import type { jsPDF } from 'jspdf';
import type { ShiftDefinition, ShiftScheduleRecord } from './ShiftsContext';
import { dominantShift } from './rotation';

/**
 * Professional shift-schedule PDF.
 *
 * This deliberately does *not* rasterise the on-screen planner (html2canvas +
 * image) the way the Gantt export does. Instead it draws the document straight
 * onto the PDF page with jsPDF's vector text/line API, so the output is real
 * selectable text with true font kerning and crisp hairline rules at any zoom —
 * a genuinely typeset document rather than a screenshot of the UI.
 *
 * The layout follows classic report/LaTeX conventions rather than web ones:
 * generous fixed margins, a serif body, letter-spaced small-caps labels, and a
 * "booktabs" table — thick rule above and below, a thin rule under the header
 * row, and no vertical rules at all. One A4-landscape sheet per week.
 *
 * The document is set in Tinos (metric-compatible with Times New Roman). It is
 * embedded rather than using jsPDF's built-in Times because the standard-14
 * fonts are WinAnsi-encoded and cannot render Croatian letters (č ć ž š đ) — a
 * hard requirement for worker names. The subset font is lazy-loaded so it only
 * costs bandwidth when someone actually exports a PDF.
 */

const FONT = 'Tinos';

async function registerFonts(doc: jsPDF) {
  // The VFS is per-document in jsPDF, so the subset must be registered on every
  // doc. The base64 module itself is a cached dynamic import.
  const { tinosRegular, tinosBold, tinosItalic } = await import('./fonts/tinos');
  doc.addFileToVFS('Tinos-Regular.ttf', tinosRegular);
  doc.addFont('Tinos-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('Tinos-Bold.ttf', tinosBold);
  doc.addFont('Tinos-Bold.ttf', FONT, 'bold');
  doc.addFileToVFS('Tinos-Italic.ttf', tinosItalic);
  doc.addFont('Tinos-Italic.ttf', FONT, 'italic');
}

// A4 landscape, in millimetres.
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN_X = 16;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 15;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

// Ink palette — restrained, print-appropriate. Body is near-black rather than
// pure black, which reads softer on paper, matching how TeX renders.
const INK = { r: 24, g: 28, b: 36 };
const MUTED = { r: 108, g: 116, b: 130 };
const HAIRLINE = { r: 176, g: 184, b: 196 };
const RULE = { r: 24, g: 28, b: 36 };
const WEEKEND_FILL = { r: 244, g: 246, b: 249 };
const ZEBRA_FILL = { r: 250, g: 251, b: 252 };

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Detect a raster data URL jsPDF can embed (SVG and unknown types are skipped). */
function rasterFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' | null {
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return null;
}

function docStamp() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}.`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time}`;
}

export interface ShiftPdfInput {
  schedules: ShiftScheduleRecord[];
  /** Ordered worker ids to render as rows (already filtered to the participants). */
  participantIds: number[];
  /** Number of day columns (5 for Mon–Fri, 7 with the weekend toggle on). */
  dayCount: number;
  lang: 'hr' | 'en';
  /** Data-URL logo, or null. SVG logos are ignored (jsPDF can't embed vector). */
  logo: string | null;
  /** Company / letterhead line beside the logo. */
  companyName?: string;
  /** The person generating the document — printed as "prepared by". */
  preparedBy?: string;
  workerName: (id: number) => string;
  /** Grouping key (e.g. trade / role) used only to order and visually separate
   *  workers with a divider rule — never printed on the document. */
  workerGroup?: (id: number) => string;
  /** Printable name for a group key, or null to keep the silent-divider
   *  behaviour. An unlabelled rule is fine for separating trades, but the
   *  fixed-shift vs rotating split is meaningless unless it is named. */
  groupLabel?: (group: string) => string | null;
  /** Shift lanes present in a given schedule (regular + any retired lane still used). */
  lanesFor: (schedule: ShiftScheduleRecord) => ShiftDefinition[];
  /** Localised weekly-hours total for a worker within a schedule. */
  weeklyHours: (schedule: ShiftScheduleRecord, workerId: number) => number;
  definitionById: Map<number, ShiftDefinition>;
}

