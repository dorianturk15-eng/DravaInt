import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useScheduling } from '../../scheduling/SchedulingContext';
import { useMachines } from '../../machines/MachinesContext';
import { useWorkers } from '../../workers/WorkersContext';
import { useSettings } from '../../settings/SettingsContext';
import { STATUS_COLORS } from '../../scheduling/boardData';
import {
  buildConnectorPath,
  buildTimeTicks,
  cardEdgeAnchor,
  edgesForDependencyType,
  snapToShiftBoundary,
  xToTime,
} from '../../scheduling/boardGeometry';
import { toLocalDateTimeString } from '../../scheduling/cpm';
import { buildMachineLookup, resolveMachineId } from '../../scheduling/machineIdentity';
import { requestFocus } from '../../navigation/focusTarget';
import { useMachineBoardController } from './useMachineBoardController';
import { MachineLane } from './MachineLane';
import { TaskCard } from './TaskCard';
import { ConnectionLayer, type RenderedConnector } from './ConnectionLayer';
import { BoardToolbar } from './BoardToolbar';
import { ConflictPanel } from './ConflictPanel';
import { MachineBoardMobile } from './MachineBoardMobile';

const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
const COACH_KEY = 'dravaint-board-coach-seen';
const MIN_OP_HOURS = 0.25;

function useNarrowViewport(maxWidth: number): boolean {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia?.(`(max-width: ${maxWidth}px)`).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const apply = () => setIsNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [maxWidth]);
  return isNarrow;
}

interface QuickCreateState {
  machine: string;
  startMs: number;
  x: number;
  y: number;
}

