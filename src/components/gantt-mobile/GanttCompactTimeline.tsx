import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '../../scheduling/SchedulingContext';
import type { JobConflicts } from '../../scheduling/cpm';
import { STATUS_COLORS } from '../../scheduling/boardData';
import {
  formatTimeRange,
  isSpotlightActive,
  matchesSpotlight,
  nearestZoomPreset,
  proposeTimes,
  stepZoom,
  MAX_PX_PER_HOUR,
  MIN_PX_PER_HOUR,
  MOBILE_ZOOM_PX_PER_HOUR,
  type DragMode,
  type MobileJobItem,
  type MobileMachineSection,
  type ProposedTimes,
  type SpotlightFilter,
} from './ganttMobileData';

export interface TimelineCommit {
  jobId: number;
  times: ProposedTimes;
}

interface GanttCompactTimelineProps {
  sections: MobileMachineSection[];
  originMs: number;
  horizonEndMs: number;
  filter: SpotlightFilter;
  lang: string;
  locale: string;
  workdayStart: number;
  workdayEnd: number;
  tier: 'phone' | 'tablet';
  getJobConflicts: (job: Job) => JobConflicts;
  onOpenJob: (jobId: number) => void;
  onCommit: (commit: TimelineCommit) => void;
}

/** Touch-sized geometry (bars ≥ 44px per the plan). */
const BAR_HEIGHT = 44;
const ROW_PITCH = 52;
const LANE_HEADER_HEIGHT = 34;
const LANE_PADDING = 8;
const DAY_STRIP_HEIGHT = 26;

const LONG_PRESS_MS = 350;
const LONG_PRESS_TOLERANCE_PX = 8;
const EDGE_SCROLL_ZONE_PX = 44;
const EDGE_SCROLL_STEP_PX = 14;

const HOUR_MS = 3_600_000;

interface EditingState {
  jobId: number;
  proposed: ProposedTimes;
  dirty: boolean;
}

interface DragGesture {
  jobId: number;
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  lastClientX: number;
  lifted: boolean;
  timer: number | null;
  /** Times the gesture proposes from — the pending proposal if one exists, else the stored job times. */
  baseStart: string;
  baseEnd: string;
}

interface PinchGesture {
  startDistance: number;
  startPxPerHour: number;
  anchorTimeMs: number;
  anchorClientX: number;
}

function conflictSummary(conflicts: JobConflicts, hr: boolean): string[] {
  const overlap = (label: string, other?: { otherOrder: string }) => (other ? `${label} ${other.otherOrder}` : undefined);
  return [
    overlap(hr ? 'Preklapanje:' : 'Overlaps', conflicts.machineOverlap),
    overlap(hr ? 'Operater zauzet:' : 'Operator busy:', conflicts.operatorOverlap),
    conflicts.unqualified?.message,
    conflicts.shiftOutside?.message,
    conflicts.hoursExceeded?.message,
    conflicts.restViolation?.message,
    conflicts.absent?.message,
  ].filter(Boolean) as string[];
}

/**
 * Compact touch timeline: no task table (labels live inside the bars), one shared time scale,
 * a sticky date scrubber, step + pinch zoom, and long-press-to-lift editing with a ✓/✕ confirm
 * pill — nothing writes until ✓.
 */
