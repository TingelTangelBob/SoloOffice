import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all customers
router.get('/', async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    // Use a single query with LEFT JOINs to get all data at once
    const result = await query(`
      SELECT 
        c.id,
        c.customer_number,
        c.name,
        c.email,
        c.address,
        c.address_supplement,
        c.city,
        c.postal_code,
        c.country,
        c.tax_id,
        c.leitweg_id,
        c.phone,
        c.is_active,
        c.created_at,
        -- Additional emails (JSON aggregation)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN ce.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', ce.id,
                  'email', ce.email,
                  'label', ce.label,
                  'isActive', ce.is_active
                )
              ELSE NULL
            END
          ) FILTER (WHERE ce.id IS NOT NULL), 
          '[]'::json
        ) as additional_emails,
        -- Hourly rates (JSON aggregation)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN chr.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', chr.id,
                  'name', chr.name,
                  'description', chr.description,
                  'rate', chr.rate,
                  'taxRate', COALESCE(chr.tax_rate, 0),
                  'isDefault', chr.is_default,
                  'createdAt', chr.created_at,
                  'updatedAt', chr.updated_at
                )
              ELSE NULL
            END
          ) FILTER (WHERE chr.id IS NOT NULL), 
          '[]'::json
        ) as hourly_rates,
        -- Materials (JSON aggregation)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN cm.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', cm.id,
                  'name', cm.name,
                  'description', cm.description,
                  'unitPrice', cm.unit_price,
                  'unit', cm.unit,
                  'taxRate', COALESCE(cm.tax_rate, 0),
                  'isDefault', cm.is_default,
                  'createdAt', cm.created_at,
                  'updatedAt', cm.updated_at
                )
              ELSE NULL
            END
          ) FILTER (WHERE cm.id IS NOT NULL), 
          '[]'::json
        ) as materials
      FROM customers c
      LEFT JOIN customer_emails ce ON c.id = ce.customer_id AND ce.is_active = true
      LEFT JOIN customer_specific_hourly_rates chr ON c.id = chr.customer_id
      LEFT JOIN customer_specific_materials cm ON c.id = cm.customer_id
      WHERE ${includeArchived ? 'TRUE' : 'c.is_active = TRUE'}
      GROUP BY 
        c.id, c.customer_number, c.name, c.email, c.address, c.address_supplement, c.city, 
        c.postal_code, c.country, c.tax_id, c.leitweg_id, c.phone, c.is_active, c.created_at
      ORDER BY c.created_at DESC
    `);
    
    const customers = result.rows.map(row => ({
      id: row.id,
      customerNumber: row.customer_number,
      name: row.name,
      email: row.email,
      address: row.address,
      addressSupplement: row.address_supplement,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      taxId: row.tax_id,
      leitwegId: row.leitweg_id,
      phone: row.phone,
      isActive: row.is_active,
      additionalEmails: row.additional_emails || [],
      hourlyRates: (row.hourly_rates || []).map(rate => ({
        ...rate,
        rate: parseFloat(rate.rate),
        taxRate: parseFloat(rate.taxRate)
      })),
      materials: (row.materials || []).map(material => ({
        ...material,
        unitPrice: parseFloat(material.unitPrice),
        taxRate: parseFloat(material.taxRate)
      })),
      createdAt: row.created_at
    }));
    res.json(customers);
  } catch (error) {
    logger.error('Failed to fetch customers', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/customers'
    });
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Get customer by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use a single query with LEFT JOINs to get all data at once
    const result = await query(`
      SELECT 
        c.id,
        c.customer_number,
        c.name,
        c.email,
        c.address,
        c.address_supplement,
        c.city,
        c.postal_code,
        c.country,
        c.tax_id,
        c.leitweg_id,
        c.phone,
        c.is_active,
        c.created_at,
        -- Additional emails (JSON aggregation)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN ce.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', ce.id,
                  'email', ce.email,
                  'label', ce.label,
                  'isActive', ce.is_active
                )
              ELSE NULL
            END
          ) FILTER (WHERE ce.id IS NOT NULL), 
          '[]'::json
        ) as additional_emails,
        -- Hourly rates (JSON aggregation with ordering)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN chr.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', chr.id,
                  'name', chr.name,
                  'description', chr.description,
                  'rate', chr.rate,
                  'taxRate', COALESCE(chr.tax_rate, 0),
                  'isDefault', chr.is_default,
                  'createdAt', chr.created_at,
                  'updatedAt', chr.updated_at,
                  'sortOrder', CASE WHEN chr.is_default THEN 0 ELSE 1 END || chr.name
                )
              ELSE NULL
            END
          ) FILTER (WHERE chr.id IS NOT NULL), 
          '[]'::json
        ) as hourly_rates,
        -- Materials (JSON aggregation with ordering)
        COALESCE(
          JSON_AGG(
            CASE 
              WHEN cm.id IS NOT NULL THEN 
                JSON_BUILD_OBJECT(
                  'id', cm.id,
                  'name', cm.name,
                  'description', cm.description,
                  'unitPrice', cm.unit_price,
                  'unit', cm.unit,
                  'taxRate', COALESCE(cm.tax_rate, 0),
                  'isDefault', cm.is_default,
                  'createdAt', cm.created_at,
                  'updatedAt', cm.updated_at,
                  'sortOrder', CASE WHEN cm.is_default THEN 0 ELSE 1 END || cm.name
                )
              ELSE NULL
            END
          ) FILTER (WHERE cm.id IS NOT NULL), 
          '[]'::json
        ) as materials
      FROM customers c
      LEFT JOIN customer_emails ce ON c.id = ce.customer_id AND ce.is_active = true
      LEFT JOIN customer_specific_hourly_rates chr ON c.id = chr.customer_id
      LEFT JOIN customer_specific_materials cm ON c.id = cm.customer_id
      WHERE c.id = $1
      GROUP BY 
        c.id, c.customer_number, c.name, c.email, c.address, c.address_supplement, c.city, 
        c.postal_code, c.country, c.tax_id, c.leitweg_id, c.phone, c.is_active, c.created_at
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const row = result.rows[0];
    const customer = {
      id: row.id,
      customerNumber: row.customer_number,
      name: row.name,
      email: row.email,
      address: row.address,
      addressSupplement: row.address_supplement,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      taxId: row.tax_id,
      leitwegId: row.leitweg_id,
      phone: row.phone,
      isActive: row.is_active,
      additionalEmails: row.additional_emails || [],
      hourlyRates: (row.hourly_rates || [])
        .map(rate => ({
          id: rate.id,
          name: rate.name,
          description: rate.description,
          rate: parseFloat(rate.rate),
          taxRate: parseFloat(rate.taxRate),
          isDefault: rate.isDefault,
          createdAt: rate.createdAt,
          updatedAt: rate.updatedAt
        }))
        .sort((a, b) => {
          // Sort by isDefault first (true first), then by name
          if (a.isDefault !== b.isDefault) {
            return b.isDefault - a.isDefault;
          }
          return a.name.localeCompare(b.name);
        }),
      materials: (row.materials || [])
        .map(material => ({
          id: material.id,
          name: material.name,
          description: material.description,
          unitPrice: parseFloat(material.unitPrice),
          unit: material.unit,
          taxRate: parseFloat(material.taxRate),
          isDefault: material.isDefault,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt
        }))
        .sort((a, b) => {
          // Sort by isDefault first (true first), then by name
          if (a.isDefault !== b.isDefault) {
            return b.isDefault - a.isDefault;
          }
          return a.name.localeCompare(b.name);
        }),
      createdAt: row.created_at
    };
    
    res.json(customer);
  } catch (error) {
    logger.error('Failed to fetch customer', {
      error: error.message,
      stack: error.stack,
      customerId: req.params.id,
      method: 'GET',
      endpoint: '/customers/:id'
    });
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// Create new customer
router.post('/', async (req, res) => {
  try {
    const { name, email, address, addressSupplement, city, postalCode, country, taxId, leitwegId, phone } = req.body;

    // Generate customer number - find highest existing number and increment
    // Always format as 4-digit number with leading zeros (e.g., 0001, 0002, etc.)
    const maxNumberResult = await query('SELECT customer_number FROM customers ORDER BY CAST(customer_number AS INTEGER) DESC LIMIT 1');
    let customerNumber;
    if (maxNumberResult.rows.length === 0) {
      // No customers exist, start with 0001
      customerNumber = '0001';
    } else {
      const lastNumber = parseInt(maxNumberResult.rows[0].customer_number);
      if (isNaN(lastNumber)) {
        // Fallback if parsing fails
        customerNumber = '0001';
      } else {
        customerNumber = String(lastNumber + 1).padStart(4, '0');
      }
    }

    const result = await query(`
      INSERT INTO customers (customer_number, name, email, address, address_supplement, city, postal_code, country, tax_id, leitweg_id, phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [customerNumber, name, email || null, address, addressSupplement || null, city, postalCode, country, taxId, leitwegId || null, phone]);

    const row = result.rows[0];
    const customer = {
      id: row.id,
      customerNumber: row.customer_number,
      name: row.name,
      email: row.email,
      address: row.address,
      addressSupplement: row.address_supplement,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      taxId: row.tax_id,
      leitwegId: row.leitweg_id,
      phone: row.phone,
      isActive: row.is_active,
      createdAt: row.created_at
    };

    res.status(201).json(customer);
  } catch (error) {
    logger.error('Failed to create customer', {
      error: error.message,
      stack: error.stack,
      customerData: { name: req.body.name, email: req.body.email },
      method: 'POST',
      endpoint: '/customers'
    });
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Update customer
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, address, addressSupplement, city, postalCode, country, taxId, leitwegId, phone } = req.body;

    const result = await query(`
      UPDATE customers 
      SET name = $1, email = $2, address = $3, address_supplement = $4, city = $5, postal_code = $6, 
          country = $7, tax_id = $8, leitweg_id = $9, phone = $10
      WHERE id = $11
      RETURNING *
    `, [name, email || null, address, addressSupplement || null, city, postalCode, country, taxId, leitwegId || null, phone, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const row = result.rows[0];
    const customer = {
      id: row.id,
      customerNumber: row.customer_number,
      name: row.name,
      email: row.email,
      address: row.address,
      addressSupplement: row.address_supplement,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      taxId: row.tax_id,
      leitwegId: row.leitweg_id,
      phone: row.phone,
      isActive: row.is_active,
      createdAt: row.created_at
    };

    res.json(customer);
  } catch (error) {
    logger.error('Failed to update customer', {
      error: error.message,
      stack: error.stack,
      customerId: req.params.id,
      customerData: { name: req.body.name, email: req.body.email },
      method: 'PUT',
      endpoint: '/customers/:id'
    });
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Customers are archived so historical documents remain intact.
router.post('/:id/archive', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('UPDATE customers SET is_active = FALSE WHERE id = $1 RETURNING id, is_active', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ id: result.rows[0].id, isActive: result.rows[0].is_active });
  } catch (error) {
    logger.error('Failed to archive customer', {
      error: error.message,
      stack: error.stack,
      customerId: req.params.id,
      method: 'POST',
      endpoint: '/customers/:id/archive'
    });
    res.status(500).json({ error: 'Failed to archive customer' });
  }
});

