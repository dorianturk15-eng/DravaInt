# Machine Scheduling Improvement Plan
### Making "Raspored strojeva" genuinely good, not just correct

*Prepared 2026-07-19 · Planning document — nothing here is built yet. Each tier can be greenlit independently. Companion to GANTT_ELEVATION_PLAN.md and MACHINE_OPERATIONS_ROLLOUT.md.*

---

## 1. Where we are today (honest audit)

Four shipped phases fixed the core correctness problem. Today the page consists of:

- **`src/pages/MachineSchedule.tsx`** — a legacy "add plain job" form (machine, order, operator, start, end) above the board.
- **`src/components/machine-board/MachineBoard.tsx`** + **`useMachineBoardController.ts`** (~900 lines) — the desktop board: per-machine lanes, one card per *operation slot* (Phase A, via `expandToOperationSlots`), drag/resize/lane-move (Phase B), connect mode, undo/redo (30 steps), saved views (localStorage), status filter, sort by name/load, CSV + PNG export, auto-schedule, "jump to conflict", quick-create by double-clicking empty lane space.
- **`MachineBoardMobile.tsx`** — below 680px, a **read-only** card list per machine (view + remove only).
- **Phase C** (`machineIdentity.ts`, `machineBackfill.ts`) — id-first machine resolution, Admin "unmapped machines" report, rename guard.
- **Phase D** (`jobOperations.ts`, migration `0008`) — `job_operations` rows synced by trigger, `job_effective_windows` view, `detect_job_operation_overlaps()`, running in **warn** mode: conflicts are written to `audit_logs` and the write is allowed.

**What works well:** the derivation layer is genuinely solid. `operationSlots.ts` is the single source of truth for "what runs on machine X, when", it is shared with capacity and tested. Interactions use Pointer Events (touch-capable on tablet). Write results are honoured (`rejected` / `version-conflict` toasts). The Phase D SQL has a tested TypeScript mirror.

**What is weak or missing (found by reading the current code):**

1. **Phase D is invisible.** `detectOperationOverlaps()` exists client-side but is called **only by its test file**. The DB's warn-mode conflict log goes to `audit_logs`, which **no screen in the app reads**. The enforcement flag (`app_settings.job_operations_overlap_enforcement`) can only be flipped by hand-written SQL — there is no Admin UI, no preflight, no path shown anywhere. The RN-2026-065/066 Pila overlap was found by *reading the database*, not by the app telling anyone. This is the biggest gap: we built a smoke detector and installed it in a locked cabinet.
2. **Lane load % is wrong by construction.** `MachineBoard.tsx:202` (and the mobile list) sums **all** of a lane's slot-hours — over the entire schedule horizon — and divides by `getWeeklyCapacityHours()`. A machine with three weeks of queued work shows 300% even if every week is fine. Dashboard's capacity view windows by week (`weekWindow`/`jobIntersectsWeek`); the two views disagree on the same data.
3. **Conflict badges are job-level and inert.** Every card of a routed order shows the identical `getJobConflicts(slot.job)` badge, even when only one operation actually clashes. The popover names the other order but not the machine, the operation, or the times — and offers **no action**. Resolving a conflict means: read badge → mentally locate the other card → manually drag things until the badge disappears. The one real conflict to date was resolved by manual time-shifting.
4. **No time orientation inside lanes.** Unlike DravaGantt, the board has **no now-line, no weekend/holiday shading, no off-shift shading**. Cards float on a blank grid; snapping to shift boundaries happens invisibly on drop, which reads as "the card jumped".
5. **Blocked interactions punish after the gesture.** Dragging a non-first operation horizontally lets you complete the whole drag, then drops the card back with a toast. Same for chain-segment cards. The rule (routes are sequential) is right; the feedback timing is wrong.
6. **Resize is blind.** No live readout of the new hours / end time while dragging; the downstream reflow of later operations is not previewed; resize doesn't snap. `MIN_OP_HOURS = 0.25` clamps silently.
7. **Quick-create tears you away from the board.** Double-click on empty lane space scrolls the page *up* to the legacy form. That form creates only plain, route-less jobs (no `operations`, no `machineId`) — so the board's own creation path produces exactly the legacy-shaped data Phases C/D work around.
8. **Auto-schedule is not operation-aware.** It packs each job back-to-back on its *first* machine's lane only (`packingKey`), shifting `job.start`. Downstream operations of two routed orders can still land on the same machine at the same time — the exact conflict class Phase D detects. The button can *create* warn-mode entries.
9. **Mobile is read-only; tablet is untuned.** Below 680px there is no drag, no status change, no zoom, no search — while Gantt Phase 2 shipped a full mobile package (agenda view, compact timeline, viewport tiers, long-press lift + confirm pill). Between 680–1100px the desktop board is served raw: 20px resize handles, tiny toolbar buttons.
10. **No search, no machine filter, no collapse.** The only filters are status and sort. Finding order RN-2026-072 among 15 machines means scanning lanes. All machines always render, including empty ones.
11. **No deep links in or out.** Navigation is tab-based (`AppTab`) with no parameters. The NotificationCenter's "machine overlap" alert navigates to the tab but cannot focus the offending job. Gantt, Progress Monitoring, Dashboard, and the Admin unmapped-machines report have no "show this on the board" affordance.
12. **Small correctness nit:** `commitMove` resolves the target lane's machine id via exact-string `machines.find((m) => m.name === state.targetMachine)` instead of `buildMachineLookup` (trim/case-insensitive) — a lane whose name came from a trimmed slot string could miss and write `machineId: null`.

