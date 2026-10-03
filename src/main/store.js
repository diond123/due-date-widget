// Persists subjects, items and settings as JSON in the user's app data folder.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  subjects: [],
  items: [],
  settings: {
    widgetBounds: null,
    showDone: false,
    launchAtLogin: true,
    setupComplete: false,
    appearance: { preset: 'auto', opacity: 0.82, bg: '#14161f', text: '#f1f2f7', fontScale: 1 },
  },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'data.json');
    this.data = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const settings = { ...DEFAULTS.settings, ...parsed.settings };
      settings.appearance = { ...DEFAULTS.settings.appearance, ...(parsed.settings && parsed.settings.appearance) };
      return { ...DEFAULTS, ...parsed, settings };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get() {
    return this.data;
  }

  // Replaces subjects and items, keeping done flags for items that still exist.
  saveSetup(subjects, items) {
    const done = new Map(this.data.items.map((i) => [i.id, i.done]));
    this.data.subjects = subjects;
    this.data.items = items.map((i) => ({ ...i, done: i.done || done.get(i.id) || false }));
    this.data.settings.setupComplete = true;
    this.write();
  }

  setDone(id, value) {
    const item = this.data.items.find((i) => i.id === id);
    if (item) {
      item.done = value;
      this.write();
    }
  }

  setSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.write();
  }
}

module.exports = { Store };
