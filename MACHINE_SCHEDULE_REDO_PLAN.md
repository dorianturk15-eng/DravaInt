# Machine Scheduling Complete Redo — Implementation Plan

> **Status: PLAN ONLY — nothing here is implemented.**
> Origin: the Phase 6 live stress test found that "Raspored strojeva" (the machine board)
> shows *"Nema naloga na ovom stroju"* for every machine involved in a multi-operation
> work order, even though those machines clearly have scheduled work. This was filed as a
> known display gap; the user has since asked for a complete redo of machine scheduling
> rather than a spot patch. This document is that redo plan.

---

## 1. Current-state findings

### 1.1 Where the bug actually lives

The board's data layer **excludes routed orders on purpose** and matches lanes by exact
string equality on the legacy single-machine field:

- `src/scheduling/boardData.ts:72` — `boardEligibleJobs()` filters out every job with
  `operations?.length > 0` (and every container/parent job). The doc comment says v1
  deliberately punted: *"reassigning 'which machine' is ambiguous for a job whose steps
  span several machines."* So a multi-op order produces **zero cards**.
- `src/scheduling/boardData.ts:90` — lane membership is
  `job.machine.trim() === machine`. For multi-op orders `WorkOrderCreator` writes the
  legacy column as a concatenated chain
  (`operations.map(op => op.machine).join(' → ')`, `src/pages/WorkOrderCreator.tsx:142`),
  e.g. `"Pila → CNC-1 → CNC-2 → Polirka-1 → Kontrola kvalitete"` — which can never equal
  a single machine name. Even without the eligibility filter, nothing would match.

Net effect: every machine that only appears inside routing chains renders an empty lane
with the `emptyLane` string (`src/i18n/translations.ts:294`).

### 1.2 The rest of the app already does this correctly

The per-step truth lives in the `operations` JSONB (`OperationStep { id, name, machine,
hours, operator?, operatorId? }`, `src/scheduling/SchedulingContext.tsx:16`), and three
subsystems already consume it per-operation:

| Subsystem | How it handles routed orders |
|---|---|
| Capacity (`src/scheduling/capacity.ts:52`) | `calculateMachineLoads` iterates `job.operations`, adding `op.hours` per `op.machine`; falls back to `splitMachineChain(job.machine)` for legacy chain strings. |
| Conflicts (`src/scheduling/cpm.ts:353-386`) | `operationIntervals`/`machineIntervals` expand a routed job into per-machine time windows (sequential from `job.start`, `op.hours` each) for overlap checks. |
| Gantt (`src/scheduling/hierarchy.ts:20,116-141`) | `computeOperationSchedule` lays operations sequentially from `job.start`; `buildGanttTasks` emits one bar per operation labelled `"{op.name} ({op.machine})"` under a project row. |

`splitMachineChain` (`src/scheduling/cpm.ts:330`) is the shared, whitespace-tolerant
`'→'` splitter — the sanctioned way to read the legacy chain string.

### 1.3 Data-model facts that constrain the redo

1. **Operations have no persisted start/end.** Their schedule is always derived:
   sequential from `job.start`, duration = `op.hours`. Three places re-derive it
   independently (`hierarchy.computeOperationSchedule`, `cpm.operationIntervals`, and the
   Gantt build) — deliberately kept in sync per code comments. Any board interaction on an
   operation card must round-trip through this model (change `job.start`, `op.hours`, or
   op order) or the model must gain per-op times.
2. **`OperationStep` has no `machineId`** — machine identity is a free-text name. Renaming
   a machine in Admin orphans operation references silently. (The `jobs` table *does* have
   a `machine_id bigint` FK column — `supabase/schema.sql:203` — but the client never
   reads or writes it; grep for `machine_id` in `src/` returns nothing.)
