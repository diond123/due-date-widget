const DAY_MS = 86400000;
let data = null;

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) n.append(c);
  return n;
};

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseLocal(iso) {
  const [date, time = '00:00'] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function daysUntil(due, today) {
  return Math.round((startOfDay(due) - today) / DAY_MS);
}

function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function countdown(days) {
  if (days === 0) return { text: 'Today', cls: 'urgent' };
  if (days === 1) return { text: 'Tomorrow', cls: 'urgent' };
  if (days <= 2) return { text: `In ${days} days`, cls: 'urgent' };
  if (days <= 7) return { text: `In ${days} days`, cls: 'soon' };
  if (days < 21) return { text: `In ${days} days`, cls: '' };
  return { text: `In ${Math.round(days / 7)} weeks`, cls: '' };
}

function groupFor(item, today) {
  if (item.tba) return 'Exams · date TBA';
  if (!item.due) return 'No date set';
  const days = daysUntil(parseLocal(item.due), today);
  if (days === 0) return 'Today';
  const leftThisWeek = 6 - ((today.getDay() + 6) % 7); // days until Sunday
  if (days <= leftThisWeek) return 'This week';
  if (days <= leftThisWeek + 7) return 'Next week';
  return 'Later';
}

const ORDER = ['Today', 'This week', 'Next week', 'Later', 'Exams · date TBA', 'No date set'];

function render() {
  if (!data) return;
  const now = new Date();
  const today = startOfDay(now);
  $('#today').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const subjects = new Map(data.subjects.map((s) => [s.code, s]));
  const showDone = data.settings.showDone;

  // From today on: anything dated today or later, plus exams still TBA.
  const upcoming = data.items.filter((i) => i.tba || !i.due || parseLocal(i.due) >= today);
  const visible = upcoming.filter((i) => showDone || !i.done);
  visible.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));

  const groups = new Map();
  for (const it of visible) {
    const g = groupFor(it, today);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }

  const list = $('#list');
  list.replaceChildren();
  if (!visible.length) {
    list.append(el('div', { className: 'empty' },
      el('b', { textContent: data.items.length ? 'All caught up' : 'No assessments yet' }),
      data.items.length ? 'Nothing left to do from today on.' : 'Click ✎ to add your subject outlines.'));
  }
  for (const name of ORDER) {
    const items = groups.get(name);
    if (!items) continue;
    const group = el('div', { className: 'group' }, el('div', { className: 'group-label', textContent: name }));
    for (const it of items) group.append(itemRow(it, subjects.get(it.subjectCode), today));
    list.append(group);
  }

  const left = upcoming.filter((i) => !i.done).length;
  const done = upcoming.length - left;
  $('#summary').textContent = `${left} to go${done ? ` · ${done} done` : ''}`;
  $('#toggle-done').textContent = showDone ? 'Hide done' : 'Show done';
  $('#toggle-done').style.visibility = done ? 'visible' : 'hidden';
}

function itemRow(it, subject, today) {
  const row = el('div', { className: 'item' + (it.done ? ' done' : '') });
  row.style.setProperty('--c', (subject && subject.color) || '#888');

  const tick = el('input', { type: 'checkbox', className: 'tick', checked: !!it.done, title: it.done ? 'Mark as not done' : 'Mark as done' });
  tick.onchange = () => {
    const value = tick.checked;
    if (value && !data.settings.showDone) {
      row.classList.add('leaving');
      setTimeout(() => window.api.setDone(it.id, value), 280);
    } else {
      window.api.setDone(it.id, value);
    }
  };

  const meta = el('div', { className: 'meta' }, el('span', { className: 'code', textContent: it.subjectCode }));
  const extra = [it.weight, it.dueLabel].filter(Boolean).join(' · ');
  if (extra) meta.append(' · ' + extra);

  const when = el('div', { className: 'when' });
  if (it.tba) {
    when.append(el('div', { className: 'pill tba', textContent: 'TBA' }));
  } else if (it.due) {
    const due = parseLocal(it.due);
    const days = daysUntil(due, today);
    const c = countdown(days);
    when.append(
      el('div', { className: `pill ${c.cls}`, textContent: c.text }),
      el('div', { className: 'date', textContent: days <= 1 ? fmtTime(due) : `${fmtDate(due)}, ${fmtTime(due)}` }));
  } else {
    when.append(el('div', { className: 'pill tba', textContent: 'No date' }));
  }

  row.append(tick, el('div', { className: 'body' }, el('div', { className: 'name', textContent: it.title, title: it.title }), meta), when);
  return row;
}