const L = {
  hr: {
    title: 'RASPORED SMJENA',
    docName: 'Raspored smjena',
    plant: 'Proizvodni pogon',
    week: 'tjedan',
    weekAbbr: 'Tj.',
    weeksLabel: 'Tjedni',
    partial: 'Djelomično',
    workersOf: 'radnika',
    department: 'Odjel',
    plantLabel: 'Pogon',
    docLabel: 'Dokument',
    createdLabel: 'Izrađeno',
    byLabel: 'Izradio',
    status: 'Status',
    published: 'Objavljeno',
    draft: 'Nacrt',
    worker: 'Radnik',
    hours: 'Sati',
    off: '—',
    legend: 'Legenda smjena',
    exceptionNote: 'Jedan blok = smjena za cijeli tjedan. Tjedan s odstupanjem (zamjena, izostanak, nepotpun tjedan) ima traku po danima ispod bloka; prazan kvadratić = radnik taj dan nije raspoređen.',
    footnote: 'Treća smjena se ne planira. Noćni rad evidentira se kao prekovremeni sati radnika.',
    preparedBy: 'Izradio',
    approvedBy: 'Odobrio',
    placeDate: 'Mjesto i datum',
    page: 'Stranica',
    of: 'od',
  },
  en: {
    title: 'SHIFT SCHEDULE',
    docName: 'Shift schedule',
    plant: 'Production plant',
    week: 'week',
    weekAbbr: 'Wk',
    weeksLabel: 'Weeks',
    partial: 'Partial',
    workersOf: 'workers',
    department: 'Department',
    plantLabel: 'Facility',
    docLabel: 'Document',
    createdLabel: 'Created',
    byLabel: 'Prepared by',
    status: 'Status',
    published: 'Published',
    draft: 'Draft',
    worker: 'Worker',
    hours: 'Hours',
    off: '—',
    legend: 'Shift legend',
    exceptionNote: 'One block = the shift for the whole week. A week that deviates (override, absence, partial week) carries a per-day strip beneath the block; a hollow square means the worker is not scheduled that day.',
    footnote: 'The third shift is not scheduled. Overnight work is logged as the worker’s overtime.',
    preparedBy: 'Prepared by',
    approvedBy: 'Approved by',
    placeDate: 'Place and date',
    page: 'Page',
    of: 'of',
  },
} as const;

/** Draw a short line of letter-spaced small-caps-style label text; returns its width. */
function label(doc: jsPDF, text: string, x: number, y: number, sizePt: number, color: Rgb) {
  doc.setFont(FONT, 'bold');
  doc.setFontSize(sizePt);
  doc.setTextColor(color.r, color.g, color.b);
  doc.setCharSpace(0.4);
  doc.text(text.toUpperCase(), x, y);
  const width = doc.getTextWidth(text.toUpperCase()) + 0.4 * (text.length - 1);
  doc.setCharSpace(0);
  return width;
}

function setDraw(doc: jsPDF, c: Rgb) { doc.setDrawColor(c.r, c.g, c.b); }
function setFill(doc: jsPDF, c: Rgb) { doc.setFillColor(c.r, c.g, c.b); }
function setInk(doc: jsPDF, c: Rgb) { doc.setTextColor(c.r, c.g, c.b); }

function drawPageFooter(doc: jsPDF, lang: 'hr' | 'en', pageNo: number, totalPages: number) {
  const t = L[lang];
  const y = PAGE_H - MARGIN_BOTTOM + 8;
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y - 3.5, PAGE_W - MARGIN_X, y - 3.5);
  doc.setFont(FONT, 'italic');
  doc.setFontSize(8);
  setInk(doc, MUTED);
  doc.text('DravaInt', MARGIN_X, y);
  const pageText = `${t.page} ${pageNo} ${t.of} ${totalPages}`;
  doc.text(pageText, PAGE_W - MARGIN_X - doc.getTextWidth(pageText), y);
}

/** Letterhead logo bounding box, in mm. The letterhead is logo-only, so this is
 *  the whole company mark on the sheet and it is sized to read as one. */
const LOGO_BOX = 60;
/** Monogram tile side. The fallback mark is typographic, so it does NOT want the
 *  full 60 mm — a 60 mm ink square would overwhelm the page. */
const MONOGRAM_BOX = 26;

/** Company logo top-left, or a typographic monogram tile if none is set.
 *  Returns the height actually drawn so the header can lay out beneath it —
 *  a wide logo scaled to the box width occupies far less than the box height. */
