import express from 'express';
import { query } from '../database.js';
import { normalizeDashboardPreferences } from '../utils/dashboardPreferences.js';

const router = express.Router();

router.get('/motion', async (req, res, next) => {
  try {
    const result = await query('SELECT animations_enabled FROM users WHERE id = $1', [req.auth.userId]);
    return res.json({ animationsEnabled: result.rows[0]?.animations_enabled !== false });
  } catch (error) { return next(error); }
});

router.put('/motion', async (req, res, next) => {
  if (typeof req.body?.animationsEnabled !== 'boolean') return res.status(400).json({ error: 'Ungültige Animationseinstellung.' });
  try {
    const result = await query('UPDATE users SET animations_enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING animations_enabled', [req.auth.userId, req.body.animationsEnabled]);
    return res.json({ animationsEnabled: result.rows[0]?.animations_enabled !== false });
  } catch (error) { return next(error); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const result = await query('SELECT dashboard_preferences FROM users WHERE id = $1', [req.auth.userId]);
    return res.json({ preferences: normalizeDashboardPreferences(result.rows[0]?.dashboard_preferences) });
  } catch (error) { return next(error); }
});

router.put('/dashboard', async (req, res, next) => {
  if (!req.body?.preferences || typeof req.body.preferences !== 'object' || Array.isArray(req.body.preferences)) {
    return res.status(400).json({ error: 'Ungültige Dashboard-Einstellungen.' });
  }
  try {
    const preferences = normalizeDashboardPreferences(req.body.preferences);
    const result = await query(
      'UPDATE users SET dashboard_preferences = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING dashboard_preferences',
      [req.auth.userId, JSON.stringify(preferences)],
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    return res.json({ preferences: normalizeDashboardPreferences(result.rows[0].dashboard_preferences) });
  } catch (error) { return next(error); }
});

export default router;
