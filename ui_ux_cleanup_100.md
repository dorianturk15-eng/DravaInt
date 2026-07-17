# DravaInt — UI/UX Cleanup: 100-Point Plan

Audit date: 2026-07-14. Baseline: `src/App.css` (1587 lines) had 25 `linear-gradient`s, 15
`backdrop-filter`s, 67 `box-shadow`s, 14 `animation`s, 7 `@keyframes`, 5 `drop-shadow`s, 10
`!important`s, and an unsystematic z-index range from `0` to `20000`. Goal: a clean, flat,
consistent theme with the same information density, minus the "premium SaaS demo" noise.

## Phase 1 — Design token foundation (1–10)

- [x] 1. Add a `--z-*` scale (base, sticky, dropdown, overlay, modal, toast) to `index.css` and stop hand-picking numbers.
- [x] 2. Add `--radius-pill` alongside existing `--radius-card`/`--radius-inner` so pill shapes stop hardcoding `999px`/`50%` ad hoc.
- [x] 3. Add `--shadow-flat` (a single subtle 1px border-toned shadow) to replace most of the 67 bespoke `box-shadow`s.
- [x] 4. Add `--transition-fast`/`--transition-base` tokens and stop hand-writing `cubic-bezier(0.4,0,0.2,1)` per rule.
- [x] 5. Audit every hardcoded hex color in `App.css` and replace with the matching `--*-color`/`--*-light` token.
- [x] 6. Ensure `--danger-color` is used consistently (some rules hardcode `#dc2626`, others `#ef4444`/`#f43f5e`).
- [x] 7. Consolidate the two near-duplicate "info" blues (`#2563eb` primary vs `#60a5fa`/`#38bdf8` accents) to one accent role.
- [x] 8. Document the token set at the top of `index.css` with a one-line comment per token (no prose blocks).
- [x] 9. Remove the unused/duplicate `--input-bg`/`--input-text` tokens if `select`/`input` already inherit `--bg-card`/`--text-primary` correctly, or wire them in consistently if not.
- [x] 10. Verify every token has a correct dark-mode override (diff `:root` vs `:root[data-theme='dark']` key sets).

## Phase 2 — Flatten gradients (11–20)

- [x] 11. Replace `.top-nav` background gradient with a flat `--bg-card`/near-black solid.
- [x] 12. Replace `.top-nav .brand` gradient-clipped text with a solid `--text-heading` color.
- [x] 13. Replace `.btn-blue`/`.btn-green`/`.btn-red` gradient fills with flat `--primary-color`/`--success-color`/`--danger-color`.
- [x] 14. Remove the `translateY(-1px)` + shadow-bloom hover on buttons; keep a simple background-darken hover.
- [x] 15. Replace `.step-number` gradient/shadow badge with a flat filled circle.
- [x] 16. Replace `.data-table th` dark gradient header with a flat `--bg-step`/solid dark row.
- [x] 17. Replace any remaining `linear-gradient` in status pills/badges with flat `--*-light` backgrounds + `--*-color` text.
- [x] 18. Replace `.efficiency-meter`/load-bar gradients with a flat single-color fill (color communicates state via hue, not gradient).
- [x] 19. Grep-confirm zero remaining `linear-gradient` declarations outside intentional data-viz (none needed).
- [x] 20. Re-check `.gantt-command-deck`/toolbar surfaces for leftover gradient backgrounds.

## Phase 3 — Remove glass/blur overuse (21–30)

- [x] 21. Remove `backdrop-filter: blur(...)` from `.top-nav` (opaque bar reads cleaner and is cheaper to render).
- [x] 22. Remove blur from `.gantt-status-legend` sticky bar; use a flat background with a bottom border instead.
- [x] 23. Remove blur from `.gantt-premium-tooltip`; use a solid dark tooltip background.
- [x] 24. Remove blur from `.alert-settings-preview`/notification surfaces.
- [x] 25. Keep blur ONLY for genuinely transient overlays (command palette backdrop, modal scrim) — audit and prune the rest.
- [x] 26. Replace `.board-ruler`'s blur with a flat sticky background (perf: blur recomputes on every scroll frame).
- [x] 27. Confirm `.glass-panel` is only used where it was originally intended (floating chrome), not creeping into content cards.
- [x] 28. Remove `saturate(1.2)` filter stacking (adds visual noise without clarity).
- [x] 29. Re-test all previously-blurred surfaces in both themes for legibility after flattening.
- [x] 30. Verify no layout shift/perf regression from removing blur (should only improve scroll perf).

## Phase 4 — Remove glow/shimmer/pulse animation noise (31–40)