function drawLogo(doc: jsPDF, input: ShiftPdfInput, x: number, y: number): number {
  const format = input.logo ? rasterFormat(input.logo) : null;
  if (input.logo && format) {
    try {
      const props = doc.getImageProperties(input.logo);
      // Fit within the box, preserving aspect ratio.
      let w = LOGO_BOX;
      let h = (props.height / props.width) * w;
      if (h > LOGO_BOX) { h = LOGO_BOX; w = (props.width / props.height) * h; }
      doc.addImage(input.logo, format, x, y, w, h);
      return h;
    } catch {
      // Fall through to the monogram if the logo can't be embedded.
    }
  }
  // Monogram tile: initials of the company name on a solid ink square. Reads as
  // a deliberate mark rather than a missing-image box.
  const initials = (input.companyName ?? 'DravaInt')
    .split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'DI';
  setFill(doc, INK);
  doc.rect(x, y, MONOGRAM_BOX, MONOGRAM_BOX, 'F');
  doc.setFont(FONT, 'bold');
  doc.setFontSize(19);
  doc.setTextColor(255, 255, 255);
  const tw = doc.getTextWidth(initials);
  doc.text(initials, x + MONOGRAM_BOX / 2 - tw / 2, y + MONOGRAM_BOX / 2 + 3.3);
  return MONOGRAM_BOX;
}

/**
 * A bordered "title block" — the kind on controlled factory documents and
 * engineering drawings — stating what the document is, when it was created, by
 * whom, and its approval status. Anchored top-right.
 */
export function titleBlockRows(
  lang: 'hr' | 'en',
  statusText: string,
  department: string,
  preparedBy?: string,
): Array<[string, string]> {
  const t = L[lang];
  return [
    // Facility first: what plant → what document → when → who → status.
    [t.plantLabel, `${t.plant} - ${department}`],
    [t.docLabel, t.docName],
    [t.createdLabel, docStamp()],
    [t.byLabel, preparedBy?.trim() || '—'],
    [t.status, statusText],
  ];
}

function drawTitleBlock(
  doc: jsPDF,
  input: ShiftPdfInput,
  statusText: string,
  department: string,
  x: number,
  y: number,
  w: number,
) {
  const rows = titleBlockRows(input.lang, statusText, department, input.preparedBy);
  const rowH = 6.6;
  const labelW = 26;
  const height = rowH * rows.length;

  rows.forEach(([key, value], index) => {
    const rowY = y + index * rowH;
    // Label cell tint.
    setFill(doc, WEEKEND_FILL);
    doc.rect(x, rowY, labelW, rowH, 'F');
    // Label.
    doc.setFont(FONT, 'bold');
    doc.setFontSize(6.4);
    setInk(doc, MUTED);
    doc.setCharSpace(0.3);
    doc.text(key.toUpperCase(), x + 2, rowY + rowH / 2 + 1.1);
    doc.setCharSpace(0);
    // Value.
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.6);
    setInk(doc, INK);
    let value2 = value;
    while (doc.getTextWidth(value2) > w - labelW - 4 && value2.length > 2) value2 = `${value2.slice(0, -2)}…`;
    doc.text(value2, x + labelW + 2.5, rowY + rowH / 2 + 1.1);
    // Inner horizontal separators.
    if (index > 0) {
      setDraw(doc, HAIRLINE);
      doc.setLineWidth(0.2);
      doc.line(x, rowY, x + w, rowY);
    }
  });

  // Vertical divider between label and value columns.
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(x + labelW, y, x + labelW, y + height);
  // Outer border.
  setDraw(doc, RULE);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, height);
  return height;
}

const DM = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Aggregate approval status across the weeks shown on the sheet. */
function statusFor(weeks: ShiftScheduleRecord[], lang: 'hr' | 'en'): string {
  const t = L[lang];
  const published = weeks.filter((w) => w.status === 'published').length;
  if (published === weeks.length) return t.published;
  if (published === 0) return t.draft;
  return `${t.partial} · ${published}/${weeks.length}`;
}

/** Title-bar range descriptor, e.g. "Tjedni 29–32 · 13.07.—08.08.2026." */
function rangeFor(weeks: ShiftScheduleRecord[], lang: 'hr' | 'en'): string {
  const t = L[lang];
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const dates = `${DM(first.startDate)} — ${DM(last.endDate)}${last.year}.`;
  if (weeks.length === 1) return `${first.weekNumber}. ${t.week}   ·   ${dates}`;
  return `${t.weeksLabel} ${first.weekNumber}–${last.weekNumber}   ·   ${dates}`;
}

/**
 * Render the header band (letterhead + title + document title block) and return
 * the y where body content should begin. Spans all the weeks on this sheet.
 */
