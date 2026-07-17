import type { jsPDF } from 'jspdf';
import type { ShiftDefinition, ShiftScheduleRecord } from './ShiftsContext';

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

function dayName(date: string, lang: 'hr' | 'en') {
  return new Date(`${date}T12:00:00`).toLocaleDateString(lang === 'hr' ? 'hr-HR' : 'en-US', { weekday: 'short' });
}

function isWeekend(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 || day === 6;
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
  /** Company / letterhead line under the logo. */
  companyName?: string;
  workerName: (id: number) => string;
  /** Shift lanes present in a given schedule (regular + any retired lane still used). */
  lanesFor: (schedule: ShiftScheduleRecord) => ShiftDefinition[];
  /** Localised weekly-hours total for a worker within a schedule. */
  weeklyHours: (schedule: ShiftScheduleRecord, workerId: number) => number;
  definitionById: Map<number, ShiftDefinition>;
}

const L = {
  hr: {
    title: 'RASPORED SMJENA',
    week: 'tjedan',
    department: 'Odjel',
    status: 'Status',
    published: 'Objavljeno',
    draft: 'Nacrt',
    generated: 'Dokument izrađen',
    workers: 'Radnika',
    worker: 'Radnik',
    hours: 'Sati',
    off: '—',
    legend: 'Legenda smjena',
    footnote: 'Treća smjena se ne planira. Noćni rad evidentira se kao prekovremeni sati radnika.',
    preparedBy: 'Izradio',
    approvedBy: 'Odobrio',
    page: 'Stranica',
    of: 'od',
  },
  en: {
    title: 'SHIFT SCHEDULE',
    week: 'week',
    department: 'Department',
    status: 'Status',
    published: 'Published',
    draft: 'Draft',
    generated: 'Document generated',
    workers: 'Workers',
    worker: 'Worker',
    hours: 'Hours',
    off: '—',
    legend: 'Shift legend',
    footnote: 'The third shift is not scheduled. Overnight work is logged as the worker’s overtime.',
    preparedBy: 'Prepared by',
    approvedBy: 'Approved by',
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

/**
 * Render the header band (letterhead + title + metadata) and return the y where
 * body content should begin.
 */
function drawHeader(doc: jsPDF, input: ShiftPdfInput, schedule: ShiftScheduleRecord, rosterCount: number): number {
  const t = L[input.lang];
  let y = MARGIN_TOP;

  // Logo, top-right, height-constrained. Placed first so the title can measure
  // the space that remains.
  const format = input.logo ? rasterFormat(input.logo) : null;
  if (input.logo && format) {
    try {
      const props = doc.getImageProperties(input.logo);
      const maxH = 15;
      const maxW = 52;
      let h = maxH;
      let w = (props.width / props.height) * h;
      if (w > maxW) { w = maxW; h = (props.height / props.width) * w; }
      doc.addImage(input.logo, format, PAGE_W - MARGIN_X - w, y, w, h);
    } catch {
      // A malformed logo shouldn't sink the whole document.
    }
  }

  // Company line + document title, left.
  setInk(doc, MUTED);
  label(doc, input.companyName ?? 'DravaInt', MARGIN_X, y + 3.5, 9, MUTED);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(23);
  setInk(doc, INK);
  doc.text(t.title, MARGIN_X, y + 13.5);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(11.5);
  setInk(doc, MUTED);
  const subtitle = `${schedule.weekNumber}. ${t.week} ${schedule.year}   ·   ${schedule.startDate} — ${schedule.endDate}`;
  doc.text(subtitle, MARGIN_X, y + 20);

  y += 25;

  // Letterhead rule: a heavy rule with a hairline just beneath it — a small
  // typographic flourish that reads as "official document".
  setDraw(doc, RULE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  setDraw(doc, HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y + 1, PAGE_W - MARGIN_X, y + 1);

  y += 7;

  // Metadata row: four label/value pairs spread across the measure.
  const meta: Array<[string, string]> = [
    [t.department, schedule.department],
    [t.status, `${schedule.status === 'published' ? t.published : t.draft} · v${schedule.version || 1}`],
    [t.workers, String(rosterCount)],
    [t.generated, docStamp()],
  ];
  const colW = CONTENT_W / meta.length;
  meta.forEach(([key, value], index) => {
    const x = MARGIN_X + index * colW;
    label(doc, key, x, y, 7.5, MUTED);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    setInk(doc, INK);
    doc.text(value, x, y + 5.5);
  });

  return y + 12;
}

interface Column { x: number; w: number; date?: string; label: string; sub?: string }

function buildColumns(dates: string[], lang: 'hr' | 'en'): Column[] {
  const nameW = 48;
  const hoursW = 20;
  const dayW = (CONTENT_W - nameW - hoursW) / dates.length;
  const t = L[lang];
  const cols: Column[] = [{ x: MARGIN_X, w: nameW, label: t.worker }];
  dates.forEach((date, index) => {
    cols.push({
      x: MARGIN_X + nameW + index * dayW,
      w: dayW,
      date,
      label: dayName(date, lang),
      sub: `${date.slice(8)}.${date.slice(5, 7)}.`,
    });
  });
  cols.push({ x: MARGIN_X + nameW + dates.length * dayW, w: hoursW, label: t.hours });
  return cols;
}

const HEADER_ROW_H = 11;
const BODY_ROW_H = 8.4;

function drawTableHeader(doc: jsPDF, cols: Column[], y: number): number {
  // Booktabs top rule.
  setDraw(doc, RULE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);

  // Weekend column tint runs the full header+intent height behind the labels.
  cols.forEach((col) => {
    if (col.date && isWeekend(col.date)) {
      setFill(doc, WEEKEND_FILL);
      doc.rect(col.x, y, col.w, HEADER_ROW_H, 'F');
    }
  });

  cols.forEach((col, index) => {
    const isName = index === 0;
    const isHours = index === cols.length - 1;
    const centreX = col.x + col.w / 2;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    setInk(doc, INK);
    doc.setCharSpace(0.3);
    if (isName) {
      doc.text(col.label.toUpperCase(), col.x + 2, y + 7);
    } else if (isHours) {
      const txt = col.label.toUpperCase();
      doc.text(txt, col.x + col.w - 2 - doc.getTextWidth(txt) - 0.3 * (txt.length - 1), y + 7);
    } else {
      const dayTxt = col.label.toUpperCase();
      doc.text(dayTxt, centreX - (doc.getTextWidth(dayTxt) + 0.3 * (dayTxt.length - 1)) / 2, y + 5);
      doc.setCharSpace(0);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      setInk(doc, MUTED);
      if (col.sub) doc.text(col.sub, centreX - doc.getTextWidth(col.sub) / 2, y + 9.2);
    }
    doc.setCharSpace(0);
  });

  const bottom = y + HEADER_ROW_H;
  // Thin rule under the header row.
  setDraw(doc, RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, bottom, PAGE_W - MARGIN_X, bottom);
  return bottom;
}

function drawRow(
  doc: jsPDF,
  input: ShiftPdfInput,
  schedule: ShiftScheduleRecord,
  cols: Column[],
  workerId: number,
  y: number,
  zebra: boolean,
) {
  const t = L[input.lang];
  if (zebra) {
    setFill(doc, ZEBRA_FILL);
    doc.rect(MARGIN_X, y, CONTENT_W, BODY_ROW_H, 'F');
  }
  // Weekend tint on top of zebra.
  cols.forEach((col) => {
    if (col.date && isWeekend(col.date)) {
      setFill(doc, WEEKEND_FILL);
      doc.rect(col.x, y, col.w, BODY_ROW_H, 'F');
    }
  });

  const midY = y + BODY_ROW_H / 2 + 1.3;

  // Worker name.
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9.5);
  setInk(doc, INK);
  let name = input.workerName(workerId);
  // Guard against a name overrunning its column.
  while (doc.getTextWidth(name) > cols[0].w - 4 && name.length > 4) name = `${name.slice(0, -2)}…`;
  doc.text(name, cols[0].x + 2, midY);

  // Day cells.
  cols.slice(1, -1).forEach((col) => {
    const assignment = schedule.assignments.find((item) => item.workerId === workerId && item.date === col.date);
    const definition = assignment ? input.definitionById.get(assignment.shiftDefinitionId) : undefined;
    const centreX = col.x + col.w / 2;
    if (definition) {
      const swatch = hexToRgb(definition.color);
      // Colour swatch dot.
      setFill(doc, swatch);
      doc.circle(col.x + 3.4, y + BODY_ROW_H / 2, 1.15, 'F');
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8.5);
      setInk(doc, INK);
      const timeTxt = `${definition.startTime}–${definition.endTime}`;
      doc.text(timeTxt, centreX - doc.getTextWidth(timeTxt) / 2 + 1.6, midY);
    } else {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(9);
      setInk(doc, HAIRLINE);
      doc.text(t.off, centreX - doc.getTextWidth(t.off) / 2, midY);
    }
  });

  // Hours (tabular).
  const hoursCol = cols[cols.length - 1];
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9.5);
  setInk(doc, INK);
  const hoursTxt = `${input.weeklyHours(schedule, workerId)} h`;
  doc.text(hoursTxt, hoursCol.x + hoursCol.w - 2 - doc.getTextWidth(hoursTxt), midY);

  return y + BODY_ROW_H;
}

