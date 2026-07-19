import type { Job } from './SchedulingContext';
import type { Machine } from '../machines/MachinesContext';
import { splitMachineChain, type EffectiveSchedule } from './cpm';
import { hasChildren } from './hierarchy';
import { buildMachineLookup, resolveMachineId, resolveMachineName, type MachineLookup } from './machineIdentity';

/**
 * One (machine, time-window) a job actually occupies — the single source of truth for "what runs on
 * machine X, when". A routed order expands to one slot per operation; a plain single-machine job to
 * one synthetic slot; a legacy chain-string job (no `operations`) to one slot per chain segment.
 *
 * This mirrors the per-operation expansions already living in `cpm.operationIntervals`,
 * `hierarchy.computeOperationSchedule` and `capacity.calculateMachineLoads`; the machine board keys
 * its lanes/cards off these slots instead of the legacy `job.machine` string, which for routed
 * orders is a display chain ("Pila → CNC-1 → …") that can never equal a single lane's name.
 */
export interface OperationSlot {
  /** Stable per-render key: `${jobId}:op${opId}`, `${jobId}:seg${index}`, or `${jobId}:self`. */
  key: string;
  jobId: number;
  /** OperationStep.id for a routed op; null for a synthetic (plain-job) slot. */
  opId: number | null;
  /** Index within `job.operations` (routed) or within the chain segments; null for a single slot. */
  opIndex: number | null;
  /** Routed operation slot (opId non-null). */
  isOperation: boolean;
  /** One segment of a legacy multi-machine chain string on a job without `operations`. */
  isChainSegment: boolean;
  /** The route/chain's first slot — the only one whose horizontal drag moves the whole job's start. */
  isFirstSlot: boolean;
  /** The route/chain's last slot — dependency connectors on the successor side anchor here. */
  isLastSlot: boolean;
  /** How many slots this job contributes (route length / chain length / 1). */
  slotCount: number;
  /** Operation step name (routed) — the card's subtitle; undefined for synthetic/chain slots. */
  name?: string;
  /** Resolved *current* machine display name (via {@link resolveMachineName}) — the lane key. */
  machine: string;
  /** Stable machine identity, resolved from the op's own id or a name-match; null when unmapped. */
  machineId: number | null;
  startMs: number;
  endMs: number;
  hours: number;
  operator?: string;
  operatorId?: number | null;
  job: Job;
}

function jobEffectiveStart(job: Job, effective: Map<number, EffectiveSchedule>): number {
  const eff = effective.get(job.id);
  if (eff) return eff.start;
  const own = job.start ? new Date(job.start).getTime() : NaN;
  return Number.isNaN(own) ? Date.now() : own;
}

function jobEffectiveEnd(job: Job, startMs: number, effective: Map<number, EffectiveSchedule>): number {
  const eff = effective.get(job.id);
  if (eff) return Math.max(eff.end, startMs);
  const own = job.end ? new Date(job.end).getTime() : NaN;
  return Number.isNaN(own) ? startMs + 3_600_000 : Math.max(own, startMs);
}

/**
 * Expands every leaf job into its per-machine operation slots. Container jobs (those with children)
 * contribute nothing — their leaves do. Slots whose machine is empty are dropped: they can't belong
 * to any lane (this matches the pre-existing board behaviour, where an empty `machine` string never
 * matched a lane and the job silently vanished).
 *
 * @param effective CPM-resolved schedule keyed by job id, so a routed order's operations lay out
 *   from its dependency-cascaded start — keeping the board in step with the Gantt and conflict views.
 * @param machines Current machine list (Phase C). When supplied, each slot's display `machine` is
 *   resolved through {@link resolveMachineName} — an op carrying a live `machineId` follows an Admin
 *   rename, while a legacy op with only a name still lands on its name's lane. Omitting it keeps the
 *   pre-Phase-C name-only behaviour (used by tests/callers without a machine list).
 */
export function expandToOperationSlots(
  jobs: Job[],
  effective: Map<number, EffectiveSchedule>,
  machines: Machine[] = [],
): OperationSlot[] {
  const slots: OperationSlot[] = [];
  const lookup: MachineLookup = buildMachineLookup(machines);

  for (const job of jobs) {
    if (hasChildren(jobs, job.id)) continue;

    const effStart = jobEffectiveStart(job, effective);

    // --- Routed order: one slot per operation, sequential from the effective start. ---
    if (job.operations && job.operations.length > 0) {
      let cursor = effStart;
      job.operations.forEach((op, index) => {
        const hours = op.hours || 0;
        const start = cursor;
        const end = cursor + hours * 3_600_000;
        cursor = end;
        const rawMachine = (op.machine || '').trim();
        if (!rawMachine) return;
        const machineId = resolveMachineId(op.machine, op.machineId, lookup);
        const machine = resolveMachineName(op.machine, op.machineId, lookup);
        slots.push({
          key: `${job.id}:op${op.id}`,
          jobId: job.id,
          opId: op.id,
          opIndex: index,
          isOperation: true,
          isChainSegment: false,
          isFirstSlot: index === 0,
          isLastSlot: index === job.operations!.length - 1,
          slotCount: job.operations!.length,
          name: op.name,
          machine,
          machineId,
          startMs: start,
          endMs: end,
          hours,
          operator: op.operator,
          operatorId: op.operatorId ?? null,
          job,
        });
      });
      continue;
    }

    // --- Plain job. A legacy chain string ("A → B") splits into evenly-windowed segments; a single
    //     machine yields one synthetic slot spanning the whole job window. ---
    const machines = splitMachineChain(job.machine);
    const effEnd = jobEffectiveEnd(job, effStart, effective);

    if (machines.length > 1) {
      const span = Math.max(0, effEnd - effStart);
      const per = span / machines.length;
      machines.forEach((segMachine, index) => {
        const start = effStart + index * per;
        const end = effStart + (index + 1) * per;
        const machineId = resolveMachineId(segMachine, null, lookup);
        const machine = resolveMachineName(segMachine, null, lookup) || segMachine;
        slots.push({
          key: `${job.id}:seg${index}`,
          jobId: job.id,
          opId: null,
          opIndex: index,
          isOperation: false,
          isChainSegment: true,
          isFirstSlot: index === 0,
          isLastSlot: index === machines.length - 1,
          slotCount: machines.length,
          machine,
          machineId,
          startMs: start,
          endMs: end,
          hours: per / 3_600_000,
          operator: job.operator,
          operatorId: job.operatorId ?? null,
          job,
        });
      });
      continue;
    }

    const rawMachine = machines[0] ?? job.machine.trim();
    if (!rawMachine) continue;
    const machineId = resolveMachineId(rawMachine, null, lookup);
    const machine = resolveMachineName(rawMachine, null, lookup) || rawMachine;
    slots.push({
      key: `${job.id}:self`,
      jobId: job.id,
      opId: null,
      opIndex: null,
      isOperation: false,
      isChainSegment: false,
      isFirstSlot: true,
      isLastSlot: true,
      slotCount: 1,
      machine,
      machineId,
      startMs: effStart,
      endMs: effEnd,
      hours: Math.max(0, effEnd - effStart) / 3_600_000,
      operator: job.operator,
      operatorId: job.operatorId ?? null,
      job,
    });
  }

  return slots;
}
