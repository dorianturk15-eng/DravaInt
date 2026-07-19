# Phase C — Machine identity (machineId) backfill

Phase C gives every machine reference a **stable id** instead of relying on the machine's **name
string**. Before this, renaming a machine in Admin silently orphaned its schedules (the name on the
operation no longer matched any lane). Now:

- `OperationStep.machineId` (inside the `jobs.operations` JSONB) and `jobs.machine_id` (plain jobs)
  are the source of truth.
- All matching (board lanes, capacity, Gantt, conflict detection) resolves the **current** machine
  name through the id first, falling back to the stored name for rows not yet backfilled.
- New/edited operations record the id automatically (WorkOrderCreator, board lane-move).

Existing production rows have **no id yet** — this backfill fills them. Until it runs, everything
still works via name fallback; nothing regresses.

## What the backfill does

For every existing row it is **conservative and non-destructive**:

1. **Routed operations** (`jobs.operations` JSONB): for each op with no `machineId`, set it to the id
   of the machine whose name matches (case-insensitive, trimmed). Existing ids are never overwritten.
2. **Plain single-machine jobs** (`operations` null, `machine` is a single name, not a `→` chain):
   set `jobs.machine_id` by the same name match.
3. **Unmatched names** (match no current machine) are **left alone** and reported — never guessed.
   Legacy chain-string jobs (`"A → B"` with no operations) get no single `machine_id`; each segment
   that matches nothing is reported.

## Files

| File | Role |
|---|---|
| `supabase/migrations/0007_backfill_operation_machine_ids.sql` | The real migration (the authoritative mechanism). |
| `src/scheduling/machineBackfill.ts` | Pure TS planner mirroring the SQL; used by tests. |
| `src/scheduling/machineBackfill.test.ts` | Validates the mapping against a mocked dataset. |
| `scripts/backfill-machine-ids.mjs` | Standalone read-only dry-run against a JSON data export. |
| Admin → Machines → **Unmapped machines** | Live report of unresolved names (post-deploy). |

## How to run (human / live-DB session)

> **Do NOT skip the dry-run.** The report tells you which names won't map so you can fix them
> (register the machine, or correct the operation) before writing.

### 1. Export snapshots (Supabase SQL editor → download as JSON)

```sql
select coalesce(jsonb_agg(to_jsonb(j)), '[]') from public.jobs j;      -- save as jobs.json
select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.machines m;  -- save as machines.json
```

### 2. Dry-run (writes nothing)

```bash
node scripts/backfill-machine-ids.mjs jobs.json machines.json
```

It prints the operations/plain-jobs it *would* fill and, crucially, the **UNMATCHED** names. Exit
code is `1` when anything is unmatched (so CI/humans notice), `0` when everything resolves.

### 3. Reconcile

For each unmatched name: register the machine in Admin (if it should exist), or fix the operation's
machine name. Re-run the dry-run until only genuinely-retired machines remain.

### 4. Apply (in a transaction)

```bash
psql "$DATABASE_URL" -1 -f supabase/migrations/0007_backfill_operation_machine_ids.sql
```

or paste it into the Supabase SQL editor, or `supabase db push`. The migration `RAISE NOTICE`s the
same unmatched report and the counts it touched. It is **idempotent** — safe to re-run.

### 5. Verify

- Re-run the dry-run: UNMATCHED should be only the expected retired names.
- Open **Admin → Machines**: the "Unmapped machines" panel should list only those same names (or be
  gone entirely).
- Rename a machine that now has fully-backfilled operations: the board/Gantt lanes should follow the
  rename with no orphaned cards, and the Admin rename guard should **not** warn.

## Still needs a live-DB session before merge

- The SQL migration has **not** been run against production (no live Supabase credentials in the
  authoring session). It must be dry-run + reviewed + applied by someone with DB access.
- Confirm no realtime/grant surprises: `jobs`/`machines` already have grants; this migration only
  UPDATEs existing rows and adds no table (no new-table checklist needed).
- After backfill, the name-fallback branches remain in the matching code intentionally (for any rows
  the backfill couldn't resolve). They can be retired later once the Admin report is empty and
  Phase D moves operations to real rows.
