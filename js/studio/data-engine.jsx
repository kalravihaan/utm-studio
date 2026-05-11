// Generic data aggregation engine.
// Public surface:
//   aggregate({rows, dimensions, metrics, filters, sort, limit, calcFields})
//
// dimensions: [{fieldId, name}]   group-by columns
// metrics:    [{fieldId, agg, name, formula?}]   numbers to reduce
// filters:    [{fieldId, op, value}]   AND'ed
// sort:       {fieldId, dir}
// limit:      number
// calcFields: [{id, name, formula, dataType, role}]   user-defined calculations
//
// Returns: { rows: [{dimVals, metricVals}], totals: {metric: value}, allRows }

const AGG_FNS = {
  SUM:           (vals) => vals.reduce((a, b) => a + (toNum(b) || 0), 0),
  AVG:           (vals) => { const ns = vals.map(toNum).filter(n => n !== null); return ns.length ? ns.reduce((a,b)=>a+b,0) / ns.length : 0; },
  MIN:           (vals) => { const ns = vals.map(toNum).filter(n => n !== null); return ns.length ? Math.min(...ns) : 0; },
  MAX:           (vals) => { const ns = vals.map(toNum).filter(n => n !== null); return ns.length ? Math.max(...ns) : 0; },
  COUNT:         (vals) => vals.filter(v => v !== null && v !== undefined && v !== '').length,
  COUNT_DISTINCT:(vals) => new Set(vals.filter(v => v !== null && v !== undefined && v !== '')).size,
  MEDIAN:        (vals) => {
    const ns = vals.map(toNum).filter(n => n !== null).sort((a,b) => a-b);
    if (!ns.length) return 0;
    const m = Math.floor(ns.length/2);
    return ns.length % 2 ? ns[m] : (ns[m-1] + ns[m]) / 2;
  },
};

const AGG_LABELS = {
  SUM: 'Sum', AVG: 'Average', MIN: 'Min', MAX: 'Max',
  COUNT: 'Count', COUNT_DISTINCT: 'Count distinct', MEDIAN: 'Median',
};

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = +v;
  return isNaN(n) ? null : n;
}

// Filter ops
const OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'starts with', 'in', 'not in', 'is null', 'is not null'];

function rowMatchesFilter(row, f) {
  const v = row[f.fieldId];
  switch (f.op) {
    case '=':            return v == f.value;
    case '!=':           return v != f.value;
    case '>':            return toNum(v) > toNum(f.value);
    case '>=':           return toNum(v) >= toNum(f.value);
    case '<':            return toNum(v) < toNum(f.value);
    case '<=':           return toNum(v) <= toNum(f.value);
    case 'contains':     return String(v||'').toLowerCase().includes(String(f.value||'').toLowerCase());
    case 'starts with':  return String(v||'').toLowerCase().startsWith(String(f.value||'').toLowerCase());
    case 'in':           return (f.value||'').split(',').map(s=>s.trim()).includes(String(v));
    case 'not in':       return !(f.value||'').split(',').map(s=>s.trim()).includes(String(v));
    case 'is null':      return v === null || v === undefined || v === '';
    case 'is not null':  return !(v === null || v === undefined || v === '');
    default: return true;
  }
}

