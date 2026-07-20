# UI Modernization Plan
### A consistent, modern, user-friendly surface across the whole app

*Prepared 2026-07-20 · Planning document — nothing here is built yet. Each tier can be greenlit independently. Companions: SHIFT_DOCUMENTS_PLAN.md (Shift Schedule page + PDF), MACHINE_SCHEDULING_IMPROVEMENT_PLAN.md (machine board interior — not re-planned here).*

---

## 1. Where we are today (honest audit)

### 1.1 What is already good (do not rebuild)

- **A real token system exists.** `src/index.css` defines surfaces, text, accents, radii, shadows, motion durations, fonts, and a z-index scale, with a full dark theme (`[data-theme='dark']`), `color-scheme` per theme, `prefers-reduced-motion` support, and consistent `:focus-visible` treatment. This is a better foundation than most apps this size have.
- **App shell features are strong:** command palette (Ctrl+K), NotificationCenter fed by the *same* conflict/capacity engines the pages use, connectivity pill with pending-sync count, inactivity lock, role-gated tabs, error boundary per page, lazy-loaded routes.
- Several pages already use a coherent "page heading" idiom: eyebrow + `h2` + subtitle (`ShiftSchedule.tsx:450`, `page-heading-row`).
- Accessibility basics are present in many spots: `role="tablist"`, `aria-label` on icon buttons, `role="alert"/"status"` on feedback, keyboard shortcut labels.

The problem is not the foundation — it's **inconsistent application** of it, page by page, plus structural drift in CSS and navigation.

### 1.2 Findings (from reading the code)

**F1 — 304 inline `style={{}}` occurrences across the 7 pages** (WorkOrderCreator 68, Admin 103, ProgressMonitoring 57, Dashboard 41, GanttChart 23, MachineSchedule 8, ShiftSchedule 4). Dashboard builds its two main panels out of `step-box` plus ~10 inline properties each (`Dashboard.tsx:161`, `:205`); Admin repeats `className="step-title" style={{ fontSize: 16, color: 'var(--text-primary)', marginBottom: 20 }}` eight times (`Admin.tsx:322` etc.); ProgressMonitoring's overdue badge is a fully inline-styled span (`ProgressMonitoring.tsx:56`). Every inline style is a place the design system can't reach — compact mode, theme tweaks, and future changes silently skip them.

**F2 — Hardcoded colors bypass the tokens.** `Dashboard.tsx:130/138` stat tiles use literal `#2563eb` / `#10b981`; the routing map uses `#3b82f6` / `#cbd5e1` (`Dashboard.tsx:229`) — the latter is a light-theme grey that stays light-grey in dark mode. Confetti colors (fine, decorative) aside, status colors exist as tokens and should be the only source.

**F3 — Two icon languages.** `components/Icons.tsx` is a consistent SVG stroke set used by nav and most buttons, but Dashboard heads its panels with emoji ("📊 Kapacitet Strojeva", "⛓️ Dijagram Toga Procesa", `Dashboard.tsx:163/207`), and several pages define private inline SVG components (`Dashboard.tsx:89`, `App.tsx:36–46`) instead of adding them to Icons.tsx.

**F4 — `App.css` is a 1,731-line monolith with two breakpoint philosophies.** The upper half is mobile-first (`min-width: 480/576/768/1024`), the lower half desktop-first (`max-width: 560/620/640/680/800/820/860/960/980/1040/1307/1360/1439`) — 20+ distinct breakpoints. Nobody can predict what a given width looks like without reading all of them; new CSS gets appended wherever.

**F5 — Navigation is triple-redundant and the drawer is near-dead weight.** The top nav renders *all* tabs as icon+label buttons, plus a hamburger that opens a side drawer containing the *same* tabs, plus the command palette also lists the same tabs (`App.tsx:222–243`). Logout appears in both nav and drawer; Settings in drawer, profile button, and palette. On desktop the drawer duplicates the tab bar exactly; on narrow widths the tab bar labels shrink but the bar itself never collapses into the drawer. There is no single intended navigation model.

**F6 — Information hierarchy on Dashboard is flat and partially wrong.** Six equal stat tiles (two of which — Total and Avg progress — are rarely actionable) get the top of the page, while the genuinely operational content (exceptions, capacity, allocation imbalance) sits below. The routing map hardcodes `i === 1` as the "active" operation (`Dashboard.tsx:229`, `:242`, `:254`) — the *second* node of every route pulses blue regardless of actual progress; it should derive from job progress/status per operation.

**F7 — Tables are desktop-only patterns.** `data-table` usages (Dashboard recent jobs, Admin lists, Progress list view) rely on `overflow-x: auto` wrappers at best. On a phone the Progress list is a sideways-scrolling spreadsheet; there is no card fallback except where bespoke ones were built (machine board mobile, Gantt mobile).