export function GanttCompactTimeline({
  sections,
  originMs,
  horizonEndMs,
  filter,
  lang,
  locale,
  workdayStart,
  workdayEnd,
  tier,
  getJobConflicts,
  onOpenJob,
  onCommit,
}: GanttCompactTimelineProps) {
  const hr = lang === 'hr';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxPerHour, setPxPerHour] = useState<number>(tier === 'tablet' ? MOBILE_ZOOM_PX_PER_HOUR.shift : MOBILE_ZOOM_PX_PER_HOUR.day);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [liftedPulse, setLiftedPulse] = useState(false);
  const [scrollInfo, setScrollInfo] = useState({ left: 0, clientWidth: 0, scrollWidth: 1 });

  const dragRef = useRef<DragGesture | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<PinchGesture | null>(null);
  const pendingAnchorRef = useRef<{ timeMs: number; clientX: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const editingRef = useRef<EditingState | null>(null);
  editingRef.current = editing;

  const spanHours = (horizonEndMs - originMs) / HOUR_MS;
  const contentWidth = Math.ceil(spanHours * pxPerHour);
  const zoomPreset = nearestZoomPreset(pxPerHour);
  const snapEnabled = zoomPreset !== 'hour';

  const timeToX = useCallback((ms: number) => ((ms - originMs) / HOUR_MS) * pxPerHour, [originMs, pxPerHour]);

  const jobById = useMemo(() => {
    const map = new Map<number, MobileJobItem>();
    sections.forEach((section) => section.items.forEach((item) => map.set(item.job.id, item)));
    return map;
  }, [sections]);

  /* ------------------------------------------------------------ scroll sync --- */

  const readScrollInfo = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollInfo({ left: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: Math.max(1, el.scrollWidth) });
  }, []);

  useEffect(() => {
    readScrollInfo();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(readScrollInfo);
    observer.observe(el);
    return () => observer.disconnect();
  }, [readScrollInfo, contentWidth]);

  // The scrubber label/thumb track scrollLeft via a rAF poll (state changes only when the value
  // moves) — scroll events on the container proved unreliable inside embedded webviews, and a
  // poll also covers momentum scrolling frames between events.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = scrollRef.current;
      if (el) {
        setScrollInfo((current) => {
          if (
            Math.abs(current.left - el.scrollLeft) < 1 &&
            current.clientWidth === el.clientWidth &&
            current.scrollWidth === Math.max(1, el.scrollWidth)
          ) return current;
          return { left: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: Math.max(1, el.scrollWidth) };
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Initial position: today at the left third of the viewport.
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    el.scrollLeft = Math.max(0, timeToX(Date.now()) - el.clientWidth / 3);
    readScrollInfo();
  }, [timeToX, readScrollInfo]);

  // Keep the time under the zoom anchor fixed when pxPerHour changes (pinch or step zoom).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = pendingAnchorRef.current;
    if (!el || !anchor) return;
    pendingAnchorRef.current = null;
    const rect = el.getBoundingClientRect();
    el.scrollLeft = timeToX(anchor.timeMs) - (anchor.clientX - rect.left);
    readScrollInfo();
  }, [pxPerHour, timeToX, readScrollInfo]);

  /* ------------------------------------------------------------- gestures --- */

  const clearLongPressTimer = () => {
    const drag = dragRef.current;
    if (drag?.timer != null) {
      window.clearTimeout(drag.timer);
      drag.timer = null;
    }
  };

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current != null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const updateProposal = useCallback(() => {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !drag.lifted || !el) return;
    const deltaPx = (drag.lastClientX - drag.startClientX) + (el.scrollLeft - drag.startScrollLeft);
    const deltaMs = (deltaPx / pxPerHour) * HOUR_MS;
    const proposed = proposeTimes(
      { start: drag.baseStart, end: drag.baseEnd },
      drag.mode,
      deltaMs,
      { snap: snapEnabled, workdayStart, workdayEnd },
    );
    const item = jobById.get(drag.jobId);
    const dirty = !item || proposed.start !== item.job.start || proposed.end !== item.job.end;
    setEditing({ jobId: drag.jobId, proposed, dirty });
  }, [pxPerHour, snapEnabled, workdayStart, workdayEnd, jobById]);

  const runAutoScroll = useCallback(() => {
    const step = () => {
      const drag = dragRef.current;
      const el = scrollRef.current;
      if (!drag || !drag.lifted || !el) {
        autoScrollFrameRef.current = null;
        return;
      }
      const rect = el.getBoundingClientRect();
      let moved = false;
      if (drag.lastClientX < rect.left + EDGE_SCROLL_ZONE_PX && el.scrollLeft > 0) {
        el.scrollLeft -= EDGE_SCROLL_STEP_PX;
        moved = true;
      } else if (drag.lastClientX > rect.right - EDGE_SCROLL_ZONE_PX && el.scrollLeft < el.scrollWidth - el.clientWidth) {
        el.scrollLeft += EDGE_SCROLL_STEP_PX;
        moved = true;
      }
      if (moved) updateProposal();
      autoScrollFrameRef.current = requestAnimationFrame(step);
    };
    if (autoScrollFrameRef.current == null) autoScrollFrameRef.current = requestAnimationFrame(step);
  }, [updateProposal]);

  const liftBar = useCallback((drag: DragGesture) => {
    drag.lifted = true;
    const item = jobById.get(drag.jobId);
    if (item) {
      const current = editingRef.current;
      const base = current && current.jobId === drag.jobId ? current.proposed : null;
      setEditing({
        jobId: drag.jobId,
        proposed: base ?? {
          start: item.job.start,
          end: item.job.end,
          startMs: new Date(item.job.start).getTime(),
          endMs: new Date(item.job.end).getTime(),
        },
        dirty: current?.jobId === drag.jobId ? current.dirty : false,
      });
    }
    setLiftedPulse(true);
    window.setTimeout(() => setLiftedPulse(false), 450);
    if ('vibrate' in navigator) navigator.vibrate?.(20);
    runAutoScroll();
  }, [jobById, runAutoScroll]);

  const endGesture = useCallback(() => {
    clearLongPressTimer();
    stopAutoScroll();
    dragRef.current = null;
  }, []);

  const beginBarGesture = useCallback((event: React.PointerEvent, item: MobileJobItem, mode: DragMode) => {
    if (pinchRef.current || pointersRef.current.size > 1) return;
    const el = scrollRef.current;
    if (!el) return;
    const isEditingThis = editingRef.current?.jobId === item.job.id;
    const base = isEditingThis ? editingRef.current!.proposed : null;
    const drag: DragGesture = {
      jobId: item.job.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: el.scrollLeft,
      lastClientX: event.clientX,
      lifted: false,
      timer: null,
      baseStart: base?.start ?? item.job.start,
      baseEnd: base?.end ?? item.job.end,
    };
    dragRef.current = drag;
    if (isEditingThis || mode !== 'move') {
      // Already in edit mode (or grabbing a resize handle): drag engages immediately.
      liftBar(drag);
    } else {
      drag.timer = window.setTimeout(() => {
        drag.timer = null;
        liftBar(drag);
      }, LONG_PRESS_MS);
    }
  }, [liftBar]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.lastClientX = event.clientX;
      if (!drag.lifted) {
        const distance = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
        // Movement before the long press fires means the user is scrolling — hand the
        // gesture back to native panning.
        if (distance > LONG_PRESS_TOLERANCE_PX && drag.timer != null) endGesture();
        return;
      }
      updateProposal();
    };
    const onPointerEnd = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      // Proposal (if any) stays pending in the confirm pill; only the gesture ends.
      endGesture();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [endGesture, updateProposal]);

  // While a bar is lifted (or a pinch is active) the browser must not pan the chart —
  // touch-action can't change mid-gesture, so block it with a non-passive listener.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchMove = (event: TouchEvent) => {
      if (dragRef.current?.lifted || pinchRef.current) event.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  useEffect(() => () => {
    stopAutoScroll();
    clearLongPressTimer();
  }, []);

  /* ---------------------------------------------------------------- pinch --- */

  const handleContainerPointerDown = (event: React.PointerEvent) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      // A second finger means pinch: any long-press / bar drag in progress yields.
      endGesture();
      const [a, b] = [...pointersRef.current.values()];
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const midX = (a.x + b.x) / 2;
      pinchRef.current = {
        startDistance: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)),
        startPxPerHour: pxPerHour,
        anchorTimeMs: originMs + ((el.scrollLeft + (midX - rect.left)) / pxPerHour) * HOUR_MS,
        anchorClientX: midX,
      };
    }
  };

  const handleContainerPointerMove = (event: React.PointerEvent) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (!pinch || pointersRef.current.size < 2) return;
    const [a, b] = [...pointersRef.current.values()];
    const distance = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
    const next = Math.min(MAX_PX_PER_HOUR, Math.max(MIN_PX_PER_HOUR, pinch.startPxPerHour * (distance / pinch.startDistance)));
    pendingAnchorRef.current = { timeMs: pinch.anchorTimeMs, clientX: pinch.anchorClientX };
    setPxPerHour(next);
  };

  const handleContainerPointerEnd = (event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };

  const applyStepZoom = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      pendingAnchorRef.current = {
        timeMs: originMs + ((el.scrollLeft + el.clientWidth / 2) / pxPerHour) * HOUR_MS,
        clientX: rect.left + el.clientWidth / 2,
      };
    }
    setPxPerHour((current) => stepZoom(current, direction));
  };

  /* ------------------------------------------------------------- scrubber --- */

  const centerTimeMs = originMs + ((scrollInfo.left + scrollInfo.clientWidth / 2) / pxPerHour) * HOUR_MS;
  const scrubberLabel = new Date(centerTimeMs).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const thumbLeftPct = (scrollInfo.left / scrollInfo.scrollWidth) * 100;
  const thumbWidthPct = Math.max(6, (scrollInfo.clientWidth / scrollInfo.scrollWidth) * 100);
  const scrubberTrackRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  const scrubTo = (clientX: number) => {
    const el = scrollRef.current;
    const track = scrubberTrackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.scrollLeft = fraction * el.scrollWidth - el.clientWidth / 2;
  };

  /* ------------------------------------------------------------- day strip --- */

  const days = useMemo(() => {
    const list: { ms: number; weekend: boolean }[] = [];
    const cursor = new Date(originMs);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < horizonEndMs) {
      const day = cursor.getDay();
      list.push({ ms: cursor.getTime(), weekend: day === 0 || day === 6 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return list;
  }, [originMs, horizonEndMs]);
  const dayWidth = 24 * pxPerHour;
  const labelEveryDay = dayWidth >= 46;

  /* ---------------------------------------------------------------- render --- */

  const spotlightOn = isSpotlightActive(filter);
  const nowMs = Date.now();
  const nowVisible = nowMs >= originMs && nowMs <= horizonEndMs;

  const editingItem = editing ? jobById.get(editing.jobId) : null;
  const editingConflicts = editing && editingItem
    ? getJobConflicts({ ...editingItem.job, start: editing.proposed.start, end: editing.proposed.end })
    : null;
  const editingConflictMessages = editingConflicts ? conflictSummary(editingConflicts, hr) : [];

  const cancelEditing = () => setEditing(null);
  const confirmEditing = () => {
    if (!editing) return;
    if (editing.dirty) onCommit({ jobId: editing.jobId, times: editing.proposed });
    setEditing(null);
  };

  let laneTop = DAY_STRIP_HEIGHT;
  const lanes = sections.map((section) => {
    const top = laneTop;
    const height = LANE_HEADER_HEIGHT + LANE_PADDING * 2 + section.rowCount * ROW_PITCH;
    laneTop += height;
    return { section, top, height };
  });
  const totalHeight = laneTop + 4;

  return (
    <div className="gmb-timeline">
      <div className="gmb-scrubber">
        <button type="button" className="gmb-zoom-btn" onClick={() => applyStepZoom(1)} aria-label={hr ? 'Umanji' : 'Zoom out'}>−</button>
        <div className="gmb-scrubber-center">
          <span className="gmb-scrubber-date">{scrubberLabel}</span>
          <div
            className="gmb-scrubber-track"
            ref={scrubberTrackRef}
            onPointerDown={(event) => {
              scrubbingRef.current = true;
              scrubTo(event.clientX);
              try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
            }}
            onPointerMove={(event) => { if (scrubbingRef.current) scrubTo(event.clientX); }}
            onPointerUp={() => { scrubbingRef.current = false; }}
            onPointerCancel={() => { scrubbingRef.current = false; }}
          >
            <div className="gmb-scrubber-thumb" style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }} />
          </div>
          <span className="gmb-zoom-label">{{ hour: hr ? 'Sat' : 'Hour', shift: hr ? 'Smjena' : 'Shift', day: hr ? 'Dan' : 'Day', week: hr ? 'Tjedan' : 'Week', month: hr ? 'Mjesec' : 'Month' }[zoomPreset]}</span>
        </div>
        <button type="button" className="gmb-zoom-btn" onClick={() => applyStepZoom(-1)} aria-label={hr ? 'Uvećaj' : 'Zoom in'}>+</button>
      </div>

      <div
        className="gmb-scroll"
        ref={scrollRef}
        onScroll={readScrollInfo}
        onPointerDown={handleContainerPointerDown}
        onPointerMove={handleContainerPointerMove}
        onPointerUp={handleContainerPointerEnd}
        onPointerCancel={handleContainerPointerEnd}
      >
        <div className="gmb-canvas" style={{ width: contentWidth, height: totalHeight }}>
          {days.map((day) => (
            <div
              key={day.ms}
              className={`gmb-day${day.weekend ? ' gmb-day-weekend' : ''}`}
              style={{ left: timeToX(day.ms), width: dayWidth }}
            >
              {(labelEveryDay || new Date(day.ms).getDay() === 1) && (
                <span className="gmb-day-label">
                  {new Date(day.ms).toLocaleDateString(locale, dayWidth >= 110 ? { weekday: 'short', day: 'numeric', month: 'numeric' } : { day: 'numeric', month: 'numeric' })}
                </span>
              )}
            </div>
          ))}

          {nowVisible && <div className="gmb-now-line" style={{ left: timeToX(nowMs) }} />}

          {lanes.map(({ section, top, height }) => (
            <div key={section.machine} className="gmb-lane" style={{ top, height }}>
              <div className="gmb-lane-header">
                <strong>{section.machine}</strong>
                <span>{section.items.length} · {section.loadPercent}%</span>
              </div>
              {section.items.map((item) => {
                const isEditingThis = editing?.jobId === item.job.id;
                // Routed orders write job.start (the whole route shifts) — display this
                // machine's operation window shifted by the same delta.
                const routedShiftMs = isEditingThis && item.routed
                  ? editing.proposed.startMs - new Date(item.job.start).getTime()
                  : 0;
                const startMs = isEditingThis
                  ? (item.routed ? item.effectiveStart + routedShiftMs : editing.proposed.startMs)
                  : item.effectiveStart;
                const endMs = isEditingThis
                  ? (item.routed ? item.effectiveEnd + routedShiftMs : editing.proposed.endMs)
                  : item.effectiveEnd;
                const left = timeToX(startMs);
                const width = Math.max(10, timeToX(endMs) - left);
                const dimmed = spotlightOn && !matchesSpotlight(item, filter);
                const barTop = LANE_HEADER_HEIGHT + LANE_PADDING + item.row * ROW_PITCH;
                const hasConflictNow = isEditingThis && (editingConflicts?.machineOverlap || editingConflicts?.operatorOverlap);
                return (
                  <div key={item.job.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {isEditingThis && editing.dirty && (
                      <div
                        className="gmb-bar-ghost"
                        style={{
                          left: timeToX(item.effectiveStart),
                          width: Math.max(10, timeToX(item.effectiveEnd) - timeToX(item.effectiveStart)),
                          top: barTop,
                          height: BAR_HEIGHT,
                        }}
                      />
                    )}
                    <div
                      className={[
                        'gmb-bar',
                        item.critical ? 'gmb-bar-critical' : '',
                        dimmed ? 'gmb-dimmed' : '',
                        isEditingThis ? 'gmb-bar-editing' : '',
                        isEditingThis && liftedPulse ? 'gmb-bar-pulse' : '',
                        hasConflictNow ? 'gmb-bar-conflict' : '',
                      ].filter(Boolean).join(' ')}
                      style={{
                        left,
                        width,
                        top: barTop,
                        height: BAR_HEIGHT,
                        background: STATUS_COLORS[item.job.status],
                        touchAction: isEditingThis ? 'none' : undefined,
                      }}
                      onPointerDown={(event) => beginBarGesture(event, item, 'move')}
                      onClick={() => {
                        // A tap (no lift, no pending edit on this bar) opens details.
                        if (!editingRef.current || editingRef.current.jobId !== item.job.id) onOpenJob(item.job.id);
                      }}
                    >
                      <span className="gmb-bar-progress" style={{ width: `${item.job.progress}%` }} />
                      <span className="gmb-bar-label">
                        {item.critical ? '⚡ ' : ''}{item.job.order || item.job.machine}
                        {width > 150 && <small>{formatTimeRange(startMs, endMs, locale)}</small>}
                      </span>
                      {isEditingThis && !item.routed && (
                        <>
                          <span
                            className="gmb-handle gmb-handle-start"
                            onPointerDown={(event) => { event.stopPropagation(); beginBarGesture(event, item, 'resize-start'); }}
                          />
                          <span
                            className="gmb-handle gmb-handle-end"
                            onPointerDown={(event) => { event.stopPropagation(); beginBarGesture(event, item, 'resize-end'); }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {section.items.length === 0 && <div className="gmb-lane-empty">{hr ? 'Nema naloga' : 'No orders'}</div>}
            </div>
          ))}
        </div>
      </div>

      {!editing && (
        <p className="gmb-hint">{hr ? 'Dugi pritisak na traku za uređivanje · uštipni za zoom' : 'Long-press a bar to edit · pinch to zoom'}</p>
      )}

      {editing && editingItem && (
        <div className={`gmb-confirm-pill${editingConflictMessages.length > 0 ? ' gmb-confirm-conflict' : ''}`} role="dialog" aria-live="polite">
          <div className="gmb-confirm-text">
            <strong>{editingItem.job.order || editingItem.job.machine}</strong>
            <span>
              {editingItem.routed
                ? `${hr ? 'Početak rute' : 'Route start'}: ${new Date(editing.proposed.startMs).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                : formatTimeRange(editing.proposed.startMs, editing.proposed.endMs, locale)}
            </span>
            {editingConflictMessages.length > 0 && <em>{editingConflictMessages.join(' · ')}</em>}
            {!editing.dirty && <em className="gmb-confirm-idle">{hr ? 'Povuci traku ili ručke' : 'Drag the bar or handles'}</em>}
          </div>
          <button type="button" className="gmb-confirm-btn gmb-confirm-no" onClick={cancelEditing} aria-label={hr ? 'Odbaci' : 'Cancel'}>✕</button>
          <button type="button" className="gmb-confirm-btn gmb-confirm-yes" onClick={confirmEditing} disabled={!editing.dirty} aria-label={hr ? 'Potvrdi' : 'Confirm'}>✓</button>
        </div>
      )}
    </div>
  );
}