---

## 2. Improvements (what's missing) — the conflict lifecycle is the centerpiece

The theme of this plan: **Phase D found conflicts; the board must now surface → explain → resolve them, and then enforcement can be turned on.** Everything else supports that.

### 2.1 Conflict panel on the board (surface)
A collapsible "Conflicts (N)" panel (or toolbar chip with count) fed by the already-tested client mirror `detectOperationOverlaps(jobs, machines)`:
- One row per overlap: `RN-2026-065 op 2 "Piljenje" ⟷ RN-2026-066 op 1 "Piljenje" · Pila · 14:00–17:00 overlaps 15:00–18:00`.
- Clicking a row scrolls both cards into view and pulses them (reuse `jumpToConflict`'s scroll logic, but targeted instead of cycling blindly).
- The chip doubles as the live health indicator: green "No conflicts" / amber count. This finally makes warn mode *visible where scheduling happens*.

### 2.2 One-click resolution (resolve)
Per conflict row, offer the two safe fixes as buttons:
- **"Shift later"** — move the later-starting job's `start` so its clashing window begins at the earlier one's end (respecting `snapToShiftBoundary` and running `runCascade`). This is precisely the manual fix applied to RN-2026-065/066, automated.
- **"Move to…"** — dropdown of machines of the same `type` (mill/lathe from `MachinesContext`) with no overlap at that window; applies `patchOperationMachine`.
Both go through `updateJob` → history (undo works) → the same rejected/version-conflict toasts.

### 2.3 Per-slot conflict badges (explain)
Make the badge honest at the operation level: compute overlap per **slot** (the board already has every slot's window; an interval sweep per lane is cheap) and badge only the clashing card(s). Popover gains: other order, other operation name, machine, both time ranges, and the same two action buttons as the panel. Job-level checks that are genuinely job-level (operator hours, rest, absence) stay on the first slot.

### 2.4 Enforcement flip UI in Admin (finish Phase D)
In Admin → System, a card for "Overlap enforcement" that:
- reads `app_settings.job_operations_overlap_enforcement` (`warn`/`enforce`),
- shows the current client-side conflict count as a preflight ("2 unresolved conflicts — resolve them before enforcing" — button disabled until 0, with an explicit override checkbox for the brave),
- writes the flag back. Include a "recent overlap warnings" list read from `audit_logs where action = 'operation_overlap_warning'` (admin-only; needs a select grant — check migration 0003's pattern per the live-Supabase checklist).

### 2.5 Time-window-aware lane load + idle visibility
- Lane header load % becomes **this-visible-window** load: hours of the lane's slots clipped to the scrolled/zoomed range (or a "this week" toggle matching Dashboard's `weekWindow`), divided by the window's working hours from settings. Board and Dashboard finally agree.
- Optional per-lane **idle gap hint**: render the largest free gap in the visible window as a faint dashed outline ("48 h free"), which is also the natural drop target for quick-create.

### 2.6 Board time furniture
Now-line (red vertical line, same visual as DravaGantt), weekend + holiday shading, and off-shift shading from `settings.workdayStart/End`. These are cheap absolutely-positioned divs behind the lanes and instantly explain *why* drops snap where they do.

### 2.7 Operation-aware auto-schedule
Rewrite `autoSchedule` to pack using `expandToOperationSlots` windows: when choosing a job's start, require **every** operation's window to be free on its machine (track per-machine end cursors; a job's feasible start is the max over its ops of each machine's availability shifted by the op's offset). Keeps the "shift `job.start` only, never reorder ops" contract. After running, the conflict chip should read zero — that becomes its acceptance test.

---

## 3. Changes (what should behave differently)

### 3.1 Block invalid drags at gesture start, not gesture end
- Non-first operation cards: no horizontal drag affordance at all — `cursor: default` horizontally, and on `beginMove` mark the interaction as **lane-move-only** (vertical highlight only; horizontal delta ignored live, not after drop). Show a small 🔒/tooltip "Sequential route — drag the first operation to move the order, or drag vertically to change machine."
- Chain-segment cards (legacy `A → B` strings without operations): show a distinct "legacy chain" style and a one-time hint offering **"Convert to route"** (see 5.4/Tier 3) instead of a dead-end toast.

### 3.2 Live drag/resize feedback
- During move: a floating pill next to the card with the snapped new start–end ("Mon 06:00 → Tue 14:00"), turning amber if the drop window overlaps another slot on the target lane (pre-drop conflict preview — the board knows every slot's window already).
- During resize: pill shows `hours` ("6 h → 9 h") plus the route's new end; ghost-outline the downstream operations at their reflowed positions so "resize reflows the route" is *seen*, not discovered.
- Snap resize deltas to 0.25 h steps so the DB and the pill agree.

### 3.3 Quick-create in place, route-capable
Replace the scroll-to-form event with an **inline popover** at the double-clicked point: order number, operator, duration (default 8 h), machine prefilled from the lane, start prefilled from the click — Create writes a job **with a single `operations` entry carrying `machineId`** (modern shape, not legacy). A "More options → Work Order Creator" link covers full routing. The top-of-page legacy form shrinks to a collapsed "Add manually" details section (kept for keyboard/accessibility parity), and should also write the modern single-op shape.

### 3.4 Fix the lane-move id lookup
`commitMove` should resolve `targetMachineId` via `buildMachineLookup(machines)` / `resolveMachineId` instead of exact-name `find` (audit item 12). One-line risk-free fix; do it first.

### 3.5 Keyboard parity for new actions
Conflict panel rows and resolution buttons reachable by keyboard; `n` / `p` (or `[`/`]`) to cycle conflicts (supersedes the blind `jumpToConflict` cycle button, which the panel replaces).

---

## 4. Easier UI

### 4.1 Toolbar diet
The desktop toolbar is currently ~14 controls in one row. Regroup:
- **Always visible:** zoom, status filter, search box (new), conflict chip (new), Today, Undo/Redo.
- **Overflow "⋯" menu:** sort, connect mode, auto-schedule, CSV, PNG, saved views, chain-selected.
This mirrors what Gantt's plan did (icon-first + overflow) and is what makes the 680–1100px tablet band usable.

### 4.2 Search + machine filtering
- **Search box** filtering by order number / operation name: non-matching cards dim to 20% opacity (don't unmount — layout stability), matching lanes stay, Enter jumps to first match.
- **Machine filter / collapse:** click a lane header to collapse it to a slim bar (count + load only); an "only machines with work" toggle hides empty lanes. Collapsed state joins the saved-view shape (`BoardView` gains `collapsedMachines: string[]`, `query?: string` — additive, so old localStorage views parse fine).

### 4.3 Empty states and onboarding
- Board with zero jobs: instead of bare lanes, a centered hint "Double-click any lane to schedule work here, or create a routed order in Work Order Creator →" (link navigates the tab).
- Zero machines: today you get a phantom "General / Unassigned" lane; replace with "No machines registered — add them in Admin → Machines" (+ link, admin-only).
- First-visit coach marks (localStorage flag): three short callouts — drag first op = move order, drag any op vertically = change machine, edges = resize hours.

### 4.4 Mobile (<680px): borrow Gantt Phase 2's proven pattern
The read-only list becomes an **agenda that can act**, reusing the interaction grammar users already learned on Gantt mobile (`GanttAgendaView`, long-press + confirm pill):
- Cards get a tap-to-open action sheet: status change, operator, "shift later 1 h / to next shift" buttons, remove. No freeform drag on phones — deliberate buttons beat 44px-target drags for schedule edits.
- Machine sections collapsible, with the corrected window-aware load %.
- The conflict chip (2.1) appears as a sticky banner; tapping lists conflicts with the same one-tap "Shift later" fix. **Resolving a real conflict from a phone is the headline mobile feature.**
- Tablet (680–1100px): keep the full board, bump `CARD_HEIGHT`/handles to touch size and use the 4.1 toolbar. Board interactions are already Pointer Events, so touch drag works — it just needs bigger targets.

### 4.5 Colour/legend clarity
A small persistent legend (status colours, conflict badge, chain glyph `‹ ›`, legacy-chain style) in a corner popover — currently the `‹ ›` glyphs and `is-operation` styling are unexplained anywhere in the UI.

---

## 5. Connections to other areas

### 5.1 Lightweight cross-page focus bus (enabler — build first)
Navigation is tab-state, not URLs, so "deep linking" = a tiny module (`src/navigation/focusTarget.ts`): `requestFocus({ tab: 'machines', jobId, opId?, machineName? })` stores a one-shot target (module-level + sessionStorage for reload survival) and navigates; the board consumes it on mount → scrolls to + pulses the card, or falls back gracefully (job gone / filtered out → toast "Order no longer on the board"). Same primitive serves Gantt and Progress as consumers later. (~60 lines + tests; every item below rides on it.)

### 5.2 Inbound links
- **NotificationCenter "machine overlap" alert** → focuses the actual clashing job, not just the tab (it already knows the jobs; today it discards them).
- **Gantt job bar context/details** → "Show on machine board" (focus first slot). The two pages already share `cpm`/`operationSlots` math, so what you see will agree.
- **Progress Monitoring row** → same link; a foreman asking "why is this late" lands on the machine context in one tap.
- **Dashboard capacity heatmap row** (per-machine) → board focused on that machine (collapse others via 4.2), week-scoped. This closes the loop with the corrected load math in 2.5 — the numbers now *match*, so the link is trustworthy.
- **Admin unmapped-machines report row** → board focused on the affected job's card (which renders on its name-string lane), so "fix the operation" is one click instead of a hunt.

### 5.3 Outbound links
- Card popover / selected card gets "Open in Work Order Creator" (the Phase 6 edit flow) for full route editing — the board does quick moves; deep edits belong there.
- Conflict panel rows → "View in Gantt" for the dependency-context view of the same clash.

### 5.4 Data connections
- **Audit-log warnings surfaced** (2.4) close the Phase D loop: DB warn → Admin sees history; board chip → scheduler sees *current* state.
- **Legacy chain conversion assist:** the board is where chain-segment cards are visibly second-class (no resize, no lane-move). A "Convert to route" action turning `"Pila → CNC-1"` into two real operations (hours split evenly, `machineId` resolved) migrates the last enforcement-exempt data class — a prerequisite for warn→enforce being airtight. (Tier 3: it's a data migration disguised as a button.)

---

## 6. Priorities (so Opus implements sensibly)

### Tier 1 — high value, low risk (greenlight together; each independently shippable)
| # | Item | Ref | Notes |
|---|---|---|---|
| 1.1 | Lane-move id lookup fix | 3.4 | One line + test. Do first. |
| 1.2 | Conflict chip + panel from `detectOperationOverlaps` | 2.1 | Pure derivation → UI; function already tested. |
| 1.3 | Per-slot conflict badges with real details | 2.3 | Interval sweep per lane; keep `getJobConflicts` for job-level checks. |
| 1.4 | "Shift later" one-click resolution | 2.2 | Reuses `updateJob` + cascade + undo paths. |
| 1.5 | Window-aware lane load % (board ⇄ Dashboard agreement) | 2.5 | Fixes an actively misleading number. |
| 1.6 | Now-line + weekend/off-shift shading | 2.6 | Cosmetic-cheap, orientation-huge. |
| 1.7 | Block non-first-op horizontal drag at gesture start | 3.1 | Pure interaction-state change; no write-path changes. |
| 1.8 | Search box + dim non-matches | 4.2 | Read-only feature. |
| 1.9 | Focus bus + NotificationCenter/Admin-report inbound links | 5.1, 5.2 | Enabler + two cheapest consumers. |

### Tier 2 — high value, medium risk (after Tier 1 settles)
| # | Item | Ref | Notes |
|---|---|---|---|
| 2.1 | Live drag/resize pills + downstream reflow ghosts | 3.2 | Touches the hot interaction path; needs care on perf. |
| 2.2 | "Move to…" machine-suggestion resolution | 2.2 | Needs free-window computation per machine. |
| 2.3 | Admin enforcement-flip card + audit-log warning list | 2.4 | Live-DB: check grants (migration 0003 pattern), RLS on `audit_logs`. |
| 2.4 | Inline quick-create popover (modern single-op shape) | 3.3 | Replaces event/scroll hack; touch write shape carefully. |
| 2.5 | Toolbar regroup + overflow, tablet touch sizing | 4.1, 4.4 | Mostly CSS/layout; broad visual diff. |
| 2.6 | Mobile agenda actions + mobile conflict banner | 4.4 | New mobile write paths; mirror Gantt-mobile patterns. |
| 2.7 | Machine collapse / hide-empty + saved-view shape v2 | 4.2 | Additive localStorage migration. |
| 2.8 | Gantt / Progress / Dashboard inbound links | 5.2 | Each a small consumer of 1.9's bus. |
| 2.9 | Empty states + coach marks + legend | 4.3, 4.5 | Low risk, but ship after layout stops moving. |

### Tier 3 — speculative / high risk (separate decisions, not part of the default greenlight)
| # | Item | Ref | Why risky |
|---|---|---|---|
| 3.1 | Operation-aware auto-schedule | 2.7 | Rewrites a bulk-write feature; needs strong tests + undo confidence. |
| 3.2 | Legacy chain → route conversion button | 5.4 | Data migration per click; irreversible shape change (undo must be proven). |
| 3.3 | Flip live DB to `enforce` | 2.4 | Do only after Tier 1/2 have run in production ≥1–2 weeks with the chip at zero; it's a config flip via the new Admin card, not a code change. |
| 3.4 | Per-operation progress / Progress Monitoring op-awareness | §4 audit | Data-model extension (`progress` per op); cross-page; out of board scope. |
| 3.5 | Idle-gap hints in lanes | 2.5 | Nice-to-have; computation + visual noise trade-off unproven. |

**Suggested implementation order within a session:** 1.1 → 1.9 (bus) → 1.2/1.3/1.4 (conflict lifecycle core) → 1.5/1.6 → 1.7/1.8 → then Tier 2 by the numbers. Keep each tier-1 item its own commit; run `npx vitest run` after each (the board, slots, jobOperations, and backfill suites must stay green).

---

## 7. The hard test (design only — to be executed later in a live browser against production)

**Purpose:** stress the conflict lifecycle end-to-end (create → surface → explain → resolve → verify warn-mode), plus drag/resize semantics and the new UI, with routed orders on shared machines. Assumes Tier 1 (and ideally 2.3, 2.4, 2.6) implemented. Machines assumed registered: **Pila**, **CNC-1**, **CNC-2**, **Bušilica** (adjust names to production's Admin → Machines list; all four must resolve — check the unmapped report is empty first).

**Setup — create three routed orders (Work Order Creator), all starting the same Monday 06:00:**
1. Create `TEST-A`: ops `Piljenje` (Pila, 4 h) → `Glodanje` (CNC-1, 6 h) → `Bušenje` (Bušilica, 2 h). Start Mon 06:00.
2. Create `TEST-B`: ops `Piljenje` (Pila, 3 h) → `Glodanje` (CNC-2, 5 h). Start Mon 06:00. *(Deliberate conflict #1: TEST-A op1 vs TEST-B op1 on Pila, 06:00–10:00 vs 06:00–09:00.)*
3. Create `TEST-C`: ops `Glodanje` (CNC-1, 4 h) → `Bušenje` (Bušilica, 3 h). Start Mon 09:00. *(Deliberate conflict #2: TEST-A op2 on CNC-1 10:00–16:00 vs TEST-C op1 09:00–13:00.)*
4. Also add one **plain** job `TEST-P` on Pila, Mon 12:00–15:00, via the board's quick-create (double-click Pila lane ≈12:00) — verifies quick-create writes the modern single-op shape (inspect: card should behave as an operation card) and sets up conflict #3 later.

**Surface — verify warn-mode visibility:**
5. Open Machine Scheduling. Confirm the conflict chip reads **2** (Pila: A⟷B; CNC-1: A⟷C). Confirm `TEST-P` at 12:00–15:00 on Pila does *not* conflict yet.
6. Open the conflict panel. Verify both rows name: both orders, both operation names, the machine, and both time ranges. Click the Pila row — verify both clashing cards scroll into view and pulse, on the **Pila** lane only (TEST-A's CNC-1/Bušilica cards must not pulse).
7. Verify per-slot badges: on TEST-A only op1's card is badged for the Pila clash (op3 `Bušenje` must be clean); on TEST-B only op1.
8. In Admin → System, verify the enforcement card shows mode **warn**, conflict preflight count **2**, and the "Enforce" action disabled. In the audit-warning list, confirm entries exist for the TEST writes (DB trigger fired on create).

**Explain/orient — board furniture:**
9. Verify the now-line is visible at the current time and "Today" scrolls to it. Verify Saturday/Sunday columns and pre-06:00 hours are shaded.
10. Zoom Hour → Shift → Day → Week; verify the lane load % changes with the visible window (Week view over the test week should show Pila well under 100%, not a lifetime sum).

**Interaction semantics:**
11. Drag TEST-A's **op2** (`Glodanje`, CNC-1) horizontally. Expected: horizontal movement refused *during* the gesture (card tracks only vertically, lock/tooltip shown) — not a post-drop snap-back toast.
12. Drag TEST-A's op2 **vertically** to CNC-2's lane and drop. Expected: op2 reassigned to CNC-2 (card now in CNC-2 lane), conflict #2 (A⟷C on CNC-1) disappears, chip drops to **1**. Undo (Ctrl+Z): op2 returns to CNC-1, chip back to **2**. Redo, then Undo again — end state: chip **2**, op2 on CNC-1.
13. Resize TEST-C's op1 from 4 h to 6 h by the right edge. Expected during drag: live pill "4 h → 6 h" and ghost of op2 (`Bušenje`) at its reflowed later position. After drop: TEST-C op2 starts 2 h later; TEST-C's job end extends 2 h. Undo.
14. Drag TEST-B's **op1** (first slot) horizontally to start Mon 10:00. Expected: whole TEST-B route shifts (op2 follows sequentially); snap pill shows the snapped time before drop; conflict #1 (Pila A⟷B) clears — chip reads **1** (only A⟷C remains).
15. New-UI case — resolve via panel: open the conflict panel on the remaining A⟷C row and click **"Shift later"**. Expected: TEST-C's start moves to ≥ TEST-A op2's end (16:00, shift-snapped), chip reads **0**, both cards clean. **But** verify conflict #3 now appears *if* TEST-C's reflow lands `Bušenje` over nothing — and separately check Pila: TEST-B now runs 10:00–13:00, overlapping plain `TEST-P` (12:00–15:00) → chip should read **1** with a routed-vs-plain row naming TEST-P. *(This is the deliberately unresolved conflict.)*
16. **Leave conflict #3 unresolved.** Reload the page. Verify the chip still reads **1** after reload (derivation, not session state). In Admin, verify preflight still blocks enforcement (count 1) and the audit list shows a warning row from step 14's/15's writes. This proves warn mode surfaces persistently without blocking.

**Cross-page connections:**
17. From the NotificationCenter machine-overlap alert, click through — expected: lands on Machine Scheduling with one of the TEST-B/TEST-P cards focused and pulsing.
18. From Gantt, open TEST-A and use "Show on machine board" — expected: board focuses TEST-A's first slot (Pila lane). From Dashboard's capacity row for Pila, click through — expected: board focused on Pila (other lanes collapsed if 2.7 shipped).
19. Search `TEST-C` in the board search box — expected: all non-TEST-C cards dim; Enter jumps to TEST-C's first slot.

**Mobile pass (Chrome device emulation, 390×844):**
20. Reload on phone width. Verify the conflict banner shows **1**; tap it, use "Shift later" on the TEST-B⟷TEST-P row — expected: resolves from the phone, banner clears to zero. Verify a card's action sheet can set TEST-P's status to `inProgress`.
21. **Teardown:** delete TEST-A/B/C/P (board card ×, or Progress). Verify chip **0**, lanes clean, Admin preflight count 0. *(Optionally leave them until after an enforcement rehearsal: flip to `enforce` in Admin with count 0, attempt to drag TEST-recreated overlap → write must be **rejected** with the board's rejected-toast, then flip back to warn.)*

**Pass criteria:** every "Expected" above holds; no console errors; `job_operations` row counts still equal JSONB lengths for the TEST orders (Admin checksum / SQL spot-check); undo history never desyncs the chip count.

---

*End of plan. Nothing above is implemented; see tier tables in §6 for suggested order.*
