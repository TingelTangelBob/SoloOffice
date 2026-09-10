import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import { createQuote } from '../../services/quoteService.js';
import jobsRouter from '../../routes/jobs.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
let customerId;

function inWorkspace(callback) {
  return runWithRequestContext({ workspaceId, userId }, callback);
}

function invokeCreateJob(body) {
  const createJobLayer = jobsRouter.stack.find(layer => (
    layer.route?.path === '/' && layer.route.methods.post
  ));
  const handler = createJobLayer?.route?.stack?.[0]?.handle;
  assert.equal(typeof handler, 'function');

  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };
    const request = { body };
    Promise.resolve(handler(request, response, reject)).catch(reject);
  });
}

before(async () => {
  await query(
    'INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)',
    [workspaceId, 'Nummern-Konkurrenztest', `number-concurrency-${suffix}`],
  );
  const result = await inWorkspace(() => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Testkunde', 'Teststraße 1', 'Berlin', '10115', 'Deutschland')
    RETURNING id
  `, [`NUMBER-${suffix}`]));
  customerId = result.rows[0].id;
});

after(async () => {
  try {
    await inWorkspace(async () => {
      await query('DELETE FROM job_entries');
      await query('DELETE FROM quotes');
      await query('DELETE FROM customers WHERE id = $1', [customerId]);
    });
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  } finally {
    await pool.end();
  }
});

test('parallele Angebotserstellung vergibt unterschiedliche Angebotsnummern', async () => {
  const results = await Promise.all([
    inWorkspace(() => createQuote({
      customerId,
      issueDate: '2099-01-15',
      items: [],
    })),
    inWorkspace(() => createQuote({
      customerId,
      issueDate: '2099-01-15',
      items: [],
    })),
  ]);

  assert.deepEqual(
    results.map(quote => quote.quoteNumber).sort(),
    ['AN-2099-001', 'AN-2099-002'],
  );
});

test('parallele Auftragserstellung vergibt unterschiedliche Auftragsnummern', async () => {
  const date = '2099-01-15';
  const body = {
    customerId,
    title: 'Konkurrenztest',
    description: 'Parallele Anlage',
    date,
  };
  const results = await Promise.all([
    inWorkspace(() => invokeCreateJob(body)),
    inWorkspace(() => invokeCreateJob(body)),
  ]);

  assert.deepEqual(results.map(result => result.statusCode), [201, 201]);
  const currentYear = new Date().getFullYear();
  assert.deepEqual(
    results.map(result => result.payload.jobNumber).sort(),
    [`AB-${currentYear}-001`, `AB-${currentYear}-002`],
  );
});
