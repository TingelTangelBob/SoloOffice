import express from 'express';
import { query } from '../database.js';

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

export default router;
