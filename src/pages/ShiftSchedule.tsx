import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { IconRefresh, IconPrint } from '../components/Icons';

function formatDate(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${pad(d)}.${pad(m)}.${y}.`;
}

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

interface WeekCell {
  weekLabel: number;
  dateLabel: string;
  firstShift: string[];
  firstShiftExtra: string[];
  secondShiftWorker: string;
  secondShiftExtra: string[];
}

export default function ShiftSchedule() {
  const { t } = useLanguage();

  const [base, setBase] = useState('Božidar B.\nPerica B.\nNenad S.\nToni P.\nIvica B.');
  const [always1, setAlways1] = useState('Goran Ć.\nAlen M.\nDamir M.\nKrunoslav S.\nDorian T.');
  const [g1, setG1] = useState('Matej B.\nAnthony Đ.');
  const [g2, setG2] = useState('Tihomir M.\nDarko N.\nMatej P.');

  const [startWeek, setStartWeek] = useState(29);
  const [weekCount, setWeekCount] = useState(6);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [weeks, setWeeks] = useState<WeekCell[]>([]);

  const docDate = useMemo(() => formatDate(new Date()), []);

  function generateSchedule() {
    const rotatingBase = parseLines(base);
    const alwaysFirst = parseLines(always1);
    const group1 = parseLines(g1);
    const group2 = parseLines(g2);
    const baseWorkersList = [...rotatingBase, ...alwaysFirst];

    let currentDate = new Date(startDate);
    const result: WeekCell[] = [];

    for (let i = 0; i < weekCount; i++) {
      const ind2ShiftWorker = rotatingBase.length ? rotatingBase[i % rotatingBase.length] : '';
      const isGroup1In2nd = i % 2 === 0;
      const dateString = formatDate(currentDate);

      const firstShift = baseWorkersList.filter((w) => w !== ind2ShiftWorker);
      const firstShiftGroup = isGroup1In2nd ? group2 : group1;
      const secondShiftGroup = isGroup1In2nd ? group1 : group2;

      result.push({
        weekLabel: startWeek + i,
        dateLabel: dateString,
        firstShift,
        firstShiftExtra: firstShiftGroup,
        secondShiftWorker: ind2ShiftWorker,
        secondShiftExtra: secondShiftGroup,
      });

      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 7);
    }

    setWeeks(result);
  }

  useEffect(() => {
    generateSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: WeekCell[][] = [];
  for (let i = 0; i < weeks.length; i += 3) {
    rows.push(weeks.slice(i, i + 3));
  }

  function padRows(names: string[], min: number) {
    const padded = [...names];
    while (padded.length < min) padded.push('');
    return padded;
  }

  return (
    <>
      <div className="wizard-container">
        <h2 style={{ marginBottom: 5 }}>{t.shifts.wizardTitle}</h2>
        <p className="subtitle-text" style={{ margin: '0 0 20px 0', fontSize: 13 }}>
          {t.shifts.wizardSubtitle}
        </p>

        <div className="step-box">
          <div className="step-title">
            <span className="step-number">1</span>
            {t.shifts.step2}
          </div>
          <div className="grid-inputs workers-ruster">
            <div>
              <label>{t.shifts.base}</label>
              <textarea value={base} onChange={(e) => setBase(e.target.value)} />
            </div>
            <div>
              <label>{t.shifts.always1}</label>
              <textarea value={always1} onChange={(e) => setAlways1(e.target.value)} />
            </div>
            <div>
              <label>{t.shifts.g1}</label>
              <textarea value={g1} onChange={(e) => setG1(e.target.value)} />
            </div>
            <div>
              <label>{t.shifts.g2}</label>
              <textarea value={g2} onChange={(e) => setG2(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="step-box">
          <div className="step-title">
            <span className="step-number">2</span>
            {t.shifts.step3}
          </div>
          <div className="grid-inputs time-settings">
            <div>
              <label>{t.shifts.startWeek}</label>
              <input
                type="number"
                value={startWeek}
                onChange={(e) => setStartWeek(parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <label>{t.shifts.weekCount}</label>
              <input
                type="number"
                value={weekCount}
                onChange={(e) => setWeekCount(parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <label>{t.shifts.startDate}</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="action-bar">
          <button className="btn btn-green" onClick={generateSchedule}>
            <IconRefresh style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.common.calculate}
          </button>
          <div style={{ width: 10, height: 10 }} />
          <button className="btn btn-blue" onClick={() => window.print()}>
            <IconPrint style={{ marginRight: 6, verticalAlign: -3 }} />
            {t.common.print}
          </button>
        </div>
      </div>

      <div className="print-preview-scroll">
        <div className="print-document">
          <h1 className="doc-title">{t.shifts.docTitle}</h1>

          <table className="meta-table">
            <tbody>
              <tr>
                <td className="meta-label">{t.common.department.toUpperCase()}:</td>
                <td className="meta-value">{t.shifts.dept}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.documentDate.toUpperCase()}:</td>
                <td className="meta-value">{docDate}</td>
              </tr>
              <tr>
                <td className="meta-label">{t.common.createdBy.toUpperCase()}:</td>
                <td className="meta-value">{t.shifts.author}</td>
              </tr>
            </tbody>
          </table>

          <table className="grid-table">
            <tbody>
              {rows.map((row, rIdx) => (
                <Fragment key={`frag-${rIdx}`}>
                  <tr>
                    {row.map((week, cIdx) => {
                      const firstList = padRows(week.firstShift, 9);
                      const firstExtra = padRows(week.firstShiftExtra, 3);
                      const secondExtra = padRows(week.secondShiftExtra, 3);
                      return (
                        <td className="grid-td" key={cIdx}>
                          <div className="week-card">
                            <div className="week-title-block">
                              <div className="week-title">
                                {week.weekLabel}. {t.shifts.week}
                              </div>
                              <div className="week-date">
                                ({t.shifts.from} {week.dateLabel})
                              </div>
                            </div>

                            <div className="shift-header-band">{t.shifts.shift1}</div>
                            <table className="names-list-table">
                              <tbody>
                                {firstList.map((name, i) => (
                                  <tr key={`f${i}`}>
                                    <td>{name || ' '}</td>
                                  </tr>
                                ))}
                                <tr className="team-gap-row">
                                  <td>&nbsp;</td>
                                </tr>
                                {firstExtra.map((name, i) => (
                                  <tr key={`fe${i}`}>
                                    <td>{name || ' '}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            <div className="shift-header-band">{t.shifts.shift2}</div>
                            <table className="names-list-table">
                              <tbody>
                                <tr>
                                  <td>{week.secondShiftWorker || ' '}</td>
                                </tr>
                                {secondExtra.map((name, i) => (
                                  <tr key={`se${i}`}>
                                    <td>{name || ' '}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      );
                    })}
                    {row.length < 3 &&
                      Array.from({ length: 3 - row.length }).map((_, i) => (
                        <td className="grid-td" key={`empty-${i}`} />
                      ))}
                  </tr>
                  <tr>
                    <td colSpan={3} style={{ height: 15 }} />
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