function drawLegendAndFootnote(doc: jsPDF, input: ShiftPdfInput, schedule: ShiftScheduleRecord, y: number) {
  const t = L[input.lang];
  const lanes = input.lanesFor(schedule);

  label(doc, t.legend, MARGIN_X, y, 7.5, MUTED);
  let cursorY = y + 5.5;
  let cursorX = MARGIN_X;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  lanes.forEach((definition) => {
    const name = input.lang === 'hr' ? definition.nameHr : definition.nameEn;
    const text = `${name} · ${definition.startTime}–${definition.endTime}`;
    const chunkW = 5 + doc.getTextWidth(text) + 10;
    if (cursorX + chunkW > PAGE_W - MARGIN_X) { cursorX = MARGIN_X; cursorY += 6; }
    setFill(doc, hexToRgb(definition.color));
    doc.circle(cursorX + 1.4, cursorY - 1.2, 1.15, 'F');
    setInk(doc, INK);
    doc.text(text, cursorX + 4, cursorY);
    cursorX += chunkW;
  });

  // Footnote.
  cursorY += 8;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(8.5);
  setInk(doc, MUTED);
  doc.text(t.footnote, MARGIN_X, cursorY);

  // Signature lines pinned near the bottom of the page.
  const sigY = PAGE_H - MARGIN_BOTTOM - 6;
  const half = CONTENT_W / 2;
  setDraw(doc, INK);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, sigY, MARGIN_X + half - 20, sigY);
  doc.line(MARGIN_X + half, sigY, MARGIN_X + half * 2 - 20, sigY);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  setInk(doc, MUTED);
  doc.text(t.preparedBy, MARGIN_X, sigY + 4);
  doc.text(t.approvedBy, MARGIN_X + half, sigY + 4);
}