router.post('/:id/restore', async (req, res) => {
  try {
    const result = await query('UPDATE customers SET is_active = TRUE WHERE id = $1 RETURNING id, is_active', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ id: result.rows[0].id, isActive: result.rows[0].is_active });
  } catch (error) {
    logger.error('Failed to restore customer', { error: error.message, customerId: req.params.id });
    res.status(500).json({ error: 'Failed to restore customer' });
  }
});

router.delete('/:id', async (req, res) => {
  res.status(405).json({ error: 'Kunden werden archiviert und nicht gelöscht.' });
});

// Add additional email to customer
router.post('/:id/emails', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, label } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Check if email already exists for this customer
    const existingEmailResult = await query(
      'SELECT id FROM customer_emails WHERE customer_id = $1 AND email = $2',
      [id, email]
    );
    
    if (existingEmailResult.rows.length > 0) {
      return res.status(400).json({ error: 'Email address already exists for this customer' });
    }

    const result = await query(`
      INSERT INTO customer_emails (customer_id, email, label, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING id, email, label, is_active
    `, [id, email, label || null]);

    const newEmail = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      label: result.rows[0].label,
      isActive: result.rows[0].is_active
    };

    res.status(201).json(newEmail);
  } catch (error) {
    logger.error('Error adding customer email:', error);
    res.status(500).json({ error: 'Failed to add customer email' });
  }
});