- [x] 31. Remove `@keyframes gantt-texture-pulse` and the `.gantt-status-texture` opacity pulse.
- [x] 32. Remove `@keyframes gantt-stripes` animated diagonal stripes on in-progress bars; use a static texture or solid fill.
- [x] 33. Remove `drop-shadow` glow on `.gantt-custom-connector.is-related`/`.board-connector.is-selected`; use a plain color + width change.
- [x] 34. Remove `drop-shadow` on `.gantt-warning-badge`; flat icon is enough.
- [x] 35. Remove hover `transform: translateY(-1px)` micro-lift from theme-toggle/nav-icon buttons; keep a simple color change.
- [x] 36. Remove `@keyframes skeleton-slide` shimmer loader in favor of a static pulse-free placeholder, or a simple opacity fade if a loading cue is still needed.
- [x] 37. Audit `transition` declarations for anything animating more than 2 properties at once; trim to what's actually noticeable.
- [x] 38. Cap all remaining transitions to ≤160ms (snappy, not floaty).
- [x] 39. Add `prefers-reduced-motion` handling to disable non-essential animations/transitions.
- [x] 40. Grep-confirm `@keyframes` count dropped from 7 to ≤2 (only genuinely functional ones, e.g. skeleton loading).

## Phase 5 — Fix the z-index/layering chaos (41–50)

- [x] 41. Inventory every `z-index` declaration and its purpose (nav, dropdown, sticky header, modal, toast, drag overlay).
- [x] 42. Replace every literal z-index number with a `var(--z-*)` token from Phase 1.
- [x] 43. Fix the Gantt sticky calendar header (`z-index: 8`) vs status legend (`z-index: 12`) vs top-nav (`z-index: 100`) so the stacking order is documented, not coincidental.
- [x] 44. Fix the machine board's ruler/lane/connector/card z-order (currently 3/4/5/6/7/20/30 hand-picked) against the shared scale.
- [x] 45. Confirm the command palette, settings modal, and lock screen all sit above every page-level sticky element with no literal `9999`/`10000`/`20000` escape hatches.
- [x] 46. Confirm toasts (board toast, sync warnings) render above modals only when that's actually intended, not by accident of a bigger number.
- [x] 47. Remove any `z-index` on elements that don't need stacking context at all (dead declarations).
- [x] 48. Test dropdown/select menus, tooltips, and popovers for correct layering over the new flat surfaces.
- [x] 49. Test the settings modal + lock screen + command palette combination for correct layering if somehow triggered together.
- [x] 50. Document the final z-index scale in a one-line comment block in `index.css`.

## Phase 6 — Buttons & interactive elements (51–60)

