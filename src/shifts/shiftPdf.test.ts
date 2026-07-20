import { describe, expect, it } from 'vitest';
import { buildShiftSchedulePdf, titleBlockRows, type ShiftPdfInput } from './shiftPdf';
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

  it('packs several weeks onto a single sheet', async () => {
    const ranges = [['2026-07-20', '2026-07-26'], ['2026-07-27', '2026-08-02'], ['2026-08-03', '2026-08-09']];
    const more = ranges.map(([startDate, endDate], i) => ({
      ...schedule, id: 11 + i, weekNumber: 30 + i, startDate, endDate,
    }));
    const doc = await buildShiftSchedulePdf(makeInput({ schedules: [schedule, ...more] }));
    // Four 5-day weeks and a small roster fit side by side on one A4 landscape.
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('spreads too many weeks across extra sheets', async () => {
    // Ten weeks can't share one sheet's width; the generator paginates by week.
    const many = Array.from({ length: 10 }, (_, n) => ({
      ...schedule, id: 20 + n, weekNumber: 29 + n,
      startDate: '2026-07-13', endDate: '2026-07-19',
    }));
    const doc = await buildShiftSchedulePdf(makeInput({ schedules: many }));
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('adds two weekend columns when dayCount is 7', async () => {
    // Smoke test: a 7-day layout must still build without overflow errors.
    const doc = await buildShiftSchedulePdf(makeInput({ dayCount: 7 }));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('still builds with a company name set (metadata/monogram use only)', async () => {
    // companyName no longer prints on the letterhead, but it still feeds the
    // monogram fallback and PDF metadata, so the input contract is unchanged.
    const doc = await buildShiftSchedulePdf(makeInput({ companyName: 'Drava International d.o.o.' }));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('fits six weeks on one sheet at week grain', async () => {
    // A week column costs ~32mm instead of ~42mm for five day-columns, so the
    // sheet holds six weeks where it held five. The redesign's real gain is
    // legibility (one block per week, not five repeated digits) — the density
    // improvement is a modest side effect, not the headline.
    const many = Array.from({ length: 6 }, (_, n) => ({
      ...schedule, id: 40 + n, weekNumber: 29 + n,
      startDate: '2026-07-13', endDate: '2026-07-19',
    }));
    const doc = await buildShiftSchedulePdf(makeInput({ schedules: many }));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('still builds when a week contains per-day overrides and gaps', async () => {
    // The exception escape hatch: a worker whose week is NOT uniform (a mid-week
    // override plus a missing day) must still render, as a dominant block with a
    // per-day tick strip rather than being collapsed away.
    const mixed: ShiftScheduleRecord = {
      ...schedule,
      assignments: [
        { id: 1, scheduleId: 10, workerId: 1, shiftDefinitionId: 1, date: '2026-07-13', isOverride: false, notes: '' },
        { id: 2, scheduleId: 10, workerId: 1, shiftDefinitionId: 1, date: '2026-07-14', isOverride: false, notes: '' },
        // Overridden mid-week onto the second shift.
        { id: 3, scheduleId: 10, workerId: 1, shiftDefinitionId: 2, date: '2026-07-15', isOverride: true, notes: '' },
        // 2026-07-16 deliberately absent — an unscheduled day.
        { id: 4, scheduleId: 10, workerId: 1, shiftDefinitionId: 1, date: '2026-07-17', isOverride: false, notes: '' },
      ],
    };
    const doc = await buildShiftSchedulePdf(makeInput({ schedules: [mixed], participantIds: [1] }));
    expect(doc.getNumberOfPages()).toBe(1);
    expect(pdfBytes(doc.output('datauristring')).length).toBeGreaterThan(2000);
  });

  it('builds with a fixed-shift group split out from the rotating one', async () => {
    const doc = await buildShiftSchedulePdf(makeInput({
      workerGroup: (id) => (id === 1 ? '0-fixed' : '1-rotating'),
      groupLabel: (group) => (group === '0-fixed' ? 'Stalna smjena' : 'Rotacija'),
    }));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('leads the title block with a facility row built from the department', () => {
    const rows = titleBlockRows('hr', 'Objavljeno', 'Alatnica', 'Ivan');
    expect(rows[0]).toEqual(['Pogon', 'Proizvodni pogon - Alatnica']);
    // The department is data-driven, not hardcoded to Alatnica.
    expect(titleBlockRows('hr', 'Nacrt', 'Kontrola kvalitete')[0][1])
      .toBe('Proizvodni pogon - Kontrola kvalitete');
    expect(titleBlockRows('en', 'Draft', 'Alatnica')[0])
      .toEqual(['Facility', 'Production plant - Alatnica']);
    // The pre-existing rows still follow, in order.
    expect(rows.map(([label]) => label))
      .toEqual(['Pogon', 'Dokument', 'Izrađeno', 'Izradio', 'Status']);
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