function renderSchedule(doc: jsPDF, input: ShiftPdfInput, schedule: ShiftScheduleRecord, isFirstPage: boolean) {
  const dates = Array.from({ length: input.dayCount }, (_, day) => {
    const d = new Date(`${schedule.startDate}T12:00:00`);
    d.setDate(d.getDate() + day);
    return d.toISOString().slice(0, 10);
  });
  const roster = input.participantIds.filter((workerId) =>
    schedule.assignments.some((assignment) => assignment.workerId === workerId));

  if (!isFirstPage) doc.addPage('a4', 'landscape');

  let y = drawHeader(doc, input, schedule, roster.length);
  const cols = buildColumns(dates, input.lang);
  y = drawTableHeader(doc, cols, y);

  // Reserve space for legend + signatures at the foot of the page.
  const bodyLimit = PAGE_H - MARGIN_BOTTOM - 34;

  roster.forEach((workerId, index) => {
    if (y + BODY_ROW_H > bodyLimit) {
      // Overflowed the sheet: close the current table and continue on a fresh
      // page with a repeated header. Rare, but keeps large crews intact.
      setDraw(doc, RULE);
      doc.setLineWidth(0.5);
      doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
      doc.addPage('a4', 'landscape');
      y = drawHeader(doc, input, schedule, roster.length);
      y = drawTableHeader(doc, cols, y);
    }
    y = drawRow(doc, input, schedule, cols, workerId, y, index % 2 === 1);
  });

  // Booktabs bottom rule.
  setDraw(doc, RULE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);

  drawLegendAndFootnote(doc, input, schedule, y + 10);
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

  schedules.forEach((schedule, index) => renderSchedule(doc, input, schedule, index === 0));

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
