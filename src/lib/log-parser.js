const SKIP_PATTERNS = [
  /(?:Skipped|Skipping)\s+(?:rule|workflow)\s+["']?([^"'\s:]+)["']?\s*[:\-]?\s*(.+?)$/i,
  /Rule\s+["']?([^"'\s]+)["']?\s+(?:was\s+)?skipped\s*[:\-]?\s*(.+?)$/i
];

const ERROR_PATTERNS = [
  /^\s*(?:ERROR|FATAL)\b\s*[:\-]?\s*(.+)$/i,
  /^\s*Error\s*[:\-]\s*(.+)$/
];

export function parseImportLog(text) {
  if (!text || typeof text !== 'string') {
    return { skippedCount: 0, skippedRules: [], hardErrors: [] };
  }

  const skippedRules = [];
  const hardErrors = [];
  const seenSkips = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let matched = false;
    for (const re of SKIP_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const name = m[1].trim();
        const reason = (m[2] || 'skipped').trim();
        const key = `${name}::${reason}`;
        if (!seenSkips.has(key)) {
          seenSkips.add(key);
          skippedRules.push({ name, reason });
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (const re of ERROR_PATTERNS) {
      const m = line.match(re);
      if (m) {
        hardErrors.push(m[1].trim());
        break;
      }
    }
  }

  return {
    skippedCount: skippedRules.length,
    skippedRules,
    hardErrors
  };
}
