import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DravaGantt } from './DravaGantt';
import type { GanttLane, GanttTask } from './types';
import { COLUMN_WIDTHS, getGanttDateRange, seedDates, xForDate } from './timescale';

const NAME_COL_WIDTH = 210;

function task(id: string, start: string, end: string, overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id,
    type: 'task',
    name: id,
    start: new Date(start),
    end: new Date(end),
    progress: 40,
    styles: { backgroundColor: '#2563eb', backgroundSelectedColor: '#2563eb' },
    ...overrides,
  };
}

function renderGantt(lanes: GanttLane[], props: Partial<Parameters<typeof DravaGantt>[0]> = {}) {
  return render(
    <DravaGantt
      lanes={lanes}
      viewMode="day"
      locale="en-US"
      rowHeight={50}
      barFillPercent={70}
      emptyLaneLabel="No assigned work orders"
      taskCountLabel={(count) => `${count} tasks`}
      {...props}
    />,
  );
}

/** Expected pixel x for a date, computed the same way the component does. */
function expectedX(lanes: GanttLane[], date: Date): number {
  const allTasks = lanes.flatMap((lane) => lane.tasks);
  const [start, end] = getGanttDateRange(allTasks, 'day');
  const dates = seedDates(start, end, 'day');
  return xForDate(date, dates, COLUMN_WIDTHS.day);
}

