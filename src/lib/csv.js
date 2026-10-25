// Minimal RFC4180 CSV line parser: handles quoted fields, embedded commas, and "" escaped quotes.
export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// Parses a full CSV text into an array of row objects keyed by lowercased header column.
export function parseCsvRows(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    header.forEach((col, idx) => {
      row[col] = (fields[idx] ?? '').trim();
    });
    return row;
  });
}