**F8 — Mixed i18n mechanics.** A full `translations.ts` exists (`t.…`), yet hundreds of strings are inline `lang === 'hr' ? '…' : '…'` ternaries scattered through every page (e.g. the whole ShiftSchedule planner, Dashboard quick actions, App.tsx alerts). Functionally fine, but it doubles string maintenance and guarantees drift in tone/terminology between the two mechanisms.

**F9 — Interaction discoverability gaps.** Editing idioms differ per page: double-click to reassign (shift board), drag-only overrides (shift board), click-to-cycle status (progress board), `<details>` disclosure for the add-job form (`MachineSchedule.tsx:51`), edit deep link buttons (Progress → WorkOrders). None are labelled; the only hint is a footnote (`board-help`, `ShiftSchedule.tsx:616`). Hit targets in dense grids are small; drag interactions have no keyboard equivalent anywhere outside Gantt.

**F10 — Page-level entry friction on Machine Scheduling.** The page opens with "Step 1: add job manually" (a legacy form producing route-less jobs) above the actual board — the exact inversion of importance already called out in MACHINE_SCHEDULING_IMPROVEMENT_PLAN.md §1.7. Not re-planned here; noted because the fix (demote/remove the form) is a UI-hierarchy change.

**F11 — Feedback is inconsistent.** Success/error surfacing varies: `inline-success` divs with timers (ShiftSchedule), colored `<p role="alert">` (MachineSchedule:109), toast-like banners (App shell 403), confetti on done (ProgressMonitoring:62 — charming, keep it). There's no shared toast/notice component, so every page reinvents one with different timing and placement.

**F12 — WorkOrderCreator print preview is a separate design language.** The in-page HTML print document (`print-document`, `WorkOrderCreator.tsx:774+`) with `window.print()` sits alongside the vector-PDF approach used by shifts and Gantt. Fine for now (it works), but its barcode line and meta table use ad-hoc inline styles and it's the only print path with no archive/versioning.

---

## 2. Design-system contract (the standard everything converges to)

This section defines the target; the tiers below sequence the work.

