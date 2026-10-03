// Turns parsed assessments plus the user's class days into dated items.
// Dates are local ISO strings ("2026-10-11T23:59") with no timezone.

const { addDays } = require('./wsu');

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseTime(text) {
  let m = text.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
  if (m) {
    let h = Number(m[1]);
    if (m[3] && /pm/i.test(m[3]) && h < 12) h += 12;
    if (m[3] && /am/i.test(m[3]) && h === 12) h = 0;
    return pad(h) + ':' + m[2];
  }
  m = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[2])) h += 12;
    return pad(h) + ':00';
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function classTypesIn(text) {
  const types = [];
  if (/lecture|demonstration/i.test(text)) types.push('Lecture');
  if (/tutorial/i.test(text)) types.push('Tutorial');
  if (/workshop/i.test(text)) types.push('Workshop');
  if (/prac|lab/i.test(text)) types.push('Practical');
  return types;
}

// The due wording ("during the allocated prac class") wins over the title.
// With no class named at all, the first class is a guess worth reviewing.
function pickClass(classes, dueText, title) {
  const wanted = [...classTypesIn(dueText), ...classTypesIn(title)];
  for (const type of wanted) {
    const c = classes.find((x) => x.type === type);
    if (c) return { cls: c, guessed: false };
  }
  return { cls: wanted.length ? null : classes[0] || null, guessed: true };
}

function weeksIn(text) {
  const weeks = [];
  const re = /weeks?\s*((?:\d{1,2}(?:\s*(?:,|and|&)\s*(?:week\s*)?)?)+)/gi;
  let m;
  while ((m = re.exec(text))) {
    for (const n of m[1].match(/\d{1,2}/g) || []) weeks.push(Number(n));
  }
  return [...new Set(weeks)];
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveAssessment(subject, a) {
  const text = a.due || '';
  const weekMap = subject.weekMap || {};
  const year = (weekMap[1] || '').slice(0, 4) || String(new Date().getFullYear());
  const base = { subjectCode: subject.code, weight: a.weight, source: text };
  const dates = [];

  // 1. Exam period: date is published later.
  if (/exam(ination)?\s+period|formal exam/i.test(text) || (/exam/i.test(a.title) && !weeksIn(text).length && !/\d{1,2}\s+[a-z]{3}/i.test(text))) {
    const start = subject.examPeriod && subject.examPeriod.start;
    return [{ ...base, title: a.title, due: start ? start + 'T09:00' : null, tba: true, dueLabel: 'Exam period · date TBA', needsReview: !start }];
  }

  // 2. Explicit calendar date, e.g. "14 August, 23:59".
  const explicit = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (explicit) {
    const mo = MONTHS.indexOf(explicit[2].toLowerCase()) + 1;
    const date = `${explicit[3] || year}-${pad(mo)}-${pad(Number(explicit[1]))}`;
    dates.push({ date, time: parseTime(text) || '23:59', label: '' });
  }

  // 3. "<Weekday> ... Week N" pairs, e.g. "Sunday 11:59 pm Week 4, Sunday 11:59 pm Week 6".
  if (!dates.length) {
    const re = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b((?:(?!monday|tuesday|wednesday|thursday|friday|saturday|sunday).)*?)week\s*(\d{1,2})/gi;
    let m;
    const time = parseTime(text) || '23:59';
    while ((m = re.exec(text))) {
      const wk = Number(m[3]);
      if (!weekMap[wk]) continue;
      dates.push({ date: addDays(weekMap[wk], WEEKDAYS.indexOf(m[1].toLowerCase())), time, label: `Week ${wk}` });
    }
  }

  // 4. Week-only items happen in class: use the matching class day.
  if (!dates.length) {
    let weeks = weeksIn(text);
    if (!weeks.length && /last week/i.test(text) && subject.lastTeachingWeek) weeks = [subject.lastTeachingWeek];
    if (!weeks.length) weeks = a.scheduleWeeks || [];
    const { cls, guessed } = pickClass(subject.classes || [], text, a.title);
    const explicitTime = parseTime(text);
    for (const wk of weeks) {
      if (!weekMap[wk]) continue;
      if (cls) {
        dates.push({ date: addDays(weekMap[wk], cls.weekday), time: explicitTime || cls.time || '09:00', label: `Week ${wk} · ${cls.type}`, needsReview: guessed });
      } else {
        dates.push({ date: addDays(weekMap[wk], 6), time: '23:59', label: `Week ${wk} · in class`, needsReview: true });
      }
    }
  }

  if (!dates.length) {
    return [{ ...base, title: a.title, due: null, tba: false, dueLabel: text || 'No due date found', needsReview: true }];
  }
  return dates.map((d, i) => ({
    ...base,
    title: dates.length > 1 ? `${a.title} ${i + 1}/${dates.length}` : a.title,
    weight: dates.length > 1 && a.weight ? `${a.weight} total` : a.weight,
    due: `${d.date}T${d.time}`,
    tba: false,
    dueLabel: d.label,
    needsReview: !!d.needsReview,
  }));
}

function resolveSubject(subject) {
  const items = [];
  for (const a of subject.assessments || []) {
    resolveAssessment(subject, a).forEach((it, i) => {
      items.push({ id: `${subject.code}-${slug(a.title)}-${i}`, done: false, ...it });
    });
  }
  return items;
}

module.exports = { resolveSubject, resolveAssessment, parseTime, weeksIn };
