// Runs the parser against the subject outlines in the project folder.
// The PDFs are local only; tests for missing files are skipped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parsePdf, resolveSubject } = require('../src/parser');

const ROOT = path.join(__dirname, '..');
const CLASSES = [
  { type: 'Lecture', weekday: 0, time: '10:00' },
  { type: 'Workshop', weekday: 1, time: '12:00' },
  { type: 'Practical', weekday: 2, time: '14:00' },
  { type: 'Tutorial', weekday: 3, time: '11:00' },
];

async function load(file) {
  const subject = await parsePdf(fs.readFileSync(path.join(ROOT, file)));
  subject.classes = CLASSES;
  return { subject, items: resolveSubject(subject) };
}

function dues(items, prefix) {
  return items.filter((i) => i.title.startsWith(prefix)).map((i) => i.due);
}

function maybe(file, fn) {
  const exists = fs.existsSync(path.join(ROOT, file));
  test(file, { skip: !exists && 'outline not present' }, fn);
}

maybe('COMP2025_2026_Spring_Subject_Outline (1).pdf', async () => {
  const { subject, items } = await load('COMP2025_2026_Spring_Subject_Outline (1).pdf');
  assert.equal(subject.code, 'COMP2025');
  assert.equal(subject.name, 'Introduction to Data Science');
  assert.ok(subject.decoded);
  assert.deepEqual(dues(items, 'Practical'), ['2026-08-05T14:00', '2026-08-19T14:00', '2026-09-02T14:00', '2026-09-30T14:00', '2026-10-14T14:00']);
  assert.deepEqual(dues(items, 'Applied Project'), ['2026-10-12T10:00']);
  const exam = items.find((i) => i.title === 'Final Exam');
  assert.ok(exam.tba);
  assert.equal(exam.weight, '40%');
});

maybe('COMP2028_2026_Spring_On-Site.pdf', async () => {
  const { subject, items } = await load('COMP2028_2026_Spring_On-Site.pdf');
  assert.equal(subject.code, 'COMP2028');
  assert.deepEqual(dues(items, 'Practical'), ['2026-08-16T23:59', '2026-08-30T23:59', '2026-09-20T23:59', '2026-10-11T23:59']);
  assert.deepEqual(dues(items, 'Essay & Presentation'), ['2026-10-25T23:59']);
  assert.ok(items.find((i) => i.title === 'Short & Long Answer').tba);
});

maybe('INFS2001_2026_Spring_Subject_Outline_On-Site.pdf', async () => {
  const { subject, items } = await load('INFS2001_2026_Spring_Subject_Outline_On-Site.pdf');
  assert.equal(subject.code, 'INFS2001');
  assert.deepEqual(dues(items, 'Assignment 1'), ['2026-09-14T23:59']);
  assert.deepEqual(dues(items, 'Assignment 2'), ['2026-10-19T23:59']);
  const pracs = dues(items, 'Tutorials and Practicals');
  assert.equal(pracs.length, 12);
  assert.equal(pracs[0], '2026-07-29T14:00');
  assert.ok(!pracs.includes('2026-09-09T14:00'), 'break week skipped');
  assert.equal(items.find((i) => i.title === 'Final Exam').weight, '50%');
});

maybe('Video_Games_Development(1).pdf', async () => {
  const { subject, items } = await load('Video_Games_Development(1).pdf');
  assert.equal(subject.code, 'COMP3024');
  assert.deepEqual(dues(items, 'Tutorials'), ['2026-08-06T11:00', '2026-09-03T11:00']);
  assert.deepEqual(dues(items, 'Assignment 1'), ['2026-08-14T23:59']);
  assert.deepEqual(dues(items, 'Assignment 2'), ['2026-10-19T09:00']);
  assert.ok(items.find((i) => i.title === 'Final Examination').tba);
  assert.equal(items.filter((i) => i.needsReview).length, 0);
});
