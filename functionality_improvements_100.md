# DravaInt — Functionality Improvement: 100-Point Plan

Builds on `additional_improvements_2026-07-13.md` (points 151–190; 167–180, 184–188 and 190 were
still open) and the new drag-and-drop Machine Scheduling board. Old point numbers are noted in
parentheses where this plan continues that backlog instead of duplicating it.

## Phase 1 — Daily operations (1–10) — continues old 171–180

- [ ] 1. Shift handover log with unresolved items and owner assignment. (old 171)
- [ ] 2. Downtime reason tracking with MTTR/MTBF summaries. (old 172)
- [ ] 3. Material shortage board linked to affected work orders. (old 173)
- [ ] 4. Quality holds and non-conformance records. (old 174)
- [ ] 5. Maintenance checklists with machine-specific templates. (old 175)
- [ ] 6. Operator kiosk mode with oversized touch targets. (old 176)
- [ ] 7. Barcode/QR work-order lookup. (old 177)
- [ ] 8. Live "next operation" queue per machine. (old 178)
- [ ] 9. Production target vs. actual by shift. (old 179)
- [ ] 10. End-of-shift digest export. (old 180)

## Phase 2 — Reliability & intelligence (11–20) — continues old 184–190

- [ ] 11. Audit history for critical schedule and role changes. (old 184)
- [ ] 12. Automated backup rotation with labeled restore points. (old 185)
- [ ] 13. Demand-based capacity forecasting. (old 186)
- [ ] 14. Schedule-risk scoring from dependencies, materials, and staffing. (old 187)
- [ ] 15. Suggested operator substitutions based on qualifications. (old 188)
- [ ] 16. Optional morning briefing view for supervisors. (old 190)
- [ ] 17. Per-workstation "what changed since I last looked" summary on login.
- [ ] 18. Exportable weekly operations report (PDF) combining capacity, delays, and exceptions.
- [ ] 19. Configurable data-retention policy for audit logs and offline queue history.
- [ ] 20. Health-check panel showing Supabase latency and realtime channel status, not just connected/offline.

## Phase 3 — Gantt planning workbench (21–30) — continues old 167–170

- [ ] 21. Compare-scenarios mode for alternate machine allocations. (old 167)
- [ ] 22. Approval gate before publishing a materially changed baseline. (old 168)
- [ ] 23. Minimap for very long multi-machine Gantt timelines. (old 169)
- [ ] 24. Shift-to-Gantt capacity overlays. (old 170)
- [ ] 25. "Jump to conflict" navigation cycling through all flagged jobs in order.
- [ ] 26. Bulk dependency creation (select N jobs, chain them FS in sequence in one action).
- [ ] 27. What-if duration slider that previews a cascade before committing it.
- [ ] 28. Per-operator saved column-width/zoom preference, not just per-view presets.
- [ ] 29. Gantt row grouping by product family, not just by machine.
- [ ] 30. Keyboard-only dependency creation (select two tasks, press a shortcut to link) as an alternative to the dropdown form.

## Phase 4 — Machine Scheduling board enhancements (31–40)

