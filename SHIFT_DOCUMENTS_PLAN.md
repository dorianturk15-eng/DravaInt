# Shift Documents & Shift Schedule Plan
### PDF letterhead/title-block changes + a weekly-block rotation UI for the Shift Schedule page

*Prepared 2026-07-20 · Planning document — nothing here is built yet. Companion to UI_MODERNIZATION_PLAN.md. Each tier can be greenlit independently.*

---

## 1. Where we are today (honest audit)

### 1.1 The PDF ("scheduling PDF" / shift schedule export)

The export is **`src/shifts/shiftPdf.ts`** — a fully vector jsPDF document (embedded Tinos font, booktabs table, A4 landscape), invoked from `src/pages/ShiftSchedule.tsx` in two places:

- `printSchedule()` (`ShiftSchedule.tsx:392`) — prints the current planner drafts.
- `printSnapshot()` (`ShiftSchedule.tsx:420`) — reprints a frozen publication snapshot.

Both pass `companyName: 'Drava International d.o.o.'` (`ShiftSchedule.tsx:403` and `:431`).

The header (`drawHeader`, `shiftPdf.ts:317–358`) currently renders, top-left:

1. The logo (`drawLogo`, 20 mm box) — or a monogram tile built from `companyName` initials if no raster logo is set.
2. **The company name as bold 13 pt text beside the logo** (`shiftPdf.ts:327`: `doc.text(input.companyName ?? 'DravaInt', textX, y + 7)`).
3. A muted line beneath it: `${t.plant} · ${weeks[0].department}` → "Proizvodni pogon · Alatnica" (`shiftPdf.ts:331`).

Top-right is the bordered **title block** (`drawTitleBlock`, `shiftPdf.ts:242–290`) — a 4-row label/value table styled like a controlled-document stamp:

| Label (HR) | Value |
|---|---|
| DOKUMENT | Raspored smjena |
| IZRAĐENO | 20.07.2026. 14:05 |
| IZRADIO | \<username\> |
| STATUS | Objavljeno / Nacrt |

Row height is `rowH = 6.6` mm and total height is derived from `rows.length`, so adding a row grows the block automatically. The block is 86 mm wide (`blockW`, `shiftPdf.ts:334`) anchored at `y = MARGIN_TOP (16)`; the big title "RASPORED SMJENA" sits at `y + 30` and the letterhead rule at `y + 40`, so there is ~24 mm of vertical room — a fifth row (block becomes 33 mm) will overlap nothing on the left column but **will cross the letterhead rule at y+40 by ~9 mm** — the layout needs a small adjustment (see 2.2).

### 1.2 The schema (what actually exists)

From `supabase/schema.sql`:

- **`shift_definitions`** (:129) — id, department_id, name_hr/en, start/end time, color, is_active. Seeded with Prva/Druga/Treća smjena.
- **`shift_schedules`** (:158) — one row per (week_number, year, department); status draft/published; version.
- **`shift_assignments`** (:175) — **one row per worker per day**: (shift_schedule_id, worker_id, date) unique, shift_definition_id, `is_override`, notes.
- **`rotation_templates`** (:148) — id, name, department_id, `cycle_weeks int`, `pattern jsonb`, is_active. **Exists in the schema but is entirely unused** — no code reads or writes it.
- `absences` + the `absences_visible` masking view.

Client mirrors live in `src/shifts/ShiftsContext.tsx` (same shapes; publication snapshots are localStorage-only, noted at `ShiftsContext.tsx:234`).

### 1.3 The generator — the rotation is ALREADY weekly

`generate_shift_schedule` (migration `0006`, line 46) assigns:

```
definitions[1 + mod(worker_index - 1 + week_index, count)]
```

for every day Mon–Fri of a week. That is: **a worker keeps one shift for the entire week, and rotates to the next shift the following week.** The business rule the user describes is already what the data contains — the *UI* is what misrepresents it.

Two real gaps in the generator:

1. **No "always first shift" group.** Every selected worker is forced through the rotation. There is no way to pin a worker to Prva smjena.
2. **Rotation phase is positional and unstable.** A worker's shift is a function of their *index in the `p_worker_ids` array* (which comes from `participantIds` insertion order in the UI). Deselect one worker and regenerate → **every worker after them in the array flips to a different shift**, silently rewriting non-override assignments for already-planned future weeks. The phase also has no anchor to real history: it doesn't ask "what shift was this worker on last week?".

