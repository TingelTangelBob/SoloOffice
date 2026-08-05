import express from 'express';
import logger from '../utils/logger.js';
const router = express.Router();

// Get all yearly invoice start numbers
router.get('/', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM yearly_invoice_start_numbers ORDER BY year ASC'
    );
    
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching yearly invoice start numbers:', error);
    res.status(500).json({ error: 'Failed to fetch yearly invoice start numbers' });
  } finally {
    client.release();
  }
});

// Create or update yearly invoice start number
router.post('/', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    const { year, startNumber } = req.body;
    
    if (!year || !startNumber || startNumber < 1) {
      return res.status(400).json({ error: 'Year and start number (>= 1) are required' });
    }
    
    // Use INSERT ... ON CONFLICT to handle upsert
    const result = await client.query(`
      INSERT INTO yearly_invoice_start_numbers (year, start_number)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, year)
      DO UPDATE SET 
        start_number = EXCLUDED.start_number,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [year, startNumber]);
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating/updating yearly invoice start number:', error);
    res.status(500).json({ error: 'Failed to create/update yearly invoice start number' });
  } finally {
    client.release();
  }
});

// Delete yearly invoice start number
router.delete('/:year', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    const { year } = req.params;
    
    const result = await client.query(
      'DELETE FROM yearly_invoice_start_numbers WHERE year = $1 RETURNING *',
      [year]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Yearly start number not found' });
    }
    
    res.json({ message: 'Yearly start number deleted successfully' });
  } catch (error) {
    logger.error('Error deleting yearly invoice start number:', error);
    res.status(500).json({ error: 'Failed to delete yearly invoice start number' });
  } finally {
    client.release();
  }
});

export default router;