// Update additional email
router.put('/:customerId/emails/:emailId', async (req, res) => {
  try {
    const { customerId, emailId } = req.params;
    const { email, label } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email belongs to customer
    const result = await query(`
      UPDATE customer_emails 
      SET email = $1, label = $2
      WHERE id = $3 AND customer_id = $4
      RETURNING id, email, label, is_active
    `, [email, label || null, emailId, customerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const updatedEmail = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      label: result.rows[0].label,
      isActive: result.rows[0].is_active
    };

    res.json(updatedEmail);
  } catch (error) {
    logger.error('Error updating customer email:', error);
    res.status(500).json({ error: 'Failed to update customer email' });
  }
});

// Delete additional email
router.delete('/:customerId/emails/:emailId', async (req, res) => {
  try {
    const { customerId, emailId } = req.params;

    const result = await query(
      'DELETE FROM customer_emails WHERE id = $1 AND customer_id = $2 RETURNING id',
      [emailId, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json({ message: 'Email deleted successfully' });
  } catch (error) {
    logger.error('Error deleting customer email:', error);
    res.status(500).json({ error: 'Failed to delete customer email' });
  }
});

// Get customer-specific hourly rates
router.get('/:id/hourly-rates', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const result = await query(`
      SELECT id, name, description, rate, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
      FROM customer_specific_hourly_rates
      WHERE customer_id = $1
      ORDER BY is_default DESC, name ASC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching customer hourly rates:', error);
    res.status(500).json({ error: 'Failed to fetch customer hourly rates' });
  }
});

// Create customer-specific hourly rate
router.post('/:id/hourly-rates', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rate, taxRate, isDefault } = req.body;

    if (!name || rate === undefined || rate === null) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }

    // Check if customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // If this is set as default, unset other defaults for this customer
    if (isDefault) {
      await query('UPDATE customer_specific_hourly_rates SET is_default = FALSE WHERE customer_id = $1 AND is_default = TRUE', [id]);
    }

    const result = await query(`
      INSERT INTO customer_specific_hourly_rates (customer_id, name, description, rate, tax_rate, is_default)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, description, rate, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
    `, [id, name, description || null, parseFloat(rate), taxRate !== undefined && taxRate !== null ? parseFloat(taxRate) : 19, isDefault || false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating customer hourly rate:', error);
    res.status(500).json({ error: 'Failed to create customer hourly rate' });
  }
});

// Update customer-specific hourly rate
router.put('/:customerId/hourly-rates/:rateId', async (req, res) => {
  try {
    const { customerId, rateId } = req.params;
    const { name, description, rate, taxRate, isDefault } = req.body;

    if (!name || rate === undefined || rate === null) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }

    // If this is set as default, unset other defaults for this customer
    if (isDefault) {
      await query('UPDATE customer_specific_hourly_rates SET is_default = FALSE WHERE customer_id = $1 AND is_default = TRUE AND id != $2', [customerId, rateId]);
    }

    const result = await query(`
      UPDATE customer_specific_hourly_rates 
      SET name = $1, description = $2, rate = $3, tax_rate = $4, is_default = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND customer_id = $7
      RETURNING id, name, description, rate, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
    `, [name, description || null, parseFloat(rate), taxRate !== undefined && taxRate !== null ? parseFloat(taxRate) : 19, isDefault || false, rateId, customerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer hourly rate not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating customer hourly rate:', error);
    res.status(500).json({ error: 'Failed to update customer hourly rate' });
  }
});

// Delete customer-specific hourly rate
router.delete('/:customerId/hourly-rates/:rateId', async (req, res) => {
  try {
    const { customerId, rateId } = req.params;

    const result = await query(
      'DELETE FROM customer_specific_hourly_rates WHERE id = $1 AND customer_id = $2 RETURNING id',
      [rateId, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer hourly rate not found' });
    }

    res.json({ message: 'Customer hourly rate deleted successfully' });
  } catch (error) {
    logger.error('Error deleting customer hourly rate:', error);
    res.status(500).json({ error: 'Failed to delete customer hourly rate' });
  }
});

// Get customer-specific materials
router.get('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const result = await query(`
      SELECT id, name, description, unit_price as "unitPrice", unit, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
      FROM customer_specific_materials
      WHERE customer_id = $1
      ORDER BY is_default DESC, name ASC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching customer materials:', error);
    res.status(500).json({ error: 'Failed to fetch customer materials' });
  }
});

// Create customer-specific material
router.post('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, unitPrice, unit, taxRate, isDefault } = req.body;

    if (!name || unitPrice === undefined || unitPrice === null) {
      return res.status(400).json({ error: 'Name and unit price are required' });
    }

    // Check if customer exists
    const customerResult = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // If this is set as default, unset other defaults for this customer
    if (isDefault) {
      await query('UPDATE customer_specific_materials SET is_default = FALSE WHERE customer_id = $1 AND is_default = TRUE', [id]);
    }

    const result = await query(`
      INSERT INTO customer_specific_materials (customer_id, name, description, unit_price, unit, tax_rate, is_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, description, unit_price as "unitPrice", unit, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
    `, [id, name, description || null, parseFloat(unitPrice), unit || 'Stück', taxRate !== undefined && taxRate !== null ? parseFloat(taxRate) : 19, isDefault || false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating customer material:', error);
    res.status(500).json({ error: 'Failed to create customer material' });
  }
});

// Update customer-specific material
router.put('/:customerId/materials/:materialId', async (req, res) => {
  try {
    const { customerId, materialId } = req.params;
    const { name, description, unitPrice, unit, taxRate, isDefault } = req.body;

    if (!name || unitPrice === undefined || unitPrice === null) {
      return res.status(400).json({ error: 'Name and unit price are required' });
    }

    // If this is set as default, unset other defaults for this customer
    if (isDefault) {
      await query('UPDATE customer_specific_materials SET is_default = FALSE WHERE customer_id = $1 AND is_default = TRUE AND id != $2', [customerId, materialId]);
    }

    const result = await query(`
      UPDATE customer_specific_materials 
      SET name = $1, description = $2, unit_price = $3, unit = $4, tax_rate = $5, is_default = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND customer_id = $8
      RETURNING id, name, description, unit_price as "unitPrice", unit, tax_rate as "taxRate", is_default as "isDefault", created_at as "createdAt", updated_at as "updatedAt"
    `, [name, description || null, parseFloat(unitPrice), unit || 'Stück', taxRate !== undefined && taxRate !== null ? parseFloat(taxRate) : 19, isDefault || false, materialId, customerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer material not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating customer material:', error);
    res.status(500).json({ error: 'Failed to update customer material' });
  }
});

// Delete customer-specific material
router.delete('/:customerId/materials/:materialId', async (req, res) => {
  try {
    const { customerId, materialId } = req.params;

    const result = await query(
      'DELETE FROM customer_specific_materials WHERE id = $1 AND customer_id = $2 RETURNING id',
      [materialId, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer material not found' });
    }

    res.json({ message: 'Customer material deleted successfully' });
  } catch (error) {
    logger.error('Error deleting customer material:', error);
    res.status(500).json({ error: 'Failed to delete customer material' });
  }
});

export default router;