### 1.4 The Shift Schedule page UI (why it reads as day-to-day)

The planner (`ShiftSchedule.tsx:567–614`) renders, per week, a grid whose **rows are shift definitions and columns are days**; each cell holds one draggable chip per assigned worker. For a 12-worker Mon–Fri week that's 60 chips per week × 4 weeks on screen. Consequences:

- The dominant visual object is the *(worker, day)* pair, so the page communicates "assignments are decided per day" — the exact misreading the user flagged. The weekly pattern (worker X is on shift 2 all of week 30) is invisible unless you scan five columns and confirm the same name appears in the same lane five times.
- The same worker appears five times per week; a whole-week change means five drags (each becoming `is_override: true`, which then *survives regeneration* — see the override-preservation logic at `ShiftSchedule.tsx:244` and migration 0006's delete-guard).
- Real weekly questions — "who rotates onto the second shift next week?", "who never rotates?" — have no answer anywhere on the page.
- The PDF already solved this presentation problem better than the UI: one row per worker, one colour-coded shift code per day, weeks side by side (`shiftPdf.ts:360+`). The per-day codes within one worker-week are almost always identical — five copies of the same digit.

What is genuinely good and must be preserved: drag-to-override with conflict preview (rest/48 h/absence checks, `dropWouldConflict` :317), the publish→immutable snapshot→archive lifecycle, absence integration, the participant roster panel, CSV/ICS export.

---

## 2. Tier 1 — PDF changes (low risk, high value, small diffs)

### 2.1 Remove "Drava International d.o.o." from the letterhead — logo only

In `drawHeader` (`shiftPdf.ts:321–331`):

- Delete the bold company-name text line (`:324–327`).
- Keep the logo exactly as is (`drawLogo` unchanged, including the monogram fallback — the fallback still needs `companyName` for initials, so **keep the `companyName` prop and the two call sites in `ShiftSchedule.tsx`**; it also feeds PDF metadata `author` at `shiftPdf.ts:691`).
- Decide what happens to the muted "Proizvodni pogon · Alatnica" line that sat *under* the name: with the plant identity moving into the title block (2.2), the cleanest result is to drop this line too and let the letterhead be just the logo — otherwise a lone muted line floats next to the logo at an odd height. If it is kept, re-anchor it vertically centred on the logo box.
- Update `shiftPdf.test.ts` accordingly (it exists; check for assertions on the header text).

Visual check after: the top-left is logo-only; the title "RASPORED SMJENA" at `y + 30` becomes the first text on the left and may optionally move up a few mm to rebalance — do this only if it looks empty in the rendered PDF, not preemptively.

### 2.2 Add "Proizvodni pogon - Alatnica" to the right-side title block

In `drawTitleBlock` (`shiftPdf.ts:244–249`), add one row to the `rows` array, **first**, so the block reads top-down: what facility → what document → when → who → status:

```ts
const rows: Array<[string, string]> = [
  [t.plantLabel, `${t.plant} - ${weeks[0].department}`],   // "POGON · Proizvodni pogon - Alatnica"
  [t.docLabel, t.docName],
  ...
];
```

Details:

- **Value should be built from the schedule's `department`, not hardcoded** — `Proizvodni pogon - ${department}` yields exactly "Proizvodni pogon - Alatnica" for the department in question (the DB default and the UI default are both `'Alatnica'`, `schema.sql:164`, `ShiftSchedule.tsx:103`) while staying correct for Brizganje/Montaža/Kontrola kvalitete, which are selectable in the planner (`ShiftSchedule.tsx:525`). `drawTitleBlock` doesn't currently receive the weeks — pass `weeks[0].department` (or the composed string) as a parameter.
- Add label strings to the `L` map (`shiftPdf.ts:119`): HR `plantLabel: 'Pogon'`, EN `plantLabel: 'Facility'`; reuse the existing `plant` strings ("Proizvodni pogon" / "Production plant").
- The existing value-truncation loop (`:271`) already protects against overflow at 8.6 pt in an 86−26−4 mm value cell — "Proizvodni pogon - Alatnica" fits untruncated; verify "Kontrola kvalitete" does too.
- **Layout fix that comes with the fifth row:** block height becomes 5 × 6.6 = 33 mm. Either (a) push the title/range/rule down by one row-height when rows > 4 (make `drawHeader` compute `ruleY` from `max(titleBottom, blockBottom) + margin`), or (b) shave `rowH` to ~5.8 mm for the 5-row block. Prefer (a) — derived layout over squeezed type.
- Matching style is automatic: the row renders through the same label-cell tint / hairline / bold-small-caps code path as the existing rows.

### 2.3 Verification for Tier 1

`shiftPdf.ts` has a test file and a pure `buildShiftSchedulePdf()` entry point that returns the doc without saving — extend tests to assert (via `doc.getTextDimensions`/text-extraction or the existing test approach) that the company name string no longer appears and the Pogon row does. Then generate one real PDF from the planner and one archive reprint (both call sites) and eyeball A4 output at 100%.

---

## 3. Tier 2 — Weekly-block rotation UI (the redesign)

### 3.1 Design principle

> The unit of scheduling in this department is the **worker-week**, not the worker-day. Days are the exception mechanism (overrides, absences), not the rule.

The data model already agrees (see 1.3). So this is primarily a **presentation and editing-grain change**, plus one small schema addition for the fixed-shift group.

### 3.2 Proposed UI: the Rotation Board

Replace the current per-week "shift lanes × days" grid as the *default* view with a single matrix:

- **Rows = workers**, split into two labelled groups:
  - **"Stalna prva smjena" (Always first shift)** — pinned group, rendered first, visually quieter (their cells are always shift 1; no rotation arrows).
  - **"Rotacija" (Rotating)** — everyone else.
- **Columns = weeks** (the 1–12 week horizon already selected in the command card). One column per week, not per day.
- **Each cell = the worker's shift for that whole week**: a solid block in the shift's colour with the shift number/name ("1 · 06–14"), exactly the coding scheme the PDF legend already established. This makes the diagonal "stairstep" of the rotation *visible* — you can see at a glance that shift 1 walks down the roster week by week.
- **Cells that are not uniform** (a mid-week override, an absence, a weekend add-on) render as a **split cell**: the dominant shift block plus small per-day ticks (M T W T F) marking the exceptions, e.g. a grey tick for an absence day, a second-colour tick for an overridden day. Clicking such a cell (or any cell) expands the **week detail** — the existing day-grid for that week, reused as-is, where per-day drag/override/absence editing continues to work exactly like today.

Editing at week grain:

- **Click a cell → cycle/pick the shift for the whole week** (writes 5 per-day assignments; sets `is_override` on all of them only if the result diverges from what the generator would produce — see 3.4's phase-anchor note).
- **Drag a whole row cell to another shift lane? No —** with rows-as-workers there are no lanes; instead a small popover on the cell: shift picker + "apply to rest of horizon" checkbox (worker moves to shift 2 from week 31 onwards).
- **Pin toggle on the worker row** (📌 / "1"): marks the worker as always-first-shift. Moves them between groups and drives the generator (3.3).
- Rest-period/48 h/absence validation stays: it already operates on per-day assignments, which remain the storage format; surface violations as a red corner badge on the week cell.

Retained secondary views (cheap, since components already exist):

- **Week detail** = today's day grid, opened per week (see above). It stops being the landing view but remains the day-level editor. This keeps the migration risk low: no editing capability is removed.
- The **archive/snapshot modal** keeps the day grid — snapshots are day-grain documents and reprints must match what was issued.

### 3.3 Data-model implications

Storage of assignments **does not change**: `shift_assignments` stays per-day (payroll, absences, overrides, ICS export, and the immutable snapshots all need day grain). The weekly view is a *derivation*: group a worker's assignments by ISO week; if all workdays share one `shift_definition_id`, that's the week's shift; otherwise it's a split cell.

One addition is needed for the fixed group. Options considered:

1. **`workers.fixed_shift_definition_id bigint null references shift_definitions(id)`** — a nullable column on `workers`. Simple, one migration, one Admin/roster toggle, trivially readable by the generator and the UI grouping. **Recommended.**
2. Use the existing, unused **`rotation_templates`** table (cycle_weeks + jsonb pattern). More general (could later express 2-week cycles, skip patterns), but it's a per-department template, not per-worker, so it can't express "these 3 named people never rotate" without inventing a worker↔template join that doesn't exist. Overkill for the stated rule; keep it in reserve for a future "custom rotation patterns" feature and note it in the migration comment.
3. A separate `worker_shift_pins` table — no advantage over (1) at this cardinality.

Migration checklist for option 1 (per the live-Supabase gotchas memory): column + FK, **grant** on the new column path is covered by existing table grants, but regenerate the `workers` select used in `WorkersContext` and confirm anon/pre-login fetch behaviour is unchanged; RLS policies on `workers` already cover update by planners/admins.

### 3.4 Generator changes (new migration, `generate_shift_schedule` v3)

1. **Fixed group:** workers with `fixed_shift_definition_id` always receive that shift (guard: if the definition is inactive, fall back to rotation and surface a warning). Everyone else rotates through the *remaining* active definitions? — **No: rotate through all active rotation shifts as today** (first shift is still part of the rotation for rotating workers; the fixed group simply doesn't participate).
2. **Stable rotation phase (fixes 1.3 gap 2):** anchor each rotating worker's phase to *their own previous week* instead of array position: look up the worker's dominant shift in the immediately preceding week's schedule (if any) and assign `next(shift)`; only fall back to the positional formula for workers with no history. This makes regeneration idempotent for existing weeks, immune to roster reordering, and matches how the crew actually thinks ("I was on second last week, so I'm on third/first now").
3. Ordering: `order by worker_index` loops stay; the delete-stale-rows guard from migration 0006 is untouched.
4. The client-side offline fallback generator (`ShiftSchedule.tsx:229–265`) must mirror both rules — it's the same algorithm in TS.

### 3.5 PDF follow-through (small, after 3.3)

- Group the roster in the PDF by fixed-vs-rotating instead of (or before) `roleName` — `buildRoster`/`workerGroup` (`shiftPdf.ts:399`, `ShiftSchedule.tsx:406`) already support an arbitrary group key and draw a divider rule between groups, so this is a one-line change of the `workerGroup` callback.
- Optional: since a worker-week is almost always one shift, a future PDF variant could print one code per **week** instead of five per day — but the current per-day grid also serves the exception cases (absences, overrides) faithfully, so leave the PDF grid alone for now. **Do not change the printed grid in this plan.**

### 3.6 What deliberately does NOT change

- Publish/snapshot/archive lifecycle, versioning, reprint fidelity.
- Per-day override capability and its conflict checks.
- CSV/ICS export formats.
- `shift_assignments` schema.

---

## 4. Tier 3 — needs explicit go-ahead (speculative / higher risk)

1. **Persist publication snapshots to Supabase** (`shift_publications` append-only table). Today they live in localStorage only (`ShiftsContext.tsx:234`) — the "payroll-grade audit trail" evaporates with a cleared browser profile and is invisible to other terminals. This is arguably a data-integrity fix rather than UI, but it's schema + RLS + grants + backfill, so it needs its own sign-off. (Checklist per the live-Supabase gotchas: base-table grants like migration 0003, no reliance on realtime echo, RLS insert-only for planners, select for authenticated.)
2. **Rotation exceptions beyond "always first"** — e.g. two-week blocks, worker-specific rotation direction — via activating `rotation_templates`. Only if the department actually asks; the jsonb pattern format would need designing.
3. **Absence-aware week cells with replacement suggestions** — when a rotating worker is absent a full week, suggest promoting a fixed-shift worker or adjusting phase. Genuinely useful, genuinely speculative.

---

## 5. Suggested implementation order

| Step | Scope | Risk |
|---|---|---|
| 1 | Tier 1 PDF changes (2.1 + 2.2) + tests | Low — one file + strings, pure function, testable offline |
| 2 | Migration: `workers.fixed_shift_definition_id` + Admin/roster pin toggle | Low — additive column |
| 3 | Rotation Board view (3.2) with week-detail reuse; day grid demoted to detail | Medium — new view, but storage untouched |
| 4 | Generator v3 (3.4) + client mirror | Medium — needs careful regen testing against existing published weeks |
| 5 | PDF grouping follow-through (3.5) | Low |
| 6 | Tier 3 items | Only with explicit go-ahead |

Verification notes: generator v3 must be tested against the year-boundary cases migration 0006 fixed (ISO week 1), against regeneration with a shrunk roster (phase stability), and with a fixed worker whose pinned shift is deactivated. The Rotation Board must round-trip: week-grain edit → per-day rows → PDF/CSV/snapshot identical to an equivalent day-grain edit.