function drawHeader(doc: jsPDF, input: ShiftPdfInput, weeks: ShiftScheduleRecord[], rosterCount: number): number {
  const t = L[input.lang];
  const y = MARGIN_TOP;

  // --- Letterhead: logo only, left ---
  // No company-name text line: the logo is the letterhead. `companyName` is
  // still used for the monogram fallback in drawLogo and for PDF metadata.
  const logoH = drawLogo(doc, input, MARGIN_X, y);

  // --- Document title block, right ---
  // The plant/department identity now lives in the block's first row.
  const blockW = 86;
  const blockH = drawTitleBlock(
    doc,
    input,
    statusFor(weeks, input.lang),
    weeks[0].department,
    PAGE_W - MARGIN_X - blockW,
    y,
    blockW,
  );

  // --- Document title + range, BESIDE the logo ---
  // Stacking the title under the logo cost ~20 mm of sheet height once the logo
  // was enlarged, which pushed a roster row onto a second page. The gutter is
  // the logo BOX width (not the drawn width) so the title's left edge stays put
  // whatever the logo's aspect ratio; the pair is centred on the logo's actual
  // height so a short wide logo doesn't leave the title floating.
  const textX = MARGIN_X + LOGO_BOX + 8;
  const titleY = y + Math.max(logoH / 2, 9) + 1;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(21);
  setInk(doc, INK);
  doc.text(t.title, textX, titleY);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(10.5);
  setInk(doc, MUTED);
  doc.text(`${rangeFor(weeks, input.lang)}   ·   ${rosterCount} ${t.workersOf}`, textX, titleY + 6);

  // The rule clears whichever runs deepest: the logo, the title block, or the
  // range line.
  const ruleY = Math.max(y + logoH, y + blockH, titleY + 6) + 5;
  // Letterhead rule: heavy rule + hairline just beneath — reads as "official".
  setDraw(doc, RULE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN_X, ruleY, PAGE_W - MARGIN_X, ruleY);
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, ruleY + 1, PAGE_W - MARGIN_X, ruleY + 1);

  return ruleY + 6;
}

// ---- Multi-week roster grid ----
//
// The unit of scheduling in this department is the WORKER-WEEK: a worker holds
// one shift Monday to Friday and steps to the next shift the following week.
// The grid used to print one column per DAY, so a normal week was the same
// digit repeated five times — five columns to say one thing, and the weekly
// pattern (the point of the document) had to be inferred by eye.
//
// Now there is one column per week and one block per worker-week, matching the
// Rotation Board's model on screen. Days survive as the EXCEPTION mechanism:
// a week whose days do not all share one shift prints its dominant shift plus a
// per-day tick strip marking the days that differ, so overrides, absences and
// partial weeks are still faithfully representable. Uniform weeks print no
// ticks at all, which is what makes the exceptions visible.
//
// Week/uniformity are computed by src/shifts/rotation.ts — the same helpers the
// Rotation Board uses — so the sheet and the screen cannot disagree.

const NAME_W = 46;
/** Hours sub-column at the right of each week column. */
const WEEK_HOURS_W = 11;
const WEEK_TIER_H = 6;
const WEEK_DATE_TIER_H = 6;
const GRID_HEAD_H = WEEK_TIER_H + WEEK_DATE_TIER_H;
/** Tall enough for the shift block plus a tick strip on exception weeks. */
const BODY_ROW_H = 11;
const TICK_H = 2.2;
/** Height of a printed group heading row (fixed-shift vs rotating). */
const GROUP_LABEL_H = 6;
/** Vertical space the signature block occupies at the foot of the sheet. */
const SIGNATURE_BAND_H = 16;

interface WeekBlock {
  schedule: ShiftScheduleRecord;
  dates: string[];
  x: number;
  w: number;
}

function datesOf(schedule: ShiftScheduleRecord, dayCount: number): string[] {
  return Array.from({ length: dayCount }, (_, day) => {
    const d = new Date(`${schedule.startDate}T12:00:00`);
    d.setDate(d.getDate() + day);
    return d.toISOString().slice(0, 10);
  });
}

/** Shift definitions in play across all weeks, ordered by start time — index+1
 *  is the code printed in cells and the legend, stable across the whole sheet. */
function orderedShiftDefs(input: ShiftPdfInput, weeks: ShiftScheduleRecord[]): ShiftDefinition[] {
  const defs = new Map<number, ShiftDefinition>();
  weeks.forEach((week) => input.lanesFor(week).forEach((def) => defs.set(def.id, def)));
  return [...defs.values()].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id - b.id);
}

/** Roster present in any week, grouped by the (unprinted) group key so members
 *  of a trade sit together; a divider rule separates groups on the page. */