export function MachineBoard() {
  const { t, lang } = useLanguage();
  const { jobs, updateJob, removeJob, restoreBackup, getJobConflicts, addJob } = useScheduling();
  const { machines } = useMachines();
  const { activeWorkers, displayName } = useWorkers();
  const { settings } = useSettings();
  const isMobile = useNarrowViewport(680);
  const [openConflictKey, setOpenConflictKey] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [quickCreate, setQuickCreate] = useState<QuickCreateState | null>(null);
  const [showCoach, setShowCoach] = useState(false);

  const controller = useMachineBoardController({
    jobs,
    machines,
    updateJob,
    removeJob,
    restoreBackup,
    getJobConflicts,
    settings,
    locale: lang === 'hr' ? 'hr-HR' : 'en-GB',
    rejectedMessage: lang === 'hr' ? 'Taj termin je već zauzet na tom stroju ili kod tog operatera.' : 'That slot is already booked for this machine or operator.',
    versionConflictMessage: lang === 'hr' ? 'Netko drugi je upravo izmijenio ovaj nalog — podaci su osvježeni.' : 'Someone else just updated this job — data refreshed.',
    chainSegmentMessage: t.machineBoard.chainSegmentHint,
    orderGoneMessage: t.machineBoard.orderGone,
  });

  const machineByName = useMemo(() => new Map(machines.map((machine) => [machine.name, machine])), [machines]);
  const machineLookup = useMemo(() => buildMachineLookup(machines), [machines]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  useEffect(() => {
    if (isMobile) return;
    if (jobs.length > 0 && !localStorage.getItem(COACH_KEY)) setShowCoach(true);
  }, [isMobile, jobs.length]);

  function dismissCoach() {
    localStorage.setItem(COACH_KEY, '1');
    setShowCoach(false);
  }

  function viewInGantt(jobId: number) {
    requestFocus({ tab: 'gantt', jobId });
  }

  async function submitQuickCreate(order: string, operatorId: number | null, durationHours: number) {
    if (!quickCreate || !order.trim()) return;
    const worker = activeWorkers.find((item) => item.id === operatorId);
    const operatorName = worker ? displayName(worker) : '';
    const startStr = toLocalDateTimeString(new Date(quickCreate.startMs));
    const endStr = toLocalDateTimeString(new Date(quickCreate.startMs + durationHours * 3_600_000));
    const machineId = resolveMachineId(quickCreate.machine, null, machineLookup);
    // Modern single-operation shape (carries machineId) — not the legacy route-less job the old
    // scroll-to-form path produced, which Phases C/D then had to work around.
    await addJob({
      machine: quickCreate.machine,
      order: order.trim(),
      operator: operatorName,
      operatorId: operatorId ?? null,
      start: startStr,
      end: endStr,
      operations: [{ id: 1, name: order.trim(), machine: quickCreate.machine, machineId, hours: durationHours, operator: operatorName, operatorId: operatorId ?? null }],
    });
    setQuickCreate(null);
  }

  // Dependencies are job-level: a connector anchors from the predecessor route's last slot to the
  // successor route's first slot (the two ends of each order's chain of operation cards).
  const connectors: RenderedConnector[] = [];
  jobs.forEach((job) => {
    (job.dependencies ?? []).forEach((dependency) => {
      const predecessorAnchor = controller.jobAnchors.get(dependency.jobId);
      const successorAnchor = controller.jobAnchors.get(job.id);
      if (!predecessorAnchor || !successorAnchor) return;
      const { sourceEdge, targetEdge } = edgesForDependencyType(dependency.type);
      const source = cardEdgeAnchor(sourceEdge === 'end' ? predecessorAnchor.last : predecessorAnchor.first, sourceEdge);
      const target = cardEdgeAnchor(targetEdge === 'end' ? successorAnchor.last : successorAnchor.first, targetEdge);
      connectors.push({
        key: `${dependency.jobId}-${job.id}`,
        path: buildConnectorPath(source, target),
        predecessorId: dependency.jobId,
        successorId: job.id,
        dashed: dependency.type === 'SS' || dependency.type === 'SF',
        selected: controller.selectedConnection?.predecessorId === dependency.jobId && controller.selectedConnection?.successorId === job.id,
      });
    });
  });

  let livePath: string | null = null;
  let liveValid: boolean | null = null;
  let connectSourceId: number | null = controller.connectSource;
  if (controller.interaction?.kind === 'link') {
    const sourceAnchor = controller.jobAnchors.get(controller.interaction.sourceJobId);
    if (sourceAnchor) {
      const sourceLayout = controller.interaction.sourceEdge === 'end' ? sourceAnchor.last : sourceAnchor.first;
      const source = cardEdgeAnchor(sourceLayout, controller.interaction.sourceEdge);
      livePath = buildConnectorPath(source, { x: controller.interaction.pointerX, y: controller.interaction.pointerY });
      liveValid = controller.interaction.classification === 'valid';
    }
    connectSourceId = controller.interaction.sourceJobId;
  }

  const ticks = useMemo(
    () => buildTimeTicks(controller.originMs, controller.spanHours, controller.pixelsPerHour, controller.zoom, controller.locale),
    [controller.originMs, controller.spanHours, controller.pixelsPerHour, controller.zoom, controller.locale],
  );

  const draggingKey = controller.interaction && controller.interaction.kind !== 'link' ? controller.interaction.ref.key : null;
  const dropTargetMachine = controller.interaction?.kind === 'move' ? controller.interaction.targetMachine : null;

  const cycleLabel = controller.cycle?.map((id) => jobById.get(id)?.order || `#${id}`).join(' → ');

  // --- Live drag/resize feedback (pill + reflow ghosts). ---
  const interaction = controller.interaction;
  const pixelsPerHour = controller.pixelsPerHour;
  let movePill: { x: number; y: number; text: string; warn: boolean } | null = null;
  let resizePill: { x: number; y: number; text: string } | null = null;
  const reflowGhosts: Array<{ key: string; x: number; y: number; width: number; height: number }> = [];

  if (interaction?.kind === 'move' && interaction.moved) {
    const layout = controller.cardLayouts.get(interaction.ref.key);
    if (layout) {
      const liveX = layout.x + interaction.liveDeltaXPx;
      const liveY = layout.y + interaction.liveDeltaYPx;
      if (interaction.horizontalLocked) {
        movePill = { x: liveX, y: liveY - 26, text: interaction.targetMachine, warn: interaction.targetMachine !== interaction.originMachine };
      } else {
        const snapped = snapToShiftBoundary(interaction.jobStartMs + (interaction.liveDeltaXPx / pixelsPerHour) * 3_600_000, settings.workdayStart, settings.workdayEnd);
        const duration = interaction.jobEndMs - interaction.jobStartMs;
        const startFmt = new Date(snapped).toLocaleString(controller.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        const endFmt = new Date(snapped + duration).toLocaleString(controller.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        // Pre-drop conflict preview: does the moved window overlap another slot on the target lane?
        const overlaps = controller.board.slots.some((other) =>
          other.jobId !== interaction.ref.jobId && other.machine === interaction.targetMachine
          && other.startMs < snapped + duration && snapped < other.endMs);
        movePill = { x: liveX, y: liveY - 26, text: `${startFmt} → ${endFmt}`, warn: overlaps };
      }
    }
  }

  if (interaction?.kind === 'resize-start' || interaction?.kind === 'resize-end') {
    const layout = controller.cardLayouts.get(interaction.ref.key);
    if (layout && interaction.ref.isOperation) {
      const deltaHours = ((interaction.kind === 'resize-end' ? interaction.liveDeltaXPx : -interaction.liveDeltaXPx) / pixelsPerHour);
      const newHours = Math.max(MIN_OP_HOURS, Math.round((interaction.originHours + deltaHours) / MIN_OP_HOURS) * MIN_OP_HOURS);
      resizePill = { x: layout.x + layout.width, y: layout.y - 26, text: `${interaction.originHours} h → ${newHours} h` };
      // Ghost the downstream operations of the same job at their reflowed (shifted) positions.
      const shiftMs = (newHours - interaction.originHours) * 3_600_000;
      const shiftPx = (shiftMs / 3_600_000) * pixelsPerHour;
      if (interaction.ref.opIndex !== null) {
        controller.board.slots.forEach((other) => {
          if (other.jobId !== interaction.ref.jobId) return;
          if (other.opIndex === null || other.opIndex <= interaction.ref.opIndex!) return;
          const otherLayout = controller.cardLayouts.get(other.key);
          if (otherLayout) reflowGhosts.push({ key: other.key, x: otherLayout.x + shiftPx, y: otherLayout.y, width: otherLayout.width, height: otherLayout.height });
        });
      }
    }
  }

  function liveOffsetFor(slotKey: string): { x: number; y: number } | null {
    if (interaction?.kind === 'move' && interaction.ref.key === slotKey && interaction.moved) {
      return { x: interaction.liveDeltaXPx, y: interaction.liveDeltaYPx };
    }
    return null;
  }

  const showEmptyBoard = !isMobile && controller.board.slots.length === 0 && machines.length > 0;
  const showNoMachines = !isMobile && machines.length === 0 && controller.board.slots.length === 0;

  return (
    <div className="board-page">
      <p className="subtitle-text" style={{ margin: '0 0 12px 0', fontSize: 13 }}>{t.machineBoard.dragHint}</p>

      <BoardToolbar
        t={t.machineBoard}
        statusLabels={t.progress.statusOptions}
        zoom={controller.zoom}
        onZoomChange={controller.setZoom}
        sortBy={controller.sortBy}
        onSortChange={controller.setSortBy}
        statusFilter={controller.statusFilter}
        onStatusFilterChange={controller.setStatusFilter}
        query={controller.query}
        onQueryChange={controller.setQuery}
        onQuerySubmit={controller.jumpToFirstMatch}
        conflictCount={controller.conflicts.length}
        conflictPanelOpen={controller.conflictPanelOpen}
        onToggleConflicts={() => controller.setConflictPanelOpen((v) => !v)}
        hideEmpty={controller.hideEmpty}
        onToggleHideEmpty={() => controller.setHideEmpty((v) => !v)}
        onShowLegend={() => setLegendOpen((v) => !v)}
        connectMode={controller.connectMode}
        onToggleConnectMode={() => controller.setConnectMode((value) => !value)}
        onScrollToday={controller.scrollToToday}
        onAutoSchedule={() => void controller.autoSchedule()}
        onExportCsv={controller.exportCsv}
        onExportPng={() => void controller.exportPng()}
        onChainSelected={controller.chainSelected}
        selectionCount={controller.selectedKeys.size}
        views={controller.views}
        onSaveView={controller.saveView}
        onApplyView={controller.applyView}
        onDeleteView={controller.deleteView}
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        historyDepth={controller.historyDepth}
        futureDepth={controller.futureDepth}
        onUndo={controller.undo}
        onRedo={controller.redo}
        compact={isMobile}
      />

      {controller.conflictPanelOpen && !isMobile && (
        <ConflictPanel
          conflicts={controller.conflicts}
          locale={controller.locale}
          onFocus={controller.focusConflict}
          onShiftLater={controller.shiftLater}
          getMoveOptions={controller.machineMoveOptions}
          onMoveTo={controller.moveSlotToMachine}
          onViewInGantt={viewInGantt}
          onClose={() => controller.setConflictPanelOpen(false)}
          labels={{
            title: t.machineBoard.conflictsTitle,
            none: t.machineBoard.noConflicts,
            shiftLater: t.machineBoard.shiftLater,
            moveTo: t.machineBoard.moveTo,
            viewInGantt: t.machineBoard.viewInGantt,
            overlaps: t.machineBoard.overlaps,
            noFreeMachine: t.machineBoard.noFreeMachine,
            close: lang === 'hr' ? 'Zatvori' : 'Close',
          }}
        />
      )}

      {legendOpen && (
        <div className="board-legend" role="note">
          <span><i className="board-legend-swatch is-operation" /> {t.machineBoard.legendOperation}</span>
          <span><i className="board-legend-swatch is-chain" /> ‹ › {t.machineBoard.legendChain}</span>
          <span><i className="board-legend-swatch is-conflict" /> {t.machineBoard.legendConflict}</span>
          <span><i className="board-legend-swatch is-now" /> {t.machineBoard.legendNow}</span>
          <button type="button" className="board-toolbar-btn" onClick={() => setLegendOpen(false)}>×</button>
        </div>
      )}

      {controller.cycle && (
        <div className="gantt-cycle-banner" role="alert">
          <strong>{lang === 'hr' ? 'Kružna ovisnost' : 'Dependency cycle'}</strong>
          <span>{cycleLabel}</span>
        </div>
      )}

      {controller.connectMode && !isMobile && (
        <p className="subtitle-text" style={{ fontSize: 12, margin: '8px 0 0' }}>{t.machineBoard.connectModeHint}</p>
      )}

      {isMobile ? (
        <MachineBoardMobile
          lanes={controller.laneOrder}
          machineByName={machineByName}
          statusLabels={t.progress.statusOptions}
          t={t.machineBoard}
          removeLabel={t.common.remove}
          locale={controller.locale}
          conflicts={controller.conflicts}
          laneLoadPercent={controller.laneLoadPercent}
          getJobConflicts={getJobConflicts}
          statusOptionLabels={t.progress.statusOptions}
          onRemove={(id) => void controller.removeJob(id)}
          onShiftLater={controller.shiftLater}
          onSetStatus={(id, status) => void updateJob(id, { status })}
        />
      ) : (
      <div className="board-scroll" ref={controller.scrollRef}>
        <div
          className="board-content"
          ref={controller.contentRef}
          style={{ width: controller.contentWidth, height: controller.totalHeight + 32 }}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('.board-task-card')) return;
            const point = controller.toContentCoords(event.clientX, event.clientY);
            const lane = controller.laneLayouts.find((item) => point.y >= item.top && point.y < item.top + item.height);
            if (!lane || lane.collapsed) return;
            const startMs = snapToShiftBoundary(xToTime(point.x, controller.originMs, controller.pixelsPerHour), settings.workdayStart, settings.workdayEnd);
            setQuickCreate({ machine: lane.machine, startMs, x: point.x, y: point.y });
          }}
        >
          {/* Time furniture behind the lanes (weekend/holiday/off-shift shading). */}
          {controller.timeBands.map((band) => (
            <div key={band.key} className={`board-time-band board-time-band-${band.kind}`} style={{ left: band.x, width: band.width, height: controller.totalHeight }} />
          ))}

          <div className="board-ruler" style={{ width: controller.contentWidth }}>
            {ticks.map((tick) => (
              <div key={tick.ms} className={`board-ruler-tick${tick.isDayStart ? ' is-day' : ''}`} style={{ left: tick.x }}>
                <span>{tick.label}</span>
              </div>
            ))}
          </div>

          {controller.laneOrder.map((lane) => {
            const layout = controller.laneLayouts.find((item) => item.machine === lane.machine)!;
            return (
              <MachineLane
                key={lane.machine}
                lane={layout}
                machine={machineByName.get(lane.machine)}
                jobCount={lane.slots.length}
                loadPercent={controller.laneLoadPercent.get(lane.machine) ?? 0}
                emptyLabel={t.machineBoard.emptyLane}
                isDropTarget={dropTargetMachine === lane.machine}
                onToggleCollapse={() => controller.toggleCollapse(lane.machine)}
                collapseHint={t.machineBoard.collapseLane}
              />
            );
          })}

          {/* Now-line above the lanes, below the cards. */}
          {controller.nowX >= 0 && controller.nowX <= controller.contentWidth && (
            <div className="board-now-line" style={{ left: controller.nowX, height: controller.totalHeight }} aria-hidden="true" />
          )}

          <ConnectionLayer
            width={controller.contentWidth}
            height={controller.totalHeight}
            connectors={connectors}
            livePath={livePath}
            liveValid={liveValid}
            onSelectConnector={(predecessorId, successorId) => controller.setSelectedConnection({ predecessorId, successorId })}
          />

          {reflowGhosts.map((ghost) => (
            <div key={`ghost-${ghost.key}`} className="board-reflow-ghost" style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }} aria-hidden="true" />
          ))}

          {controller.board.lanes.flatMap((lane) => lane.slots).map((boardSlot) => {
            const { slot } = boardSlot;
            const layout = controller.cardLayouts.get(slot.key);
            if (!layout) return null;
            return (
              <TaskCard
                key={slot.key}
                slot={slot}
                layout={layout}
                color={STATUS_COLORS[slot.job.status]}
                slotConflicts={controller.conflictBySlot.get(slot.key) ?? []}
                jobConflicts={getJobConflicts(slot.job)}
                locale={controller.locale}
                selected={controller.selectedKeys.has(slot.key)}
                isDragging={draggingKey === slot.key}
                isConnectSource={connectSourceId === slot.jobId}
                isPulsing={controller.pulsedKeys.has(slot.key)}
                dimmed={!controller.matchesQuery(slot)}
                horizontalLocked={(slot.isOperation && !slot.isFirstSlot) || slot.isChainSegment}
                lockHint={slot.isChainSegment ? t.machineBoard.chainSegmentHint : t.machineBoard.sequentialRouteHint}
                liveOffset={liveOffsetFor(slot.key)}
                conflictsOpen={openConflictKey === slot.key}
                onToggleConflicts={() => setOpenConflictKey((current) => (current === slot.key ? null : slot.key))}
                getMoveOptions={controller.machineMoveOptions}
                onShiftLater={controller.shiftLater}
                onMoveTo={controller.moveSlotToMachine}
                onViewInGantt={viewInGantt}
                labels={{ shiftLater: t.machineBoard.shiftLater, moveTo: t.machineBoard.moveTo, viewInGantt: t.machineBoard.viewInGantt, overlaps: t.machineBoard.overlaps, noFreeMachine: t.machineBoard.noFreeMachine }}
                onPointerDown={(event) => controller.beginMove(event, slot)}
                onResizePointerDown={(event, edge) => controller.beginResize(event, slot, edge)}
                onConnectPointerDown={(event, edge) => controller.beginLink(event, slot.jobId, edge)}
                onPointerMove={controller.handlePointerMove}
                onPointerUp={controller.handlePointerUp}
                onPointerCancel={controller.handlePointerCancel}
                onToggleSelect={(additive) => controller.toggleSelect(slot.key, additive)}
                onRemove={() => controller.removeSlot(slot)}
              />
            );
          })}

          {movePill && (
            <div className={`board-drag-pill${movePill.warn ? ' is-warn' : ''}`} style={{ left: movePill.x, top: movePill.y }}>{movePill.text}</div>
          )}
          {resizePill && (
            <div className="board-drag-pill" style={{ left: resizePill.x, top: resizePill.y }}>{resizePill.text}</div>
          )}

          {showEmptyBoard && (
            <div className="board-empty-hint">
              <p>{t.machineBoard.emptyBoard}</p>
              <button type="button" className="btn btn-ghost" onClick={() => requestFocus({ tab: 'workOrders' })}>{t.machineBoard.emptyBoardLink}</button>
            </div>
          )}
          {showNoMachines && (
            <div className="board-empty-hint">
              <p>{t.machineBoard.noMachinesTitle}</p>
              <span className="subtitle-text">{t.machineBoard.noMachinesLink}</span>
            </div>
          )}

          {quickCreate && (
            <QuickCreatePopover
              t={t.machineBoard}
              lang={lang}
              machine={quickCreate.machine}
              x={quickCreate.x}
              y={quickCreate.y}
              workers={activeWorkers.map((w) => ({ id: w.id, label: displayName(w) }))}
              onCancel={() => setQuickCreate(null)}
              onCreate={(order, operatorId, hours) => void submitQuickCreate(order, operatorId, hours)}
              onMoreOptions={() => { setQuickCreate(null); requestFocus({ tab: 'workOrders' }); }}
            />
          )}
        </div>
      </div>
      )}

      {showCoach && !isMobile && (
        <div className="board-coach" role="dialog" aria-label="Onboarding">
          <ul>
            <li>{t.machineBoard.coachMove}</li>
            <li>{t.machineBoard.coachLane}</li>
            <li>{t.machineBoard.coachResize}</li>
          </ul>
          <button type="button" className="btn btn-blue" onClick={dismissCoach}>{t.machineBoard.coachDismiss}</button>
        </div>
      )}

      {controller.selectedConnection && !controller.editingConnection && !isMobile && (
        <div className="dependency-editor" style={{ marginTop: 10 }}>
          <strong>{jobById.get(controller.selectedConnection.successorId)?.order || jobById.get(controller.selectedConnection.successorId)?.machine}</strong>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const successor = jobById.get(controller.selectedConnection!.successorId);
              const dependency = successor?.dependencies?.find((item) => item.jobId === controller.selectedConnection!.predecessorId);
              if (dependency) controller.setEditingConnection({ successorId: controller.selectedConnection!.successorId, predecessorId: controller.selectedConnection!.predecessorId, type: dependency.type, lagHours: dependency.lagHours });
            }}
          >
            {lang === 'hr' ? 'Uredi' : 'Edit'}
          </button>
          <button type="button" className="btn btn-red" onClick={() => controller.deleteConnection(controller.selectedConnection!.successorId, controller.selectedConnection!.predecessorId)}>
            {t.machineBoard.deleteConnection}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => controller.setSelectedConnection(null)}>×</button>
        </div>
      )}

      {controller.editingConnection && (
        <div className="dependency-editor" style={{ marginTop: 10 }}>
          <strong>{lang === 'hr' ? 'Uredi vezu' : 'Edit dependency'}</strong>
          <select
            value={controller.editingConnection.type}
            onChange={(event) => controller.setEditingConnection({ ...controller.editingConnection!, type: event.target.value as (typeof DEPENDENCY_TYPES)[number] })}
          >
            {DEPENDENCY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input
            type="number"
            step="0.5"
            value={controller.editingConnection.lagHours}
            onChange={(event) => controller.setEditingConnection({ ...controller.editingConnection!, lagHours: Number(event.target.value) })}
          />
          <button type="button" className="btn btn-blue" onClick={controller.saveConnectionEdit}>{lang === 'hr' ? 'Spremi' : 'Save'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => controller.setEditingConnection(null)}>×</button>
        </div>
      )}

      {controller.toast && (
        <div className={`board-toast board-toast-${controller.toast.tone}`} role="status" onClick={controller.dismissToast}>
          {controller.toast.message}
        </div>
      )}
    </div>
  );
}

