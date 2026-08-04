import express from 'express';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all hourly rates
router.get('/', async (req, res) => {
  try {
    const { query } = await import('../database.js');
    const result = await query(`
      SELECT 
        id,
        name,
        description,
        rate,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM hourly_rates 
      ORDER BY is_default DESC, name ASC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching hourly rates:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Stundensätze' });
  }
});

// Create a new hourly rate
router.post('/', async (req, res) => {
  try {
    const { name, description, rate, taxRate, isDefault } = req.body;
    
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name und Stundensatz sind erforderlich' });
    }

    const { query } = await import('../database.js');
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await query('UPDATE hourly_rates SET is_default = FALSE WHERE is_default = TRUE');
    }
    
    const result = await query(`
      INSERT INTO hourly_rates (name, description, rate, tax_rate, is_default)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING 
        id,
        name,
        description,
        rate,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, [name, description || '', rate, taxRate ?? 19, isDefault || false]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating hourly rate:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Stundensatzes' });
  }
});

// Update an hourly rate
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rate, taxRate, isDefault } = req.body;
    
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name und Stundensatz sind erforderlich' });
    }

    const { query } = await import('../database.js');
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await query('UPDATE hourly_rates SET is_default = FALSE WHERE is_default = TRUE AND id != $1', [id]);
    }
    
    const result = await query(`
      UPDATE hourly_rates 
      SET name = $1, description = $2, rate = $3, tax_rate = $4, is_default = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING 
        id,
        name,
        description,
        rate,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, [name, description || '', rate, taxRate ?? 19, isDefault || false, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stundensatz nicht gefunden' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating hourly rate:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Stundensatzes' });
  }
});

// Delete an hourly rate
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { query } = await import('../database.js');
    
    const result = await query('DELETE FROM hourly_rates WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Stundensatz nicht gefunden' });
    }
    
    res.json({ message: 'Stundensatz erfolgreich gelöscht' });
  } catch (error) {
    logger.error('Error deleting hourly rate:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Stundensatzes' });
  }
});

export default router;
