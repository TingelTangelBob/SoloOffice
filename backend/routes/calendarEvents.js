import express from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

const formatEvent = (row) => ({
  id: row.id,
  eventType: row.event_type,
  title: row.title,
  startDate: row.start_date,
  endDate: row.end_date,
  notes: row.notes || undefined,
  allDay: row.all_day,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, event_type, title, start_date, end_date, notes, all_day, created_at, updated_at
      FROM calendar_events
      ORDER BY start_date ASC, end_date ASC, title ASC
    `);
    res.json(result.rows.map(formatEvent));
  } catch (error) {
    logger.error('Failed to fetch calendar events', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

router.post('/', async (req, res) => {
  const { eventType = 'vacation', title, startDate, endDate, notes, allDay = true } = req.body;

  if (eventType !== 'vacation' || !title || !startDate || !endDate) {
    return res.status(400).json({ error: 'eventType, title, startDate and endDate are required' });
  }

  if (new Date(`${endDate}T00:00:00Z`) < new Date(`${startDate}T00:00:00Z`)) {
    return res.status(400).json({ error: 'endDate must not be before startDate' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO calendar_events (id, event_type, title, start_date, end_date, notes, all_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, event_type, title, start_date, end_date, notes, all_day, created_at, updated_at
    `, [randomUUID(), eventType, title.trim(), startDate, endDate, notes || null, allDay]);
    res.status(201).json(formatEvent(result.rows[0]));
  } catch (error) {
    logger.error('Failed to create calendar event', { error: error.message });
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM calendar_events WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Calendar event not found' });
    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete calendar event', { error: error.message });
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

export default router;