function buildRoster(input: ShiftPdfInput, weeks: ShiftScheduleRecord[]): Array<{ id: number; group: string }> {
  const present = input.participantIds.filter((id) =>
    weeks.some((week) => week.assignments.some((a) => a.workerId === id)));
  return present
    .map((id, order) => ({ id, group: input.workerGroup?.(id) ?? '', order }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order)
    .map(({ id, group }) => ({ id, group }));
}

interface WeekCell {
  /** The week's shift, or null when the worker has no assignments that week. */
  definition: ShiftDefinition | null;
  /** True when every date in the block carries the same shift. */
  uniform: boolean;
  /** Per-date shift, null where the worker is not scheduled (off/absent). */
  days: Array<ShiftDefinition | null>;
}

/**
 * Collapse a worker's week into one printable block.
 *
 * `uniform` is stricter than rotation.isUniformWeek: a week that is missing a
 * day (an absence, or a partial week) is NOT uniform here even though the days
 * it does have agree, because the sheet must show that the week is incomplete.
 */
function weekCellFor(input: ShiftPdfInput, block: WeekBlock, workerId: number, order: number[]): WeekCell {
  const mine = block.schedule.assignments.filter((a) => a.workerId === workerId);
  const days = block.dates.map((date) => {
    const assignment = mine.find((a) => a.date === date);
    return assignment ? input.definitionById.get(assignment.shiftDefinitionId) ?? null : null;
  });
  const dominantId = dominantShift(mine, workerId, order);
  const definition = dominantId == null ? null : input.definitionById.get(dominantId) ?? null;
  const uniform = days.every((d) => d !== null && d.id === definition?.id);
  return { definition, uniform, days };
}

/**
 * A full-width tinted band naming a roster group (fixed-shift vs rotating).
 * Spans the whole table rather than sitting inside the name column: the label
 * is longer than the 46 mm name column, so confining it there ran the text
 * across the first vertical rule.
 */
function drawGroupHeading(doc: jsPDF, heading: string, y: number, tableRight: number) {
  setFill(doc, WEEKEND_FILL);
  doc.rect(MARGIN_X, y, tableRight - MARGIN_X, GROUP_LABEL_H, 'F');
  label(doc, heading, MARGIN_X + 2, y + 4.1, 6.6, MUTED);
}

/** Vertical hairlines separating the name column and each week block. */
function drawVerticals(doc: jsPDF, blocks: WeekBlock[], yTop: number, yBottom: number) {
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X + NAME_W, yTop, MARGIN_X + NAME_W, yBottom);
  blocks.forEach((b) => doc.line(b.x + b.w, yTop, b.x + b.w, yBottom));
}

function drawGridHeader(doc: jsPDF, input: ShiftPdfInput, blocks: WeekBlock[], y: number): number {
  const t = L[input.lang];
  const tableRight = blocks[blocks.length - 1].x + blocks[blocks.length - 1].w;
  const lastDay = blocks[0].dates.length - 1;

  // Booktabs top rule.
  setDraw(doc, RULE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, tableRight, y);

  // Worker column label, vertically centred across both tiers.
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  setInk(doc, INK);
  doc.setCharSpace(0.3);
  doc.text(t.worker.toUpperCase(), MARGIN_X + 2, y + GRID_HEAD_H / 2 + 1);
  doc.setCharSpace(0);

  blocks.forEach((block) => {
    const cx = block.x + (block.w - WEEK_HOURS_W) / 2;
    // Tier 1: the week number, which is the column's identity.
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.4);
    setInk(doc, INK);
    doc.setCharSpace(0.2);
    const week = `${t.weekAbbr} ${block.schedule.weekNumber}`;
    doc.text(week, cx - doc.getTextWidth(week) / 2, y + 4.3);
    doc.setCharSpace(0);

    // Tier 2: the dates the week covers.
    doc.setFont(FONT, 'normal');
    doc.setFontSize(6.8);
    setInk(doc, MUTED);
    const range = `${DM(block.dates[0])}–${DM(block.dates[lastDay])}`;
    doc.text(range, cx - doc.getTextWidth(range) / 2, y + WEEK_TIER_H + 4.2);

    // Hours sub-column header ("h" is understood in both languages).
    const hx = block.x + block.w - WEEK_HOURS_W / 2;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    setInk(doc, MUTED);
    doc.text('h', hx - doc.getTextWidth('h') / 2, y + WEEK_TIER_H + 4.2);
  });

  // Thin rule between the week tier and the date tier.
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X + NAME_W, y + WEEK_TIER_H, tableRight, y + WEEK_TIER_H);

  const bottom = y + GRID_HEAD_H;
  setDraw(doc, RULE);
  doc.setLineWidth(0.35);
  doc.line(MARGIN_X, bottom, tableRight, bottom);
  return bottom;
}

