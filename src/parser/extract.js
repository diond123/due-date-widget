// Extracts text from a PDF as an array of lines, rebuilt from pdf.js text items
// by grouping on the baseline and sorting each line along the reading direction.
// Rotated text (e.g. landscape schedule tables) is grouped on its own axis.
const path = require('path');
const { pathToFileURL } = require('url');

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsPromise = import(pathToFileURL(entry).href);
  }
  return pdfjsPromise;
}

function orientation(t) {
  const [a, b] = t;
  if (Math.abs(b) > Math.abs(a)) return b > 0 ? 'up' : 'down';
  return 'flat';
}

// For each orientation, `line` is the coordinate shared by text on one line and
// `along` increases in reading order. Lines are emitted top-to-bottom (flat) or
// in the rotated equivalent.
function coords(item, dir) {
  const [, , , , x, y] = item.transform;
  if (dir === 'up') return { line: x, along: y, lineOrder: x };
  if (dir === 'down') return { line: x, along: -y, lineOrder: -x };
  return { line: y, along: x, lineOrder: -y };
}

function buildLines(items, dir) {
  const rows = new Map();
  for (const item of items) {
    const c = coords(item, dir);
    const key = Math.round(c.line / 2) * 2;
    if (!rows.has(key)) rows.set(key, { order: c.lineOrder, parts: [] });
    rows.get(key).parts.push({ along: c.along, str: item.str, w: item.width });
  }
  const out = [];
  for (const row of [...rows.values()].sort((a, b) => a.order - b.order)) {
    row.parts.sort((a, b) => a.along - b.along);
    let text = '';
    let lastEnd = null;
    for (const part of row.parts) {
      if (lastEnd !== null) {
        const gap = part.along - lastEnd;
        text += gap > 12 ? '   ' : gap > 1.5 ? ' ' : '';
      }
      text += part.str;
      lastEnd = part.along + part.w;
    }
    out.push(text);
  }
  return out;
}

async function extractLines(data) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    verbosity: 0,
    standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
  }).promise;

  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byDir = { flat: [], up: [], down: [] };
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      byDir[orientation(item.transform)].push(item);
    }
    for (const dir of ['flat', 'up', 'down']) {
      if (byDir[dir].length) lines.push(...buildLines(byDir[dir], dir));
    }
    lines.push('\f');
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}

module.exports = { extractLines };