3. **DB-side double-booking is unenforced for routed work.** `validate_job_assignment`
   (`supabase/schema.sql:278-284`) compares `machine` by exact string over the job's
   single time range; routed orders carry a zero-duration parent window, so the trigger
   neither protects nor false-flags them. The schema comment itself says the real fix is
   per-operation rows (`job_operations`, IMPROVEMENTS_PLAN item #13).
4. **The board's write paths assume one machine per job.** Drag-to-lane writes
   `updateJob(id, { machine: targetMachine })`
   (`src/components/machine-board/useMachineBoardController.ts:350`), auto-schedule keys
   its packing map on `job.machine` (`:517`), and CSV export emits the raw `machine`
   string (`:552`). All of these silently corrupt or mis-handle a chain string if routed
   orders were naively made "eligible" without a per-operation card model — which is why
   the naive one-line fix (drop the filter) is wrong.
5. **`jobs_machine_time_idx`** indexes `(machine, start_time, end_time)` — an index on a
   column whose value is a display chain for routed orders; useless for per-machine
   queries on routed work.

### 1.4 Summary of the root cause

The legacy single `machine` text column is doing three jobs at once — display label,
lane/join key, and DB constraint key — and for multi-op orders its value is a chain
string that satisfies none of them. Everything that has been fixed already (capacity,
conflicts, Gantt) was fixed by ignoring the column and reading `operations`; the machine
board is the last major consumer still keying off it, plus the DB trigger.

---

## 2. Target design

### 2.1 Principles

1. **One source of truth for "what runs on machine X when": the operation.** A plain
   single-machine job is treated as a one-operation route (synthesized at read time, not
   migrated). Every consumer — board, capacity, conflicts, Gantt, DB constraints —
   derives from the same per-operation expansion.
2. **The legacy `machine` column becomes display-only, then derived, then (server-side)
   trigger-ignored.** It is never again used as a join/lane key anywhere in the client.
3. **Machine identity moves to `machineId`** (name kept as denormalized display), so
   Admin renames stop orphaning schedules.
4. **Operations eventually become rows** (`job_operations` table) so the DB can enforce
   overlap; the JSONB stays as the client cache/write format until then.

### 2.2 The board model (client)

Introduce a shared per-operation expansion in `src/scheduling/` (new module, e.g.
`operationSlots.ts`) that replaces the three parallel derivations:

```ts
interface OperationSlot {
  jobId: number;
  opId: number | null;      // null for plain single-machine jobs (synthetic slot)
  machine: string;          // resolved display name
  machineId: number | null; // once identity lands (Phase C)
  startMs: number;          // derived: sequential from job.start (CPM-effective start)
  endMs: number;
  operator?: string;
  operatorId?: number | null;
  job: Job;                 // back-reference for status/order/progress
}

function expandToOperationSlots(jobs: Job[], effective: Map<number, EffectiveSchedule>): OperationSlot[]
```

Rules:
- Routed job → one slot per operation, sequential from the job's **CPM-effective** start
  (so dependency cascades show correctly, matching `cpm.operationIntervals`).
- Plain leaf job → one synthetic slot spanning `effectiveStart..effectiveEnd`. If its
  `machine` is a legacy chain string (`splitMachineChain(...).length > 1`), emit one slot
  per chain segment with the window split evenly — exactly the assumption `capacity.ts`
  already makes — so pre-`operations` production rows still land on the right lanes.
- Container jobs (`hasChildren`) contribute no slots (their leaves do).

`buildBoardLanes` then groups **slots** (not jobs) into lanes keyed by machine, and the
board renders `OperationCard`s. Lane membership no longer touches `job.machine`.

`cpm.operationIntervals`, `hierarchy.computeOperationSchedule`, and the Gantt build are
refactored to consume the same expansion (or it delegates to theirs) — one derivation,
not four.

### 2.3 Board interactions on operation cards

Because op times are derived, interactions must map to real writes:

| Gesture | Semantics |
|---|---|
| Drag first op of a route horizontally | Moves `job.start` (whole route shifts — ops are sequential). |
| Drag a non-first op horizontally | **v1: disabled** (show toast explaining the route is sequential; offer "open in Gantt"). A later phase can introduce per-op lag/offset fields. |
| Drag an op card to another lane | Rewrites that step's `op.machine`/`op.machineId` inside `operations` (one `updateJob` with the patched array) and re-derives the display chain for `job.machine`. |
| Resize an op card | Edits `op.hours` (min 0.25h), which reflows subsequent ops. |
| Drag/resize a plain single-machine job card | Unchanged (today's behaviour). |
| Dependency linking | Stays job-level (edges anchor to the route's first/last op card). Op-to-op links inside one job are meaningless (already strictly sequential). |
| Remove on an op card | Removes the whole job only from the parent card / with confirmation — an op card's "×" should delete the *operation*, not the order. |

Supporting changes: `commitMove`'s machine-change branch, `autoSchedule`'s packing map,
CSV export, and conflict badges all switch from `job.machine` to slot-level data.
`autoSchedule` packs per-machine using slots and moves `job.start` only (it must not
reorder operations).

### 2.4 Add-job form (`MachineSchedule.tsx` step 1)

Unchanged for quick single-machine jobs. Add a hint linking to the Work Order Creator for
routed orders. Quick-create (double-click a lane) keeps prefiling a single-machine job on
that lane.

### 2.5 Data model target (server)

End-state (Phase D):

```sql
create table public.job_operations (
  id bigint generated by default as identity primary key,
  job_id bigint not null references public.jobs(id) on delete cascade,
  seq int not null,
  name text not null,
  machine_id bigint references public.machines(id) on delete set null,
  machine_name text not null default '',   -- denormalized display
  hours numeric not null check (hours > 0),
  operator_id bigint references public.workers(id) on delete set null,
  operator_name text not null default '',
  unique (job_id, seq)
);
```

- `jobs.operations` JSONB remains the client write format initially; a trigger (or the
  client dual-write) keeps `job_operations` in sync until the client reads rows directly.
- `validate_job_assignment` is extended to expand routed jobs via `job_operations`
  (sequential windows from `start_time`) — closing the documented enforcement gap.
- `jobs.machine` becomes a generated/derived display value (or simply stops being
  written as a chain once nothing reads it); `jobs_machine_time_idx` is superseded by an
  index on `job_operations(machine_id)` + the job time index.
- The existing dead `jobs.machine_id` column gets populated for single-machine jobs as a
  side effect of the identity phase, or dropped — decide at Phase C (recommend:
  populate; it makes single-op synthesis trivial server-side).

---

## 3. Migration & backfill

Production data shapes to handle (live Supabase — see deployment memory: grants and
realtime quirks apply to any new table):

1. **Routed jobs** (`operations` non-null, `machine` = chain string): no data migration
   needed for Phases A–B — the client derives everything. Phase C backfills
   `op.machineId` by name-matching against `machines` (report non-matches in Admin
   rather than guessing). Phase D copies JSONB → `job_operations` rows in a migration,
   with a checksum pass (row count per job == JSONB length).
2. **Plain jobs** (`operations` null, `machine` = single name): backfill
   `jobs.machine_id` by name match; unmatched names surface in an Admin "unmapped
   machines" list.
3. **Legacy chain-string jobs without `operations`** (created before the routing UI, if
   any exist): the slot expansion already splits these client-side. Optionally a one-off
   migration converts them into real `operations` (even hour split) — do this only after
   verifying against production data how many exist.
4. **New-table checklist** (from live-Supabase gotchas): explicit `grant` statements for
   `authenticated`/`anon` per migration 0003 pattern, RLS policies mirroring `jobs`,
   realtime publication if the board should live-update, and audit/updated_at triggers
   per the existing `do $$` loops in `schema.sql`.
5. **Rollback**: Phases A–B are pure client; rollback = revert deploy. Phase C's
   `machineId` fields are additive (readers must tolerate absence). Phase D keeps JSONB
   authoritative until a final cutover commit, so rollback = stop reading rows.

---

## 4. UI changes

- **Op cards** visually distinct from job cards: smaller header showing
  `order · step-name`, machine implied by lane; a chain glyph linking sibling ops
  (subtle, not the full dependency connector).
- **Lane load %** now includes routed hours (it will jump — expected and correct; note it
  in the release notes so users don't think load doubled overnight).
- **Mobile board** (`MachineBoardMobile.tsx`) consumes the same lanes, so it inherits the
  fix; verify its per-lane job list renders op entries sensibly (order + step name).
- **Empty-lane copy**: keep, but it should now be rare and truthful.
- **Toasts/i18n**: new strings (hr + en) for "sequential route — drag the first step or
  edit in the Gantt", op-resize feedback, and Admin unmapped-machine warnings.
- **Conflict badges** on op cards use the existing per-operation conflict data
  (`cpm.getJobConflicts` already computes it — the board just never showed it for routed
  work).

---

## 5. Risk areas

1. **Write amplification / version conflicts.** Editing one op rewrites the whole
   `operations` JSONB through `updateJob`'s optimistic-versioning path. Two users editing
   different steps of the same order will version-conflict — acceptable initially
   (surfaced by the existing toast), fixed for real by Phase D rows.
2. **Derived-schedule drift.** Four derivations of op timing exist today; consolidation
   must be test-locked (`boardData.test.ts`, `conflicts.test.ts`, `capacity.test.ts`,
   Gantt snapshot) or the board and Gantt will disagree about where an op sits.
3. **`job.machine` chain regeneration.** When an op's machine changes, regenerating the
   display chain must use the canonical `' → '` join (WorkOrderCreator's format) or
   legacy readers (`splitMachineChain` callers) mis-split. Centralize chain
   join/split as a pair in `cpm.ts`.
4. **Interaction regressions on the existing board.** Drag/resize/link/undo/history are
   pointer-heavy and subtle (`interactionRef` timing, cascade debounce). The redo
   touches `commitMove`, layout, and hit-testing; the desktop board needs a manual
   regression pass, and drag semantics must degrade safely (unknown card kind ⇒ no-op,
   never a bad write).
5. **Live-DB realities.** Unreliable realtime echo and missing grants have bitten every
   new table before (memory: live-supabase-gotchas); Phase D must follow that checklist
   and be verified against production, not just local.
6. **Admin machine renames** remain destructive until Phase C. Interim mitigation:
   Admin warns when renaming a machine referenced by any job/operation.
7. **DB trigger tightening (Phase D)** can start rejecting writes that used to pass.
   Roll out as warn-only (log to audit) before enforcing.

---

## 6. Phased rollout

**Phase A — Read-side fix (ships the stress-test bug fix).** Client-only.
Build `expandToOperationSlots`; rework `buildBoardLanes` to lane by slot; render op
cards **read-only** (select/inspect/conflict badge yes; drag/resize/link no); update
lane load %, CSV export, mobile board. Tests: slot expansion (routed, plain, legacy
chain, container), lane membership, load math parity with `capacity.ts`.
*Exit criterion: every machine in the Phase 6 stress-test dataset shows its routed work.*

**Phase B — Interactions.** Enable the gesture table in §2.3: first-op drag moves
`job.start`; lane-drag rewrites `op.machine` + regenerates the display chain; resize
edits `op.hours`; auto-schedule/undo/history updated. Manual regression pass on desktop
+ mobile.

**Phase C — Identity.** Add `machineId` to `OperationStep` and start writing
`jobs.machine_id` for plain jobs; backfill by name match; Admin unmapped-machine report
and rename guard. All new matching prefers id, falls back to name.

**Phase D — Operations as rows + DB enforcement.** `job_operations` table (schema §2.5),
JSONB→rows backfill migration, dual-write, extend `validate_job_assignment` (warn-only →
enforce), retire the chain string as a key everywhere server-side. Follow the
live-Supabase new-table checklist; verify on production with a real session (the
admin-route-guard memory says several bugs only reproduce there).

Each phase is independently shippable and independently revertible; A alone resolves the
reported bug.

---

## 7. Verification plan (per phase)

- Unit: new slot-expansion suite + existing `boardData/capacity/conflicts/cpm` suites
  extended for routed cases (including the no-spaces chain and empty-machine ops).
- Integration: `MachineBoard.test.tsx` gains a routed-order fixture asserting lanes and
  card counts; Gantt-vs-board timing parity test (same job ⇒ same op windows).
- Manual on live: re-run the Phase 6 stress-test script's machine-board section against
  production data after Phase A and after Phase D's trigger enforcement.

---

## 8. Explicitly out of scope

- Per-operation independent start times / gaps between ops (route stays strictly
  sequential; revisit after Phase B feedback).
- Finite-capacity auto-scheduling across routed ops (auto-schedule keeps its greedy
  job-level packing).
- Reworking the Gantt drag-and-drop branch (`claude/gantt-phase3-dragdrop`, unmerged) —
  it should rebase onto the consolidated slot derivation when it lands, noted here so
  the two efforts don't diverge.
