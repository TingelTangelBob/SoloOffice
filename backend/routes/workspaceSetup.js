import express from 'express';
import { query } from '../database.js';

const router = express.Router();
const choices = new Set(['undecided', 'takeover', 'no_legacy_data']);

function mapRow(row) {
  return {
    currentStep: row.current_step,
    completedAt: row.completed_at,
    migrationChoice: row.migration_choice,
    setupRequired: row.setup_required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/', async (_req, res) => {
  const result = await query(`
    SELECT * FROM workspace_setup
    WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  `);
  if (!result.rows[0]) return res.status(404).json({ error: 'Einrichtungsstatus nicht gefunden.' });
  return res.json(mapRow(result.rows[0]));
});

router.patch('/', async (req, res) => {
  const currentStep = req.body.currentStep;
  const migrationChoice = req.body.migrationChoice;
  const completing = req.body.complete === true;
  if (currentStep !== undefined && (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > 5)) {
    return res.status(400).json({ error: 'Der Einrichtungsschritt muss zwischen 1 und 5 liegen.' });
  }
  if (migrationChoice !== undefined && !choices.has(migrationChoice)) {
    return res.status(400).json({ error: 'Die Auswahl zur Datenübernahme ist ungültig.' });
  }
  if (completing && migrationChoice === undefined) {
    return res.status(400).json({ error: 'Bitte eine Entscheidung zur Datenübernahme treffen.' });
  }
  if (completing && !['takeover', 'no_legacy_data'].includes(migrationChoice)) {
    return res.status(400).json({ error: 'Bitte Datenübernahme starten oder „Keine Altdaten“ auswählen.' });
  }

  const result = await query(`
    UPDATE workspace_setup
    SET current_step = COALESCE($1, current_step),
        migration_choice = COALESCE($2, migration_choice),
        completed_at = CASE WHEN $3 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
        setup_required = CASE WHEN $3 THEN FALSE ELSE setup_required END,
        updated_at = NOW()
    WHERE workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    RETURNING *
  `, [completing ? 5 : currentStep ?? null, migrationChoice ?? null, completing]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Einrichtungsstatus nicht gefunden.' });
  return res.json(mapRow(result.rows[0]));
});

export default router;