function drawGridRow(
  doc: jsPDF,
  input: ShiftPdfInput,
  blocks: WeekBlock[],
  codes: Map<number, number>,
  order: number[],
  workerId: number,
  rowNumber: number,
  y: number,
  zebra: boolean,
) {
  const tableRight = blocks[blocks.length - 1].x + blocks[blocks.length - 1].w;

  if (zebra) {
    setFill(doc, ZEBRA_FILL);
    doc.rect(MARGIN_X, y, tableRight - MARGIN_X, BODY_ROW_H, 'F');
  }

  const midY = y + BODY_ROW_H / 2 + 1.2;

  // Worker cell: row number (muted) + name (bold, the row's anchor). The group
  // is used only to order/separate rows and is never printed.
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.4);
  setInk(doc, MUTED);
  const idx = `${rowNumber}.`;
  doc.text(idx, MARGIN_X + 2, midY);
  const nameX = MARGIN_X + 2 + doc.getTextWidth(idx) + 2;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9.2);
  setInk(doc, INK);
  let name = input.workerName(workerId);
  while (doc.getTextWidth(name) > MARGIN_X + NAME_W - nameX - 1.5 && name.length > 4) name = `${name.slice(0, -2)}…`;
  doc.text(name, nameX, midY);

  // One block per worker-week, plus the weekly-hours total.
  blocks.forEach((block) => {
    const cell = weekCellFor(input, block, workerId, order);
    const cellX = block.x + 1.2;
    const cellW = block.w - WEEK_HOURS_W - 2.4;

    if (cell.definition) {
      const c = hexToRgb(cell.definition.color);
      // Tinted plate + a solid colour bar at the left edge. The bar survives
      // greyscale printing, where a 12% tint is nearly invisible.
      const plateY = y + 1.1;
      const plateH = BODY_ROW_H - (cell.uniform ? 2.2 : TICK_H + 3.2);
      doc.setFillColor(
        Math.round(255 - (255 - c.r) * 0.12),
        Math.round(255 - (255 - c.g) * 0.12),
        Math.round(255 - (255 - c.b) * 0.12),
      );
      doc.rect(cellX, plateY, cellW, plateH, 'F');
      doc.setFillColor(c.r, c.g, c.b);
      doc.rect(cellX, plateY, 1.3, plateH, 'F');

      // "1 · 06–14" — the code carries the colour, the times stay ink.
      const code = String(codes.get(cell.definition.id) ?? '•');
      const times = `${cell.definition.startTime.slice(0, 5)}–${cell.definition.endTime.slice(0, 5)}`;
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8.6);
      const codeW = doc.getTextWidth(code);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(7.4);
      const timesW = doc.getTextWidth(times);
      const gap = 1.8;
      const showTimes = codeW + gap + timesW + 5 <= cellW;
      const totalW = showTimes ? codeW + gap + timesW : codeW;
      const startX = cellX + 2.4 + Math.max(0, (cellW - 3.6 - totalW) / 2);
      const textY = plateY + plateH / 2 + 1.1;

      doc.setFont(FONT, 'bold');
      doc.setFontSize(8.6);
      doc.setTextColor(c.r, c.g, c.b);
      doc.text(code, startX, textY);
      if (showTimes) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(7.4);
        setInk(doc, INK);
        doc.text(times, startX + codeW + gap, textY);
      }

      // Exception strip: only on weeks that are not uniform, so its presence is
      // itself the signal that something deviates. One tick per date — filled in
      // that day's own shift colour, hollow where the worker is not scheduled.
      if (!cell.uniform) {
        const tickY = plateY + plateH + 1.1;
        const tickW = (cellW - (cell.days.length - 1) * 0.7) / cell.days.length;
        cell.days.forEach((day, di) => {
          const tx = cellX + di * (tickW + 0.7);
          if (day) {
            const dc = hexToRgb(day.color);
            doc.setFillColor(dc.r, dc.g, dc.b);
            doc.rect(tx, tickY, tickW, TICK_H, 'F');
          } else {
            setDraw(doc, HAIRLINE);
            doc.setLineWidth(0.2);
            doc.rect(tx, tickY, tickW, TICK_H);
          }
        });
      }
    } else {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      setInk(doc, HAIRLINE);
      const off = L[input.lang].off;
      doc.text(off, cellX + cellW / 2 - doc.getTextWidth(off) / 2, midY);
    }

    const hours = input.weeklyHours(block.schedule, workerId);
    const hoursTxt = hours > 0 ? String(hours) : '–';
    doc.setFont(FONT, hours > 0 ? 'bold' : 'normal');
    doc.setFontSize(8.4);
    setInk(doc, hours > 0 ? INK : HAIRLINE);
    doc.text(hoursTxt, block.x + block.w - 2 - doc.getTextWidth(hoursTxt), midY);
  });
}

