import type { JobPriority } from './SchedulingContext';

interface PriorityMeta {
  /** Higher rank = more urgent; used for sorting work orders. */
  rank: number;
  color: string;
  labelHr: string;
  labelEn: string;
}

export const PRIORITY_META: Record<JobPriority, PriorityMeta> = {
  low: { rank: 0, color: '#64748b', labelHr: 'Nizak', labelEn: 'Low' },
  normal: { rank: 1, color: '#2563eb', labelHr: 'Normalan', labelEn: 'Normal' },
  high: { rank: 2, color: '#f59e0b', labelHr: 'Visok', labelEn: 'High' },
  urgent: { rank: 3, color: '#dc2626', labelHr: 'Hitno', labelEn: 'Urgent' },
};

export function priorityMeta(priority: JobPriority | undefined): PriorityMeta {
  return PRIORITY_META[priority ?? 'normal'];
}

export function priorityLabel(priority: JobPriority | undefined, lang: string): string {
  const meta = priorityMeta(priority);
  return lang === 'hr' ? meta.labelHr : meta.labelEn;
}

export function priorityRank(priority: JobPriority | undefined): number {
  return priorityMeta(priority).rank;
}
