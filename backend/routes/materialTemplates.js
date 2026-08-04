import express from 'express';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all material templates
router.get('/', async (req, res) => {
  try {
    const { query } = await import('../database.js');
    const result = await query(`
      SELECT 
        id,
        name,
        description,
        unit_price as "unitPrice",
        unit,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM material_templates 
      ORDER BY is_default DESC, name ASC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching material templates:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Material-Vorlagen' });
  }
});

// Create a new material template
router.post('/', async (req, res) => {
  try {
    const { name, description, unitPrice, unit, taxRate, isDefault } = req.body;
    
    if (!name || unitPrice === undefined) {
      return res.status(400).json({ error: 'Name und Preis sind erforderlich' });
    }

    const { query } = await import('../database.js');
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await query('UPDATE material_templates SET is_default = FALSE WHERE is_default = TRUE');
    }
    
    const result = await query(`
      INSERT INTO material_templates (name, description, unit_price, unit, tax_rate, is_default)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id,
        name,
        description,
        unit_price as "unitPrice",
        unit,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, [name, description || '', unitPrice, unit || 'Stück', taxRate ?? 19, isDefault || false]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating material template:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Material-Vorlage' });
  }
});

// Update a material template
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, unitPrice, unit, taxRate, isDefault } = req.body;
    
    if (!name || unitPrice === undefined) {
      return res.status(400).json({ error: 'Name und Preis sind erforderlich' });
    }

    const { query } = await import('../database.js');
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await query('UPDATE material_templates SET is_default = FALSE WHERE is_default = TRUE AND id != $1', [id]);
    }
    
    const result = await query(`
      UPDATE material_templates 
      SET name = $1, description = $2, unit_price = $3, unit = $4, tax_rate = $5, is_default = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING 
        id,
        name,
        description,
        unit_price as "unitPrice",
        unit,
        tax_rate as "taxRate",
        is_default as "isDefault",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `, [name, description || '', unitPrice, unit || 'Stück', taxRate ?? 19, isDefault || false, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Material-Vorlage nicht gefunden' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating material template:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Material-Vorlage' });
  }
});

// Delete a material template
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { query } = await import('../database.js');
    
    const result = await query('DELETE FROM material_templates WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Material-Vorlage nicht gefunden' });
    }
    
    res.json({ message: 'Material-Vorlage erfolgreich gelöscht' });
  } catch (error) {
    logger.error('Error deleting material template:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Material-Vorlage' });
  }
});

export default router;
