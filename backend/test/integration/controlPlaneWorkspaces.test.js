import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool } from '../../database.js';
import {
  ControlPlaneOperationError,
  provisionWorkspace,
  setWorkspaceSuspension,
} from '../../services/controlPlaneWorkspaces.js';
import { deleteWorkspaceData } from '../../services/workspaceDeletion.js';
import { runWithRequestContext } from '../../utils/requestContext.js';
import { hashPassword } from '../../utils/auth.js';
import { requestHash } from '../../utils/controlPlaneAuth.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const suffix = randomUUID().slice(0, 8);
const createdWorkspaces = new Set();
const createdKeys = new Set();
const createdUsers = new Set();

function key(name) {
  const value = `control-plane-test:${suffix}:${name}`;
  createdKeys.add(value);
  return value;
}

async function provision({ name, ownerEmail, idempotencyKey, payloadOverride }) {
  const payload = payloadOverride || { name, ownerEmail };
  const result = await provisionWorkspace({
    name,
    ownerEmail,
    idempotencyKey,
    operationId: `binding-${suffix}`,
    requestHash: requestHash(JSON.stringify(payload)),
  });
  if (result.body?.workspaceId) createdWorkspaces.add(result.body.workspaceId);
  return result;
}

after(async () => {
  for (const workspaceId of createdWorkspaces) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await runWithRequestContext({ workspaceId }, () => deleteWorkspaceData(client, workspaceId));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  await pool.query('DELETE FROM control_plane_audit_events WHERE idempotency_key = ANY($1::text[])', [[...createdKeys]]);
  await pool.query('DELETE FROM control_plane_requests WHERE idempotency_key = ANY($1::text[])', [[...createdKeys]]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[...createdUsers]]);
  await pool.end();
});

test('Bereitstellung legt Workspace, Grundausstattung und Eigentümer-Einladung an', async () => {
  const ownerEmail = `inhaber-${suffix}@example.com`;
  const result = await provision({
    name: 'Control-Plane Test GmbH',
    ownerEmail,
    idempotencyKey: key('provision'),
  });

  assert.equal(result.status, 201);
  assert.equal(result.replayed, false);
  assert.equal(result.body.status, 'active');
  assert.equal(result.body.name, 'Control-Plane Test GmbH');
  assert.match(result.body.workspaceId, /^[0-9a-f-]{36}$/);
  assert.equal(result.body.owner.binding, 'invitation');
  assert.ok(result.ownerInvitationToken, 'Ohne bestehendes Konto muss ein Einladungstoken entstehen.');

  const workspaceId = result.body.workspaceId;
  const invitation = await pool.query(
    'SELECT role, email, invited_by, accepted_at FROM workspace_invitations WHERE workspace_id = $1',
    [workspaceId],
  );
  assert.equal(invitation.rows.length, 1);
  assert.equal(invitation.rows[0].role, 'owner');
  assert.equal(invitation.rows[0].email, ownerEmail);
  assert.equal(invitation.rows[0].invited_by, null);

  // Grundausstattung wie bei einer Registrierung, sonst steht der Workspace
  // ohne Firmenstammsatz da.
  const seeded = await runWithRequestContext({ workspaceId }, async () => ({
    company: await pool.query('SELECT name, email FROM company WHERE workspace_id = $1', [workspaceId]),
    rates: await pool.query('SELECT COUNT(*)::int AS count FROM hourly_rates WHERE workspace_id = $1', [workspaceId]),
    materials: await pool.query('SELECT COUNT(*)::int AS count FROM material_templates WHERE workspace_id = $1', [workspaceId]),
  }));
  assert.equal(seeded.company.rows[0]?.name, 'Control-Plane Test GmbH');
  assert.equal(seeded.company.rows[0]?.email, ownerEmail);
  assert.equal(seeded.rates.rows[0].count, 1);
  assert.equal(seeded.materials.rows[0].count, 1);

  const binding = await pool.query('SELECT owner_email, owner_user_id FROM control_plane_workspaces WHERE workspace_id = $1', [workspaceId]);
  assert.equal(binding.rows[0]?.owner_email, ownerEmail);
  assert.equal(binding.rows[0]?.owner_user_id, null);
});

test('derselbe Idempotency-Key erzeugt keinen zweiten Workspace', async () => {
  const ownerEmail = `wiederholung-${suffix}@example.com`;
  const idempotencyKey = key('provision-repeat');
  const name = 'Wiederholung GmbH';

  const first = await provision({ name, ownerEmail, idempotencyKey });
  const second = await provision({ name, ownerEmail, idempotencyKey });
  const third = await provision({ name, ownerEmail, idempotencyKey });

  assert.equal(second.replayed, true);
  assert.equal(third.replayed, true);
  assert.equal(second.body.workspaceId, first.body.workspaceId);
  assert.equal(third.body.workspaceId, first.body.workspaceId);
  assert.equal(second.ownerInvitationToken, null);

  const workspaces = await pool.query('SELECT COUNT(*)::int AS count FROM workspaces WHERE name = $1', [name]);
  assert.equal(workspaces.rows[0].count, 1);
});

