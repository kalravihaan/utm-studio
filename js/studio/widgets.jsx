// Widget renderers — each takes (widget, aggResult, theme, fields) and renders.
// Chart.js handles line/bar/pie. Heatmap/treemap/table are hand-rolled.

function StudioChart({ config, deps }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    const chart = new Chart(ref.current.getContext('2d'), config);
    return () => chart.destroy();
  }, deps);
  return <canvas ref={ref}></canvas>;
}

function getMetricKey(m) { return m.fieldId + '|' + (m.agg || 'SUM'); }

function fmtForField(value, field) {
  if (value === null || value === undefined) return '–';
  if (typeof value !== 'number') return String(value);
  return fmtCompact(value);
}

// Empty / error overlay
function EmptyState({ message }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: '#9AA0A6', fontSize: 12.5, padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 22, opacity: 0.4 }}>◌</div>
      <div>{message}</div>
    </div>
  );
}

// ============== Scorecard ==============
function ScorecardWidget({ widget, dataset, theme }) {
  const m = widget.config.metric;
  if (!m || !m.fieldId) return <EmptyState message="Pick a metric in Setup" />;
  const result = aggregate({
    rows: dataset.rows, metrics: [m], filters: widget.config.filters || [],
    calcFields: dataset.calcFields || [],
  });
  const val = result.totals[getMetricKey(m)];
  const accent = widget.config.accent || theme.accent;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '4px 4px' }}>
      <div style={{ fontSize: 11.5, color: theme.muted, fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase' }}>{widget.title || m.name || metricLabel(m, dataset.fieldMap)}</div>
      <div style={{ fontSize: 32, fontWeight: 500, color: theme.text, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(val)}</div>
      <div style={{ fontSize: 12, color: theme.muted }}>{fmtFull(val)}</div>
      <div style={{ width: 28, height: 3, background: accent, borderRadius: 2, marginTop: 2 }}></div>
    </div>
  );
}

// ============== Line / Area ==============
function LineWidget({ widget, dataset, theme, area = false }) {
  const { dimension, metrics, breakdown, smooth, showLegend } = widget.config;
  if (!dimension || !dimension.fieldId || !metrics || !metrics.length) {
    return <EmptyState message="Pick a dimension and at least one metric" />;
  }

  // Bucketize x-axis
  let agg;
  if (breakdown && breakdown.fieldId) {
    agg = aggregate({ rows: dataset.rows, dimensions: [dimension, breakdown], metrics, filters: widget.config.filters || [], calcFields: dataset.calcFields || [] });
  } else {
    agg = aggregate({ rows: dataset.rows, dimensions: [dimension], metrics, filters: widget.config.filters || [], calcFields: dataset.calcFields || [] });
  }

  // Sort x-axis values naturally (lexicographic for now; date buckets sort lexicographically too)
  const xVals = [...new Set(agg.rows.map(r => r.dimVals[0]))].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });

  let datasets;
  if (breakdown && breakdown.fieldId) {
    const breakdownVals = [...new Set(agg.rows.map(r => r.dimVals[1]))];
    datasets = breakdownVals.map((bv, i) => {
      const color = theme.palette[i % theme.palette.length];
      return {
        label: String(bv),
        data: xVals.map(x => {
          const row = agg.rows.find(r => r.dimVals[0] === x && r.dimVals[1] === bv);
          return row ? row.metricVals[getMetricKey(metrics[0])] : 0;
        }),
        borderColor: color,
        backgroundColor: color + (area ? '44' : '22'),
        borderWidth: 2.2, tension: smooth ? 0.32 : 0, pointRadius: 2.5, fill: area,
      };
    });
  } else {
    datasets = metrics.map((m, i) => {
      const color = theme.palette[i % theme.palette.length];
      const key = getMetricKey(m);
      return {
        label: m.name || metricLabel(m, dataset.fieldMap),
        data: xVals.map(x => {
          const row = agg.rows.find(r => r.dimVals[0] === x);
          return row ? row.metricVals[key] : 0;
        }),
        borderColor: color,
        backgroundColor: color + (area ? '44' : '22'),
        borderWidth: 2.2, tension: smooth ? 0.32 : 0, pointRadius: 2.5, fill: area,
      };
    });
  }

  const config = {
    type: 'line',
    data: { labels: xVals.map(String), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: !!showLegend && datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14 } },
        tooltip: { backgroundColor: '#202124', padding: 10, cornerRadius: 6 },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#F1F3F4' }, ticks: { callback: v => fmtCompact(v) } },
      },
    },
  };

  return <div style={{ height: '100%', position: 'relative' }}><StudioChart config={config} deps={[JSON.stringify(widget), dataset.id]} /></div>;
}

