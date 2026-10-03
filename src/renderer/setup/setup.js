const COLORS = ['#5b5bf0', '#e0567a', '#1fa58b', '#f08c2e', '#3d9be9', '#a35bd6', '#c9a227', '#5f8f3e'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TYPES = ['Lecture', 'Tutorial', 'Practical', 'Workshop'];

const state = {
  step: 0,
  subjects: [],
  // Items per subject code. `dirty` marks subjects whose items must be rebuilt
  // because the outline or class times changed.
  items: {},
  dirty: new Set(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
};

// ---------- navigation ----------

function go(step) {
  state.step = step;
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === step));
  document.querySelectorAll('#steps li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
  });
  if (step === 1) renderCards();
  if (step === 2) renderClasses();
  if (step === 3) renderReview();
  $('main').scrollTop = 0;
}

document.addEventListener('click', (e) => {
  if (e.target.matches('[data-next]')) go(state.step + 1);
  if (e.target.matches('[data-back]')) go(state.step - 1);
});

// ---------- step 1: outlines ----------

function nextColor() {
  const used = new Set(state.subjects.map((s) => s.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[state.subjects.length % COLORS.length];
}

function addSubject(subject) {
  const existing = state.subjects.findIndex((s) => s.code && s.code === subject.code);
  if (existing >= 0) {
    // Re-importing an outline keeps the class times and colour already set.
    const old = state.subjects[existing];
    state.subjects[existing] = { ...subject, color: old.color, classes: old.classes };
  } else {
    const classes = (subject.classTypes || ['Lecture', 'Practical']).map((type) => ({ type, weekday: 0, time: '09:00', unset: true }));
    state.subjects.push({ ...subject, color: nextColor(), classes });
  }
  state.dirty.add(subject.code);
}

async function importPaths(paths) {
  const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
  if (!pdfs.length) return;
  const status = $('#drop-status');
  status.textContent = `Reading ${pdfs.length} outline${pdfs.length > 1 ? 's' : ''}…`;
  const results = await window.api.parsePdfs(pdfs);
  const failed = [];
  for (const r of results) {
    if (r.ok && r.subject.code) addSubject({ ...r.subject, file: r.file });
    else failed.push(r.file);
  }
  status.textContent = failed.length ? `Couldn't read a subject from: ${failed.join(', ')}. You can add it manually.` : '';
  renderCards();
}

function renderCards() {
  const wrap = $('#subject-cards');
  wrap.replaceChildren();
  for (const s of state.subjects) {
    const count = (s.assessments || []).length;
    const weeks = Object.keys(s.weekMap || {}).length;
    const sub = s.manual
      ? 'Added manually · enter dates on the review step'
      : `${count} assessment${count === 1 ? '' : 's'} · ${weeks ? weeks + '-week schedule' : 'no schedule found'}${s.file ? ' · ' + s.file : ''}`;
    const badge = !s.manual && (!count || !weeks)
      ? el('span', { className: 'badge warn', textContent: 'Check on review' })
      : el('span', { className: 'badge', textContent: s.manual ? 'Manual' : 'Ready' });
    const remove = el('button', { className: 'icon', title: 'Remove', textContent: '✕' });
    remove.onclick = () => {
      state.subjects = state.subjects.filter((x) => x !== s);
      delete state.items[s.code];
      renderCards();
    };
    wrap.append(el('div', { className: 'card' },
      el('span', { className: 'swatch', style: `background:${s.color}` }),
      el('div', { className: 'meta' },
        el('div', { className: 'title', textContent: `${s.code} · ${s.name}` }),
        el('div', { className: 'sub', textContent: sub })),
      badge, remove));
  }
  $('#to-classes').disabled = state.subjects.length === 0;
}

const drop = $('#drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => importPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f))));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('#browse').onclick = async () => importPaths(await window.api.pickPdfs());

$('#add-manual').onclick = () => {
  const form = $('#manual-form').content.firstElementChild.cloneNode(true);
  $('#subject-cards').append(form);
  $('.code', form).focus();
  $('.cancel', form).onclick = () => form.remove();
  $('.add', form).onclick = () => {
    const code = $('.code', form).value.trim().toUpperCase();
    const name = $('.name', form).value.trim();
    if (!code) return $('.code', form).focus();
    if (state.subjects.some((s) => s.code === code)) return alertInline(form, 'That subject is already added.');
    state.subjects.push({ code, name: name || code, manual: true, color: nextColor(), weekMap: {}, assessments: [], classes: [] });
    state.items[code] = [];
    renderCards();
  };
};

function alertInline(node, msg) {
  let m = node.querySelector('.inline-msg');
  if (!m) node.append((m = el('span', { className: 'inline-msg badge warn' })));
  m.textContent = msg;
}

// ---------- step 2: class times ----------

function renderClasses() {
  const wrap = $('#class-editors');
  wrap.replaceChildren();
  for (const s of state.subjects) {
    const block = el('div', { className: 'subject-block' },
      el('h2', {}, el('span', { className: 'dot', style: `background:${s.color}` }), s.name, el('span', { className: 'code', textContent: s.code })));
    if (s.manual) {
      block.append(el('p', { className: 'hint', textContent: 'No outline schedule for this subject, so class times aren\'t needed. Add its dates on the next step.' }));
      wrap.append(block);
      continue;
    }
    const rows = el('div');
    const draw = () => {
      rows.replaceChildren();
      s.classes.forEach((c, i) => rows.append(classRow(s, c, i, draw)));
    };
    draw();
    const add = el('button', { className: 'ghost', textContent: '+ Add class' });
    add.onclick = () => { s.classes.push({ type: 'Tutorial', weekday: 0, time: '09:00' }); state.dirty.add(s.code); draw(); };
    block.append(el('p', { className: 'hint', textContent: 'Remove any class type you don\'t have.' }), rows, add);
    wrap.append(block);
  }
}

function classRow(s, c, i, redraw) {
  const type = el('select', { className: 'type' }, ...TYPES.map((t) => el('option', { value: t, textContent: t, selected: t === c.type })));
  const day = el('select', { className: 'day' }, ...DAYS.map((d, n) => el('option', { value: n, textContent: d, selected: n === c.weekday })));
  const time = el('input', { className: 'time', type: 'time', value: c.time || '09:00' });
  const changed = () => {
    c.type = type.value;
    c.weekday = Number(day.value);
    c.time = time.value || '09:00';
    delete c.unset;
    row.classList.remove('unset');
    state.dirty.add(s.code);
  };
  [type, day, time].forEach((x) => x.addEventListener('change', changed));
  const remove = el('button', { className: 'icon', title: 'Remove class', textContent: '✕' });
  remove.onclick = () => { s.classes.splice(i, 1); state.dirty.add(s.code); redraw(); };
  const row = el('div', { className: 'class-row' + (c.unset ? ' unset' : '') }, type, day, el('span', { className: 'muted', textContent: 'at' }), time, remove);
  return row;
}

// ---------- step 3: review ----------

async function rebuildDirty() {
  for (const s of state.subjects) {
    if (s.manual || !state.dirty.has(s.code)) continue;
    const subject = { ...s, classes: s.classes.map(({ type, weekday, time }) => ({ type, weekday, time })) };
    state.items[s.code] = await window.api.resolve(subject);
  }
  state.dirty.clear();
}

async function renderReview() {
  await rebuildDirty();
  const wrap = $('#review');
  wrap.replaceChildren();
  for (const s of state.subjects) {
    const items = state.items[s.code] || (state.items[s.code] = []);
    const tbody = el('tbody');
    const draw = () => {
      tbody.replaceChildren();
      items.forEach((it, i) => tbody.append(itemRow(items, it, i, draw)));
    };
    draw();
    const add = el('button', { className: 'ghost', textContent: '+ Add assessment' });
    add.onclick = () => {
      items.push({ id: `${s.code}-custom-${Date.now()}`, subjectCode: s.code, title: '', weight: '', due: null, tba: false, dueLabel: '', done: false, custom: true });
      draw();
      tbody.lastElementChild.querySelector('input').focus();
    };
    wrap.append(el('div', { className: 'subject-block' },
      el('h2', {}, el('span', { className: 'dot', style: `background:${s.color}` }), s.name, el('span', { className: 'code', textContent: s.code })),
      el('table', {},
        el('thead', {}, el('tr', {}, ...['Assessment', 'Weight', 'Due', 'TBA', ''].map((h) => el('th', { textContent: h })))),
        tbody),
      add));
  }
}

function itemRow(items, it, i, redraw) {
  const title = el('input', { type: 'text', value: it.title, placeholder: 'Assessment name' });
  const weight = el('input', { type: 'text', className: 'weight', value: it.weight || '', placeholder: '%' });
  const due = el('input', { type: 'datetime-local', value: it.due || '' });
  const tba = el('input', { type: 'checkbox', checked: !!it.tba, title: 'Date to be announced (e.g. exams)' });
  const row = el('tr', { className: it.needsReview ? 'review' : '' });
  const update = () => {
    it.title = title.value;
    it.weight = weight.value;
    it.due = due.value || null;
    it.tba = tba.checked;
    if (it.due && it.needsReview) {
      it.needsReview = false;
      row.className = '';
    }
  };
  [title, weight, due, tba].forEach((x) => x.addEventListener('change', update));
  const remove = el('button', { className: 'icon', title: 'Remove', textContent: '✕' });
  remove.onclick = () => { items.splice(i, 1); redraw(); };
  const titleCell = el('td', {}, title);
  if (it.needsReview && it.source) titleCell.append(el('span', { className: 'source', textContent: `Outline says: "${it.source}"` }));
  row.append(titleCell, el('td', {}, weight), el('td', {}, due), el('td', { className: 'tba' }, tba), el('td', {}, remove));
  return row;
}

$('#finish').onclick = async () => {
  await rebuildDirty();
  const subjects = state.subjects.map((s) => ({ ...s }));
  const items = [];
  for (const s of subjects) {
    for (const it of state.items[s.code] || []) {
      if (!it.title.trim()) continue;
      items.push({ ...it, subjectCode: s.code });
    }
  }
  $('#finish').disabled = true;
  await window.api.saveSetup({ subjects, items, launchAtLogin: $('#login').checked });
};

// ---------- start ----------

(async function init() {
  const data = await window.api.getData();
  if (data.settings.setupComplete && data.subjects.length) {
    state.subjects = data.subjects;
    for (const s of data.subjects) state.items[s.code] = data.items.filter((i) => i.subjectCode === s.code);
    $('#login').checked = data.settings.launchAtLogin;
    go(1);
  } else {
    go(0);
  }
})();