/**
 * Lay the legend out and report how tall it is, without drawing.
 *
 * The footer used to flow downward from the bottom of the grid, which let it
 * run into the signature block once the legend wrapped or the how-to-read note
 * was added. Measuring first lets the footer be anchored to the bottom of the
 * sheet instead, so it can never collide, and the body gets every row that is
 * actually free above it.
 */
function measureFooter(doc: jsPDF, input: ShiftPdfInput, defs: ShiftDefinition[], codes: Map<number, number>): number {
  const t = L[input.lang];
  let rows = 1;
  let cursorX = MARGIN_X;
  defs.forEach((definition) => {
    const code = String(codes.get(definition.id) ?? '•');
    const name = input.lang === 'hr' ? definition.nameHr : definition.nameEn;
    const text = `${name} · ${definition.startTime}–${definition.endTime}`;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    const chunkW = doc.getTextWidth(code) + 2.5 + doc.getTextWidth(text) + 11;
    if (cursorX + chunkW > PAGE_W - MARGIN_X) { cursorX = MARGIN_X; rows += 1; }
    cursorX += chunkW;
  });
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.4);
  const noteLines: string[] = doc.splitTextToSize(t.exceptionNote, CONTENT_W);
  // label + legend rows + note + gap + footnote
  return 5.5 + rows * 6 + 1 + noteLines.length * 3.4 + 5 + 4;
}

function drawLegendAndFootnote(doc: jsPDF, input: ShiftPdfInput, defs: ShiftDefinition[], codes: Map<number, number>, y: number) {
  const t = L[input.lang];

  label(doc, t.legend, MARGIN_X, y, 7.5, MUTED);
  let cursorY = y + 5.5;
  let cursorX = MARGIN_X;
  defs.forEach((definition) => {
    const code = String(codes.get(definition.id) ?? '•');
    const name = input.lang === 'hr' ? definition.nameHr : definition.nameEn;
    const text = `${name} · ${definition.startTime}–${definition.endTime}`;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    const chunkW = doc.getTextWidth(code) + 2.5 + doc.getTextWidth(text) + 11;
    if (cursorX + chunkW > PAGE_W - MARGIN_X) { cursorX = MARGIN_X; cursorY += 6; }
    // Colour-coded number, then the shift name and times.
    const c = hexToRgb(definition.color);
    doc.setTextColor(c.r, c.g, c.b);
    doc.text(code, cursorX, cursorY);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    setInk(doc, INK);
    doc.text(text, cursorX + doc.getTextWidth(code) + 2.5, cursorY);
    cursorX += chunkW;
  });

  // How to read a week block — the grid is week-grain, which is not the
  // convention a reader arrives with, so it is spelled out once.
  cursorY += 6.5;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(7.4);
  setInk(doc, MUTED);
  const noteLines: string[] = doc.splitTextToSize(t.exceptionNote, CONTENT_W);
  doc.text(noteLines, MARGIN_X, cursorY);
  // Advance by the note's ACTUAL height — it wraps to two lines in Croatian, and
  // a fixed step would drop the footnote on top of it.
  cursorY += noteLines.length * 3.4;

  // Footnote.
  cursorY += 5;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(8.5);
  setInk(doc, MUTED);
  doc.text(t.footnote, MARGIN_X, cursorY);
}

function drawSignatures(doc: jsPDF, input: ShiftPdfInput) {
  const t = L[input.lang];
  const sigY = PAGE_H - MARGIN_BOTTOM - 6;
  const colW = 78;
  const gap = 14;
  const preparer = input.preparedBy?.trim();

  if (preparer) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    setInk(doc, INK);
    doc.text(preparer, MARGIN_X, sigY - 1.6);
  }

  setDraw(doc, INK);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, sigY, MARGIN_X + colW, sigY);
  doc.line(MARGIN_X + colW + gap, sigY, MARGIN_X + colW * 2 + gap, sigY);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  setInk(doc, MUTED);
  doc.text(t.preparedBy, MARGIN_X, sigY + 4);
  doc.text(t.approvedBy, MARGIN_X + colW + gap, sigY + 4);
}