// ============== Bar / HBar / Stacked ==============
function BarWidget({ widget, dataset, theme, horizontal = false, stacked = false }) {
  const { dimension, metrics, breakdown, showLegend, sortDesc, limit } = widget.config;
  if (!dimension || !dimension.fieldId || !metrics || !metrics.length) {
    return <EmptyState message="Pick a dimension and at least one metric" />;
  }
  let agg;
  if (breakdown && breakdown.fieldId) {
    agg = aggregate({ rows: dataset.rows, dimensions: [dimension, breakdown], metrics, filters: widget.config.filters || [], calcFields: dataset.calcFields || [] });
  } else {
    agg = aggregate({ rows: dataset.rows, dimensions: [dimension], metrics, filters: widget.config.filters || [], calcFields: dataset.calcFields || [] });
  }

  const xValsAll = [...new Set(agg.rows.map(r => r.dimVals[0]))];
  // sort xVals by total of first metric
  const totals = {};
  for (const r of agg.rows) {
    totals[r.dimVals[0]] = (totals[r.dimVals[0]] || 0) + (r.metricVals[getMetricKey(metrics[0])] || 0);
  }
  xValsAll.sort((a, b) => (sortDesc ? totals[b] - totals[a] : totals[a] - totals[b]));
  const xVals = limit ? xValsAll.slice(0, limit) : xValsAll;

  let datasets;
  if (breakdown && breakdown.fieldId) {
    const bvals = [...new Set(agg.rows.map(r => r.dimVals[1]))];
    datasets = bvals.map((bv, i) => ({
      label: String(bv),
      data: xVals.map(x => {
        const row = agg.rows.find(r => r.dimVals[0] === x && r.dimVals[1] === bv);
        return row ? row.metricVals[getMetricKey(metrics[0])] : 0;
      }),
      backgroundColor: theme.palette[i % theme.palette.length],
      stack: stacked ? 's1' : undefined,
      borderRadius: 3,
    }));
  } else {
    datasets = metrics.map((m, i) => ({
      label: m.name || metricLabel(m, dataset.fieldMap),
      data: xVals.map(x => {
        const row = agg.rows.find(r => r.dimVals[0] === x);
        return row ? row.metricVals[getMetricKey(m)] : 0;
      }),
      backgroundColor: theme.palette[i % theme.palette.length],
      borderRadius: 3,
    }));
  }

  const config = {
    type: 'bar',
    data: { labels: xVals.map(String), datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: !!showLegend && datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, padding: 14 } },
        tooltip: { backgroundColor: '#202124', padding: 10, cornerRadius: 6 },
      },
      scales: {
        x: { stacked: !!stacked, grid: { display: horizontal ? true : false, color: '#F1F3F4' }, ticks: { callback: v => horizontal ? fmtCompact(v) : v } },
        y: { stacked: !!stacked, beginAtZero: true, grid: { color: '#F1F3F4' }, ticks: { callback: v => horizontal ? v : fmtCompact(v) } },
      },
    },
  };

  return <div style={{ height: '100%', position: 'relative' }}><StudioChart config={config} deps={[JSON.stringify(widget), dataset.id]} /></div>;
}

