# Phase D — `job_operations` rows + DB-level overlap enforcement

Phase D closes the last two gaps from the machine-scheduling redo (see
`MACHINE_SCHEDULE_REDO_PLAN.md` §2.5, §6):

1. **Operations become rows.** A new `public.job_operations` table holds one row per operation of a
   routed order. The `jobs.operations` JSONB stays the **client write format**; the rows are a
   **derived mirror**, kept in sync by a DB trigger (the "dual-write"). Nothing reads the rows for
   display yet — they exist so the database can reason about per-operation work.
2. **The DB can finally enforce routed double-booking.** `validate_job_assignment` is extended to
   expand routed jobs into sequential per-machine windows and reject (or warn about) overlaps.
   Previously it compared the single `jobs.machine` text — a display chain like `"Pila → CNC-1 → …"`
   for routed orders — so routed work was neither protected nor false-flagged.

It rolls out **warn-first**: overlaps are logged to `audit_logs` and allowed, until an operator flips a
setting to start rejecting them. Until that flip, nothing new can block a write.

## What the migration does

`supabase/migrations/0008_job_operations_table_and_overlap.sql` (one transaction, idempotent):

1. Creates `public.job_operations` (`job_id, seq, name, machine_id, machine_name, hours,
   operator_id, operator_name`, `unique(job_id, seq)`) with the full live-Supabase new-table
   checklist: explicit `grant select` to `authenticated`, RLS (`authenticated_read using(true)`,
   mirroring `jobs`), and realtime publication. Writes are **server-only** (the sync trigger owns
   them), so no client write grant is issued.
2. Installs `sync_job_operations()` — a `SECURITY DEFINER` trigger on `jobs` (fires
   `after insert or update of operations`) that delete-and-reinserts a job's rows from its JSONB. This
   is the dual-write: every existing client path (`updateJob`, `addJob`, WorkOrderCreator, board
   lane-move) keeps both copies in sync **atomically**, with no client code change.
3. Backfills existing rows from the JSONB and runs a **checksum** (`count(rows) ==
   jsonb_array_length(operations)` per routed job), raising a warning on any mismatch.
4. Adds `machine_match_key()`, the `job_effective_windows` view, and
   `detect_job_operation_overlaps()`, then extends `validate_job_assignment` with the operation-level
   check. The check reads mode from `app_settings.job_operations_overlap_enforcement`
   (default `"warn"`); warn logs to `audit_logs` and allows, `"enforce"` rejects with errcode `DR001`.

The mapping and overlap rules are defined once in TypeScript (`src/scheduling/jobOperations.ts`) and
mirrored byte-for-byte by the SQL — the same lock-step Phase C used for `machineBackfill.ts`.

### Design decisions worth knowing (see "Open questions" below)

- **Dual-write is a DB trigger, not client code.** The plan allowed either; the trigger is atomic,
  covers all write paths, and avoids doubling the optimistic-versioning write surface (redo plan
  risk §5.1). The client-side "dual-write" is therefore the shared derivation module, not a second
  round-trip.
- **Plain-vs-plain overlaps stay on the legacy string check** (already hard-enforced). The new
  op-level check only adds the missing coverage — routed-vs-routed and routed-vs-plain — so nothing
  is double-reported and existing enforcement behaviour is unchanged.
- **`hours` allows 0** (`check (hours >= 0)`), not the plan's `> 0`: the sync trigger must never
  reject a `jobs` write the JSONB already accepted. A 0-hour op is kept as a row (so the checksum
  holds) but contributes no enforceable window.

## Files

| File | Role |
|---|---|
| `supabase/migrations/0008_job_operations_table_and_overlap.sql` | The real migration (table, sync trigger, backfill, view, overlap check). |
| `src/scheduling/jobOperations.ts` | Pure TS mirror: `buildJobOperationRows` (JSONB→rows) + `detectOperationOverlaps`. |
| `src/scheduling/jobOperations.test.ts` | Validates the mapping and overlap rules against mocked data. |
| `scripts/verify-job-operations.mjs` | Standalone read-only checksum + overlap preview against a JSON export. |
| `public.app_settings['job_operations_overlap_enforcement']` | Live enforcement mode: `"warn"` (default) → `"enforce"`. |

