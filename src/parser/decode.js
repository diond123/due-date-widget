// Some outlines are generated with fonts that lack a Unicode map, so the text
// comes out as a fixed glyph substitution (e.g. "am#D2+i" for "Subject").
// This detects that and maps it back to readable text.

const MAP = {
  '\u001b': 'A', '\u001c': 'a', '\u001d': '&', '#': 'b', '+': 'c', '/': 'd', '2': 'e', '7': 'f', ';': 'g', '?': 'h', B: 'i', D: 'j',
  F: 'k', H: 'l', K: 'm', M: 'n', Q: 'o', T: 'p', '[': 'q', '`': 'r', b: 's', i: 't', m: 'u', p: 'v',
  r: 'w', t: 'x', v: 'y', x: 'z',
  '"': 'B', '*': 'C', '.': 'D', '1': 'E', '6': 'F', ':': 'G', '>': 'H', A: 'I', C: 'J', E: 'K', G: 'L', J: 'M',
  L: 'N', P: 'O', S: 'P', Z: 'Q', _: 'R', a: 'S', h: 'T', l: 'U', o: 'V', q: 'W', u: 'Y',
  y: '0', R: '1', k: '2', j: '3', '9': '4', '8': '5', e: '6', d: '7', '3': '8', N: '9',
  g: ' ', X: '.', '-': ',', ',': ':', c: ';', '@': '-', f: '/', U: '(', V: ')', W: '%', '!': '@',
  '\\': '?', I: '<', '=': '>', Y: '+', '}': 'fi', '{': 'ffi', z: 'ff', '~': 'fl', n: '?', s: '?',
};

const SIGNATURES = ['am#D2+i', '*PJS', 'q22F', 'bb2bbK2Mi'];

function isScrambled(text) {
  return SIGNATURES.some((s) => text.includes(s));
}

function decodeLine(line) {
  let out = '';
  for (const ch of line) {
    if (ch === ' ' || ch === '\f') out += ch;
    else if (Object.prototype.hasOwnProperty.call(MAP, ch)) out += MAP[ch];
    else if (ch.charCodeAt(0) < 32) continue;
    else out += ch;
  }
  return out;
}

function decodeIfNeeded(lines) {
  if (!isScrambled(lines.join('\n'))) return { lines, decoded: false };
  return { lines: lines.map(decodeLine), decoded: true };
}

module.exports = { decodeIfNeeded, isScrambled, decodeLine };