// ============== Pie / Donut ==============
function PieWidget({ widget, dataset, theme, donut = false }) {
  const { dimension, metric, limit, showLegend } = widget.config;
  if (!dimension || !dimension.fieldId || !metric || !metric.fieldId) {
    return <EmptyState message="Pick a dimension and a metric" />;
  }
  const agg = aggregate({
    rows: dataset.rows, dimensions: [dimension], metrics: [metric],
    filters: widget.config.filters || [], calcFields: dataset.calcFields || [],
    limit: limit || 10,
  });
  const labels = agg.rows.map(r => String(r.dimVals[0]));
  const data = agg.rows.map(r => r.metricVals[getMetricKey(metric)]);
  const config = {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => theme.palette[i % theme.palette.length]),
        borderColor: '#fff', borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: donut ? '62%' : '0%',
      plugins: {
        legend: { display: !!showLegend, position: 'right', labels: { boxWidth: 10, usePointStyle: true, padding: 12, font: { size: 11 } } },
        tooltip: {
          backgroundColor: '#202124', padding: 10, cornerRadius: 6,
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a,b) => a+b, 0) || 1;
              return `${ctx.label}: ${fmtCompact(ctx.parsed)} (${(ctx.parsed/total*100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  };
  return <div style={{ height: '100%', position: 'relative' }}><StudioChart config={config} deps={[JSON.stringify(widget), dataset.id]} /></div>;
}

// ============== Table ==============
function TableWidget({ widget, dataset, theme }) {
  const { dimensions, metrics, pageSize, showRowNumbers } = widget.config;
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState(null);
  if ((!dimensions || !dimensions.length) && (!metrics || !metrics.length)) {
    return <EmptyState message="Add dimensions or metrics in Setup" />;
  }
  const agg = aggregate({
    rows: dataset.rows, dimensions: dimensions || [], metrics: metrics || [],
    filters: widget.config.filters || [], calcFields: dataset.calcFields || [],
    sort,
  });
  const ps = pageSize || 10;
  const totalPages = Math.max(1, Math.ceil(agg.rows.length / ps));
  const pageRows = agg.rows.slice((page-1)*ps, page*ps);

  const headerCell = (label, onClick, active, align) => (
    <th onClick={onClick} style={{
      textAlign: align || 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500,
      color: active ? theme.accent : theme.muted, textTransform: 'uppercase', letterSpacing: '.04em',
      borderBottom: `1px solid ${theme.border}`, background: '#FAFBFC', cursor: onClick ? 'pointer' : 'default',
      whiteSpace: 'nowrap', userSelect: 'none',
    }}>{label}{active && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>}</th>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {showRowNumbers && headerCell('#', null, false, 'right')}
              {(dimensions||[]).map((d, i) => headerCell(d.name || d.fieldId,
                () => setSort(s => ({ fieldId: d.fieldId, dir: s && s.fieldId === d.fieldId && s.dir === 'desc' ? 'asc' : 'desc' })),
                sort && sort.fieldId === d.fieldId, 'left'))}
              {(metrics||[]).map((m, i) => {
                const key = getMetricKey(m);
                return headerCell(m.name || metricLabel(m, dataset.fieldMap),
                  () => setSort(s => ({ metricKey: key, dir: s && s.metricKey === key && s.dir === 'desc' ? 'asc' : 'desc' })),
                  sort && sort.metricKey === key, 'right');
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
                {showRowNumbers && <td style={tdStyle('right', theme)}>{(page-1)*ps + i + 1}</td>}
                {(dimensions||[]).map((d, di) => (
                  <td key={di} style={tdStyle('left', theme)}>{String(r.dimVals[di] ?? '')}</td>
                ))}
                {(metrics||[]).map((m, mi) => (
                  <td key={mi} style={tdStyle('right', theme)}>{fmtCompact(r.metricVals[getMetricKey(m)])}</td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={(dimensions||[]).length + (metrics||[]).length + (showRowNumbers?1:0)}
                style={{ padding: 24, textAlign: 'center', color: '#9AA0A6' }}>No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {agg.rows.length > ps && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', fontSize: 11.5, color: theme.muted }}>
          <div>{((page-1)*ps+1).toLocaleString()}–{Math.min(page*ps, agg.rows.length).toLocaleString()} of {agg.rows.length.toLocaleString()}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} style={tblBtn(theme, page===1)}>‹</button>
            <span style={{ padding: '0 6px' }}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages} style={tblBtn(theme, page===totalPages)}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}
const tdStyle = (align, theme) => ({ padding: '8px 12px', textAlign: align, color: theme.text, fontVariantNumeric: align === 'right' ? 'tabular-nums' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 });
const tblBtn = (theme, dis) => ({ padding: '2px 8px', border: `1px solid ${theme.border}`, background: '#fff', color: dis ? '#BDC1C6' : theme.accent, cursor: dis ? 'not-allowed' : 'pointer', borderRadius: 3, fontSize: 11, fontFamily: 'inherit' });

// ============== Pivot ==============
function PivotWidget({ widget, dataset, theme }) {
  const { rowDims, colDim, metric } = widget.config;
  if (!rowDims || !rowDims.length || !colDim || !colDim.fieldId || !metric || !metric.fieldId) {
    return <EmptyState message="Pick row dims, column dim, and metric" />;
  }
  const agg = aggregate({
    rows: dataset.rows, dimensions: [...rowDims, colDim], metrics: [metric],
    filters: widget.config.filters || [], calcFields: dataset.calcFields || [],
  });
  const key = getMetricKey(metric);
  const colVals = [...new Set(agg.rows.map(r => r.dimVals[rowDims.length]))];
  // group by row tuple
  const byRow = new Map();
  for (const r of agg.rows) {
    const rowKey = r.dimVals.slice(0, rowDims.length).join('\u001F');
    let entry = byRow.get(rowKey);
    if (!entry) { entry = { dimVals: r.dimVals.slice(0, rowDims.length), cells: {} }; byRow.set(rowKey, entry); }
    entry.cells[r.dimVals[rowDims.length]] = r.metricVals[key];
  }
  const allCells = [...byRow.values()].flatMap(e => Object.values(e.cells));
  const max = Math.max(...allCells, 1);

  return (
    <div style={{ height: '100%', overflow: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {rowDims.map((d, i) => (
              <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: theme.muted, textTransform: 'uppercase', letterSpacing: '.04em', background: '#FAFBFC', borderBottom: `1px solid ${theme.border}` }}>{d.name || d.fieldId}</th>
            ))}
            {colVals.map(c => (
              <th key={c} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: theme.muted, background: '#FAFBFC', borderBottom: `1px solid ${theme.border}`, whiteSpace: 'nowrap' }}>{String(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...byRow.values()].map((e, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${theme.border}` }}>
              {e.dimVals.map((v, di) => (
                <td key={di} style={{ padding: '6px 12px', color: theme.text, fontWeight: 500 }}>{String(v)}</td>
              ))}
              {colVals.map(c => {
                const v = e.cells[c] || 0;
                const t = max ? Math.min(1, v/max) : 0;
                return (
                  <td key={c} style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <div style={{
                      padding: '4px 8px', borderRadius: 3,
                      background: v > 0 ? `rgba(26,115,232,${0.08 + t * 0.5})` : 'transparent',
                      color: t > 0.6 ? '#fff' : theme.text,
                    }}>{v ? fmtCompact(v) : ''}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============== Heatmap ==============
function HeatmapWidget({ widget, dataset, theme }) {
  const { rowDim, colDim, metric, limit } = widget.config;
  if (!rowDim || !rowDim.fieldId || !colDim || !colDim.fieldId || !metric || !metric.fieldId) {
    return <EmptyState message="Pick row, column and metric" />;
  }
  const agg = aggregate({
    rows: dataset.rows, dimensions: [rowDim, colDim], metrics: [metric],
    filters: widget.config.filters || [], calcFields: dataset.calcFields || [],
  });
  const key = getMetricKey(metric);
  // pick top rows by total
  const rowTotals = {};
  for (const r of agg.rows) rowTotals[r.dimVals[0]] = (rowTotals[r.dimVals[0]] || 0) + r.metricVals[key];
  const rowsSorted = Object.entries(rowTotals).sort((a,b) => b[1] - a[1]).slice(0, limit || 15).map(([k]) => k);
  const cols = [...new Set(agg.rows.map(r => r.dimVals[1]))].sort();
  const cell = (r, c) => {
    const found = agg.rows.find(x => x.dimVals[0] === r && x.dimVals[1] === c);
    return found ? found.metricVals[key] : 0;
  };
  const max = Math.max(...agg.rows.map(r => r.metricVals[key]), 1);
  const cellH = 28;
  const colorFor = (v) => {
    if (v <= 0) return '#F8F9FA';
    const t = Math.min(1, v/max);
    const r = Math.round(232 + (26-232) * t);
    const g = Math.round(240 + (115-240) * t);
    const b = Math.round(254 + (232-254) * t);
    return `rgb(${r},${g},${b})`;
  };
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${cols.length}, minmax(48px, 1fr))`, gap: 2, fontSize: 11, color: theme.muted }}>
        <div></div>
        {cols.map((c, i) => <div key={i} style={{ padding: '4px 6px', textAlign: 'center', fontWeight: 500 }}>{String(c)}</div>)}
        {rowsSorted.map(r => (
          <React.Fragment key={r}>
            <div style={{ padding: '4px 8px', fontWeight: 500, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(r)}>{String(r)}</div>
            {cols.map(c => {
              const v = cell(r, c);
              const light = v / max < 0.45;
              return (
                <div key={c} title={`${r} · ${c}: ${fmtFull(v)}`} style={{
                  background: colorFor(v), color: light ? theme.text : '#fff',
                  padding: '4px 6px', textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                  borderRadius: 3, height: cellH - 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{v > 0 ? fmtCompact(v) : ''}</div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ============== Treemap ==============
function TreemapWidget({ widget, dataset, theme }) {
  const { dimension, metric, limit } = widget.config;
  if (!dimension || !dimension.fieldId || !metric || !metric.fieldId) {
    return <EmptyState message="Pick a dimension and a metric" />;
  }
  const agg = aggregate({
    rows: dataset.rows, dimensions: [dimension], metrics: [metric],
    filters: widget.config.filters || [], calcFields: dataset.calcFields || [], limit: limit || 30,
  });
  const items = agg.rows.map((r, i) => ({
    label: String(r.dimVals[0]),
    value: r.metricVals[getMetricKey(metric)] || 0,
    color: theme.palette[i % theme.palette.length],
  })).filter(i => i.value > 0);
  if (!items.length) return <EmptyState message="No data" />;
  const rects = squarifyLayout(items, 0, 0, 100, 100);
  const total = items.reduce((a,b) => a+b.value, 0);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', background: '#F8F9FA', borderRadius: 6, overflow: 'hidden' }}>
      {rects.map((rect, i) => {
        const pct = (rect.value/total*100).toFixed(1);
        const small = rect.w < 12 || rect.h < 10;
        return (
          <div key={i} title={`${rect.label}: ${fmtFull(rect.value)} (${pct}%)`} style={{
            position: 'absolute', left: rect.x + '%', top: rect.y + '%', width: rect.w + '%', height: rect.h + '%',
            background: rect.color, color: '#fff', padding: 8, boxSizing: 'border-box', border: '1px solid #fff',
            fontSize: 12, lineHeight: 1.2, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {!small && <>
              <div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rect.label}</div>
              <div style={{ fontSize: 11, opacity: 0.9 }}>{fmtCompact(rect.value)}</div>
              <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 'auto' }}>{pct}%</div>
            </>}
          </div>
        );
      })}
    </div>
  );
}

function squarifyLayout(items, x0, y0, x1, y1) {
  const rects = [];
  const sorted = [...items].sort((a,b) => b.value - a.value);
  function place(items, x0, y0, x1, y1) {
    const totalV = items.reduce((a,b) => a+b.value,0) || 1;
    const w = x1 - x0, h = y1 - y0;
    if (items.length === 0) return;
    if (items.length === 1) { rects.push({ ...items[0], x: x0, y: y0, w, h }); return; }
    const horiz = w >= h;
    let split = 1, bestScore = Infinity, row = [];
    for (let i = 1; i <= items.length; i++) {
      const slice = items.slice(0, i);
      const sV = slice.reduce((a,b)=>a+b.value,0);
      const len = horiz ? (sV/totalV) * w : (sV/totalV) * h;
      const breadth = horiz ? h : w;
      let worst = 0;
      for (const it of slice) {
        const aR = (it.value/sV) * breadth;
        const ratio = Math.max(aR/len, len/aR);
        if (ratio > worst) worst = ratio;
      }
      if (worst < bestScore) { bestScore = worst; split = i; row = slice; } else break;
    }
    const rowV = row.reduce((a,b)=>a+b.value,0);
    if (horiz) {
      const rowW = (rowV/totalV) * w;
      let yy = y0;
      for (const it of row) { const itH = (it.value/rowV) * h; rects.push({ ...it, x: x0, y: yy, w: rowW, h: itH }); yy += itH; }
      place(items.slice(split), x0 + rowW, y0, x1, y1);
    } else {
      const rowH = (rowV/totalV) * h;
      let xx = x0;
      for (const it of row) { const itW = (it.value/rowV) * w; rects.push({ ...it, x: xx, y: y0, w: itW, h: rowH }); xx += itW; }
      place(items.slice(split), x0, y0 + rowH, x1, y1);
    }
  }
  place(sorted, x0, y0, x1, y1);
  return rects;
}

// ============== Text / Divider ==============
function TextWidget({ widget, theme }) {
  const c = widget.config;
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center',
      justifyContent: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start',
      fontSize: c.size || 16, fontWeight: c.weight || 500,
      color: c.color || theme.text, padding: '4px 8px',
    }}>{c.text || 'Click to edit text'}</div>
  );
}
function DividerWidget({ widget, theme }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center' }}><div style={{ width: '100%', height: 1, background: widget.config.color || theme.border }}></div></div>;
}

// ============== Dispatcher ==============
function WidgetBody({ widget, dataset, theme }) {
  switch (widget.type) {
    case 'scorecard': return <ScorecardWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'line':      return <LineWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'area':      return <LineWidget widget={widget} dataset={dataset} theme={theme} area />;
    case 'bar':       return <BarWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'hbar':      return <BarWidget widget={widget} dataset={dataset} theme={theme} horizontal />;
    case 'stacked':   return <BarWidget widget={widget} dataset={dataset} theme={theme} stacked />;
    case 'pie':       return <PieWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'donut':     return <PieWidget widget={widget} dataset={dataset} theme={theme} donut />;
    case 'table':     return <TableWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'pivot':     return <PivotWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'heatmap':   return <HeatmapWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'treemap':   return <TreemapWidget widget={widget} dataset={dataset} theme={theme} />;
    case 'text':      return <TextWidget widget={widget} theme={theme} />;
    case 'divider':   return <DividerWidget widget={widget} theme={theme} />;
    default:          return <EmptyState message={`Unknown widget: ${widget.type}`} />;
  }
}

Object.assign(window, { WidgetBody, getMetricKey });