// Evaluate calculated field formula. Formula uses field IDs as JS-safe identifiers.
// E.g. "Revenue / Sales_Qty"   "GMV - Revenue"   "(Returns / Sales) * 100"
// We sandbox via Function() with row as context object.
const _formulaCache = new Map();
function evalCalc(formula, row) {
  if (!_formulaCache.has(formula)) {
    try {
      const safe = formula.replace(/`/g, '');
      const code = `with(__row){ try { return (${safe}); } catch(e) { return null; } }`;
      // eslint-disable-next-line no-new-func
      _formulaCache.set(formula, new Function('__row', code));
    } catch (e) {
      _formulaCache.set(formula, () => null);
    }
  }
  const fn = _formulaCache.get(formula);
  const ctx = {};
  for (const [k, v] of Object.entries(row)) {
    // sanitize key for `with`
    ctx[k] = v;
    ctx[k.replace(/[^A-Za-z0-9_]/g, '_')] = v;
  }
  try { return fn(ctx); } catch (e) { return null; }
}

// Augment row with calculated fields
function withCalcs(rows, calcFields) {
  if (!calcFields || !calcFields.length) return rows;
  return rows.map(r => {
    const o = { ...r };
    for (const c of calcFields) o[c.id] = evalCalc(c.formula || '', o);
    return o;
  });
}

function applyFilters(rows, filters) {
  if (!filters || !filters.length) return rows;
  return rows.filter(r => filters.every(f => f.fieldId && rowMatchesFilter(r, f)));
}

// Date bucketing for time-series dimensions: 'day' | 'month' | 'year' | 'none'
function bucketDateValue(v, granularity) {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  if (granularity === 'year') return String(d.getFullYear());
  if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  if (granularity === 'day') return d.toISOString().slice(0, 10);
  return v;
}

// Get the cell value as used for grouping
function dimValue(row, dim) {
  let v = row[dim.fieldId];
  if (dim.granularity) v = bucketDateValue(v, dim.granularity);
  return v == null ? '(none)' : v;
}

function aggregate({ rows, dimensions = [], metrics = [], filters = [], sort, limit, calcFields = [] }) {
  let working = withCalcs(rows, calcFields);
  working = applyFilters(working, filters);

  // No dimensions => single totals row
  if (!dimensions.length) {
    const out = { dimVals: [], metricVals: {} };
    for (const m of metrics) {
      const fn = AGG_FNS[m.agg || 'SUM'];
      out.metricVals[m.fieldId + '|' + (m.agg || 'SUM')] = fn ? fn(working.map(r => r[m.fieldId])) : 0;
    }
    return { rows: [out], totals: out.metricVals, allRows: working };
  }

  // Group by dimension tuple
  const groups = new Map();
  for (const r of working) {
    const key = dimensions.map(d => dimValue(r, d)).join('\u001F');
    let g = groups.get(key);
    if (!g) {
      g = { dimVals: dimensions.map(d => dimValue(r, d)), rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }

  const out = [];
  const totals = {};
  for (const g of groups.values()) {
    const metricVals = {};
    for (const m of metrics) {
      const fn = AGG_FNS[m.agg || 'SUM'];
      const key = m.fieldId + '|' + (m.agg || 'SUM');
      metricVals[key] = fn ? fn(g.rows.map(r => r[m.fieldId])) : 0;
    }
    out.push({ dimVals: g.dimVals, metricVals });
  }
  // grand totals
  for (const m of metrics) {
    const fn = AGG_FNS[m.agg || 'SUM'];
    totals[m.fieldId + '|' + (m.agg || 'SUM')] = fn ? fn(working.map(r => r[m.fieldId])) : 0;
  }

  // Sort
  if (sort && (sort.fieldId || sort.metricKey)) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      let av, bv;
      if (sort.metricKey) { av = a.metricVals[sort.metricKey]; bv = b.metricVals[sort.metricKey]; }
      else {
        const dIdx = dimensions.findIndex(d => d.fieldId === sort.fieldId);
        av = a.dimVals[dIdx]; bv = b.dimVals[dIdx];
      }
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return ((av || 0) - (bv || 0)) * dir;
    });
  } else if (metrics.length) {
    // default: sort by first metric desc
    const key = metrics[0].fieldId + '|' + (metrics[0].agg || 'SUM');
    out.sort((a, b) => (b.metricVals[key] || 0) - (a.metricVals[key] || 0));
  }

  return {
    rows: limit ? out.slice(0, limit) : out,
    totals,
    allRows: working,
  };
}

// Build a friendly metric label, e.g. "Sum of Revenue"
function metricLabel(m, fieldMap) {
  if (m.name) return m.name;
  const fname = (fieldMap && fieldMap[m.fieldId]) ? fieldMap[m.fieldId].name : m.fieldId;
  const agg = AGG_LABELS[m.agg || 'SUM'];
  return `${agg} of ${fname}`;
}

// Formatters (generic — used by widgets)
function fmtCompact(n) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n/1e3).toFixed(1) + 'K';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}
function fmtFull(n) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  if (Number.isInteger(n)) return n.toLocaleString();
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtPercent(n, dp = 1) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  return n.toFixed(dp) + '%';
}
function fmtAuto(n, fieldType) {
  if (fieldType === 'percent') return fmtPercent(n);
  return fmtCompact(n);
}

Object.assign(window, {
  aggregate, withCalcs, evalCalc, applyFilters,
  AGG_FNS, AGG_LABELS, OPS,
  metricLabel, fmtCompact, fmtFull, fmtPercent, fmtAuto, toNum,
  bucketDateValue,
});