interface QuickCreatePopoverProps {
  t: ReturnType<typeof useLanguage>['t']['machineBoard'];
  lang: 'hr' | 'en';
  machine: string;
  x: number;
  y: number;
  workers: Array<{ id: number; label: string }>;
  onCancel: () => void;
  onCreate: (order: string, operatorId: number | null, hours: number) => void;
  onMoreOptions: () => void;
}

function QuickCreatePopover({ t, lang, machine, x, y, workers, onCancel, onCreate, onMoreOptions }: QuickCreatePopoverProps) {
  const [order, setOrder] = useState('');
  const [operatorId, setOperatorId] = useState<number | null>(null);
  const [hours, setHours] = useState(8);
  return (
    <div className="board-quick-create" style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="board-quick-create-head">
        <strong>{t.quickCreateTitle}</strong>
        <span>{machine}</span>
        <button type="button" onClick={onCancel} aria-label={lang === 'hr' ? 'Zatvori' : 'Close'}>×</button>
      </div>
      <label>{lang === 'hr' ? 'Nalog' : 'Order'}
        <input type="text" value={order} autoFocus onChange={(e) => setOrder(e.target.value)} />
      </label>
      <label>{lang === 'hr' ? 'Operater' : 'Operator'}
        <select value={operatorId ?? ''} onChange={(e) => setOperatorId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{lang === 'hr' ? 'Nije dodijeljen' : 'Unassigned'}</option>
          {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.label}</option>)}
        </select>
      </label>
      <label>{t.quickCreateDuration}
        <input type="number" min={0.25} step={0.25} value={hours} onChange={(e) => setHours(Math.max(0.25, Number(e.target.value) || 0.25))} />
      </label>
      <div className="board-quick-create-actions">
        <button type="button" className="btn btn-green" disabled={!order.trim()} onClick={() => onCreate(order, operatorId, hours)}>{t.quickCreateCreate}</button>
        <button type="button" className="btn btn-ghost" onClick={onMoreOptions}>{t.quickCreateMore}</button>
      </div>
    </div>
  );
}