const barFor = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-task-bar="${id}"]`) as HTMLElement;

describe('DravaGantt rendering', () => {
  it('renders lane headers with task counts and efficiency, and an empty-lane message', () => {
    const lanes: GanttLane[] = [
      { id: 'CNC-1', label: 'CNC-1', efficiency: 62, tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] },
      { id: 'CNC-2', label: 'CNC-2', efficiency: 0, tasks: [] },
    ];
    renderGantt(lanes);
    expect(screen.getByText('CNC-1')).toBeInTheDocument();
    expect(screen.getByText('1 tasks')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('No assigned work orders')).toBeInTheDocument();
  });

  it('positions bars from the shared timescale', () => {
    const lanes: GanttLane[] = [
      { id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T00:00', '2026-07-16T00:00')] },
    ];
    const { container } = renderGantt(lanes);
    const bar = barFor(container, 'wo-1');
    expect(bar).toBeTruthy();
    const x1 = expectedX(lanes, new Date('2026-07-14T00:00'));
    const x2 = expectedX(lanes, new Date('2026-07-16T00:00'));
    expect(parseFloat(bar.style.left)).toBeCloseTo(NAME_COL_WIDTH + x1, 3);
    expect(parseFloat(bar.style.width)).toBeCloseTo(x2 - x1, 3);
  });

  it('renders weekend bands, overlap bands, dependency arrows and decorations', () => {
    const lanes: GanttLane[] = [
      {
        id: 'M',
        label: 'M',
        tasks: [
          task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00', {
            texture: true,
            setupRatio: 0.25,
            setupLabel: 'Setup: 2h',
            warning: 'Material is not ready',
            baseline: { start: new Date('2026-07-13T08:00'), end: new Date('2026-07-13T16:00') },
          }),
          task('wo-2', '2026-07-14T12:00', '2026-07-14T20:00', {
            dependencies: ['wo-1'],
            dependencyTypes: { 'wo-1': 'SS' },
          }),
        ],
      },
    ];
    const { container } = renderGantt(lanes);
    expect(container.querySelectorAll('.dg-weekend-band').length).toBeGreaterThan(0);
    // wo-1 and wo-2 overlap 12:00–16:00 on the same machine
    expect(container.querySelectorAll('.dg-overlap-band')).toHaveLength(1);
    const connector = container.querySelector('.dg-connector') as SVGPathElement;
    expect(connector).toBeTruthy();
    expect(connector.getAttribute('stroke-dasharray')).toBe('5 4'); // SS link renders dashed
    expect(container.querySelector('.dg-texture')).toBeTruthy();
    expect(container.querySelector('.dg-setup-stripe')).toBeTruthy();
    expect(container.querySelector('.dg-warning-badge')?.getAttribute('title')).toBe('Material is not ready');
    expect(container.querySelector('.dg-baseline-ghost')).toBeTruthy();
  });

  it('does not draw arrows for predecessors outside the lane', () => {
    const lanes: GanttLane[] = [
      { id: 'A', label: 'A', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] },
      { id: 'B', label: 'B', tasks: [task('wo-2', '2026-07-15T08:00', '2026-07-15T16:00', { dependencies: ['wo-1'] })] },
    ];
    const { container } = renderGantt(lanes);
    expect(container.querySelectorAll('.dg-connector')).toHaveLength(0);
  });
});

describe('DravaGantt interaction', () => {
  it('selects on plain click and reports deselection', () => {
    const onSelect = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onSelect });
    const bar = barFor(container, 'wo-1');
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 101 });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-1' }), true);

    fireEvent.pointerDown(bar, { pointerId: 2, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 100 });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'wo-1' }), false);
  });

  it('drag-moves a bar by whole columns and keeps the dropped position optimistically', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDateChange });
    const bar = barFor(container, 'wo-1');
    const leftBefore = parseFloat(bar.style.left);

    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + 2 * COLUMN_WIDTHS.day });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + 2 * COLUMN_WIDTHS.day });

    expect(onDateChange).toHaveBeenCalledTimes(1);
    const moved = onDateChange.mock.calls[0][0] as GanttTask;
    expect(moved.start.getTime()).toBeCloseTo(new Date('2026-07-16T08:00').getTime(), -4);
    expect(moved.end.getTime() - moved.start.getTime()).toBe(8 * 3_600_000);

    // The bar stays at the dropped position (optimistic override) until props change.
    const barAfter = barFor(container, 'wo-1');
    expect(parseFloat(barAfter.style.left)).toBeCloseTo(leftBefore + 2 * COLUMN_WIDTHS.day, 3);
  });

  it('resizes via the end handle without moving the start', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDateChange });
    const handle = container.querySelector('.dg-resize-handle--end') as HTMLElement;

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day });

    const resized = onDateChange.mock.calls[0][0] as GanttTask;
    expect(resized.start).toEqual(new Date('2026-07-14T08:00'));
    expect(resized.end.getTime()).toBeCloseTo(new Date('2026-07-15T16:00').getTime(), -4);
  });

  it('changes progress via the progress handle', () => {
    const onProgressChange = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T00:00', '2026-07-16T00:00')] }];
    const { container } = renderGantt(lanes, { onProgressChange });
    const handle = container.querySelector('.dg-progress-handle') as HTMLElement;
    const barWidth = 2 * COLUMN_WIDTHS.day;

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + barWidth / 2 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + barWidth / 2 });

    expect(onProgressChange).toHaveBeenCalledTimes(1);
    expect((onProgressChange.mock.calls[0][0] as GanttTask).progress).toBeCloseTo(90, 0);
  });

  it('cancels an in-flight drag on Escape', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDateChange });
    const bar = barFor(container, 'wo-1');
    const leftBefore = parseFloat(bar.style.left);

    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 430 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 430 });

    expect(onDateChange).not.toHaveBeenCalled();
    expect(parseFloat(barFor(container, 'wo-1').style.left)).toBeCloseTo(leftBefore, 3);
  });

  it('deletes the selected task with the Delete key', () => {
    const onDelete = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDelete });
    const bar = barFor(container, 'wo-1');
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-1' }));
  });

  it('opens details on double click', () => {
    const onDoubleClick = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDoubleClick });
    fireEvent.doubleClick(barFor(container, 'wo-1'));
    expect(onDoubleClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-1' }));
  });

  it('drops optimistic overrides when revertNonce changes', () => {
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container, rerender } = renderGantt(lanes, { revertNonce: 0 });
    const bar = barFor(container, 'wo-1');
    const leftBefore = parseFloat(bar.style.left);

    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day });
    expect(parseFloat(barFor(container, 'wo-1').style.left)).toBeCloseTo(leftBefore + COLUMN_WIDTHS.day, 3);

    rerender(
      <DravaGantt
        lanes={lanes}
        viewMode="day"
        locale="en-US"
        rowHeight={50}
        barFillPercent={70}
        emptyLaneLabel="No assigned work orders"
        taskCountLabel={(count) => `${count} tasks`}
        revertNonce={1}
      />,
    );
    expect(parseFloat(barFor(container, 'wo-1').style.left)).toBeCloseTo(leftBefore, 3);
  });

  it('ctrl-click builds a multi-select, shows the pill, and Esc clears it', () => {
    const onSelect = vi.fn();
    const lanes: GanttLane[] = [{
      id: 'M',
      label: 'M',
      tasks: [
        task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00'),
        task('wo-2', '2026-07-15T08:00', '2026-07-15T16:00'),
      ],
    }];
    const { container } = renderGantt(lanes, { onSelect, selectionHint: (count) => `${count} selected` });
    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });
    fireEvent.pointerDown(barFor(container, 'wo-2'), { pointerId: 2, clientX: 100, button: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 100 });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-1' }), true);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-2' }), true);
    expect(container.querySelectorAll('.dg-bar--selected')).toHaveLength(2);
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelectorAll('.dg-bar--selected')).toHaveLength(0);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-1' }), false);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wo-2' }), false);
  });

  it('moves co-selected bars together during a group drag (optimistic)', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{
      id: 'M',
      label: 'M',
      tasks: [
        task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00'),
        task('wo-2', '2026-07-20T08:00', '2026-07-20T16:00'),
      ],
    }];
    const { container } = renderGantt(lanes, { onDateChange });
    const otherLeftBefore = parseFloat(barFor(container, 'wo-2').style.left);

    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });
    fireEvent.pointerDown(barFor(container, 'wo-2'), { pointerId: 2, clientX: 100, button: 0, ctrlKey: true });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 100 });

    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 3, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 300 + COLUMN_WIDTHS.day });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 300 + COLUMN_WIDTHS.day });

    // Only the dragged bar reports; the page applies the delta to the rest of the selection.
    expect(onDateChange).toHaveBeenCalledTimes(1);
    // But the co-selected bar keeps the shifted position optimistically.
    expect(parseFloat(barFor(container, 'wo-2').style.left)).toBeCloseTo(otherLeftBefore + COLUMN_WIDTHS.day, 3);
  });

  it('applies live snapTime to the dragged start', () => {
    const onDateChange = vi.fn();
    // Snap everything to 06:00 of its day.
    const snapTime = (ms: number) => {
      const date = new Date(ms);
      date.setHours(6, 0, 0, 0);
      return date.getTime();
    };
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDateChange, snapTime });
    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + 2 * COLUMN_WIDTHS.day });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + 2 * COLUMN_WIDTHS.day });

    const moved = onDateChange.mock.calls[0][0] as GanttTask;
    expect(moved.start).toEqual(new Date('2026-07-16T06:00'));
  });

  it('shows the conflict tint, drag tooltip reasons and cascade previews from getDragPreview', () => {
    const getDragPreview = vi.fn().mockReturnValue({
      conflicts: ['Overlaps RN-2041'],
      cascades: [{ taskId: 'wo-2', start: new Date('2026-07-17T08:00'), end: new Date('2026-07-17T16:00') }],
    });
    const lanes: GanttLane[] = [{
      id: 'M',
      label: 'M',
      tasks: [
        task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00'),
        task('wo-2', '2026-07-15T08:00', '2026-07-15T16:00', { dependencies: ['wo-1'] }),
      ],
    }];
    const { container } = renderGantt(lanes, { getDragPreview });
    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day, clientY: 40 });

    expect(getDragPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wo-1' }),
      expect.any(Date),
      expect.any(Date),
      'M',
    );
    expect(barFor(container, 'wo-1').classList.contains('dg-bar--conflict')).toBe(true);
    expect(screen.getByText('⚠ Overlaps RN-2041')).toBeInTheDocument();
    expect(container.querySelector('.dg-cascade-preview')).toBeTruthy();
    expect(container.querySelector('.dg-drag-ghost')).toBeTruthy();
    expect(container.querySelector('.dg-snap-guide')).toBeTruthy();

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day });
    expect(container.querySelector('.dg-drag-tooltip')).toBeNull();
  });

  it('reports a lane change when a laneChangeable bar is dropped on another lane', () => {
    const onLaneChange = vi.fn();
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [
      { id: 'A', label: 'A', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00', { laneChangeable: true })] },
      { id: 'B', label: 'B', tasks: [] },
    ];
    const { container } = renderGantt(lanes, { onLaneChange, onDateChange });
    // Lane A spans y [0, 96) (46px header + 50px row); lane B starts at 96. The scroll
    // container has a zero rect in jsdom, so clientY maps straight onto body y + header.
    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 300, clientY: 70, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day, clientY: 50 + 96 + 30 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300 + COLUMN_WIDTHS.day, clientY: 50 + 96 + 30 });

    expect(onDateChange).not.toHaveBeenCalled();
    expect(onLaneChange).toHaveBeenCalledTimes(1);
    expect(onLaneChange.mock.calls[0][1]).toBe('B');
  });

  it('nudges the selected bar with arrow keys and resizes with Alt+arrows', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{ id: 'M', label: 'M', tasks: [task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00')] }];
    const { container } = renderGantt(lanes, { onDateChange });
    fireEvent.pointerDown(barFor(container, 'wo-1'), { pointerId: 1, clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });

    // Day view nudge unit is one 8h shift.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    let moved = onDateChange.mock.calls[0][0] as GanttTask;
    expect(moved.start).toEqual(new Date('2026-07-14T16:00'));
    expect(moved.end).toEqual(new Date('2026-07-15T00:00'));

    // Shift+arrow is the fine 15-minute nudge, applied on top of the optimistic position.
    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });
    moved = onDateChange.mock.calls[1][0] as GanttTask;
    expect(moved.start).toEqual(new Date('2026-07-14T15:45'));

    // Alt+arrow resizes the end edge only.
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    moved = onDateChange.mock.calls[2][0] as GanttTask;
    expect(moved.start).toEqual(new Date('2026-07-14T15:45'));
    expect(moved.end).toEqual(new Date('2026-07-15T07:45'));
  });

  it('does not drag project rows', () => {
    const onDateChange = vi.fn();
    const lanes: GanttLane[] = [{
      id: 'M',
      label: 'M',
      tasks: [
        task('wo-1', '2026-07-14T08:00', '2026-07-14T16:00', { type: 'project', isDisabled: true }),
        task('op-1-1', '2026-07-14T08:00', '2026-07-14T16:00', { project: 'wo-1' }),
      ],
    }];
    const { container } = renderGantt(lanes, { onDateChange });
    const bar = barFor(container, 'wo-1');
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 430 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 430 });
    expect(onDateChange).not.toHaveBeenCalled();
  });
});
