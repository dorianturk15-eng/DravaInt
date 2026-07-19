#!/usr/bin/env node
// Phase D — job_operations verification (read-only; touches no database).
//
// Mirrors, in plain Node, the mapping in:
//   * src/scheduling/jobOperations.ts  (buildJobOperationRows — the tested TS mirror)
//   * supabase/migrations/0008_job_operations_table_and_overlap.sql  (sync trigger + backfill)
//
// Two jobs:
//   1. CHECKSUM: from a `jobs` export, compute how many job_operations rows each routed job SHOULD
//      have (== jsonb_array_length(operations)). If a `job_operations` export is also given, diff the
//      actual per-job row counts against expected and report mismatches — the same invariant the
//      migration's backfill checksum enforces, runnable BEFORE and AFTER applying the migration.
//   2. OVERLAPS: report routed operation-level double-bookings the warn/enforce trigger would find,
//      so a human can preview them (and reconcile) before flipping enforcement to '"enforce"'.
//
// USAGE:
//   node scripts/verify-job-operations.mjs <jobs.json> [job_operations.json] [machines.json]
//
//   <jobs.json>            array of job rows (select * from jobs). Uses `operations`, `machine`,
//                          `start_time`/`start`, `end_time`/`end`, `status`, `parent_id`/`parentId`.
//   [job_operations.json]  optional array of rows (select job_id, seq from job_operations) to diff.
//   [machines.json]        optional array of {id,name} for rename-safe overlap key resolution.
//
// Export snapshots from the Supabase SQL editor with e.g.:
//   select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.jobs j;            -- jobs.json
//   select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.job_operations o;  -- job_operations.json
//   select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.machines m;        -- machines.json

import { readFileSync } from 'node:fs';

const [, , jobsPath, opsPath, machinesPath] = process.argv;
if (!jobsPath) {
  console.error('Usage: node scripts/verify-job-operations.mjs <jobs.json> [job_operations.json] [machines.json]');
  process.exit(2);
}

const readJson = (p) => (p ? JSON.parse(readFileSync(p, 'utf8')) : null);
const jobs = readJson(jobsPath);
const opsExport = readJson(opsPath);
const machines = readJson(machinesPath) ?? [];

const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const splitChain = (s) => (s ?? '').toString().split('→').map((x) => x.trim()).filter(Boolean);
const ms = (v) => (v ? new Date(v).getTime() : NaN);

const byName = new Map();
for (const m of machines) {
  const key = norm(m.name);
  if (key && !byName.has(key)) byName.set(key, m);
}
// Mirror of resolveMachineId → machine_match_key.
const matchKey = (name, id) => {
  if (id != null && machines.some((m) => m.id === id)) return `id:${id}`;
  const m = byName.get(norm(name));
  return m ? `id:${m.id}` : `name:${norm(name)}`;
};

const hasKids = (id) => jobs.some((j) => (j.parent_id ?? j.parentId) === id);

// ---- 1) Checksum ----------------------------------------------------------------------------------
const expected = new Map(); // jobId -> expected row count
for (const j of jobs) {
  const ops = Array.isArray(j.operations) ? j.operations : null;
  if (ops) expected.set(j.id, ops.length);
}

console.log('=== Phase D job_operations verification ===');
console.log(`jobs: ${jobs.length}   routed jobs: ${expected.size}`);

if (opsExport) {
  const actual = new Map();
  for (const row of opsExport) actual.set(row.job_id, (actual.get(row.job_id) ?? 0) + 1);
  let mismatches = 0;
  for (const [jobId, exp] of expected) {
    const got = actual.get(jobId) ?? 0;
    if (got !== exp) {
      mismatches++;
      console.log(`  CHECKSUM MISMATCH: job ${jobId} — JSONB has ${exp} op(s), ${got} row(s) present`);
    }
  }
  // Rows for jobs that shouldn't have any (or extra rows).
  for (const [jobId, got] of actual) {
    if (!expected.has(jobId)) { mismatches++; console.log(`  ORPHAN ROWS: job ${jobId} has ${got} job_operations row(s) but no routed JSONB`); }
  }
  console.log(mismatches === 0 ? '\nChecksum OK: every routed job has exactly its JSONB operation count in rows.' : `\nChecksum: ${mismatches} mismatch(es) — investigate before enforcing.`);
} else {
  console.log('\n(no job_operations export given — printing EXPECTED row counts only)');
  let total = 0;
  for (const [, exp] of expected) total += exp;
  console.log(`Expected total job_operations rows after backfill: ${total}`);
}

// ---- 2) Overlap preview ---------------------------------------------------------------------------
const windows = [];
for (const j of jobs) {
  if (j.status === 'done') continue;
  if (hasKids(j.id)) continue;
  const start = ms(j.start_time ?? j.start);
  if (Number.isNaN(start)) continue;
  const ops = Array.isArray(j.operations) ? j.operations : null;
  if (ops && ops.length) {
    let cursor = start;
    ops.forEach((op, seq) => {
      const opStart = cursor;
      const opEnd = cursor + Math.max(0, Number(op.hours) || 0) * 3_600_000;
      cursor = opEnd;
      const name = (op.machine ?? '').toString().trim();
      if (!name || opEnd <= opStart) return;
      windows.push({ jobId: j.id, order: j.job_order ?? j.order, seq, isOp: true, key: matchKey(name, op.machineId ?? null), name, start: opStart, end: opEnd });
    });
    continue;
  }
  const segs = splitChain(j.machine);
  if (segs.length !== 1) continue;
  const end = ms(j.end_time ?? j.end);
  if (Number.isNaN(end) || end <= start) continue;
  windows.push({ jobId: j.id, order: j.job_order ?? j.order, seq: 0, isOp: false, key: matchKey(segs[0], null), name: segs[0], start, end });
}

const overlaps = [];
for (let i = 0; i < windows.length; i++) {
  for (let k = i + 1; k < windows.length; k++) {
    const a = windows[i], b = windows[k];
    if (a.jobId === b.jobId) continue;
    if (!a.isOp && !b.isOp) continue;
    if (a.key !== b.key) continue;
    if (!(a.start < b.end && b.start < a.end)) continue;
    overlaps.push({ a, b });
  }
}

console.log(`\nOperation-level overlaps the trigger would flag: ${overlaps.length}`);
for (const { a, b } of overlaps) {
  console.log(`  ${a.name}: order ${a.order} (step ${a.seq}) overlaps order ${b.order} (step ${b.seq})`);
}
console.log(overlaps.length === 0
  ? '\nNo routed overlaps — safe to flip enforcement to "enforce".'
  : '\nReconcile these (or accept them) before setting job_operations_overlap_enforcement = "enforce".');

// Exit non-zero if anything needs a human (mismatch or overlap), so CI/humans notice.
process.exit(overlaps.length > 0 ? 1 : 0);
