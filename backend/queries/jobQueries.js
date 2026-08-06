import { pool } from '../database.js';
import logger from '../utils/logger.js';

const parseMaterials = (materialsData) => {
  if (!materialsData || materialsData === 'null' || materialsData === null || materialsData === '') {
    return [];
  }

  if (Array.isArray(materialsData)) {
    return materialsData;
  }

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

  return [];
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

export async function findAllJobs() {
  const result = await pool.query(`
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
      GROUP BY j.id, c.name, jr.rule
      ORDER BY j.date DESC, j.created_at DESC
    `);

  return result.rows.map(row => formatJobData(row));
}

export async function findJobById(id) {
  const result = await pool.query(`
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
    `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return formatJobData(result.rows[0]);
}