- [x] 51. Standardize button padding/height across `.btn`, `.board-toolbar-btn`, `.gantt-command-actions .btn`, `.queue-toolbar .btn` (currently 4+ ad hoc sizes).
- [x] 52. Standardize icon-button size (`.nav-icon-button`, `.theme-toggle-btn`, `.nav-lock-status`) to one consistent square size.
- [x] 53. Standardize focus-visible ring styling across all buttons (some rely on default outline, some override it inconsistently).
- [x] 54. Fix `.btn-ghost` contrast in dark mode (verify it's legible, not just "transparent + hope").
- [x] 55. Remove redundant inline `style={{width:'auto', padding:...}}` scattered across pages in favor of a `.btn-sm` utility class.
- [x] 56. Ensure disabled button states have one consistent visual treatment (opacity + cursor), not per-component variations.
- [x] 57. Fix touch target sizing on compact/mobile — audit any button under 40px hit area.
- [x] 58. Standardize the danger-action button treatment (delete/remove) so it's visually consistent everywhere (Admin, MachineSchedule, GanttChart, ProgressMonitoring).
- [x] 59. Fix double-bordered look where a button sits inside an already-bordered toolbar group (`.board-toolbar-group` + `.board-toolbar-btn` both drawing borders).
- [ ] 60. Verify keyboard Tab order through toolbars is left-to-right, logical, with no skipped/duplicated stops.

## Phase 7 — Cards, tables, badges (61–70)

- [x] 61. Standardize card corner radius: `.wizard-container` uses `--radius-card`, some ad hoc cards use raw `8px`/`10px`/`12px`/`9px` — unify.
- [x] 62. Standardize card border treatment (some cards are border-only, some are shadow-only, some are both) to one rule.
- [x] 63. Fix `.data-table` header contrast now that the gradient is flattened — verify text remains readable.
- [ ] 64. Standardize status-pill sizing/padding across pages (Dashboard, ProgressMonitoring, MachineSchedule board all render status slightly differently).
- [x] 65. Fix inconsistent row-hover background across `.data-table tr:hover` vs `.board-task-card:hover` vs `.queue-list article:hover`.
- [ ] 66. Standardize empty-state styling (dashed border + centered text) across all "no data yet" messages instead of one-off implementations.
- [ ] 67. Standardize conflict/warning badge visual language (the board's `⚠` badges vs Gantt's warning badges vs table inline warnings currently look different).
- [x] 68. Fix `.role-chip` vs `.dependency-chip` vs `.queue-operation` chip styles to share one base chip class with color variants.
- [ ] 69. Verify table text truncation (`text-overflow: ellipsis`) is applied consistently to every long-content column, not just some.
- [x] 70. Audit card padding scale — currently 20/24/25/32px mixed — collapse to 2–3 consistent steps.

## Phase 8 — Typography & spacing discipline (71–80)

- [x] 71. Audit every one-off `font-size` value in `App.css` (dozens of 7–13px micro-variants) and collapse to a type scale (e.g. 11/12/13/14/16/20/24).
- [x] 72. Remove `text-transform: uppercase` + heavy `letter-spacing` from places it doesn't earn its keep (keep only for true section labels, not every small label).
- [x] 73. Standardize heading font-weight usage (700 vs 750 vs 800 vs 900 — pick two: one for headings, one for emphasis).
- [ ] 74. Fix inconsistent `line-height` on dense table/list rows (some 18px, some 22px, some unset).
- [ ] 75. Standardize the vertical rhythm between stacked `step-box`es (currently mixes 15/20px margins).
- [x] 76. Standardize gap values in flex/grid layouts (currently mixes 4/5/6/7/8/9/10/12/13/14/15/18/20px) to a spacing scale of 4/8/12/16/24.
- [x] 77. Fix subtitle/secondary text color/opacity so it's consistent between `.subtitle-text` and inline `color: var(--text-secondary)` usages.
- [x] 78. Verify `--font-title` (Outfit) vs `--font-body` (Inter) usage is intentional and not accidentally applied to body copy.
- [ ] 79. Remove remaining inline `style={{fontSize: ..., color: ...}}` scattered through page components in favor of the shared classes above.
- [x] 80. Spot-check long Croatian labels for wrapping/overflow now that spacing has tightened.

## Phase 9 — Dark mode consistency (81–90)

- [x] 81. Fix every hardcoded light-only hex found in Phase 1's audit that doesn't have a dark-mode counterpart (status legend, connector colors, print-oriented shift-schedule colors).
- [x] 82. Verify the machine board's status colors (`STATUS_COLORS` in `boardData.ts`) remain legible against `--bg-card` in dark mode.
- [x] 83. Verify conflict/warning colors (red/amber) meet contrast in dark mode, not just light.
- [x] 84. Fix the printable A4 templates (shift schedule, work order) to intentionally stay light-themed for print regardless of app theme (print should never render dark-mode colors).
- [x] 85. Verify scrollbar theming looks correct in dark mode (currently uses `--border-color` which should adapt, confirm visually).
- [x] 86. Verify focus-visible ring contrast in dark mode.
- [x] 87. Verify the lock screen and login screen fully respect the active theme rather than being independently styled.
- [x] 88. Verify chart/gauge fill colors (capacity bars, efficiency meters) adapt correctly in dark mode.
- [x] 89. Verify toast/notification colors have sufficient contrast against dark surfaces.
- [x] 90. Do a full page-by-page dark-mode pass after all flattening changes land (regressions are likely after Phase 2–7 edits).

## Phase 10 — Motion, accessibility, final quirks (91–100)

- [x] 91. Add `outline`/`aria-*` audit pass for the new machine board's interactive elements (cards, handles) — confirm no regressions from the CSS simplification.
- [x] 92. Fix the connect-handle hit target so it doesn't visually overlap the resize handle at each card edge (currently both anchor at the same edge).
- [x] 93. Fix conflict popover z-index/positioning so it never renders off the right edge of the viewport for cards near the screen edge.
- [x] 94. Fix the board toast's fixed bottom-right position so it doesn't overlap the connection-editor popover when both are visible.
- [x] 95. Verify the settings modal search field, tabs, and save banner still read cleanly after the blur/gradient removal.
- [x] 96. Verify the command palette's result list still has clear keyboard-selected-row styling without relying on the old glow treatment.
- [x] 97. Fix any remaining `!important` usage by resolving the underlying specificity conflict instead of overriding it.
- [x] 98. Run the app at 1280×720, 1024×768, and mobile width and screenshot-diff each page against the pre-cleanup version for regressions.
- [x] 99. Update `README.md`'s "glass surfaces" / "premium" language to describe the new flat, clean theme accurately.
- [x] 100. Record before/after screenshots and a short changelog entry documenting the theme simplification.
