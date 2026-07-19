#!/usr/bin/env node
// Phase C — machine-id backfill DRY RUN (read-only; touches no database).
//
// Mirrors, in plain Node, the logic in:
//   * src/scheduling/machineBackfill.ts  (the tested TS planner)
//   * supabase/migrations/0007_backfill_operation_machine_ids.sql  (the real migration)
//
// It reports, for a snapshot of `jobs` and `machines`, exactly which operations/plain-jobs the
// migration WOULD assign a machineId to, and which machine names resolve to nothing (so they can be
// reconciled before the SQL runs). Nothing is written back.
//
// USAGE:
//   node scripts/backfill-machine-ids.mjs <jobs.json> <machines.json>
//
//   <jobs.json>     array of job rows (as returned by `select * from jobs` / the client Job shape).
//                   Each may have `operations` (array of {id,name,machine,machineId?}) and `machine`.
//   <machines.json> array of {id,name} (as returned by `select id,name from machines`).
//
// Export the snapshots from the Supabase SQL editor with e.g.:
//   select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.jobs j;       -- → jobs.json
//   select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.machines m;   -- → machines.json

import { readFileSync } from 'node:fs';

const [, , jobsPath, machinesPath] = process.argv;
if (!jobsPath || !machinesPath) {
  console.error('Usage: node scripts/backfill-machine-ids.mjs <jobs.json> <machines.json>');
  process.exit(2);
}

const norm = (s) => (s ?? '').toString().trim().toLowerCase();
const splitChain = (s) => (s ?? '').toString().split('→').map((x) => x.trim()).filter(Boolean);

const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));
const machines = JSON.parse(readFileSync(machinesPath, 'utf8'));

const byName = new Map();
for (const m of machines) {
  const key = norm(m.name);
  if (key && !byName.has(key)) byName.set(key, m);
}

const opAssignments = [];
const plainJobAssignments = [];
const unmatched = [];

for (const job of jobs) {
  // Supabase rows use snake_case (job_order, operations); the client shape uses `order`.
  const order = job.order ?? job.job_order ?? String(job.id);
  const ops = Array.isArray(job.operations) ? job.operations : null;
  if (ops && ops.length) {
    for (const op of ops) {
      const name = (op.machine ?? '').toString().trim();
      if (!name) continue;
      if (op.machineId != null) continue; // never overwrite
      const match = byName.get(norm(name));
      if (match) opAssignments.push({ jobId: job.id, order, opId: op.id, opName: op.name, machineName: name, machineId: match.id });
      else unmatched.push({ jobId: job.id, order, opId: op.id, opName: op.name, machineName: name });
    }
    continue;
  }
  const segments = splitChain(job.machine);
  if (segments.length === 1) {
    const name = segments[0];
    const match = byName.get(norm(name));
    if (match) plainJobAssignments.push({ jobId: job.id, order, machineName: name, machineId: match.id });
    else unmatched.push({ jobId: job.id, order, opId: null, machineName: name });
  } else {
    for (const name of segments) {
      if (!byName.get(norm(name))) unmatched.push({ jobId: job.id, order, opId: null, machineName: name });
    }
  }
}

const uniqueUnmatched = [...new Set(unmatched.map((u) => u.machineName))].sort();

console.log('=== Phase C machine-id backfill — DRY RUN ===');
console.log(`jobs: ${jobs.length}   machines: ${machines.length}`);
console.log(`\nWould assign machineId to ${opAssignments.length} routed operation(s):`);
for (const a of opAssignments) console.log(`  job ${a.jobId} (${a.order}) op ${a.opId} "${a.opName}"  "${a.machineName}" → machineId ${a.machineId}`);
console.log(`\nWould assign machine_id to ${plainJobAssignments.length} plain job(s):`);
for (const a of plainJobAssignments) console.log(`  job ${a.jobId} (${a.order})  "${a.machineName}" → machine_id ${a.machineId}`);
console.log(`\nUNMATCHED — ${unmatched.length} reference(s), ${uniqueUnmatched.length} distinct name(s) (NOT backfilled; reconcile first):`);
for (const name of uniqueUnmatched) {
  const uses = unmatched.filter((u) => u.machineName === name);
  console.log(`  "${name}"  (${uses.length} use(s); e.g. job ${uses[0].jobId}/${uses[0].order})`);
}

// Non-zero exit when there is anything to reconcile, so CI/humans notice.
process.exit(unmatched.length > 0 ? 1 : 0);
