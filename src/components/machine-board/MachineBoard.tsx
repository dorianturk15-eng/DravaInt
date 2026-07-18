import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useScheduling } from '../../scheduling/SchedulingContext';
import { useMachines } from '../../machines/MachinesContext';
import { useSettings } from '../../settings/SettingsContext';
import { STATUS_COLORS } from '../../scheduling/boardData';
import { getWeeklyCapacityHours } from '../../scheduling/capacity';
import {
  buildConnectorPath,
  buildTimeTicks,
  cardEdgeAnchor,
  edgesForDependencyType,
  snapToShiftBoundary,
  xToTime,
} from '../../scheduling/boardGeometry';
import { toLocalDateTimeString } from '../../scheduling/cpm';

/** Fired when the user double-clicks empty lane space; MachineSchedule prefills its add-job form. */
export const QUICK_CREATE_EVENT = 'dravaint:board-quick-create';
export interface QuickCreateDetail {
  machine: string;
  start: string;
  end: string;
}
import { useMachineBoardController } from './useMachineBoardController';
import { MachineLane } from './MachineLane';
import { TaskCard } from './TaskCard';
import { ConnectionLayer, type RenderedConnector } from './ConnectionLayer';
import { BoardToolbar } from './BoardToolbar';
import { MachineBoardMobile } from './MachineBoardMobile';

const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

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

export function MachineBoard() {
  const { t, lang } = useLanguage();
  const { jobs, updateJob, removeJob, restoreBackup, getJobConflicts } = useScheduling();
  const { machines } = useMachines();
  const { settings } = useSettings();
  const isMobile = useNarrowViewport(680);
  const [openConflictKey, setOpenConflictKey] = useState<string | null>(null);

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
    sequentialRouteMessage: t.machineBoard.sequentialRouteHint,
    chainSegmentMessage: t.machineBoard.chainSegmentHint,
  });

  const machineByName = useMemo(() => new Map(machines.map((machine) => [machine.name, machine])), [machines]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

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
        connectMode={controller.connectMode}
        onToggleConnectMode={() => controller.setConnectMode((value) => !value)}
        onScrollToday={controller.scrollToToday}
        onAutoSchedule={() => void controller.autoSchedule()}
        onExportCsv={controller.exportCsv}
        onExportPng={() => void controller.exportPng()}
        onJumpToConflict={() => controller.jumpToConflict()}
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
          getJobConflicts={getJobConflicts}
          onRemove={(id) => void controller.removeJob(id)}
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
            if (!lane) return;
            const startMs = snapToShiftBoundary(xToTime(point.x, controller.originMs, controller.pixelsPerHour), settings.workdayStart, settings.workdayEnd);
            window.dispatchEvent(new CustomEvent<QuickCreateDetail>(QUICK_CREATE_EVENT, {
              detail: { machine: lane.machine, start: toLocalDateTimeString(new Date(startMs)), end: toLocalDateTimeString(new Date(startMs + 8 * 3_600_000)) },
            }));
          }}
        >
          <div className="board-ruler" style={{ width: controller.contentWidth }}>
            {ticks.map((tick) => (
              <div key={tick.ms} className={`board-ruler-tick${tick.isDayStart ? ' is-day' : ''}`} style={{ left: tick.x }}>
                <span>{tick.label}</span>
              </div>
            ))}
          </div>

          {controller.laneOrder.map((lane) => {
            const layout = controller.laneLayouts.find((item) => item.machine === lane.machine)!;
            const hours = lane.slots.reduce((sum, item) => sum + (item.slot.endMs - item.slot.startMs) / 3_600_000, 0);
            return (
              <MachineLane
                key={lane.machine}
                lane={layout}
                machine={machineByName.get(lane.machine)}
                jobCount={lane.slots.length}
                loadPercent={(hours / getWeeklyCapacityHours()) * 100}
                emptyLabel={t.machineBoard.emptyLane}
                isDropTarget={dropTargetMachine === lane.machine}
              />
            );
          })}

          <ConnectionLayer
            width={controller.contentWidth}
            height={controller.totalHeight}
            connectors={connectors}
            livePath={livePath}
            liveValid={liveValid}
            onSelectConnector={(predecessorId, successorId) => controller.setSelectedConnection({ predecessorId, successorId })}
          />

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
                conflicts={getJobConflicts(slot.job)}
                selected={controller.selectedKeys.has(slot.key)}
                isDragging={draggingKey === slot.key}
                isConnectSource={connectSourceId === slot.jobId}
                conflictsOpen={openConflictKey === slot.key}
                onToggleConflicts={() => setOpenConflictKey((current) => (current === slot.key ? null : slot.key))}
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
        </div>
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