// ---------- appearance ----------

const DEFAULT_APPEARANCE = { preset: 'auto', opacity: 0.82, bg: '#14161f', text: '#f1f2f7', fontScale: 1 };
const PRESETS = {
  dark: { bg: '#14161f', text: '#f1f2f7', opacity: 0.82 },
  light: { bg: '#fafafd', text: '#1b1d27', opacity: 0.9 },
  glass: { bg: '#000000', text: '#ffffff', opacity: 0.15 },
};
const systemLight = window.matchMedia('(prefers-color-scheme: light)');
let look = { ...DEFAULT_APPEARANCE };
let saveTimer = null;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// "Auto" follows the system theme; every other preset uses the stored colours.
function effective(a) {
  if (a.preset === 'auto') return { ...a, ...(systemLight.matches ? PRESETS.light : PRESETS.dark) };
  return a;
}

function applyAppearance(a) {
  const e = effective(a);
  const root = document.documentElement;
  root.style.setProperty('--bg-rgb', hexToRgb(e.bg).join(', '));
  root.style.setProperty('--alpha', String(e.opacity));
  root.style.setProperty('--text', e.text);
  root.style.setProperty('--scale', String(e.fontScale || 1));
  root.dataset.tone = luminance(e.text) > 0.5 ? 'dark' : 'light';
  root.classList.toggle('low-alpha', e.opacity < 0.35);
  root.classList.toggle('no-bg', e.opacity < 0.08);
}

function syncPanel() {
  const e = effective(look);
  $('#opacity').value = Math.round(e.opacity * 100);
  $('#opacity-val').textContent = Math.round(e.opacity * 100) + '%';
  $('#bg').value = e.bg;
  $('#text').value = e.text;
  document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === look.preset));
  document.querySelectorAll('#sizes button').forEach((b) => b.classList.toggle('on', Number(b.dataset.scale) === look.fontScale));
}

function setLook(patch, { custom = false } = {}) {
  // Editing a colour or opacity turns the current theme into "Custom".
  if (custom) look = { ...effective(look), preset: 'custom' };
  look = { ...look, ...patch };
  applyAppearance(look);
  syncPanel();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.setSettings({ appearance: look }), 300);
}

function panelOpen() {
  return !$('#panel').hidden;
}

function togglePanel(open = !panelOpen()) {
  $('#panel').hidden = !open;
  $('#style').classList.toggle('on', open);
  if (open) syncPanel();
}

$('#style').onclick = () => togglePanel();
$('#done').onclick = () => togglePanel(false);
$('#reset').onclick = () => setLook({ ...DEFAULT_APPEARANCE });
$('#presets').onclick = (e) => {
  const p = e.target.dataset.preset;
  if (!p) return;
  if (p === 'custom') setLook({ preset: 'custom' }, { custom: true });
  else setLook({ preset: p, ...(PRESETS[p] || {}) });
};
$('#sizes').onclick = (e) => {
  if (e.target.dataset.scale) setLook({ fontScale: Number(e.target.dataset.scale) });
};
$('#opacity').oninput = (e) => setLook({ opacity: Number(e.target.value) / 100 }, { custom: true });
$('#bg').oninput = (e) => setLook({ bg: e.target.value }, { custom: true });
$('#text').oninput = (e) => setLook({ text: e.target.value }, { custom: true });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePanel(false); });
systemLight.addEventListener('change', () => { applyAppearance(look); if (panelOpen()) syncPanel(); });

function receive(d) {
  data = d;
  // While the panel is open, local edits are the source of truth.
  if (!panelOpen()) {
    look = { ...DEFAULT_APPEARANCE, ...(d.settings.appearance || {}) };
    applyAppearance(look);
  }
  render();
}

$('#edit').onclick = () => window.api.openSetup();
$('#hide').onclick = () => window.api.hideWidget();
$('#toggle-done').onclick = () => window.api.setSettings({ showDone: !data.settings.showDone });

window.api.onDataChanged(receive);
window.api.onRefresh(render);
window.api.onOpenAppearance(() => togglePanel(true));
// Keeps countdowns current; the main process also pings at midnight and on resume.
setInterval(render, 5 * 60 * 1000);

window.api.getData().then(receive);
