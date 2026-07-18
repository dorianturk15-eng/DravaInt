# Gantt Chart Elevation Plan
### Making the Gantogram tab the flagship of Drava Planner — on desktop, tablet, and phone

*Prepared 2026-07-18 · Planning document — nothing here is built yet. Each phase can be greenlit independently.*

---

## 1. Where we are today (honest audit)

The Gantt tab already does a lot — more than most commercial tools at this size:

**What works well**
- **Real scheduling brain.** Behind the chart sits a custom CPM (critical path method) engine — it computes effective start/end respecting dependencies (FS/SS/FF/SF with lag), working hours, weekends and holidays, finds the critical path, computes slack per job, detects dependency cycles, and cascades changes to dependent jobs when you move a bar. This is genuinely valuable and fully ours — no library provides this.
- **Rich visual layer.** Per-machine lanes with efficiency meters, critical-path highlighting, weekend shading, an exact "now" line, red overlap/over-allocation bands, setup-time stripes on bars, warning badges (operator conflict, material not ready), baseline "ghost" bars showing deviation from a saved plan, and curved dependency arrows that light up on hover.
- **Working tools.** Undo/redo (Ctrl+Z/Y, 30 steps), saved view presets per user, search filter, machine sorting, auto-schedule button, baseline save + deviation log, PNG/PDF export, fullscreen, drag to move/resize bars with snapping to shift boundaries, drag-to-reorder operations inside a work order, and clear error messages when the database rejects a change.

**What is fragile or rough (this is the important part)**

1. **The foundation is a dead library.** The chart itself is rendered by `gantt-task-react` version 0.3.9 — a library that has not been updated since ~2021. Everything listed under "rich visual layer" above is **not** provided by the library: our code waits for the library to render, then reaches into its output and injects extra graphics by hand, using the library's *internal, obfuscated* style names (literally selectors like `._KxSXS` and `._31ERP`). If the library ever changed, or if its rendering order shifts, all those decorations silently disappear. About 400 of the page's 1,300 lines are this patching machinery, re-running on every DOM change via a MutationObserver — which also costs performance on large schedules.

2. **Drag does not work on touch screens. At all.** The library listens only to mouse events. On a phone or tablet you cannot move a bar, resize it, or change progress — the single most-loved feature of the tab is desktop-only.

3. **Mobile layout is essentially absent.** There is exactly one small-screen CSS rule (it stacks the toolbar). The chart itself renders at full desktop density: a wide left-hand task table plus a wide timeline, each machine lane with its own horizontal scrollbar (kept in sync by custom JS). On a phone this means endless sideways scrolling through mostly-empty grid.

4. **Each machine is a separate chart instance.** Stacked `<Gantt>` components, one per machine, with JavaScript syncing their horizontal scroll. It works, but it duplicates the time axis per lane, wastes vertical space, and makes a shared header/minimap impossible.

5. **Exports are screenshots.** PNG/PDF export rasterizes the page with html2canvas — output is blurry when zoomed and captures whatever happens to be on screen, unlike the shift schedule's crisp vector PDF.

6. **Baseline and presets live only in the browser.** Saved baseline and view presets are in localStorage — they don't follow the user across devices and are lost if the browser data is cleared.

**Bottom line:** the intelligence (CPM engine, conflict detection, cascade logic) is solid and reusable. The *rendering* layer is the weak point — we've outgrown the library we started with. The miracle is achievable precisely because the hard part (the brain) already exists; what needs replacing is the drawing and interaction layer.

---

## 2. The core recommendation: build our own timeline renderer ("DravaGantt")

This is the single most important decision in this plan, so it comes first.

**Options considered:**

