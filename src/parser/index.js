const { extractLines } = require('./extract');
const { decodeIfNeeded } = require('./decode');
const { parseOutline } = require('./wsu');
const { resolveSubject } = require('./resolve');

// Reads one outline PDF and returns the parsed subject (without class days).
async function parsePdf(buffer) {
  const raw = await extractLines(buffer);
  const { lines, decoded } = decodeIfNeeded(raw);
  return { ...parseOutline(lines), decoded };
}

module.exports = { parsePdf, resolveSubject };