1. **Spacing scale:** adopt the implicit 4-px grid explicitly — `--space-1..8` (4, 8, 12, 16, 20, 24, 32, 40). All new/edited rules use tokens; no literal margins in TSX.
2. **Typography scale:** `--text-xs/sm/base/lg/xl/2xl` (11, 12.5, 14, 16, 20, 24) + two weights per family. Page title = 2xl/800 Outfit (already the de-facto standard), panel title = lg/700, table/body = base, meta = sm, micro-labels = xs uppercase (the "eyebrow" idiom, already exists).
3. **Color:** only tokens. Extend `index.css` with the handful of missing semantic tokens found in the audit: `--accent-muted-stroke` (routing map idle), `--tile-accent-*` aliases for stat tiles, status colors already exist.
4. **Components (CSS-first, small):** the audit shows six repeated hand-rolled patterns worth promoting to shared components/classes: `PageHeader` (eyebrow/h2/subtitle/actions), `Panel` (today's `step-box`/`glass-panel` duality merged into one), `StatTile`, `EmptyState` (icon + line + CTA — currently 5 different ad-hoc versions), `InlineNotice` (success/error/info with role and auto-dismiss), `DataTable` wrapper (sticky header, overflow, mobile card slot). No third-party UI library — the app's look is already distinctive and a library migration would be all risk, no user value.
5. **Breakpoints:** exactly three — `680px` (phone/tablet boundary already used by machine board), `1024px`, `1360px` — expressed mobile-first. Everything else gets migrated to the nearest one.
6. **Icons:** Icons.tsx is the only icon source; emoji leave headings.
7. **Interaction affordances:** anything editable shows it (hover affordance or visible control); anything draggable also has a click/menu path; every destructive action confirms or is undoable.

---

## 3. Tier 1 — Low risk, high value (mechanical convergence)

Safe, incremental, no behavior changes. Each item is independently shippable.

1. **Token/inline-style sweep, page by page.** Convert the 304 inline styles into classes using existing + new tokens. Order by payoff: Admin (103) → WorkOrderCreator (68) → ProgressMonitoring (57) → Dashboard (41) → rest. Mechanical rule: if a style encodes layout intrinsic to one element instance (a one-off `minWidth` on a table cell), it may stay; if it encodes *design* (color, font-size, spacing, radius), it becomes a class. Acceptance: visual parity screenshots per page, light + dark.
2. **Kill hardcoded colors** (F2) — including the dark-mode-broken `#cbd5e1` stroke in the routing map.
3. **One icon language** (F3): emoji headings → Icons.tsx SVGs; hoist the private inline icons (App.tsx menu/search/lock, Dashboard check/alert) into Icons.tsx.
4. **`PageHeader` everywhere:** Dashboard, MachineSchedule, ProgressMonitoring, Admin, WorkOrderCreator adopt the eyebrow/h2/subtitle/actions pattern ShiftSchedule already has. Right-hand slot hosts each page's primary action (New order / Generate / etc.), giving every page one obvious starting point.
5. **`EmptyState` + `InlineNotice` components** replacing the five ad-hoc empties and four ad-hoc feedback styles (F11). Confetti stays.
6. **Fix the routing-map "active op" logic** (F6): derive the active node from operation completion (progress mapped over ops, or status), not `i === 1`. This is a correctness fix hiding in the UI.
7. **Stat tile demotion/promotion on Dashboard:** merge Total+Avg into one quiet tile row; promote the exception strip (`dashboard-command-strip` already computes it) to the top with per-exception click-throughs (delayed → Progress filtered; conflict → machine board focus — `requestFocus` already exists at `Dashboard.tsx:184`).
8. **Label the hidden interactions** (F9): title/tooltip + a one-line hint slot in `Panel` for drag/double-click idioms; `<details>` on MachineSchedule gets a visible chevron + summary text.

## 4. Tier 2 — Structural (moderate risk, needs a review pass each)

1. **CSS re-organization** (F4): split `App.css` into `styles/` modules — `shell.css`, `components.css` (Panel/buttons/tables/badges), one file per page — imported from one index. Then the **breakpoint migration** to the three canonical widths, one module at a time (this is where visual regressions can happen; do it per-module with before/after screenshots at 375/680/1024/1440).
2. **Navigation simplification** (F5): pick the model — recommended: **top tab bar is the sole desktop navigation; the drawer exists only below 1024px** (where tabs collapse into it); logout/settings live in the profile menu only; the hamburger disappears on desktop. Command palette unchanged (it's an accelerator, not primary nav). Also: the active tab already shows in `nav-active-module` — drop the duplicate label under the brand once tabs are always visible on desktop.
3. **Responsive table pattern** (F7): `DataTable` gains a card-list fallback below 680px (define one card layout per table: primary line, meta line, status pill, actions). Apply to Progress list, Admin lists, Dashboard recent jobs.
4. **i18n consolidation** (F8): move inline ternary strings into `translations.ts` opportunistically — *rule going forward* plus a sweep of the worst offenders (ShiftSchedule, App.tsx alerts). Not a blocker for anything else; can run as background hygiene per page touched.
5. **MachineSchedule page hierarchy** (F10): demote the legacy add form beneath the board (or replace with the board's quick-create per MACHINE_SCHEDULING_IMPROVEMENT_PLAN §3.3 if that plan's Tier covering it is greenlit — coordinate, don't duplicate).
6. **Density: make `compactMode` real.** The setting exists (`App.tsx:135` toggles a root class) — audit which rules actually respond to `.compact-layout` and wire the spacing tokens to it so compact mode compresses `--space-*` globally instead of a handful of ad-hoc rules.

## 5. Tier 3 — Requires explicit go-ahead (visible redesigns / opinionated)

1. **Dashboard re-layout as an operations cockpit:** exceptions → capacity (with week nav) → allocation → recent, in that order, with the routing map moved to a per-order drill-in (it's diagnostic, not glanceable). This changes what users see first; wants a yes from the actual users.
2. **Global search in the command palette:** index orders/workers/machines so Ctrl+K finds "RN-2026-072" and jumps focused (the `requestFocus` bus already supports targets). Medium effort, high delight, but touches every context provider.
3. **WorkOrderCreator print path convergence** (F12): rebuild the HTML print preview as a vector jsPDF document sharing the letterhead/title-block components from `shiftPdf.ts` (post-refactor into a shared `pdf/` module) — consistent company documents, archivable like shift snapshots. Real effort; only worth it if printed work orders are an official document like the shift schedule. (Any letterhead built here must follow SHIFT_DOCUMENTS_PLAN §2.1: logo only, no company-name text.)
4. **Full mobile pass for ShiftSchedule and Admin** — the two pages with no mobile strategy at all. Shift board on a phone likely wants the Rotation Board (SHIFT_DOCUMENTS_PLAN §3.2) in single-week-column mode. Speculative until the weekly-block redesign lands.
5. **Visual refresh** (if wanted at all): slightly larger radii on cards, tuned dark-theme elevation, Outfit at more weights. Deliberately last — the app's problem is consistency, not taste.

---

## 6. Sequencing & verification

- Tier 1 items are parallel-safe except 1 (the sweep) which should go page-by-page with screenshot parity checks (light/dark × 375/680/1024/1440 via the browser preview tooling).
- Tier 2.1 (CSS split) should land **before** further Tier 1 sweep pages if both run long, so new classes are born in the right files.
- Nothing here touches Supabase; the only behavior changes are Tier 1.6 (routing-map logic) and navigation (Tier 2.2), which need a quick role-matrix re-test (worker vs admin tab visibility) and the admin-route-guard race kept in mind (roleResolving gate in `App.tsx:100` must not be disturbed).
- Coordinate with in-flight branches before touching their files: machine board (`MACHINE_SCHEDULING_IMPROVEMENT_PLAN`), Gantt Phase 4 branch, work-order edit branch. Sessions share one checkout — verify the current branch before staging.
