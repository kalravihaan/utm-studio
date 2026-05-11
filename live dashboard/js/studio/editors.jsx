// Property panels: Setup (data/dimensions/metrics) + Style (colors/labels)
// Used by the right-side panel when a widget is selected.

function PropPanel({ widget, dataset, theme, fields, updateWidget }) {
  const [section, setSection] = React.useState('setup');
  const upd = (patch) => updateWidget(w => ({ ...w, ...patch }));
  const updCfg = (patch) => updateWidget(w => ({ ...w, config: { ...w.config, ...patch } }));

  if (!widget) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: theme.muted }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: theme.text, marginBottom: 8 }}>No widget selected</div>
        <div>Click a widget on the canvas to configure it, or use the <strong>+ Add</strong> menu to insert one.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}` }}>
        {['setup', 'style'].map(s => (
          <button key={s} onClick={() => setSection(s)} style={{
            flex: 1, padding: '10px 0', border: 'none', background: 'transparent',
            fontSize: 12.5, fontWeight: 500, color: section === s ? theme.accent : theme.muted,
            borderBottom: section === s ? `2px solid ${theme.accent}` : '2px solid transparent',
            cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit',
          }}>{s}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {section === 'setup'
          ? <SetupPanel widget={widget} dataset={dataset} theme={theme} fields={fields} upd={upd} updCfg={updCfg} />
          : <StylePanel widget={widget} theme={theme} upd={upd} updCfg={updCfg} />}
      </div>
    </div>
  );
}

function Row({ label, children, theme, help }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: theme.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{label}</div>
      {children}
      {help && <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>{help}</div>}
    </div>
  );
}

const inputStyle = (theme) => ({
  width: '100%', padding: '6px 8px', border: `1px solid ${theme.border}`, borderRadius: 4,
  fontSize: 12.5, fontFamily: 'inherit', color: theme.text, background: '#fff', outline: 'none', boxSizing: 'border-box',
});

const btnStyle = (theme, primary) => ({
  padding: '6px 10px', borderRadius: 4, border: primary ? 'none' : `1px solid ${theme.border}`,
  background: primary ? theme.accent : '#fff', color: primary ? '#fff' : theme.text,
  fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
});

// Dimension picker (single)
function DimPicker({ value, onChange, fields, theme, label = 'Dimension', allowClear, dateGranularity }) {
  return (
    <Row label={label} theme={theme}>
      <select value={value && value.fieldId || ''} onChange={e => {
        const f = fields.find(x => x.id === e.target.value);
        onChange(f ? { fieldId: f.id, name: f.name } : null);
      }} style={inputStyle(theme)}>
        <option value="">{allowClear ? '— none —' : '— pick a field —'}</option>
        {fields.map(f => <option key={f.id} value={f.id}>{f.name} {f.dataType === 'date' ? '📅' : f.dataType === 'number' ? '#' : 'ab'}</option>)}
      </select>
      {dateGranularity && value && (fields.find(f => f.id === value.fieldId)||{}).dataType === 'date' && (
        <select value={value.granularity || 'month'} onChange={e => onChange({ ...value, granularity: e.target.value })}
          style={{ ...inputStyle(theme), marginTop: 6 }}>
          <option value="day">By day</option>
          <option value="month">By month</option>
          <option value="year">By year</option>
        </select>
      )}
    </Row>
  );
}

// Metric picker (single, with agg)
function MetricPicker({ value, onChange, fields, theme, label = 'Metric' }) {
  return (
    <Row label={label} theme={theme}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={value && value.fieldId || ''} onChange={e => {
          const f = fields.find(x => x.id === e.target.value);
          if (!f) return onChange(null);
          onChange({ fieldId: f.id, name: f.name, agg: f.defaultAgg || 'SUM' });
        }} style={{ ...inputStyle(theme), flex: 2 }}>
          <option value="">— pick a field —</option>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={value && value.agg || 'SUM'} onChange={e => onChange({ ...value, agg: e.target.value })}
          disabled={!value} style={{ ...inputStyle(theme), flex: 1 }}>
          {Object.keys(AGG_FNS).map(a => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
        </select>
      </div>
    </Row>
  );
}

// Multi-metric list with reorder + remove
function MetricList({ values, onChange, fields, theme, label = 'Metrics' }) {
  const add = () => onChange([...(values||[]), { fieldId: null, agg: 'SUM' }]);
  const update = (i, v) => { const arr = [...values]; arr[i] = v; onChange(arr); };
  const remove = (i) => { const arr = [...values]; arr.splice(i, 1); onChange(arr); };
  return (
    <Row label={label} theme={theme}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(values || []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={m.fieldId || ''} onChange={e => {
              const f = fields.find(x => x.id === e.target.value);
              update(i, f ? { fieldId: f.id, name: f.name, agg: m.agg || f.defaultAgg || 'SUM' } : { ...m, fieldId: null });
            }} style={{ ...inputStyle(theme), flex: 2 }}>
              <option value="">— field —</option>
              {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={m.agg || 'SUM'} onChange={e => update(i, { ...m, agg: e.target.value })}
              style={{ ...inputStyle(theme), flex: 1 }}>
              {Object.keys(AGG_FNS).map(a => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
            </select>
            <button onClick={() => remove(i)} style={{ ...btnStyle(theme), padding: '4px 8px', color: '#C5221F' }} title="Remove">×</button>
          </div>
        ))}
        <button onClick={add} style={{ ...btnStyle(theme), alignSelf: 'flex-start' }}>+ Add metric</button>
      </div>
    </Row>
  );
}

// Multi-dimension list (table widget)
function DimList({ values, onChange, fields, theme, label = 'Dimensions' }) {
  const add = () => onChange([...(values||[]), { fieldId: null }]);
  const update = (i, v) => { const arr = [...values]; arr[i] = v; onChange(arr); };
  const remove = (i) => { const arr = [...values]; arr.splice(i, 1); onChange(arr); };
  return (
    <Row label={label} theme={theme}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(values || []).map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={d.fieldId || ''} onChange={e => {
              const f = fields.find(x => x.id === e.target.value);
              update(i, f ? { fieldId: f.id, name: f.name } : { ...d, fieldId: null });
            }} style={{ ...inputStyle(theme), flex: 1 }}>
              <option value="">— field —</option>
              {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button onClick={() => remove(i)} style={{ ...btnStyle(theme), padding: '4px 8px', color: '#C5221F' }}>×</button>
          </div>
        ))}
        <button onClick={add} style={{ ...btnStyle(theme), alignSelf: 'flex-start' }}>+ Add dimension</button>
      </div>
    </Row>
  );
}

function SetupPanel({ widget, dataset, theme, fields, upd, updCfg }) {
  const c = widget.config || {};
  // Title row appears for all widgets
  return (
    <div>
      <Row label="Widget title" theme={theme}>
        <input type="text" value={widget.title || ''} onChange={e => upd({ title: e.target.value })}
          placeholder="(auto)" style={inputStyle(theme)} />
      </Row>
      {widget.type === 'scorecard' && (
        <MetricPicker value={c.metric} onChange={m => updCfg({ metric: m })} fields={fields} theme={theme} />
      )}
      {(widget.type === 'line' || widget.type === 'area') && (
        <>
          <DimPicker value={c.dimension} onChange={d => updCfg({ dimension: d })} fields={fields} theme={theme} dateGranularity />
          <MetricList values={c.metrics} onChange={m => updCfg({ metrics: m })} fields={fields} theme={theme} />
          <DimPicker value={c.breakdown} onChange={d => updCfg({ breakdown: d })} fields={fields} theme={theme} label="Breakdown (optional)" allowClear />
          <Row label="Options" theme={theme}>
            <label style={chkLbl(theme)}><input type="checkbox" checked={!!c.smooth} onChange={e => updCfg({ smooth: e.target.checked })} /> Smooth lines</label>
            <label style={chkLbl(theme)}><input type="checkbox" checked={!!c.showLegend} onChange={e => updCfg({ showLegend: e.target.checked })} /> Show legend</label>
          </Row>
        </>
      )}
      {(widget.type === 'bar' || widget.type === 'hbar' || widget.type === 'stacked') && (
        <>
          <DimPicker value={c.dimension} onChange={d => updCfg({ dimension: d })} fields={fields} theme={theme} dateGranularity />
          <MetricList values={c.metrics} onChange={m => updCfg({ metrics: m })} fields={fields} theme={theme} />
          <DimPicker value={c.breakdown} onChange={d => updCfg({ breakdown: d })} fields={fields} theme={theme} label="Breakdown (optional)" allowClear />
          <Row label="Limit rows" theme={theme}>
            <input type="number" min={1} max={500} value={c.limit ?? 20} onChange={e => updCfg({ limit: +e.target.value || null })} style={inputStyle(theme)} />
          </Row>
          <Row label="Options" theme={theme}>
            <label style={chkLbl(theme)}><input type="checkbox" checked={!!c.sortDesc} onChange={e => updCfg({ sortDesc: e.target.checked })} /> Sort descending</label>
            <label style={chkLbl(theme)}><input type="checkbox" checked={!!c.showLegend} onChange={e => updCfg({ showLegend: e.target.checked })} /> Show legend</label>
          </Row>
        </>
      )}
      {(widget.type === 'pie' || widget.type === 'donut') && (
        <>
          <DimPicker value={c.dimension} onChange={d => updCfg({ dimension: d })} fields={fields} theme={theme} />
          <MetricPicker value={c.metric} onChange={m => updCfg({ metric: m })} fields={fields} theme={theme} />
          <Row label="Slices to show" theme={theme}>
            <input type="number" min={1} max={50} value={c.limit ?? 10} onChange={e => updCfg({ limit: +e.target.value || 10 })} style={inputStyle(theme)} />
          </Row>
        </>
      )}
      {widget.type === 'table' && (
        <>
          <DimList values={c.dimensions} onChange={v => updCfg({ dimensions: v })} fields={fields} theme={theme} />
          <MetricList values={c.metrics} onChange={v => updCfg({ metrics: v })} fields={fields} theme={theme} />
          <Row label="Rows per page" theme={theme}>
            <select value={c.pageSize || 10} onChange={e => updCfg({ pageSize: +e.target.value })} style={inputStyle(theme)}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Row>
          <label style={chkLbl(theme)}><input type="checkbox" checked={!!c.showRowNumbers} onChange={e => updCfg({ showRowNumbers: e.target.checked })} /> Show row numbers</label>
        </>
      )}
      {widget.type === 'pivot' && (
        <>
          <DimList values={c.rowDims} onChange={v => updCfg({ rowDims: v })} fields={fields} theme={theme} label="Row dimensions" />
          <DimPicker value={c.colDim} onChange={d => updCfg({ colDim: d })} fields={fields} theme={theme} label="Column dimension" />
          <MetricPicker value={c.metric} onChange={m => updCfg({ metric: m })} fields={fields} theme={theme} />
        </>
      )}
      {widget.type === 'heatmap' && (
        <>
          <DimPicker value={c.rowDim} onChange={d => updCfg({ rowDim: d })} fields={fields} theme={theme} label="Row dimension" />
          <DimPicker value={c.colDim} onChange={d => updCfg({ colDim: d })} fields={fields} theme={theme} label="Column dimension" />
          <MetricPicker value={c.metric} onChange={m => updCfg({ metric: m })} fields={fields} theme={theme} />
          <Row label="Top N rows" theme={theme}>
            <input type="number" min={1} max={50} value={c.limit ?? 15} onChange={e => updCfg({ limit: +e.target.value || 15 })} style={inputStyle(theme)} />
          </Row>
        </>
      )}
      {widget.type === 'treemap' && (
        <>
          <DimPicker value={c.dimension} onChange={d => updCfg({ dimension: d })} fields={fields} theme={theme} />
          <MetricPicker value={c.metric} onChange={m => updCfg({ metric: m })} fields={fields} theme={theme} />
          <Row label="Limit tiles" theme={theme}>
            <input type="number" min={1} max={100} value={c.limit ?? 30} onChange={e => updCfg({ limit: +e.target.value || 30 })} style={inputStyle(theme)} />
          </Row>
        </>
      )}
      {widget.type === 'text' && (
        <>
          <Row label="Text content" theme={theme}>
            <textarea value={c.text || ''} onChange={e => updCfg({ text: e.target.value })} rows={3} style={{ ...inputStyle(theme), resize: 'vertical', fontFamily: 'inherit' }} />
          </Row>
          <Row label="Font size" theme={theme}>
            <input type="number" min={8} max={48} value={c.size || 16} onChange={e => updCfg({ size: +e.target.value || 16 })} style={inputStyle(theme)} />
          </Row>
          <Row label="Weight" theme={theme}>
            <select value={c.weight || 500} onChange={e => updCfg({ weight: +e.target.value })} style={inputStyle(theme)}>
              <option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option>
            </select>
          </Row>
          <Row label="Align" theme={theme}>
            <select value={c.align || 'left'} onChange={e => updCfg({ align: e.target.value })} style={inputStyle(theme)}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
          </Row>
        </>
      )}
    </div>
  );
}

function StylePanel({ widget, theme, upd, updCfg }) {
  const c = widget.config || {};
  return (
    <div>
      <Row label="Size on grid" theme={theme}>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1, fontSize: 11, color: theme.muted }}>Width
            <input type="number" min={1} max={GRID_COLS} value={widget.w} onChange={e => upd({ w: Math.max(1, Math.min(GRID_COLS, +e.target.value)) })} style={inputStyle(theme)} />
          </label>
          <label style={{ flex: 1, fontSize: 11, color: theme.muted }}>Height
            <input type="number" min={1} max={20} value={widget.h} onChange={e => upd({ h: Math.max(1, Math.min(20, +e.target.value)) })} style={inputStyle(theme)} />
          </label>
        </div>
      </Row>
      <Row label="Preset" theme={theme}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[['S',3,3],['M',6,4],['L',8,5],['Full',12,6]].map(([lbl,w,h]) => (
            <button key={lbl} onClick={() => upd({ w, h })} style={btnStyle(theme)}>{lbl}</button>
          ))}
        </div>
      </Row>
      {(widget.type === 'scorecard') && (
        <Row label="Accent color" theme={theme}>
          <ColorPicker value={c.accent || theme.accent} onChange={v => updCfg({ accent: v })} theme={theme} />
        </Row>
      )}
      <Row label="Title color" theme={theme}>
        <input type="text" value={widget.titleColor || ''} placeholder={theme.text} onChange={e => upd({ titleColor: e.target.value })} style={inputStyle(theme)} />
      </Row>
    </div>
  );
}

function ColorPicker({ value, onChange, theme }) {
  const swatches = ['#1A73E8','#0F9D58','#9334E6','#E37400','#EA4335','#46BDC6','#FF6D00','#202124'];
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {swatches.map(s => (
        <button key={s} onClick={() => onChange(s)} style={{
          width: 22, height: 22, borderRadius: 4, border: value === s ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
          background: s, cursor: 'pointer', padding: 0,
        }} title={s}></button>
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
    </div>
  );
}

const chkLbl = (theme) => ({ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: theme.text, marginBottom: 6, cursor: 'pointer' });

Object.assign(window, { PropPanel, Row, DimPicker, MetricPicker, MetricList, DimList, ColorPicker, inputStyle, btnStyle, chkLbl });
