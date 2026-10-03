// Parses the text of a Western Sydney University style subject outline:
// subject header, the weekly schedule table and the Assessment Summary table.

const SUBJECT_RE = /^\s*([A-Z]{4}\d{4})\s+(.+?)\s*$/;
const WEEK_ROW_RE = /^Week\s*(\d{1,2})\b\s*(.*)$/;
const DATE_RE = /(\d{2})-(\d{2})-(\d{4})/;

function parseSubject(lines) {
  for (const line of lines.slice(0, 15)) {
    const m = line.match(SUBJECT_RE);
    if (m) return { code: m[1], name: m[2] };
  }
  return { code: '', name: '' };
}

// Each schedule row starts with "Week N" and the Monday date follows on the
// next line; the row continues until the next "Week M" line.
function parseSchedule(lines) {
  const rows = new Map();
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(WEEK_ROW_RE);
    if (m) {
      const week = Number(m[1]);
      const next = lines[i + 1] || '';
      const d = (m[2].match(DATE_RE) || next.match(DATE_RE));
      if (d) {
        current = { week, date: `${d[3]}-${d[2]}-${d[1]}`, text: m[2] };
        if (!rows.has(week)) rows.set(week, current);
        else current = rows.get(week);
        continue;
      }
    }
    if (!current) continue;
    if (line === '\f' || /timetable should be used as a guide/i.test(line) || /^Teaching\s+Topic/.test(line)) {
      current = null;
      continue;
    }
    current.text += '\n' + line.replace(DATE_RE, '');
  }
  return [...rows.values()].sort((a, b) => a.week - b.week);
}

function mentionsIn(text) {
  const out = [];
  const re = /(?:^|\s)-\s+([A-Z][A-Za-z0-9&,'’ ]*?[A-Za-z0-9])(?=\s{2,}|\s+-\s|\s*$)/gm;
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}

function addDays(iso, days) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function parseSummary(lines) {
  const start = lines.findIndex((l) => /^Item\s+Weight\s+Due Date/.test(l));
  if (start < 0) return [];
  const items = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '\f' || /^Feedback on Assessment/.test(line) || /^\d+(\.\d+)*\s{2,}[A-Z]/.test(line)) break;
    const row = line.match(/^(.+?)\s{2,}(\d{1,3}\s?%)\s+(.*)$/);
    if (row) {
      cur = { title: row[1].trim(), weight: row[2].replace(/\s/g, ''), due: firstCell(row[3]) };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    // A lone number just before a page break is the page number.
    if (/^\d+$/.test(line.trim()) && (lines[i + 1] === '\f' || lines[i + 1] === undefined)) continue;
    cur.due = (cur.due + ' ' + firstCell(line)).trim();
  }
  return items;
}

function firstCell(text) {
  const cell = text.split(/\s{3,}/)[0].trim();
  // Drop trailing SLO/Yes/No residue that sits in the same cell.
  return cell.replace(/\s+(Yes|No)(\s+(Yes|No))?$/, '').trim();
}

// Fallback when there is no summary table: "3.2.x Title" blocks with Weight:/Due:.
function parseDetailBlocks(lines) {
  const items = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^3\.2\.\d+\s+(.+)$/);
    if (h) {
      cur = { title: h[1].trim(), weight: '', due: '' };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    const w = line.match(/Weight:\s*(\d{1,3}%)/);
    if (w && !cur.weight) cur.weight = w[1];
    const d = line.match(/Due:\s*(.+)$/);
    if (d && !cur.due) cur.due = d[1].trim();
  }
  return items.filter((it) => it.weight);
}

function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseOutline(lines) {
  const subject = parseSubject(lines);
  const schedule = parseSchedule(lines);
  const weekMap = {};
  for (const r of schedule) weekMap[r.week] = r.date;

  const breakWeeks = schedule.filter((r) => /\bbreak\b/i.test(r.text)).map((r) => r.week);
  const stuvac = schedule.find((r) => /STUVAC/i.test(r.text));
  const examRow = schedule.find((r) => /final exam|examination period/i.test(r.text) && (!stuvac || r.week > stuvac.week));
  const lastWeek = schedule.length ? schedule[schedule.length - 1] : null;
  let examPeriod = null;
  const examStartWeek = stuvac ? stuvac.week + 1 : examRow ? examRow.week : null;
  if (examStartWeek && weekMap[examStartWeek] && lastWeek) {
    examPeriod = { start: weekMap[examStartWeek], end: addDays(lastWeek.date, 6) };
  }
  const lastTeachingWeek = schedule.filter((r) => (stuvac ? r.week < stuvac.week : examStartWeek ? r.week < examStartWeek : true) && !breakWeeks.includes(r.week) && r.text.trim()).map((r) => r.week).pop() || null;

  let assessments = parseSummary(lines);
  if (!assessments.length) assessments = parseDetailBlocks(lines);

  for (const a of assessments) {
    const key = normalise(a.title);
    a.scheduleWeeks = schedule
      .filter((r) => mentionsIn(r.text).some((m) => normalise(m) === key))
      .map((r) => r.week);
  }

  // Class types come from the schedule header columns and the due-date wording.
  const header = lines.find((l) => /Assessment Due/.test(l) && /Topic/.test(l)) || '';
  const hints = header + ' ' + assessments.map((a) => a.title + ' ' + a.due).join(' ');
  const classTypes = ['Lecture'];
  if (/\btutorial/i.test(hints)) classTypes.push('Tutorial');
  if (/\bpractical|\bprac\b|\blab\b/i.test(hints)) classTypes.push('Practical');
  if (/\bworkshop/i.test(hints)) classTypes.push('Workshop');
  if (classTypes.length === 1) classTypes.push('Practical');

  return { ...subject, weekMap, breakWeeks, examPeriod, lastTeachingWeek, classTypes, assessments };
}

module.exports = { parseOutline, parseSchedule, parseSummary, mentionsIn, addDays };
