import express from 'express';
import { pool } from '../database.js';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { findAllJobs, findJobById } from '../queries/jobQueries.js';

const router = express.Router();

// Helper function to safely parse materials
const parseMaterials = (materialsData) => {
  if (!materialsData || materialsData === 'null' || materialsData === null || materialsData === '') {
    return [];
  }
  
  // If it's already an array, return it
  if (Array.isArray(materialsData)) {
    return materialsData;
  }
  
  // If it's a string, try to parse it
  if (typeof materialsData === 'string') {
    try {
      return JSON.parse(materialsData);
    } catch (error) {
      logger.warn('Failed to parse materials string', { 
        error: error.message, 
        materialsData: typeof materialsData === 'string' ? materialsData.substring(0, 100) : materialsData 
      });
      return [];
    }
  }
  
  // For any other type, return empty array
  return [];
};

const isValidTimeZone = (value) => {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const parseRecurrence = (row) => {
  if (!row.recurrence_id || !row.recurrence_rule) return undefined;
  let rule = row.recurrence_rule;
  if (typeof rule === 'string') {
    try {
      rule = JSON.parse(rule);
    } catch {
      return undefined;
    }
  }
  return {
    ...rule,
    id: row.recurrence_id,
    occurrenceIndex: row.recurrence_index,
    totalOccurrences: row.recurrence_total,
  };
};

// Helper function to format job data
const formatJobData = (row, customerName = null) => ({
  id: row.id,
  jobNumber: row.job_number,
  externalJobNumber: row.external_job_number,
  customerId: row.customer_id,
  customerName: customerName || row.customer_name || '',
  customerAddress: row.customer_address,
  location: row.location,
  alternateLocation: row.alternate_location || '',
  timeZone: row.time_zone || 'Europe/Berlin',
  title: row.title || '',
  description: row.description || '',
  date: row.date,
  startTime: row.start_time,
  endTime: row.end_time,
  hoursWorked: parseFloat(row.hours_worked) || 0,
  hourlyRate: parseFloat(row.hourly_rate) || 0,
  hourlyRateId: row.hourly_rate_id,
  timeEntries: row.time_entries || [],
  materials: parseMaterials(row.materials),
  status: row.status,
  notes: row.notes,
  priority: row.priority,
  attachments: row.attachments || [],
  signature: row.signature || null,
  recurrence: parseRecurrence(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const parseDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return new Date(NaN);
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return new Date(NaN);
  return date;
};

const formatDateOnly = (value) => value.toISOString().split('T')[0];

const normalizeRecurrence = (value) => {
  if (!value) return null;

  const intervalUnit = value.intervalUnit || 'week';
  const interval = Math.floor(Number(value.interval));
  const startDate = String(value.startDate || '');
  const parsedStartDate = parseDateOnly(startDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime())) {
    throw new Error('Ungültiges Startdatum für die Wiederholung');
  }

  const duration = Math.floor(Number(value.duration ?? value.durationWeeks));
  const maxDuration = intervalUnit === 'week' ? 104 : intervalUnit === 'month' ? 120 : 100;
  if (!['week', 'month', 'year'].includes(intervalUnit) || !Number.isInteger(interval) || interval < 1 || interval > maxDuration) {
    throw new Error('Ungültiges Wiederholungsintervall');
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > maxDuration) {
    throw new Error('Ungültige Wiederholungsdauer');
  }

  const startWeekday = parsedStartDate.getUTCDay() === 0 ? 7 : parsedStartDate.getUTCDay();
  const weekdays = [...new Set([startWeekday, ...(Array.isArray(value.weekdays) ? value.weekdays : [])].map(Number))]
    .filter(day => day >= 1 && day <= 7)
    .sort((a, b) => a - b);

  return {
    intervalUnit,
    interval,
    startDate,
    duration,
    ...(intervalUnit === 'week' ? { weekdays, durationWeeks: duration } : {}),
  };
};

const expandRecurrence = (rule) => {
  const startDate = parseDateOnly(rule.startDate);
  const duration = Number(rule.duration ?? rule.durationWeeks);
  if (Number.isNaN(startDate.getTime()) || !Number.isFinite(duration)) return [];

  if (rule.intervalUnit === 'month' || rule.intervalUnit === 'year') {
    const dates = [];
    for (let offset = 0; offset < duration; offset += rule.interval) {
      const occurrence = new Date(startDate);
      occurrence.setUTCDate(1);
      if (rule.intervalUnit === 'month') {
        occurrence.setUTCMonth(startDate.getUTCMonth() + offset);
      } else {
        occurrence.setUTCFullYear(startDate.getUTCFullYear() + offset);
      }
      const daysInMonth = new Date(Date.UTC(occurrence.getUTCFullYear(), occurrence.getUTCMonth() + 1, 0)).getUTCDate();
      occurrence.setUTCDate(Math.min(startDate.getUTCDate(), daysInMonth));
      dates.push(formatDateOnly(occurrence));
    }
    return dates;
  }

  const isoWeekday = startDate.getUTCDay() === 0 ? 7 : startDate.getUTCDay();
  const startMonday = new Date(startDate);
  startMonday.setUTCDate(startMonday.getUTCDate() - (isoWeekday - 1));
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + duration * 7);
  const weekdays = [...new Set([isoWeekday, ...(rule.weekdays || [])])].sort((a, b) => a - b);
  const dates = [];

  for (let weekOffset = 0; ; weekOffset += rule.interval) {
    const weekStart = new Date(startMonday);
    weekStart.setUTCDate(startMonday.getUTCDate() + weekOffset * 7);
    if (weekStart >= endDate) break;
    for (const weekday of weekdays) {
      const occurrence = new Date(weekStart);
      occurrence.setUTCDate(weekStart.getUTCDate() + weekday - 1);
      if (occurrence >= startDate && occurrence < endDate) dates.push(formatDateOnly(occurrence));
    }
  }

  return dates;
};

const generateJobNumber = async (client) => {
  const currentYear = new Date().getFullYear();
  const yearPattern = `AB-${currentYear}-%`;
  const lastJobResult = await client.query(
    'SELECT job_number FROM job_entries WHERE job_number LIKE $1 ORDER BY created_at DESC, job_number DESC LIMIT 1',
    [yearPattern]
  );

  if (lastJobResult.rows.length === 0) return `AB-${currentYear}-001`;
  const lastJobNumber = lastJobResult.rows[0].job_number || '';
  const numberPart = lastJobNumber.startsWith(`AB-${currentYear}-`)
    ? lastJobNumber.substring(`AB-${currentYear}-`.length)
    : '';
  const lastNumber = parseInt(numberPart, 10);
  return `AB-${currentYear}-${String(Number.isNaN(lastNumber) ? 1 : lastNumber + 1).padStart(3, '0')}`;
};

const insertJobInstance = async (client, data) => {
  const jobNumber = await generateJobNumber(client);
  const result = await client.query(`
    INSERT INTO job_entries (
      job_number, external_job_number, customer_id, customer_address, location, alternate_location, time_zone, title, description, date,
      start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, materials, status, notes, priority,
      recurrence_id, recurrence_index, recurrence_total
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    RETURNING id
  `, [
    jobNumber,
    data.externalJobNumber || null,
    data.customerId || null,
    data.customerAddress || null,
    data.location || null,
    data.alternateLocation || null,
    data.timeZone || 'Europe/Berlin',
    data.title || null,
    data.description || null,
    data.date,
    data.startTime || null,
    data.endTime || null,
    data.hoursWorked || 0,
    data.hourlyRate || 0,
    data.hourlyRateId || null,
    JSON.stringify(data.materials || []),
    data.status || 'draft',
    data.notes || null,
    data.priority || null,
    data.recurrenceId || null,
    data.recurrenceIndex || null,
    data.recurrenceTotal || null,
  ]);

  const jobId = result.rows[0].id;
  const timeEntries = Array.isArray(data.timeEntries) ? data.timeEntries : [];
  if (timeEntries.length > 0) {
    for (const timeEntry of timeEntries) {
      await client.query(`
        INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        jobId,
        timeEntry.description || '',
        timeEntry.startTime || null,
        timeEntry.endTime || null,
        timeEntry.hoursWorked || 0,
        timeEntry.hourlyRate || 0,
        timeEntry.hourlyRateId || null,
        timeEntry.taxRate != null ? timeEntry.taxRate : 19,
        timeEntry.total || 0,
      ]);
    }
  } else if (data.hoursWorked > 0 || data.startTime || data.endTime) {
    await client.query(`
      INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      jobId,
      'Arbeitszeit',
      data.startTime || null,
      data.endTime || null,
      data.hoursWorked || 0,
      data.hourlyRate || 0,
      data.hourlyRateId || null,
      19,
      (data.hoursWorked || 0) * (data.hourlyRate || 0),
    ]);
  }

  if (Array.isArray(data.attachments)) {
    for (const attachment of data.attachments) {
      await client.query(`
        INSERT INTO job_attachments (job_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [jobId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }
  }

  return jobId;
};

// Get all job entries
router.get('/', async (req, res) => {
  try {
    const jobs = await findAllJobs();
    res.json(jobs);
  } catch (error) {
    logger.error('Failed to fetch jobs', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get a specific job entry
router.get('/:id', async (req, res) => {
  try {
    const job = await findJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (error) {
    logger.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Create a new job entry
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      customerId,
      customerAddress,
      location,
      alternateLocation,
      timeZone,
      title,
      description,
      date,
      startTime,
      endTime,
      hoursWorked,
      hourlyRate,
      hourlyRateId,
      timeEntries,
      materials,
      status,
      notes,
      priority,
      attachments,
      externalJobNumber,
      recurrence: recurrenceInput,
    } = req.body;

    const targetStatus = status || 'draft';
    const effectiveTimeZone = timeZone || 'Europe/Berlin';

    if (!isValidTimeZone(effectiveTimeZone)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ungültige Zeitzone für den Kurs.' });
    }

    // Drafts may be incomplete. Active workflow stages require all core fields.
    if (targetStatus !== 'draft' && (!customerId || !String(title || '').trim() || !String(description || '').trim())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Pflichtfelder fehlen',
        details: {
          customerId: !customerId ? 'Kunde ist erforderlich' : null,
          title: !String(title || '').trim() ? 'Titel ist erforderlich' : null,
          description: !String(description || '').trim() ? 'Beschreibung ist erforderlich' : null
        }
      });
    }

    // Get customer name when a draft already has a customer.
    if (customerId) {
      const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
      if (customerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Customer not found', customerId });
      }
    }

    // Validate date format
    const jobDate = new Date(date);
    if (isNaN(jobDate.getTime())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid date format' });
    }
    const formattedDate = jobDate.toISOString().split('T')[0]; // YYYY-MM-DD format

    let recurrence;
    try {
      recurrence = normalizeRecurrence(recurrenceInput);
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: error.message });
    }

    const occurrenceDates = recurrence ? expandRecurrence(recurrence) : [formattedDate];
    if (occurrenceDates.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Die Wiederholung erzeugt keine gültige Einheit.' });
    }

    let recurrenceId = null;
    if (recurrence) {
      const recurrenceResult = await client.query(
        'INSERT INTO job_recurrences (rule) VALUES ($1) RETURNING id',
        [JSON.stringify(recurrence)]
      );
      recurrenceId = recurrenceResult.rows[0].id;
    }

    const createdJobIds = [];
    for (const [index, occurrenceDate] of occurrenceDates.entries()) {
      const createdJobId = await insertJobInstance(client, {
        customerId,
        customerAddress,
        location,
        alternateLocation,
        timeZone: effectiveTimeZone,
        title,
        description,
        date: occurrenceDate,
        startTime,
        endTime,
        hoursWorked,
        hourlyRate,
        hourlyRateId,
        timeEntries,
        materials,
        status,
        notes,
        priority,
        attachments,
        externalJobNumber,
        recurrenceId,
        recurrenceIndex: recurrence ? index + 1 : null,
        recurrenceTotal: recurrence ? occurrenceDates.length : null,
      });
      createdJobIds.push(createdJobId);
    }

    const jobId = createdJobIds[0];

    await client.query('COMMIT');

    // Fetch the complete job with attachments and time entries
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name, jr.rule as recurrence_rule,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             COALESCE(
               json_agg(
                 DISTINCT jsonb_build_object(
                   'id', jte.id,
                   'description', jte.description,
                   'startTime', jte.start_time,
                   'endTime', jte.end_time,
                   'hoursWorked', jte.hours_worked,
                   'hourlyRate', jte.hourly_rate,
                   'hourlyRateId', jte.hourly_rate_id,
                   'taxRate', jte.tax_rate,
                   'total', jte.total
                 )
               ) FILTER (WHERE jte.id IS NOT NULL), '[]'::json
             ) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_recurrences jr ON j.recurrence_id = jr.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name, jr.rule
    `, [jobId]);

    const job = formatJobData(completeJob.rows[0]);
    res.status(201).json(job);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating job:', error);
    res.status(500).json({ 
      error: 'Failed to create job', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    client.release();
  }
});

// Update a job entry
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Check if job exists and get current status
    const currentJobResult = await client.query(
      'SELECT status, recurrence_id, customer_id, title, description FROM job_entries WHERE id = $1',
      [id]
    );
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];

    const existingSeriesResult = currentJob.recurrence_id
      ? await client.query(
        'SELECT * FROM job_entries WHERE recurrence_id = $1 ORDER BY recurrence_index ASC, created_at ASC',
        [currentJob.recurrence_id]
      )
      : { rows: [] };
    
    // Prevent editing if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot edit invoiced job', 
        message: 'Jobs that have been invoiced cannot be modified to maintain invoice integrity.' 
      });
    }
    
    const {
      customerId,
      customerAddress,
      location,
      alternateLocation,
      timeZone,
      title,
      description,
      date,
      startTime,
      endTime,
      hoursWorked,
      hourlyRate,
      hourlyRateId,
      materials,
      status,
      notes,
      priority,
      attachments,
      timeEntries,
      externalJobNumber,
      recurrence: recurrenceInput,
    } = req.body;

    // Get customer name if customerId is provided
    let customerName = null;
    if (customerId) {
      const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
      if (customerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Customer not found' });
      }
      customerName = customerResult.rows[0].name;
    }

    const targetStatus = status || currentJob.status;
    const effectiveCustomerId = customerId !== undefined ? customerId || null : currentJob.customer_id;
    const effectiveTitle = title !== undefined ? title : currentJob.title;
    const effectiveDescription = description !== undefined ? description : currentJob.description;
    if (targetStatus !== 'draft' && (
      !effectiveCustomerId
      || !String(effectiveTitle || '').trim()
      || !String(effectiveDescription || '').trim()
    )) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Pflichtfelder fehlen',
        details: {
          customerId: !effectiveCustomerId ? 'Kunde ist erforderlich' : null,
          title: !String(effectiveTitle || '').trim() ? 'Titel ist erforderlich' : null,
          description: !String(effectiveDescription || '').trim() ? 'Beschreibung ist erforderlich' : null,
        },
      });
    }

    if (timeZone !== undefined && !isValidTimeZone(timeZone || 'Europe/Berlin')) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ungültige Zeitzone für den Kurs.' });
    }

    let recurrenceToCreate = null;
    let recurrenceUpdate = null;
    let recurrenceDetach = false;
    if (recurrenceInput !== undefined) {
      try {
        if (currentJob.recurrence_id) {
          const hasProtectedSeriesUnit = existingSeriesResult.rows.some(({ status }) => ['completed', 'invoiced'].includes(status));
          if (hasProtectedSeriesUnit) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'Diese Kursserie enthält bereits abgeschlossene oder abgerechnete Termine und kann deshalb nicht mehr in ihrer Wiederholung geändert werden.',
              message: 'Kursserie nicht änderbar'
            });
          }
          if (recurrenceInput === null) {
            recurrenceDetach = true;
          } else {
            const recurrence = normalizeRecurrence(recurrenceInput);
            const occurrenceDates = expandRecurrence(recurrence);
            if (occurrenceDates.length === 0) throw new Error('Die Wiederholung erzeugt keine gültige Einheit.');
            recurrenceUpdate = {
              id: currentJob.recurrence_id,
              rule: recurrence,
              dates: occurrenceDates,
              rows: existingSeriesResult.rows,
            };
          }
        } else if (recurrenceInput) {
          const recurrence = normalizeRecurrence(recurrenceInput);
          const occurrenceDates = expandRecurrence(recurrence);
          if (occurrenceDates.length === 0) throw new Error('Die Wiederholung erzeugt keine gültige Einheit.');
          const recurrenceResult = await client.query(
            'INSERT INTO job_recurrences (rule) VALUES ($1) RETURNING id',
            [JSON.stringify(recurrence)]
          );
          recurrenceToCreate = { id: recurrenceResult.rows[0].id, dates: occurrenceDates };
        }
      } catch (error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: error.message });
      }
    }

    // Prepare the update query - only update fields that are provided
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (customerId !== undefined) {
      updates.push(`customer_id = $${paramIndex++}`);
      values.push(customerId || null);
    }
    if (customerAddress !== undefined) {
      updates.push(`customer_address = $${paramIndex++}`);
      values.push(customerAddress);
    }
    if (location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      values.push(location || null);
    }
    if (alternateLocation !== undefined) {
      updates.push(`alternate_location = $${paramIndex++}`);
      values.push(alternateLocation || null);
    }
    if (timeZone !== undefined) {
      updates.push(`time_zone = $${paramIndex++}`);
      values.push(timeZone || 'Europe/Berlin');
    }
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (date !== undefined) {
      updates.push(`date = $${paramIndex++}`);
      values.push(date);
    }
    if (startTime !== undefined && startTime !== '' && startTime !== null) {
      updates.push(`start_time = $${paramIndex++}`);
      values.push(startTime);
    }
    if (endTime !== undefined && endTime !== '' && endTime !== null) {
      updates.push(`end_time = $${paramIndex++}`);
      values.push(endTime);
    }
    if (hoursWorked !== undefined) {
      updates.push(`hours_worked = $${paramIndex++}`);
      values.push(hoursWorked);
    }
    if (hourlyRate !== undefined) {
      updates.push(`hourly_rate = $${paramIndex++}`);
      values.push(hourlyRate);
    }
    if (hourlyRateId !== undefined) {
      updates.push(`hourly_rate_id = $${paramIndex++}`);
      values.push(hourlyRateId);
    }
    if (materials !== undefined) {
      updates.push(`materials = $${paramIndex++}`);
      values.push(JSON.stringify(materials || []));
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    if (externalJobNumber !== undefined) {
      updates.push(`external_job_number = $${paramIndex++}`);
      values.push(externalJobNumber);
    }
    if (req.body.signature !== undefined) {
      updates.push(`signature = $${paramIndex++}`);
      values.push(req.body.signature ? JSON.stringify(req.body.signature) : null);
    }
    if (recurrenceToCreate) {
      updates.push(`recurrence_id = $${paramIndex++}`);
      values.push(recurrenceToCreate.id);
      updates.push(`recurrence_index = $${paramIndex++}`);
      values.push(1);
      updates.push(`recurrence_total = $${paramIndex++}`);
      values.push(recurrenceToCreate.dates.length);
    }
    if (recurrenceDetach) {
      updates.push('recurrence_id = NULL');
      updates.push('recurrence_index = NULL');
      updates.push('recurrence_total = NULL');
    }

    // Always update the updated_at timestamp
    updates.push(`updated_at = NOW()`);
    
    // Add the ID for the WHERE clause
    values.push(id);
    const whereParamIndex = paramIndex; // Use the next parameter index for WHERE clause

    const updateQuery = `
      UPDATE job_entries SET
        ${updates.join(', ')}
      WHERE id = $${whereParamIndex}
      RETURNING *
    `;

    const result = await client.query(updateQuery, values);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }

    // Handle time entries update if provided
    if (timeEntries !== undefined) {
      // Delete existing time entries
      await client.query('DELETE FROM job_time_entries WHERE job_id = $1', [id]);
      
      // Insert new time entries
      if (Array.isArray(timeEntries) && timeEntries.length > 0) {
        for (const timeEntry of timeEntries) {
          await client.query(`
            INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            id,
            timeEntry.description || '',
            timeEntry.startTime || null,
            timeEntry.endTime || null,
            timeEntry.hoursWorked || 0,
            timeEntry.hourlyRate || 0,
            timeEntry.hourlyRateId || null,
            timeEntry.taxRate != null ? timeEntry.taxRate : 19,
            timeEntry.total || 0
          ]);
        }
      }
    }

    // Handle attachments update if provided
    if (attachments !== undefined) {
      // Delete existing attachments
      await client.query('DELETE FROM job_attachments WHERE job_id = $1', [id]);
      
      // Insert new attachments
      if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
          await client.query(`
            INSERT INTO job_attachments (job_id, name, content, content_type, size)
            VALUES ($1, $2, $3, $4, $5)
          `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
        }
      }
    }

    if (recurrenceDetach) {
      for (const seriesRow of existingSeriesResult.rows) {
        if (seriesRow.id === id) continue;
        await client.query('DELETE FROM job_entries WHERE id = $1', [seriesRow.id]);
      }
      await client.query('DELETE FROM job_recurrences WHERE id = $1', [currentJob.recurrence_id]);
    }

    if (recurrenceUpdate) {
      const orderedRows = [...recurrenceUpdate.rows].sort((a, b) => (
        (a.recurrence_index || 0) - (b.recurrence_index || 0)
      ));
      const survivorCount = Math.min(orderedRows.length, recurrenceUpdate.dates.length);
      const survivors = orderedRows.slice(0, survivorCount);
      const currentSeriesRow = orderedRows.find((seriesRow) => seriesRow.id === id);
      if (currentSeriesRow && !survivors.some((seriesRow) => seriesRow.id === id)) {
        survivors[survivors.length - 1] = currentSeriesRow;
      }
      const survivorIds = new Set(survivors.map((seriesRow) => seriesRow.id));

      for (const seriesRow of orderedRows) {
        if (!survivorIds.has(seriesRow.id)) {
          await client.query('DELETE FROM job_entries WHERE id = $1', [seriesRow.id]);
        }
      }

      for (const [index, seriesRow] of survivors.entries()) {
        await client.query(`
          UPDATE job_entries
          SET date = $1,
              recurrence_id = $2,
              recurrence_index = $3,
              recurrence_total = $4,
              updated_at = NOW()
          WHERE id = $5
        `, [recurrenceUpdate.dates[index], recurrenceUpdate.id, index + 1, recurrenceUpdate.dates.length, seriesRow.id]);
      }

      await client.query(
        'UPDATE job_recurrences SET rule = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(recurrenceUpdate.rule), recurrenceUpdate.id]
      );

      const updatedRow = result.rows[0];
      const recurringJobData = {
        customerId: updatedRow.customer_id,
        customerAddress: updatedRow.customer_address,
        location: updatedRow.location,
        title: updatedRow.title,
        description: updatedRow.description,
        startTime: updatedRow.start_time,
        endTime: updatedRow.end_time,
        hoursWorked: Number(updatedRow.hours_worked) || 0,
        hourlyRate: Number(updatedRow.hourly_rate) || 0,
        hourlyRateId: updatedRow.hourly_rate_id,
        timeEntries: Array.isArray(timeEntries) ? timeEntries : [],
        materials: parseMaterials(updatedRow.materials),
        status: updatedRow.status,
        notes: updatedRow.notes,
        priority: updatedRow.priority,
        attachments: Array.isArray(attachments) ? attachments : [],
        externalJobNumber: updatedRow.external_job_number,
        recurrenceId: recurrenceUpdate.id,
        recurrenceTotal: recurrenceUpdate.dates.length,
      };
      for (let index = survivors.length; index < recurrenceUpdate.dates.length; index += 1) {
        await insertJobInstance(client, {
          ...recurringJobData,
          date: recurrenceUpdate.dates[index],
          recurrenceIndex: index + 1,
        });
      }
    }

    if (recurrenceToCreate) {
      const updatedRow = result.rows[0];
      const recurringJobData = {
        customerId: updatedRow.customer_id,
        customerAddress: updatedRow.customer_address,
        location: updatedRow.location,
        title: updatedRow.title,
        description: updatedRow.description,
        startTime: updatedRow.start_time,
        endTime: updatedRow.end_time,
        hoursWorked: Number(updatedRow.hours_worked) || 0,
        hourlyRate: Number(updatedRow.hourly_rate) || 0,
        hourlyRateId: updatedRow.hourly_rate_id,
        timeEntries: Array.isArray(timeEntries) ? timeEntries : [],
        materials: parseMaterials(updatedRow.materials),
        status: updatedRow.status,
        notes: updatedRow.notes,
        priority: updatedRow.priority,
        attachments: Array.isArray(attachments) ? attachments : [],
        externalJobNumber: updatedRow.external_job_number,
        recurrenceId: recurrenceToCreate.id,
        recurrenceTotal: recurrenceToCreate.dates.length,
      };
      for (const [index, occurrenceDate] of recurrenceToCreate.dates.slice(1).entries()) {
        await insertJobInstance(client, {
          ...recurringJobData,
          date: occurrenceDate,
          recurrenceIndex: index + 2,
        });
      }
    }

    await client.query('COMMIT');

    // Fetch the complete job with attachments and time entries
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name, jr.rule as recurrence_rule,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', jte.id,
                 'description', jte.description,
                 'startTime', jte.start_time,
                 'endTime', jte.end_time,
                 'hoursWorked', jte.hours_worked,
                 'hourlyRate', jte.hourly_rate,
                 'hourlyRateId', jte.hourly_rate_id,
                 'taxRate', jte.tax_rate,
                 'total', jte.total
               )
             ) FILTER (WHERE jte.id IS NOT NULL) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_recurrences jr ON j.recurrence_id = jr.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name, jr.rule
    `, [id]);

    const job = formatJobData(completeJob.rows[0]);
    res.json(job);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating job:', error);
    res.status(500).json({ error: 'Failed to update job' });
  } finally {
    client.release();
  }
});

