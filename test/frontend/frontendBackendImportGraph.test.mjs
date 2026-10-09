import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'src');
const nodeBuiltins = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs',
  'http', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'stream', 'timers',
  'tls', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);
const importPattern = /(?:\bimport\s*(?:type\s*)?(?:[^'";]*?\s+from\s*)?|\bexport\s+(?:type\s+)?[^'";]*?\s+from\s*|\bimport\s*\()(['"])([^'"]+)\1\s*\)?/g;

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`,
    path.join(base, 'index.js'), path.join(base, 'index.ts')];
  return candidates.find(candidate => {
    try { return readFileSync(candidate, 'utf8') !== undefined; } catch { return false; }
  }) || null;
}

function findForbiddenReachability() {
  const queue = [];
  const visited = new Set();
  for (const entry of walkFrontend(frontend)) queue.push({ file: entry, chain: [entry] });
  const violations = new Set();

  while (queue.length) {
    const { file, chain } = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2];
      if (specifier === 'pg' || specifier.startsWith('pg/')) violations.add(`${chain.map(item => path.relative(root, item)).join(' -> ')} -> ${specifier}`);
      if (specifier.startsWith('node:') && nodeBuiltins.has(specifier.slice(5).split('/')[0])) {
        violations.add(`${chain.map(item => path.relative(root, item)).join(' -> ')} -> ${specifier}`);
      } else if (!specifier.startsWith('.') && nodeBuiltins.has(specifier.split('/')[0])) {
        violations.add(`${chain.map(item => path.relative(root, item)).join(' -> ')} -> ${specifier}`);
      }
      const resolved = resolveLocal(file, specifier);
      if (!resolved) continue;
      const relative = path.relative(root, resolved).split(path.sep).join('/');
      if (relative === 'backend/database.js' || relative.startsWith('backend/database.')) {
        violations.add(`${chain.map(item => path.relative(root, item)).join(' -> ')} -> ${relative}`);
      }
      if (relative.startsWith('backend/services/')) {
        violations.add(`${chain.map(item => path.relative(root, item)).join(' -> ')} -> ${relative}`);
      }
      if (!visited.has(resolved)) queue.push({ file: resolved, chain: [...chain, resolved] });
    }
  }
  return [...violations].sort();
}

function* walkFrontend(dir) {
  // Keep the graph rooted in real source entrypoints, with no dependency on installed backend packages.
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* walkFrontend(file);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) yield file;
  }
}

test('Frontend import graph does not reach database, backend services, pg, or Node.js builtins', () => {
  assert.deepEqual(findForbiddenReachability(), [], 'Frontend-reachable modules must stay independent of database and Node.js runtime code');
});
