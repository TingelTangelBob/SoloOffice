import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool, query } from '../../database.js';
import importsRouter from '../../routes/imports.js';
import jobsRouter from '../../routes/jobs.js';
import { createQuote } from '../../services/quoteService.js';
import { runWithRequestContext } from '../../utils/requestContext.js';

if (!/(?:^|[_-])(integration|test)(?:$|[_-])/i.test(String(process.env.DB_NAME || ''))) {
  throw new Error('Integrationstests dürfen nur gegen eine als Test/Integration benannte Datenbank laufen.');
}

const workspaceId = randomUUID();
const userId = randomUUID();
const suffix = randomUUID().slice(0, 8);
let customerId;

const inWorkspace = callback => runWithRequestContext({ workspaceId, userId }, callback);

function routeHandler(router, path, method) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  const handler = layer?.route?.stack?.[0]?.handle;
  assert.equal(typeof handler, 'function');
  return handler;
}

function invokeImport(resource, rows) {
  const handler = routeHandler(importsRouter, '/:resource', 'post');
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
    Promise.resolve(handler({ params: { resource }, body: { rows, dryRun: false } }, response, reject)).catch(reject);
  });
}

function invokeCreateJob(body) {
  const handler = routeHandler(jobsRouter, '/', 'post');
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
    Promise.resolve(handler({ body }, response, reject)).catch(reject);
  });
}

before(async () => {
  await query(
    'INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)',
    [workspaceId, 'Import-Nummerntest', `import-number-concurrency-${suffix}`],
  );
  const result = await inWorkspace(() => query(`
    INSERT INTO customers (customer_number, name, address, city, postal_code, country)
    VALUES ($1, 'Importkunde', 'Teststraße 1', 'Berlin', '10115', 'Deutschland')
    RETURNING id
  `, [`IMPORT-${suffix}`]));
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

test('paralleler Angebotsimport und reguläres Anlegen vergeben unterschiedliche Nummern', async () => {
  const results = await Promise.all([
    inWorkspace(() => invokeImport('quotes', [{
      customerId,
      issueDate: '2099-01-15',
      itemDescription: 'Importleistung',
      itemUnitPrice: 100,
    }])),
    inWorkspace(() => createQuote({
      customerId,
      issueDate: '2099-01-15',
      items: [{ description: 'Regulärleistung', quantity: 1, unitPrice: 100, taxRate: 19 }],
    })),
  ]);

  assert.equal(results[0].statusCode, 200);
  assert.equal(results[0].payload.summary.imported, 1);
  assert.deepEqual(
    (await inWorkspace(() => query('SELECT quote_number FROM quotes ORDER BY quote_number'))).rows.map(row => row.quote_number),
    ['AN-2099-001', 'AN-2099-002'],
  );
});

test('paralleler Auftragsimport und reguläres Anlegen vergeben unterschiedliche Nummern', async () => {
  const year = new Date().getFullYear();
  const results = await Promise.all([
    inWorkspace(() => invokeImport('jobs', [{
      customerId,
      date: `${year}-01-15`,
      title: 'Importauftrag',
    }])),
    inWorkspace(() => invokeCreateJob({
      customerId,
      title: 'Regulärauftrag',
      description: 'Parallele Anlage',
      date: `${year}-01-15`,
    })),
  ]);

  assert.equal(results[0].statusCode, 200);
  assert.equal(results[0].payload.summary.imported, 1);
  assert.equal(results[1].statusCode, 201);
  assert.deepEqual(
    (await inWorkspace(() => query('SELECT job_number FROM job_entries ORDER BY job_number'))).rows.map(row => row.job_number),
    [`AB-${year}-001`, `AB-${year}-002`],
  );
});

test('mehrjährige Importe erwerben Dokumentnummernsperren in stabiler Reihenfolge', async () => {
  const rows = [
    { customerId, issueDate: '2101-01-15', itemDescription: 'Leistung A', itemUnitPrice: 10 },
    { customerId, issueDate: '2100-01-15', itemDescription: 'Leistung B', itemUnitPrice: 10 },
  ];
  const reversedRows = [...rows].reverse().map((row, index) => ({ ...row, itemDescription: `Leistung C${index}` }));
  const results = await Promise.all([
    inWorkspace(() => invokeImport('quotes', rows)),
    inWorkspace(() => invokeImport('quotes', reversedRows)),
  ]);

  assert.deepEqual(results.map(result => result.payload.summary.imported), [2, 2]);
  const numbers = (await inWorkspace(() => query(
    "SELECT quote_number FROM quotes WHERE quote_number LIKE 'AN-2100-%' OR quote_number LIKE 'AN-2101-%' ORDER BY quote_number",
  ))).rows.map(row => row.quote_number);
  assert.deepEqual(numbers, ['AN-2100-001', 'AN-2100-002', 'AN-2101-001', 'AN-2101-002']);
});