- [ ] 31. Saved board views (zoom + sort + filter) per operator, mirroring the Gantt page's saved presets.
- [ ] 32. PNG/print export of the board for shift handover printouts.
- [x] 33. Keyboard nudge (arrow keys move the selected card by one snap increment) as an alternative to pointer drag.
- [x] 34. Status/operator filter chips in the toolbar so a busy board can be narrowed at a glance.
- [x] 35. "Auto-schedule" button on the board (reuse the Gantt page's auto-scheduler) for quick fill of unassigned jobs.
- [ ] 36. Machine downtime blocks rendered as non-bookable lane regions (ties into Phase 1's maintenance/downtime tracking).
- [x] 37. Double-click empty lane space to quick-create a job pre-filled with that machine and time.
- [x] 38. Board-level undo/redo history indicator (show how many steps are available, not just enabled/disabled arrows).
- [ ] 39. Virtualize card rendering for machines with very high job counts (perf safeguard as adoption grows).
- [ ] 40. Cross-link from a Gantt task's context menu to "show on Machine Scheduling board."

## Phase 5 — Shift scheduling (41–50)

- [ ] 41. Drag-and-drop swap requests between two workers with supervisor approval step.
- [ ] 42. Multi-week rotation template editor (beyond the current hardcoded 2-week G1/G2 pattern).
- [ ] 43. Automatic rest-period and max-hours validation surfaced inline while building the roster, not just after publish.
- [ ] 44. Absence request submission by workers, routed to a supervisor approval queue.
- [ ] 45. Shift roster comparison view (this week vs. last week) to catch accidental duplicate assignments.
- [ ] 46. CSV import for bulk worker roster upload.
- [ ] 47. Per-shift headcount target with a live "understaffed/overstaffed" indicator.
- [ ] 48. Public holiday calendar integration so shift generation automatically skips them.
- [ ] 49. Shift-schedule change notifications to affected workers (in-app, tied to the existing alert center).
- [ ] 50. Printable per-worker personal schedule (vs. only the whole-team A4 sheet).

## Phase 6 — Work orders & travelers (51–60)

- [ ] 51. Work order templates for recurring product routes (save an operations sequence, reuse it).
- [ ] 52. Revision history on a work order (who changed what operation/date, with diff view).
- [ ] 53. Attach multiple files per operation step (not just one CAD upload per job).
- [ ] 54. Digital sign-off per operation step (operator marks a step complete with a timestamp/initials).
- [ ] 55. Cost roll-up per work order (material + labor-hours estimate) surfaced on the printable traveler.
- [ ] 56. Duplicate-work-order action that copies an existing order's route as a starting point.
- [ ] 57. Work order search/filter by product, customer, or date range (currently only browsable via the tree).
- [ ] 58. Configurable traveler print template (choose which fields print) instead of one fixed layout.
- [ ] 59. Linking a work order to a customer/sales-order reference field.
- [ ] 60. Batch status update (mark N selected work orders as done/delayed at once).

## Phase 7 — Admin & roles (61–70)

- [ ] 61. Bulk worker import/export (CSV) alongside the existing individual worker CRUD.
- [ ] 62. Per-role default landing page (not just one global default view).
- [ ] 63. Machine maintenance schedule management (ties into Phase 1 item 5).
- [ ] 64. Configurable qualification catalog (currently qualifications are free-text strings matched to machine names).
- [ ] 65. Admin-visible login history / last-active timestamp per account.
- [ ] 66. Role permission matrix view (a single screen showing what each role can/can't do, for onboarding new admins).
- [ ] 67. Company holiday calendar management UI (feeds Phase 5 item 48 and Gantt's holiday-aware CPM).
- [x] 68. Configurable weekly-capacity-hours value in Settings instead of the hardcoded 40h constant.
- [ ] 69. Machine retirement/archival flow (soft-delete a machine without breaking historical job references).
- [ ] 70. Admin action log filter/search (once Phase 2 item 11's audit history exists).

## Phase 8 — Reporting & analytics (71–80)

- [ ] 71. On-time delivery rate trend chart (rolling weeks).
- [ ] 72. Operator utilization report (scheduled vs. idle hours per week).
- [ ] 73. Machine utilization report separate from the live capacity heatmap (historical, not just current-week).
- [ ] 74. Delay root-cause breakdown (material, staffing, machine, other) once Phase 1's downtime/material tracking exists.
- [x] 75. Exportable CSV of any table view (jobs, workers, machines) for external analysis.
- [ ] 76. Configurable dashboard widget order/visibility per user.
- [ ] 77. Weekly email-style digest (rendered in-app, downloadable) summarizing exceptions and completions.
- [ ] 78. Product-family throughput report (which products consume the most machine hours).
- [ ] 79. Critical-path frequency report (which jobs/machines show up on the critical path most often, a bottleneck signal).
- [ ] 80. Simple year-over-week capacity trend sparkline on the dashboard.

## Phase 9 — Notifications & alerts (81–90)

- [ ] 81. Per-alert-type mute/snooze instead of only a global enable/disable toggle.
- [ ] 82. Notification history log (currently only shows live/current alerts, not what fired earlier today).
- [ ] 83. Desktop push notifications (via the PWA's service worker) for critical alerts when the tab isn't focused.
- [ ] 84. Configurable alert severity thresholds per alert type (not just the existing capacity/delay ones).
- [ ] 85. "Assign to me" action directly from an alert (e.g. claim a material-shortage exception).
- [ ] 86. Sound toggle for the pre-lock chime and any new alert sounds, independent of each other.
- [ ] 87. Digest mode: batch low-priority alerts into a periodic summary instead of individual toasts.
- [ ] 88. Alert center filter by module (shifts/machines/work orders) for busy days.
- [ ] 89. Read/unread state per individual alert, not just a global "seen" flag.
- [ ] 90. Escalation rule: an unacknowledged critical alert after N minutes re-surfaces more prominently.

## Phase 10 — Data integrity, performance, offline/PWA (91–100)

- [x] 91. Soft-delete (`deleted_at`) wiring for jobs, enabling true undo-of-delete (flagged as deferred in the Machine Scheduling board work).
- [x] 92. Background periodic reconciliation pass comparing local cache to server state to catch silent drift.
- [x] 93. Configurable offline-queue retry backoff instead of only retrying on `online` event.
- [ ] 94. Service-worker cache versioning UI so a stale PWA install can self-heal without the user clearing site data manually.
- [ ] 95. Batch/debounce rapid successive `updateJob` calls (e.g. multi-select drag) into fewer network round-trips.
- [ ] 96. Add database indexes/queries review pass now that `jobs`/`workers`/`shift_assignments` have grown in shape.
- [ ] 97. End-to-end smoke test script covering login → create work order → schedule → drag → connect → publish shift, runnable in CI.
- [x] 98. Expand Vitest coverage to the machine board's conflict/cycle classification logic (currently covered by geometry/CPM units only).
- [x] 99. Add a `CHANGELOG.md` so future feature batches are documented in one place instead of scattered plan files.
- [ ] 100. Performance pass: profile the machine board and Gantt page with 500+ synthetic jobs to catch any render bottlenecks before real adoption hits that scale.
