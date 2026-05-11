// Generic xlsx parser: produces { rows, fields, sheetNames }
// Unlike the original FY-26 parser, this works on ANY workbook — it infers
// column types from values and lets the user wire columns into widgets later.

async function parseAnyExcel(file, onProgress) {
  if (typeof XLSX === 'undefined') throw new Error('Excel library not loaded.');
  if (onProgress) onProgress('Reading file…');
  const buf = await file.arrayBuffer();
  if (onProgress) onProgress('Parsing workbook…');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    sheets[name] = rows;
  }
  // Use first non-empty sheet
  const firstName = wb.SheetNames.find(n => (sheets[n] || []).length > 0) || wb.SheetNames[0];
  const rows = sheets[firstName] || [];
  if (onProgress) onProgress(`Inferring fields from ${rows.length.toLocaleString()} rows…`);
  await new Promise(r => setTimeout(r, 10));
  const fields = inferFields(rows);
  // Convert raw buffer back to blob so we can stash it for re-download
  const rawBlob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  return { rows, fields, sheets, sheetNames: wb.SheetNames, sheetName: firstName, rawBlob };
}

// Infer per-column field defs from sample values
function inferFields(rows) {
  if (!rows.length) return [];
  const cols = new Set();
  for (const r of rows.slice(0, 100)) for (const k of Object.keys(r)) cols.add(k);
  const sample = rows.slice(0, 200);
  const fields = [];
  for (const col of cols) {
    let nums = 0, strs = 0, dates = 0, nonNull = 0;
    let min = Infinity, max = -Infinity;
    for (const r of sample) {
      const v = r[col];
      if (v === null || v === undefined || v === '') continue;
      nonNull += 1;
      if (v instanceof Date) { dates += 1; continue; }
      if (typeof v === 'number') {
        nums += 1;
        if (v < min) min = v;
        if (v > max) max = v;
        continue;
      }
      const s = String(v).trim();
      if (s === '') continue;
      // Try numeric
      const n = +s;
      if (!isNaN(n) && s.match(/^-?\d+(\.\d+)?$/)) {
        nums += 1;
        if (n < min) min = n;
        if (n > max) max = n;
      } else if (s.match(/^\d{4}-\d{1,2}-\d{1,2}/) || s.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
        dates += 1;
      } else {
        strs += 1;
      }
    }
    let dataType = 'string';
    let role = 'dimension';
    if (dates > nonNull * 0.6) { dataType = 'date'; role = 'dimension'; }
    else if (nums > nonNull * 0.7) { dataType = 'number'; role = 'metric'; }
    fields.push({
      id: col,
      name: col,
      dataType,
      role,            // 'dimension' or 'metric' (initial guess; user can re-tag)
      source: 'native',
      defaultAgg: dataType === 'number' ? 'SUM' : 'COUNT',
    });
  }
  return fields;
}

// Get distinct values from a column (for filter pickers etc.)
function distinctValues(rows, fieldId, max = 1000) {
  const set = new Set();
  for (const r of rows) {
    const v = r[fieldId];
    if (v === null || v === undefined || v === '') continue;
    set.add(typeof v === 'object' ? String(v) : v);
    if (set.size >= max) break;
  }
  return [...set];
}

// Export current rows back to xlsx Blob (used by "Download current data")
function rowsToXlsxBlob(rows, sheetName = 'Sheet1') {
  if (typeof XLSX === 'undefined') throw new Error('Excel library not loaded.');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

Object.assign(window, { parseAnyExcel, inferFields, distinctValues, rowsToXlsxBlob });
