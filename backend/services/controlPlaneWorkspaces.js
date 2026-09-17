import { randomUUID } from 'node:crypto';

import { pool } from '../database.js';
import { runWithRequestContext } from '../utils/requestContext.js';
import {
  INVITATION_MAX_AGE_MS,
  createOpaqueToken,
  createWorkspaceSlug,
  hashOpaqueToken,
} from '../utils/auth.js';

/**
 * Fachlogik der administrativen Workspace-Schnittstelle (AP-4.4).
 *
 * Bewusst getrennt von der Route: die Signaturprüfung ist Transportsache,
 * Bereitstellung und Sperre sind Datenbankvorgänge und lassen sich so gegen
 * eine Testdatenbank prüfen.
 */

export class ControlPlaneOperationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

async function lockIdempotencyKey(client, idempotencyKey) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
    [`control-plane:${idempotencyKey}`],
  );
}

async function findStoredRequest(client, idempotencyKey) {
  const result = await client.query(
    'SELECT * FROM control_plane_requests WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  return result.rows[0] || null;
}

async function storeRequest(client, { idempotencyKey, operation, requestHash, operationId, workspaceId, status, body }) {
  await client.query(`
    INSERT INTO control_plane_requests (
      idempotency_key, operation, request_hash, operation_id, workspace_id, response_status, response_body
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (idempotency_key) DO UPDATE SET
      operation = EXCLUDED.operation,
      request_hash = EXCLUDED.request_hash,
      operation_id = EXCLUDED.operation_id,
      workspace_id = EXCLUDED.workspace_id,
      response_status = EXCLUDED.response_status,
      response_body = EXCLUDED.response_body,
      updated_at = NOW()
  `, [idempotencyKey, operation, requestHash, operationId || null, workspaceId || null, status, JSON.stringify(body)]);
}

async function recordAudit(client, { operation, workspaceId, idempotencyKey, operationId, previousState, nextState, reason }) {
  await client.query(`
    INSERT INTO control_plane_audit_events (
      operation, workspace_id, idempotency_key, operation_id, previous_state, next_state, reason
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [operation, workspaceId || null, idempotencyKey || null, operationId || null, previousState || null, nextState || null, reason || null]);
}

function workspaceState(row) {
  return row.suspended_at ? 'suspended' : 'active';
}

async function seedWorkspaceDefaults(client, { workspaceId, workspaceName, ownerEmail, createdBy }) {
  // Dieselbe Grundausstattung wie bei einer Registrierung in der Fachapp.
  // Ohne sie stünde ein bereitgestellter Workspace ohne Firmenstammsatz da.
  await runWithRequestContext({ userId: createdBy || '', workspaceId }, async () => {
    await client.query(`
      INSERT INTO company (name, address, city, postal_code, country, phone, email, tax_id, invoice_start_number, workspace_id)
      VALUES ($1, '', '', '', 'Deutschland', '', $2, '', 1, $3)
    `, [workspaceName, ownerEmail, workspaceId]);
    await client.query(`
      INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default)
      VALUES ('Standard', 'Normale Arbeitszeit', 75, 19, TRUE)
    `);
    await client.query(`
      INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default)
      VALUES ('Kleinmaterial', 'Diverses Kleinmaterial', 15, 'Pauschale', 19, TRUE)
    `);
  });
}

/**
 * Legt einen Workspace an und bindet den Eigentümer.
 *
 * Existiert bereits ein Konto mit der Adresse, wird es direkt Eigentümer.
 * Andernfalls entsteht eine Eigentümer-Einladung; erst deren Annahme legt ein
 * Konto an. Die Fachapp vergibt hier bewusst kein Passwort.
 *
 * @returns {Promise<{status: number, body: object, replayed: boolean, ownerInvitationToken: string|null}>}
 */
export async function provisionWorkspace({ name, ownerEmail, idempotencyKey, operationId, requestHash }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockIdempotencyKey(client, idempotencyKey);

    const stored = await findStoredRequest(client, idempotencyKey);
    if (stored) {
      if (stored.operation !== 'provision' || stored.request_hash !== requestHash) {
        throw new ControlPlaneOperationError(
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
          'Dieser Idempotency-Key wurde bereits für einen anderen Vorgang verwendet.',
        );
      }
      await client.query('COMMIT');
      return { status: stored.response_status, body: stored.response_body, replayed: true, ownerInvitationToken: null };
    }

    const workspaceId = randomUUID();
    const workspaceResult = await client.query(`
      INSERT INTO workspaces (id, name, slug)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [workspaceId, name, createWorkspaceSlug(name)]);
    const workspace = workspaceResult.rows[0];

    const existingUser = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE',
      [ownerEmail],
    );
    const ownerUserId = existingUser.rows[0]?.id || null;

    await seedWorkspaceDefaults(client, {
      workspaceId,
      workspaceName: name,
      ownerEmail,
      createdBy: ownerUserId,
    });

    let ownerInvitationToken = null;
    let ownerInvitationExpiresAt = null;
    if (ownerUserId) {
      await client.query(`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner', updated_at = NOW()
      `, [workspaceId, ownerUserId]);
      await client.query('UPDATE workspaces SET created_by = $1 WHERE id = $2', [ownerUserId, workspaceId]);
    } else {
      ownerInvitationToken = createOpaqueToken();
      const invitation = await client.query(`
        INSERT INTO workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
        VALUES ($1, $2, 'owner', $3, NULL, NOW() + ($4::bigint * INTERVAL '1 millisecond'))
        RETURNING expires_at
      `, [workspaceId, ownerEmail, hashOpaqueToken(ownerInvitationToken), INVITATION_MAX_AGE_MS]);
      ownerInvitationExpiresAt = invitation.rows[0].expires_at;
    }

    await client.query(`
      INSERT INTO control_plane_workspaces (workspace_id, owner_email, owner_user_id, idempotency_key, operation_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [workspaceId, ownerEmail, ownerUserId, idempotencyKey, operationId || null]);

    await recordAudit(client, {
      operation: 'provision',
      workspaceId,
      idempotencyKey,
      operationId,
      previousState: null,
      nextState: 'active',
      reason: ownerUserId ? 'owner:existing-account' : 'owner:invitation',
    });

    // Der Einladungstoken wird bewusst nicht in der Antworthistorie abgelegt.
    const body = {
      workspaceId,
      name: workspace.name,
      slug: workspace.slug,
      status: 'active',
      createdAt: workspace.created_at,
      owner: {
        email: ownerEmail,
        binding: ownerUserId ? 'account' : 'invitation',
        invitationExpiresAt: ownerInvitationExpiresAt,
      },
    };
    await storeRequest(client, {
      idempotencyKey,
      operation: 'provision',
      requestHash,
      operationId,
      workspaceId,
      status: 201,
      body,
    });
    await client.query('COMMIT');
    return { status: 201, body, replayed: false, ownerInvitationToken };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sperrt oder entsperrt einen Workspace. Es werden keine Daten gelöscht:
 * Lesen und Export bleiben erlaubt, nur Schreibzugriffe werden abgewiesen.
 */
export async function setWorkspaceSuspension({ workspaceId, suspended, reason, idempotencyKey, operationId, requestHash }) {
  const operation = suspended ? 'suspend' : 'unsuspend';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockIdempotencyKey(client, idempotencyKey);

    const existing = await client.query(
      'SELECT id, name, slug, suspended_at, suspended_reason FROM workspaces WHERE id = $1 FOR UPDATE',
      [workspaceId],
    );
    if (existing.rows.length === 0) {
      throw new ControlPlaneOperationError(404, 'WORKSPACE_NOT_FOUND', 'Workspace nicht gefunden.');
    }

    const previousState = workspaceState(existing.rows[0]);
    const nextState = suspended ? 'suspended' : 'active';

    // Der Zustand wird immer gesetzt, auch bei wiederholtem Aufruf. Eine
    // zwischenzeitliche Gegenbewegung darf nicht durch einen gespeicherten
    // Antworteintrag verdeckt werden.
    const updated = await client.query(`
      UPDATE workspaces
      SET suspended_at = ${suspended ? 'COALESCE(suspended_at, NOW())' : 'NULL'},
          suspended_reason = ${suspended ? '$2' : 'NULL'},
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, slug, suspended_at, suspended_reason
    `, suspended ? [workspaceId, reason || null] : [workspaceId]);
    const workspace = updated.rows[0];

    if (previousState !== nextState) {
      await recordAudit(client, {
        operation,
        workspaceId,
        idempotencyKey,
        operationId,
        previousState,
        nextState,
        reason,
      });
    }

    const body = {
      workspaceId: workspace.id,
      name: workspace.name,
      status: nextState,
      suspendedAt: workspace.suspended_at,
      reason: workspace.suspended_reason,
      changed: previousState !== nextState,
    };
    await storeRequest(client, {
      idempotencyKey,
      operation,
      requestHash,
      operationId,
      workspaceId,
      status: 200,
      body,
    });
    await client.query('COMMIT');
    return { status: 200, body };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