function renderDocument(doc: jsPDF, input: ShiftPdfInput) {
  const dayCount = input.dayCount;
  const weeks = [...input.schedules].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const roster = buildRoster(input, weeks);
  const defs = orderedShiftDefs(input, weeks);
  const codes = new Map(defs.map((def, index) => [def.id, index + 1]));

  // How many week-blocks fit across the sheet, and how wide each is once the
  // available width is shared out (kept within sensible min/max bounds).
  const availW = CONTENT_W - NAME_W;
  // A week column has to hold "1 · 06–14" plus the hours cell. Below the minimum
  // the times are dropped and only the shift code prints, which still reads.
  const minBlockW = 21 + WEEK_HOURS_W;
  const maxBlockW = 34 + WEEK_HOURS_W;
  const weeksPerPage = Math.max(1, Math.floor(availW / minBlockW));

  const chunks: ShiftScheduleRecord[][] = [];
  for (let i = 0; i < weeks.length; i += weeksPerPage) chunks.push(weeks.slice(i, i + weeksPerPage));
  if (chunks.length === 0) chunks.push(weeks);

  let firstPage = true;
  chunks.forEach((chunkWeeks) => {
    const blockW = Math.min(maxBlockW, Math.max(minBlockW, availW / chunkWeeks.length));
    const blocks: WeekBlock[] = chunkWeeks.map((schedule, i) => ({
      schedule,
      dates: datesOf(schedule, dayCount),
      x: MARGIN_X + NAME_W + i * blockW,
      w: blockW,
    }));
    const tableRight = blocks[blocks.length - 1].x + blocks[blocks.length - 1].w;
    // Reserve the footer's measured height plus the signature band, so the grid
    // stops above them instead of printing through them.
    const footerH = measureFooter(doc, input, defs, codes);
    const footerTop = PAGE_H - MARGIN_BOTTOM - SIGNATURE_BAND_H - footerH;
    const bodyLimit = footerTop - 4;

    const order = defs.map((d) => d.id);
    let rowStart = 0;
    do {
      if (!firstPage) doc.addPage('a4', 'landscape');
      firstPage = false;

      let y = drawHeader(doc, input, chunkWeeks, roster.length);
      const gridTop = y;
      y = drawGridHeader(doc, input, blocks, y);

      let prevGroup: string | null = null;
      let drawn = 0;
      while (rowStart < roster.length && y + BODY_ROW_H <= bodyLimit) {
        const { id, group } = roster[rowStart];
        if (prevGroup !== null && group !== prevGroup) {
          // Group divider. A bare rule reads fine for trades; when the caller
          // supplies a label (fixed-shift vs rotating) it is printed, because an
          // unnamed split tells the reader nothing.
          setDraw(doc, RULE);
          doc.setLineWidth(0.4);
          doc.line(MARGIN_X, y, tableRight, y);
          const heading = input.groupLabel?.(group) ?? null;
          if (heading) {
            if (y + GROUP_LABEL_H + BODY_ROW_H > bodyLimit) break;
            drawGroupHeading(doc, heading, y, tableRight);
            y += GROUP_LABEL_H;
          }
        } else if (prevGroup === null) {
          const heading = input.groupLabel?.(group) ?? null;
          if (heading) {
            if (y + GROUP_LABEL_H + BODY_ROW_H > bodyLimit) break;
            drawGroupHeading(doc, heading, y, tableRight);
            y += GROUP_LABEL_H;
          }
        }
        drawGridRow(doc, input, blocks, codes, order, id, rowStart + 1, y, drawn % 2 === 1);
        prevGroup = group;
        y += BODY_ROW_H;
        rowStart += 1;
        drawn += 1;
      }

      // Booktabs bottom rule + vertical separators over the whole grid.
      setDraw(doc, RULE);
      doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y, tableRight, y);
      drawVerticals(doc, blocks, gridTop, y);

      drawLegendAndFootnote(doc, input, defs, codes, footerTop);
      drawSignatures(doc, input);
    } while (rowStart < roster.length);
  });
}

/** Build the PDF document (without saving) so callers can save, preview, or test it. */
export async function buildShiftSchedulePdf(input: ShiftPdfInput): Promise<jsPDF> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const doc = new JsPdf({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  await registerFonts(doc);
  doc.setProperties({
    title: `${L[input.lang].title} — ${input.schedules.map((s) => `${s.weekNumber}/${s.year}`).join(', ')}`,
    subject: L[input.lang].title,
    creator: 'DravaInt',
    author: input.companyName ?? 'DravaInt',
  });

  const printable = input.schedules.filter((schedule) =>
    input.participantIds.some((workerId) => schedule.assignments.some((a) => a.workerId === workerId)));
  const schedules = printable.length ? printable : input.schedules;

  renderDocument(doc, { ...input, schedules });

  // Page numbers are stamped last, once the total is known.
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    drawPageFooter(doc, input.lang, page, total);
  }

  return doc;
}

/** Generate and download the shift-schedule PDF. */
export async function downloadShiftSchedulePdf(input: ShiftPdfInput) {
  const doc = await buildShiftSchedulePdf(input);
  const first = input.schedules[0];
  const name = first ? `raspored-smjena-${first.year}-t${first.weekNumber}` : 'raspored-smjena';
  doc.save(`${name}.pdf`);
}
