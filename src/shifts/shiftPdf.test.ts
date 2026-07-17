import { describe, expect, it } from 'vitest';
import { buildShiftSchedulePdf, type ShiftPdfInput } from './shiftPdf';
import type { ShiftDefinition, ShiftScheduleRecord } from './ShiftsContext';

const definitions: ShiftDefinition[] = [
  { id: 1, nameHr: 'Prva smjena', nameEn: 'First shift', startTime: '06:00', endTime: '14:00', color: '#2563eb', isActive: true },
  { id: 2, nameHr: 'Druga smjena', nameEn: 'Second shift', startTime: '14:00', endTime: '22:00', color: '#7c3aed', isActive: true },
];
const definitionById = new Map(definitions.map((d) => [d.id, d]));

const schedule: ShiftScheduleRecord = {
  id: 10,
  weekNumber: 29,
  year: 2026,
  startDate: '2026-07-13',
  endDate: '2026-07-19',
  department: 'Alatnica',
  status: 'published',
  version: 2,
  assignments: [
    { id: 1, scheduleId: 10, workerId: 1, shiftDefinitionId: 1, date: '2026-07-13', isOverride: false, notes: '' },
    { id: 2, scheduleId: 10, workerId: 1, shiftDefinitionId: 1, date: '2026-07-14', isOverride: false, notes: '' },
    { id: 3, scheduleId: 10, workerId: 2, shiftDefinitionId: 2, date: '2026-07-13', isOverride: true, notes: '' },
  ],
};

function makeInput(overrides: Partial<ShiftPdfInput> = {}): ShiftPdfInput {
  return {
    schedules: [schedule],
    participantIds: [1, 2],
    dayCount: 5,
    lang: 'hr',
    logo: null,
    workerName: (id) => (id === 1 ? 'Ivan Horvat' : 'Marko Kovač'),
    lanesFor: () => definitions,
    weeklyHours: (_s, id) => (id === 1 ? 16 : 8),
    definitionById,
    ...overrides,
  };
}

function pdfBytes(dataUri: string): Uint8Array {
  const base64 = dataUri.split(',')[1];
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

describe('buildShiftSchedulePdf', () => {
  it('produces a valid single-page PDF for one week', async () => {
    const doc = await buildShiftSchedulePdf(makeInput());
    expect(doc.getNumberOfPages()).toBe(1);
    const bytes = pdfBytes(doc.output('datauristring'));
    // %PDF- magic header.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    // Non-trivial content stream.
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it('renders one page per week', async () => {
    const second = { ...schedule, id: 11, weekNumber: 30, startDate: '2026-07-20', endDate: '2026-07-26' };
    const doc = await buildShiftSchedulePdf(makeInput({ schedules: [schedule, second] }));
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('adds two weekend columns when dayCount is 7', async () => {
    // Smoke test: a 7-day layout must still build without overflow errors.
    const doc = await buildShiftSchedulePdf(makeInput({ dayCount: 7 }));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('paginates a large crew onto extra sheets', async () => {
    const bigRoster = Array.from({ length: 40 }, (_, i) => i + 1);
    const assignments = bigRoster.map((workerId) => ({
      id: workerId, scheduleId: 10, workerId, shiftDefinitionId: 1, date: '2026-07-13', isOverride: false, notes: '',
    }));
    const doc = await buildShiftSchedulePdf(makeInput({
      schedules: [{ ...schedule, assignments }],
      participantIds: bigRoster,
      workerName: (id) => `Radnik ${id}`,
    }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