test('ein wiederverwendeter Schlüssel mit anderem Inhalt wird abgelehnt', async () => {
  const idempotencyKey = key('provision-conflict');
  await provision({ name: 'Konflikt GmbH', ownerEmail: `konflikt-${suffix}@example.com`, idempotencyKey });

  await assert.rejects(
    () => provision({
      name: 'Andere GmbH',
      ownerEmail: `konflikt-${suffix}@example.com`,
      idempotencyKey,
      payloadOverride: { name: 'Andere GmbH', ownerEmail: `konflikt-${suffix}@example.com` },
    }),
    error => {
      assert.ok(error instanceof ControlPlaneOperationError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT');
      return true;
    },
  );

  const workspaces = await pool.query("SELECT COUNT(*)::int AS count FROM workspaces WHERE name = 'Andere GmbH'");
  assert.equal(workspaces.rows[0].count, 0);
});

test('ein bestehendes Konto wird direkt Eigentümer', async () => {
  const ownerEmail = `bestandskonto-${suffix}@example.com`;
  const user = await pool.query(`
    INSERT INTO users (email, password_hash, first_name, last_name, email_verified_at)
    VALUES ($1, $2, 'Test', 'Konto', NOW())
    RETURNING id
  `, [ownerEmail, await hashPassword('ein-sehr-gutes-passwort')]);
  createdUsers.add(user.rows[0].id);

  const result = await provision({
    name: 'Bestandskonto GmbH',
    ownerEmail,
    idempotencyKey: key('provision-existing-user'),
  });

  assert.equal(result.body.owner.binding, 'account');
  assert.equal(result.ownerInvitationToken, null);

  const membership = await pool.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [result.body.workspaceId, user.rows[0].id],
  );
  assert.equal(membership.rows[0]?.role, 'owner');
});

test('Sperren und Entsperren ändern nur den Zustand, nicht die Daten', async () => {
  const provisioned = await provision({
    name: 'Sperr-Test GmbH',
    ownerEmail: `sperre-${suffix}@example.com`,
    idempotencyKey: key('provision-suspend'),
  });
  const workspaceId = provisioned.body.workspaceId;

  const suspended = await setWorkspaceSuspension({
    workspaceId,
    suspended: true,
    reason: 'subscription:past_due',
    idempotencyKey: key('suspend'),
    operationId: `binding-${suffix}`,
    requestHash: requestHash(JSON.stringify({ reason: 'subscription:past_due' })),
  });
  assert.equal(suspended.body.status, 'suspended');
  assert.equal(suspended.body.changed, true);
  assert.ok(suspended.body.suspendedAt);

  // Wiederholter Aufruf bleibt folgenlos und verschiebt den Zeitpunkt nicht.
  const again = await setWorkspaceSuspension({
    workspaceId,
    suspended: true,
    reason: 'subscription:past_due',
    idempotencyKey: key('suspend'),
    operationId: `binding-${suffix}`,
    requestHash: requestHash(JSON.stringify({ reason: 'subscription:past_due' })),
  });
  assert.equal(again.body.changed, false);
  assert.deepEqual(again.body.suspendedAt, suspended.body.suspendedAt);

  const company = await runWithRequestContext({ workspaceId }, () => pool.query(
    'SELECT COUNT(*)::int AS count FROM company WHERE workspace_id = $1',
    [workspaceId],
  ));
  assert.equal(company.rows[0].count, 1, 'Eine Sperre darf keine Daten entfernen.');

  const unsuspended = await setWorkspaceSuspension({
    workspaceId,
    suspended: false,
    reason: 'subscription:active',
    idempotencyKey: key('unsuspend'),
    operationId: `binding-${suffix}`,
    requestHash: requestHash(JSON.stringify({ reason: 'subscription:active' })),
  });
  assert.equal(unsuspended.body.status, 'active');
  assert.equal(unsuspended.body.suspendedAt, null);
  assert.equal(unsuspended.body.changed, true);

  // Erneutes Sperren mit demselben Schlüssel muss wieder greifen; eine
  // gespeicherte Antwort darf den Zustand nicht einfrieren.
  const resuspended = await setWorkspaceSuspension({
    workspaceId,
    suspended: true,
    reason: 'subscription:past_due',
    idempotencyKey: key('suspend'),
    operationId: `binding-${suffix}`,
    requestHash: requestHash(JSON.stringify({ reason: 'subscription:past_due' })),
  });
  assert.equal(resuspended.body.status, 'suspended');
  assert.equal(resuspended.body.changed, true);

  const audit = await pool.query(
    'SELECT operation, previous_state, next_state FROM control_plane_audit_events WHERE workspace_id = $1 ORDER BY created_at ASC',
    [workspaceId],
  );
  assert.deepEqual(audit.rows.map(row => row.operation), ['provision', 'suspend', 'unsuspend', 'suspend']);
});

test('unbekannte Workspaces werden nicht stillschweigend akzeptiert', async () => {
  await assert.rejects(
    () => setWorkspaceSuspension({
      workspaceId: randomUUID(),
      suspended: true,
      reason: 'test',
      idempotencyKey: key('suspend-unknown'),
      operationId: null,
      requestHash: requestHash('{}'),
    }),
    error => {
      assert.ok(error instanceof ControlPlaneOperationError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'WORKSPACE_NOT_FOUND');
      return true;
    },
  );
});
