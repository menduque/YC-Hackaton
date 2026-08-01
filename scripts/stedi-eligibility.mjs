#!/usr/bin/env node
// Run a Stedi test-mode mock eligibility check (X12 270 -> 271) from the CLI.
//
//   node scripts/stedi-eligibility.mjs --list
//   node scripts/stedi-eligibility.mjs aetna
//   node scripts/stedi-eligibility.mjs unitedhealthcare-inactive --raw
//
// Requires STEDI_API_KEY (a *test* key) in the repo-root .env.
// Test mode sends nothing to real payers and is free.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so this stays dependency-free.
function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const { MOCK_REQUESTS, getMockRequest, STEDI_ELIGIBILITY_ENDPOINT } = await import(
  path.join(root, 'app/src/stedi/mock-requests.ts')
);

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const id = args.find((a) => !a.startsWith('--'));

if (!id || args.includes('--list')) {
  const byCategory = new Map();
  for (const m of MOCK_REQUESTS) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category).push(m);
  }
  for (const [cat, items] of byCategory) {
    console.log(`\n${cat}`);
    for (const m of items) console.log(`  ${m.id.padEnd(34)} ${m.label}`);
  }
  console.log('\nUsage: node scripts/stedi-eligibility.mjs <id> [--raw]');
  process.exit(id ? 0 : 1);
}

const apiKey = process.env.STEDI_API_KEY;
if (!apiKey) {
  console.error('Missing STEDI_API_KEY. Add a *test* key to .env at the repo root.');
  process.exit(1);
}
if (!apiKey.startsWith('test_')) {
  console.error('STEDI_API_KEY is not a test key. Refusing to run — this script is test-mode only.');
  process.exit(1);
}

const mock = getMockRequest(id);
const res = await fetch(STEDI_ELIGIBILITY_ENDPOINT, {
  method: 'POST',
  headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(mock.request),
});
const body = await res.json();

if (raw) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(res.ok ? 0 : 1);
}

console.log(`${mock.label}  [${res.status}]`);
console.log(`  payer            ${body.payer?.name ?? mock.payerName}`);
console.log(`  applicationMode  ${body.meta?.applicationMode}`);
console.log(`  traceId          ${body.meta?.traceId}`);

const aaa = [
  ...(body.errors ?? []),
  ...(body.subscriber?.aaaErrors ?? []),
  ...(body.payer?.aaaErrors ?? []),
  ...(body.provider?.aaaErrors ?? []),
];
if (aaa.length) {
  console.log('  AAA errors:');
  for (const e of aaa) console.log(`    ${e.code ?? e.field}: ${e.description ?? e.message}`);
}

const active = (body.benefitsInformation ?? []).filter((b) => b.code === '1');
if (active.length) {
  console.log(`  active coverage  ${active.map((b) => b.serviceTypeCodes?.join(',')).join(' | ')}`);
}
const copays = (body.benefitsInformation ?? []).filter((b) => b.code === 'B' && b.benefitAmount);
for (const c of copays.slice(0, 5)) {
  console.log(`  copay            $${c.benefitAmount} ${c.serviceTypes?.[0] ?? ''}`);
}
const deductibles = (body.benefitsInformation ?? []).filter((b) => b.code === 'C' && b.benefitAmount);
for (const d of deductibles.slice(0, 5)) {
  console.log(
    `  deductible       $${d.benefitAmount} ${d.timeQualifier ?? ''} ${d.inPlanNetworkIndicator ?? ''}`
  );
}
console.log('\n  (full response: add --raw)');