| Option | Verdict |
|---|---|
| Keep patching `gantt-task-react` | Dead end. No touch support, fragile internal-selector hacks, unmaintained. Every new feature costs more than it should. |
| Frappe Gantt / vis-timeline (free libraries) | Same trap again: limited touch support, no per-machine swimlanes the way we need them, and we'd re-patch all our custom visuals (setup stripes, overlap bands, baseline ghosts) onto someone else's internals. |
| Bryntum / DHTMLX Gantt (commercial) | Genuinely excellent, touch-ready — but licensed per developer (roughly €700–1,000+/yr), heavy bundles, and their scheduling engine would fight our CPM engine (two brains disagreeing about where bars go). |
| dnd-kit / react-dnd (drag libraries) | Good libraries, wrong shape. They excel at dragging cards between lists (like our Machine Board). A Gantt bar drag is really "convert pixels ↔ time with snapping" — a coordinate math problem, not a list-sorting problem. A library adds weight without solving our actual problem. |
| **Build our own renderer** ✅ | **Recommended.** We already build 70% of the visuals by hand — just in the worst possible way (injecting into a library's output). Owning the renderer means every feature in this plan becomes straightforward instead of a hack. |

**Why this is less scary than it sounds:** a Gantt renderer is fundamentally one function — `time → x position` — plus rows, rectangles, and pointer handling. We already have that exact function (`getXCoordinate`, `seedDates`, the geometry code) written for the patching layer, and the Machine Board's `boardGeometry.ts` does time↔pixel math too, with tests. The plan is to promote that code into a proper component instead of a parasite on a library. What we render:

- **One unified timeline**, machines as collapsible rows (swimlanes) inside a single scroll container — no more per-lane scrollbar syncing, one shared time header.
- **SVG + absolutely-positioned divs** (no canvas): stays crisp at any zoom, styleable with our existing CSS variables/dark mode, and clickable per element.
- **Pointer Events** (`pointerdown/move/up`) for all interaction — the modern browser API that unifies mouse, touch, and pen in one code path. This is how touch drag becomes free rather than a separate project.
- **Row virtualization**: only render rows/bars near the viewport, so 50 machines × hundreds of jobs stays smooth.
- All current decorations (critical path, overlap bands, setup stripes, baseline ghosts, badges, dependency arrows, weekend bands, now-line) become *first-class rendered elements* — declared in React, never injected afterwards. The MutationObserver machinery gets deleted entirely.

**What we keep unchanged:** the entire CPM engine, conflict detection, cascade logic, undo/redo, presets, Supabase write path and error reporting, translations. The renderer swap touches only how things are drawn and dragged.

**Bundle bonus:** removing `gantt-task-react` (+ its CSS) roughly pays for the new component; no new runtime dependency is added.

---

## 3. Phone & tablet: the interaction model (priority #1)

"Responsive" for a Gantt is not shrinking the desktop chart — it's choosing *what a planner actually needs at each screen size*. Three deliberate tiers:

### Phone (< ~700px): "Today + Agenda" first, timeline second
A phone user on the shop floor wants: *what's running now, what's next, is anything red, and occasionally nudge a job.* They do not want to pan a 3-week grid.

- **Default view = Agenda list** (we already have this pattern working in the Machine Board's mobile card list): machines as collapsible sections, jobs as cards ordered by time, with status color, critical-path flag, conflict badges, and times. Tap a card → the existing details sheet (edit times, operator, material, operations).
- **Compact timeline as the second tab**: a simplified strip view — no left-hand task table at all (bar labels render *inside/above* the bars), taller touch-sized bars (min 44px), one visible time scale, and a **date scrubber** (sticky header showing the visible date; drag it to fly through time — much faster than panning kilometers of grid).
- **Step zoom, not pinch-only**: big [−] [+] buttons cycling Hour → Shift → Day → Week → Month, *plus* pinch-zoom for those who expect it. Pinch anchors on the midpoint between fingers so the time under your fingers stays put.
- **Editing on phone = deliberate, not accidental**: long-press a bar (350ms with haptic-style visual pulse) to "lift" it into move mode; while lifted, the chart pans only via an edge auto-scroll, so scrolling and dragging never fight. Big round handles appear at bar ends for resize. A floating confirmation pill shows the new times with ✓ / ✕ — nothing writes to the database until ✓. (On phones, an explicit confirm beats desktop's instant-apply: fat-finger protection.)
- **What degrades away on phone**: dependency arrows (become a "🔗 2" chip on the card that lists links when tapped), the efficiency meters (fold into the section header as a single %), and the planning-tools workshop (already collapsible; becomes a full-screen sheet).

### Tablet (~700–1100px): the real chart, touch-tuned
Tablets are the sweet spot for a planner walking the floor — enough room for the actual timeline.

- Full unified timeline, but: narrower frozen name column (order number only, tap to peek details), row height bumped to touch size, all drag interactions from the phone model (long-press lift, big handles, confirm pill — configurable to instant-apply for power users), pinch + step zoom.
- Toolbar becomes icon-first with labels in an overflow menu.

### Desktop (> ~1100px): everything, denser
Current density and instant drag-apply stay; desktop gains the same new renderer features (unified lanes, minimap, live conflict preview) without the touch chrome.

**One codebase, not three:** these are the *same* DravaGantt component with layout/interaction props driven by a `useViewportTier()` hook — the same pattern as `MachineBoard` / `MachineBoardMobile` today, but sharing the renderer.

---

## 4. Drag & drop, elevated

What exists: move/resize with mouse, snap to shift boundaries on drop, cascade to dependents, undo, DB-rejection banner. What "modern" adds:

1. **Live ghost + snap guides.** While dragging, the bar's original position stays as a translucent ghost; a vertical guide line follows the leading edge with a floating time tooltip ("Mon 14:00 → Wed 06:00"). Snapping happens *during* the drag (magnetic pull to shift starts 06:00/14:00/22:00, day boundaries, and to the end of the preceding job on the same machine), not silently after drop.
2. **Conflict preview before you drop.** As the ghost moves, run the existing conflict checks (`getJobConflicts`, overlap detection) against the *proposed* time continuously: the target region tints red and the tooltip says *why* ("overlaps RN-2041 · operator Ivan busy") **before** the user commits. Today you find out after the fact via banner-and-snap-back. This is the highest-value single UX change for planners, and it's cheap because the check functions already exist.
3. **Cascade preview.** Because moving a job cascades to dependents, show the dependents' bars shifting as *outline previews* live during the drag — the planner sees the full consequence of a move before releasing.
4. **Cross-machine drag.** Drag a bar vertically to another machine's row to reassign it (with qualification/conflict checks live). Impossible today because each machine is a separate chart; trivial with unified lanes.
5. **Multi-select & bulk move.** Click-select exists but is hidden. Make it visible: selected bars get a highlight ring and a count pill ("3 selected · drag to move together, Esc to clear"); Shift-click or drag-marquee on empty grid to select; dragging any selected bar moves the group (delta logic already exists in `handleDateChange`).
6. **Keyboard scheduling.** Select a bar → arrow keys nudge by the current snap unit (Shift+arrows = fine, 15min), Alt+arrows resize, Enter opens details, with an aria-live announcement of the new time. This is both an accessibility requirement and genuinely fast for desktop power use.
7. **Undo toast.** After any drop: a small toast "RN-2041 moved to Wed 06:00 · **Undo**" — one tap to revert without knowing Ctrl+Z exists (critical on touch, where there is no Ctrl+Z).

All of this rides on the Pointer Events foundation from section 2 — none of it is practical while `gantt-task-react` owns the drag.

---

## 5. "Miracle" features menu

Each independent; effort: **S** ≈ a focused session, **M** ≈ a few sessions, **L** ≈ a mini-project. Ordered roughly by value-for-effort.

| # | Feature | What it gives Dorian | Effort |
|---|---|---|---|
| 1 | **Quick-filter spotlight** | Typing in search *dims* non-matching bars in place instead of hiding rows — you see the matches in context of everything else. Chips for one-tap filters: Critical / Delayed / Material waiting / My machine. | **S** |
| 2 | **Live "now" playhead + shift progress** | The now-line gets a header clock, auto-follows during the day, and each in-progress bar shows elapsed-vs-planned fill — glance = "are we on pace this shift?" | **S** |
| 3 | **Undo toast + change log strip** | Every change (who, what, when → where) in a small slide-out log; tap any entry to revert to that point. Builds trust for multi-user editing. | **M** |
| 4 | **Capacity heatmap overlay** | Toggle that tints each machine row per day/shift by load (green→amber→red, using existing `capacity.ts` math). Instantly shows *where there is room* — the question auto-scheduling and quoting both start from. | **M** |
| 5 | **Minimap** | A thin strip above the chart showing the whole horizon compressed, with a draggable viewport window and red ticks where conflicts/critical jobs are. Kills the "lost in week 3" problem on every screen size, doubles as the phone's date scrubber. | **M** |
| 6 | **Drag-to-link dependencies** | Drag from a bar's edge connector dot onto another bar to create an FS link (long-press the arrow to edit type/lag or delete). Replaces the current two-dropdown form for the common case. | **M** |
| 7 | **What-changed diff after auto-schedule** | Auto-schedule first shows a *proposal*: ghost bars at new positions + a summary ("7 jobs move · RN-2041 +6h · makespan −1.2 days") with Apply / Cancel. Turns the scariest button in the app into a safe one. | **M** |
| 8 | **Live presence & bar locking** | Via Supabase Realtime presence: avatars of who's viewing, a colored outline + name on a bar someone else is dragging, and their changes animating in smoothly instead of snapping. Prevents two planners fighting over the same job. | **M** |
| 9 | **Vector PDF export** | Rebuild export on jsPDF vector drawing (same approach as the shift-schedule PDF, fonts already embedded): crisp at any zoom, proper A3/A4 landscape pagination by machine and date range, header with logo/date/filters. The raster PNG stays for quick sharing. | **M** |
| 10 | **Cloud baselines & snapshots** | Move baseline + presets from localStorage to Supabase: named snapshots ("Plan agreed with customer 14.7."), compare any snapshot as ghost overlay, shared across devices/users. | **M** |
| 11 | **Smart slot suggestions** | Select a job → "✨ Suggest" scans free capacity (heatmap math + conflict checks) and offers the 3 best earliest valid slots ("Tue 06:00 on Glodalica 2 — no conflicts, finishes 8h earlier"), one tap to apply. A deterministic scheduling assistant, not a black box. | **L** |
| 12 | **Split & interrupt jobs** | Scissors tool: split a bar at a time point into two segments (e.g., interrupted by an urgent order), segments visually linked. Needs a data-model addition (multiple segments per job), which is why it's L. | **L** |

---

## 6. Phased rollout

Ordered so each phase ships something visible and each builds on the last. **Phase 2 is the one that delivers "nice on phone and tablet."**

### Phase 1 — New foundation: the DravaGantt renderer *(the enabler)*
Replace `gantt-task-react` with our own unified-timeline component: single scroll container, machine swimlanes (collapsible), shared time header, all existing decorations (critical path, overlap bands, setup stripes, baseline ghosts, badges, weekend bands, now-line, dependency arrows) as first-class rendering, row virtualization, Pointer-Events drag with the current behaviors (move/resize/progress, snapping, cascade) reproduced. Delete the 400 lines of DOM-patching. Feature-parity checkpoint: nothing new for users yet except noticeably smoother scrolling and one timeline instead of many — this phase is judged by "nothing got worse."
*Biggest phase, but every later phase depends on it. Includes a side-by-side QA period against the old chart before removal.*

### Phase 2 — Phone & tablet experience *(the stated priority)*
The three-tier model from section 3: phone Agenda view + compact timeline with date scrubber, long-press lift editing with confirm pill, big resize handles, step zoom + pinch zoom, tablet touch tuning, toolbar responsive redesign. Ship with **#1 quick-filter spotlight** and the **undo toast** (needed for touch).
*After this phase Dorian can genuinely plan from a phone in the workshop.*

### Phase 3 — Drag & drop excellence
Ghost + snap guides, live conflict preview, cascade preview, cross-machine drag, visible multi-select + bulk move, keyboard scheduling. Add **#2 live playhead**.
*After this phase the desktop experience is best-in-class, not just good.*

### Phase 4 — Planner superpowers *(pick à la carte)*
From the menu: recommended order **#5 minimap → #4 capacity heatmap → #7 auto-schedule diff → #6 drag-to-link → #9 vector PDF → #10 cloud baselines**. Each is independent — greenlight any subset.

### Phase 5 — Multi-user & intelligence
**#8 live presence/locking**, **#3 change log**, then **#11 smart slot suggestions** and, if wanted, **#12 split jobs**. These are the "wow in a demo, loved in daily use" tier, and they need the stability of Phases 1–3 underneath.

---

## 7. Risks & honest caveats

- **Phase 1 is a rewrite of the rendering layer.** Mitigation: the geometry math and all scheduling logic already exist and are tested; we build the new chart behind a toggle and run it side-by-side before deleting the old one. The riskiest week is the first one.
- **Touch drag needs real-device testing.** Emulators lie about touch. Budget time for testing on an actual mid-range Android phone and an iPad — including the known realtime-echo quirks of the live Supabase setup, which have bitten drag interactions before.
- **Presence/locking (#8) depends on Supabase Realtime**, which has been unreliable on the live project for echoes; presence channels are a different mechanism and generally more dependable, but verify on the live instance early.
- **Don't skip Phase 1.** Every shortcut that adds touch support on top of `gantt-task-react` means hacking an unmaintained library's mouse handlers — it would cost most of Phase 1's effort and leave all the fragility in place.

---

*Prepared by Claude (Fable) from a full read of `src/pages/GanttChart.tsx`, `src/scheduling/cpm.ts`, `src/scheduling/hierarchy.ts`, `boardGeometry.ts`, the Machine Board mobile implementation, and current CSS/responsive rules.*