## How to run (human / live-DB session)

> Nothing here has been run against production — this was authored without live Supabase credentials.
> Apply it the same way Phase C's backfill was applied, and stay in **warn** mode until the overlap
> preview is clean or the remaining overlaps are understood.

### 1. Export snapshots (Supabase SQL editor → download as JSON)

```sql
select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.jobs j;      -- jobs.json
select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.machines m;  -- machines.json
```

### 2. Preview overlaps BEFORE applying (writes nothing)

```bash
node scripts/verify-job-operations.mjs jobs.json "" machines.json
```

It lists the routed operation-level overlaps the trigger would flag. Exit code is `1` when any
overlap exists (so CI/humans notice). These are real double-bookings hidden until now — decide
whether to reschedule them or accept them before you ever switch to enforce.

### 3. Apply the migration (in a transaction — the file already wraps `begin/commit`)

```bash
psql "$DATABASE_URL" -f supabase/migrations/0008_job_operations_table_and_overlap.sql
```

or paste it into the Supabase SQL editor, or `supabase db push`. It `RAISE NOTICE/WARNING`s the
checksum result. It is **idempotent** — safe to re-run.

### 4. Verify the checksum against the live rows

```sql
select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.job_operations o;  -- job_operations.json
```

```bash
node scripts/verify-job-operations.mjs jobs.json job_operations.json machines.json
```

Expect `Checksum OK`. The in-migration checksum should also have printed no mismatch. Also confirm
the live-Supabase basics (from the deployment memory):

- `select * from public.job_operations limit 1;` as a normal authenticated user → rows return
  (grants + RLS OK), not `permission denied`.
- A board write that edits a routed order's operations → the matching `job_operations` rows update
  (the sync trigger fired). Insert a routed order and confirm rows appear.
- Realtime: `job_operations` is in the `supabase_realtime` publication (only matters once the client
  reads rows live — not yet).

### 5. Observe warn mode

Leave enforcement at `"warn"` for a real observation window. Overlaps that occur are logged:

```sql
select created_at, record_id, after_state
from public.audit_logs
where action = 'operation_overlap_warning'
order by created_at desc;
```

Every entry is a routed double-booking that *would* have been rejected under enforce. Reconcile the
recurring ones (reschedule, or fix the routing). `after_state` carries the machine, the other order,
and the two step indices.

### 6. Flip to enforce (only when warn is quiet / understood)

```sql
update public.app_settings set value = '"enforce"' where key = 'job_operations_overlap_enforcement';
```

From now on a write that would create a routed operation overlap is rejected with errcode `DR001` —
the client already surfaces this as a "slot taken" rejection (`SLOT_TAKEN_ERRCODE` in
`SchedulingContext.tsx`), so no client change is needed. Re-run the Phase 6 stress-test script's
machine-board section against production after the flip (redo plan §7).

## Rollback

- **Warn → off:** `update public.app_settings set value = '"warn"' …` (or delete the key) — reverts
  to logging-only; no write is ever blocked by the new check.
- **Whole phase:** the JSONB stays authoritative and nothing reads `job_operations` for display, so
  rollback is: set enforcement to `"warn"`, and (if desired) `drop trigger sync_job_operations_trigger
  on public.jobs; drop table public.job_operations cascade;` plus restore the previous
  `validate_job_assignment` body from `schema.sql`. No job data is lost — the rows are derived.

## Still needs a live-DB session before merge

- The migration has **not** run against production. Apply + checksum + warn-mode observation must be
  done by someone with DB access. The admin-route-guard memory notes several bugs only reproduce
  against a real Supabase session — treat the enforce flip as the moment to re-run the stress test.
- Confirm the sync trigger and the deferred constraint trigger interact as intended on a real write
  (the AFTER sync trigger must land rows before the DEFERRED validate trigger reads them at commit).
  Verified by logic and unit tests here; confirm once live.
- `schema.sql` still contains the **old** `validate_job_assignment` and its LIMITATION comment. Once
  this migration is applied and stable, fold the Phase D definition into `schema.sql` so a fresh
  `schema.sql` run reproduces production (Phase C left the same follow-up).