// Delete a job entry
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Check if job exists and get current status
    const currentJobResult = await client.query('SELECT status, recurrence_id FROM job_entries WHERE id = $1', [id]);
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];
    const recurrenceId = currentJob.recurrence_id;
    
    // Prevent deleting if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot delete invoiced job', 
        message: 'Jobs that have been invoiced cannot be deleted to maintain invoice integrity.' 
      });
    }
    
    // Delete attachments first (due to foreign key constraint)
    await client.query('DELETE FROM job_attachments WHERE job_id = $1', [id]);
    
    // Delete the job
    const result = await client.query('DELETE FROM job_entries WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }

    if (recurrenceId) {
      await client.query(
        'DELETE FROM job_recurrences WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM job_entries WHERE recurrence_id = $1)',
        [recurrenceId]
      );
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error deleting job:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  } finally {
    client.release();
  }
});

// Delete multiple job entries
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid job IDs' });
    }

    // Check if any jobs are invoiced
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    const invoicedJobsResult = await pool.query(
      `SELECT id FROM job_entries WHERE id IN (${placeholders}) AND status = 'invoiced'`,
      ids
    );
    
    if (invoicedJobsResult.rows.length > 0) {
      const invoicedJobIds = invoicedJobsResult.rows.map(row => row.id);
      return res.status(403).json({ 
        error: 'Cannot delete invoiced jobs', 
        message: 'Some jobs have been invoiced and cannot be deleted to maintain invoice integrity.',
        invoicedJobIds 
      });
    }

    const result = await pool.query(
      `DELETE FROM job_entries WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    
    res.json({ 
      message: `${result.rows.length} jobs deleted successfully`,
      deletedIds: result.rows.map(row => row.id)
    });
  } catch (error) {
    logger.error('Error deleting jobs:', error);
    res.status(500).json({ error: 'Failed to delete jobs' });
  }
});

// Add signature to job
router.post('/:id/signature', async (req, res) => {
  const { id } = req.params;
  const signatureData = typeof req.body.signatureData === 'string' ? req.body.signatureData : '';
  const customerName = typeof req.body.customerName === 'string' ? req.body.customerName.trim() : '';
  const signaturePrefix = 'data:image/png;base64,';

  // Vor dem Öffnen einer Transaktion validieren. Ein früher Return nach BEGIN
  // würde andernfalls eine offene Transaktion an den Pool zurückgeben.
  if (!signatureData || !customerName) {
    logger.warn('Signature upload failed - missing required fields', {
      jobId: id,
      hasSignatureData: Boolean(signatureData),
      hasCustomerName: Boolean(customerName),
    });
    return res.status(400).json({
      error: 'Missing required fields',
      details: {
        signatureData: !signatureData ? 'Signature data is required' : null,
        customerName: !customerName ? 'Customer name is required' : null,
      },
    });
  }

  if (customerName.length > 200) {
    return res.status(400).json({ error: 'Customer name is too long' });
  }

  if (!signatureData.startsWith(signaturePrefix)) {
    logger.warn('Signature upload failed - invalid data format', {
      jobId: id,
      signatureDataPrefix: signatureData.substring(0, 30),
    });
    return res.status(400).json({
      error: 'Invalid signature data format',
      details: { signatureData: 'Signature data must be a valid PNG data URL' },
    });
  }

  const encodedSignature = signatureData.slice(signaturePrefix.length);
  if (!encodedSignature || encodedSignature.length > 1_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature)) {
    return res.status(400).json({ error: 'Invalid or oversized signature data' });
  }

  const decodedSignature = Buffer.from(encodedSignature, 'base64');
  const isPng = decodedSignature.length >= 8
    && decodedSignature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) {
    return res.status(400).json({ error: 'Signature data is not a valid PNG image' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.debug('Adding signature for job', {
      jobId: id,
      customerName,
      signatureDataLength: signatureData.length,
      hasValidSignature: true,
    });

    // Check if job exists
    const currentJobResult = await client.query('SELECT status FROM job_entries WHERE id = $1 FOR UPDATE', [id]);
    
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.warn('Signature upload failed - job not found', { jobId: id });
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];
    
    // Prevent adding signature if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot add signature to invoiced job', 
        message: 'Jobs that have been invoiced cannot be modified to maintain invoice integrity.' 
      });
    }
    
    // Create signature object
    const signature = {
      id: randomUUID(),
      customerName,
      signatureData,
      signedAt: new Date().toISOString(),
      ipAddress: req.ip || req.connection.remoteAddress
    };
    
    // Update job with signature and set status to completed
    const result = await client.query(`
      UPDATE job_entries SET
        signature = $1,
        status = 'completed',
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [JSON.stringify(signature), id]);
    
    await client.query('COMMIT');
    
    // Fetch the complete job with customer name
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name, jr.rule as recurrence_rule,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', jte.id,
                 'description', jte.description,
                 'startTime', jte.start_time,
                 'endTime', jte.end_time,
                 'hoursWorked', jte.hours_worked,
                 'hourlyRate', jte.hourly_rate,
                 'hourlyRateId', jte.hourly_rate_id,
                 'taxRate', jte.tax_rate,
                 'total', jte.total
               )
             ) FILTER (WHERE jte.id IS NOT NULL) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_recurrences jr ON j.recurrence_id = jr.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name, jr.rule
    `, [id]);

    const job = formatJobData(completeJob.rows[0]);
    res.json({ 
      message: 'Signature added successfully and job marked as completed',
      job 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error adding signature:', error);
    res.status(500).json({ error: 'Failed to add signature' });
  } finally {
    client.release();
  }
});

export default router;
