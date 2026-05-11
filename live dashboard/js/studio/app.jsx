// Top-level Studio app: dashboard switcher, file management, edit mode, tabs,
// undo/redo, theme, export/import.

const PERSIST_DEBOUNCE_MS = 400;

function StudioApp() {
  const [dashboard, setDashboard] = React.useState(null);          // current dashboard object
  const [history, setHistory] = React.useState(null);              // undo history of dashboard
  const [dataset, setDataset] = React.useState(null);              // full dataset of current dashboard
  const [datasets, setDatasets] = React.useState([]);              // list of recent datasets (metadata)
  const [dashboards, setDashboards] = React.useState([]);
  const [activeTabId, setActiveTabId] = React.useState(null);
  const [selectedWidgetId, setSelectedWidgetId] = React.useState(null);
  const [editMode, setEditMode] = React.useState(true);
  const [showLibrary, setShowLibrary] = React.useState(false);
  const [showDashboardMenu, setShowDashboardMenu] = React.useState(false);
  const [showDataMenu, setShowDataMenu] = React.useState(false);
  const [uploadStatus, setUploadStatus] = React.useState(null);
  const [confirmingTabDel, setConfirmingTabDel] = React.useState(null);
  const fileInputRef = React.useRef(null);

  // Refresh dashboards + datasets listings
  const refreshLists = React.useCallback(async () => {
    setDashboards(await dbListDashboards());
    setDatasets(await dbListDatasets());
  }, []);

  // Initial load: pick latest dashboard or create one
  React.useEffect(() => {
    (async () => {
      Chart.defaults.font.family = "'Roboto','Helvetica Neue',Arial,sans-serif";
      Chart.defaults.color = '#5F6368';
      Chart.defaults.borderColor = '#E8EAED';

      await refreshLists();
      const list = await dbListDashboards();
      let current;
      const currentId = await dbMetaGet('currentDashboardId');
      if (currentId) current = await dbGetDashboard(currentId);
      if (!current && list.length) current = list[0];
      if (!current) {
        // First run: seed the FY-26 preset and try to load the bundled master sheet
        current = buildFY26Dashboard();
        setUploadStatus({ state: 'loading', msg: 'Setting up FY-26 dashboard…' });
        const ds = await loadBundledFY26Dataset(msg => setUploadStatus({ state: 'loading', msg }));
        if (ds) current.datasetId = ds.id;
        await dbSaveDashboard(current);
        if (ds) {
          setUploadStatus({ state: 'success', msg: `Loaded ${ds.rows.length.toLocaleString()} rows · ${ds.fields.length} fields` });
          setTimeout(() => setUploadStatus(null), 3500);
        } else {
          setUploadStatus({ state: 'success', msg: 'FY-26 dashboard ready — upload your data to populate it' });
          setTimeout(() => setUploadStatus(null), 4500);
        }
      }
      await openDashboard(current.id);
    })();
  }, []);

  // Open a dashboard by id
  const openDashboard = React.useCallback(async (id) => {
    const d = await dbGetDashboard(id);
    if (!d) return;
    await dbMetaSet('currentDashboardId', id);
    setDashboard(d);
    setHistory(makeHistory(d));
    setActiveTabId(d.tabs[0]?.id || null);
    setSelectedWidgetId(null);
    if (d.datasetId) {
      const ds = await dbGetDataset(d.datasetId);
      setDataset(ds || null);
    } else {
      setDataset(null);
    }
    await refreshLists();
  }, [refreshLists]);

  // Persist dashboard (debounced)
  const persistTimer = React.useRef(null);
  const queuePersist = React.useCallback((d) => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      await dbSaveDashboard(d);
      setDashboards(await dbListDashboards());
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  // Mutate dashboard with optional history push
  const updateDashboard = React.useCallback((updater, pushHistory = true) => {
    setDashboard(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next === prev) return prev;
      const stamped = { ...next, updatedAt: Date.now() };
      if (pushHistory) setHistory(h => historyPush(h, stamped));
      else setHistory(h => ({ ...h, present: stamped }));
      queuePersist(stamped);
      return stamped;
    });
  }, [queuePersist]);

  const undo = React.useCallback(() => {
    setHistory(h => {
      if (!h.past.length) return h;
      const next = historyUndo(h);
      setDashboard(next.present);
      queuePersist(next.present);
      return next;
    });
  }, [queuePersist]);
  const redo = React.useCallback(() => {
    setHistory(h => {
      if (!h.future.length) return h;
      const next = historyRedo(h);
      setDashboard(next.present);
      queuePersist(next.present);
      return next;
    });
  }, [queuePersist]);

  // ----- Tab helpers -----
  const activeTab = dashboard?.tabs.find(t => t.id === activeTabId) || dashboard?.tabs[0];

  const updateTab = React.useCallback((updater, pushHistory = true) => {
    updateDashboard(d => {
      if (!d) return d;
      const tabs = d.tabs.map(t => t.id === activeTab.id ? (typeof updater === 'function' ? updater(t) : updater) : t);
      return { ...d, tabs };
    }, pushHistory);
  }, [activeTab, updateDashboard]);

  const addTab = () => {
    updateDashboard(d => {
      const t = newTab(`Page ${d.tabs.length + 1}`);
      setActiveTabId(t.id);
      return { ...d, tabs: [...d.tabs, t] };
    });
  };
  const renameTab = (id, name) => updateDashboard(d => ({ ...d, tabs: d.tabs.map(t => t.id === id ? { ...t, name } : t) }));
  const removeTab = (id) => updateDashboard(d => {
    const tabs = d.tabs.filter(t => t.id !== id);
    if (!tabs.length) tabs.push(newTab('Page 1'));
    if (activeTabId === id) setActiveTabId(tabs[0].id);
    return { ...d, tabs };
  });

  // ----- Add widget -----
  const addWidget = (type) => {
    const w = newWidget(type);
    Object.assign(w, placeNew(activeTab.widgets, w.w, w.h));
    updateTab(t => ({ ...t, widgets: [...t.widgets, w] }));
    setSelectedWidgetId(w.id);
    setShowLibrary(false);
  };

  const selectedWidget = activeTab?.widgets.find(w => w.id === selectedWidgetId);
  const updateSelectedWidget = (updater) => {
    updateTab(t => ({
      ...t,
      widgets: t.widgets.map(w => w.id === selectedWidgetId ? (typeof updater === 'function' ? updater(w) : updater) : w),
    }));
  };

  // ----- Data ----- 
  const datasetView = React.useMemo(() => {
    if (!dataset) return null;
    const fieldMap = {};
    const allFields = [...(dataset.fields || []), ...((dashboard?.calcFields)||[])];
    for (const f of allFields) fieldMap[f.id] = dashboard?.fieldOverrides?.[f.id] ? { ...f, ...dashboard.fieldOverrides[f.id] } : f;
    return {
      id: dataset.id,
      name: dataset.name,
      rows: dataset.rows,
      fields: allFields.map(f => fieldMap[f.id] || f),
      fieldMap,
      calcFields: dashboard?.calcFields || [],
    };
  }, [dataset, dashboard?.calcFields, dashboard?.fieldOverrides]);

  // ----- File upload -----
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus({ state: 'loading', msg: 'Reading file…' });
    try {
      const parsed = await parseAnyExcel(file, msg => setUploadStatus({ state: 'loading', msg }));
      const ds = {
        id: uid('ds_'),
        name: file.name.replace(/\.xlsx?$/i, '') || 'Dataset',
        rows: parsed.rows,
        fields: parsed.fields,
        rawXlsx: parsed.rawBlob,
        sheetName: parsed.sheetName,
      };
      await dbSaveDataset(ds);
      setDataset(ds);
      updateDashboard(d => ({ ...d, datasetId: ds.id }));
      setUploadStatus({ state: 'success', msg: `Loaded ${parsed.rows.length.toLocaleString()} rows · ${parsed.fields.length} fields` });
      setTimeout(() => setUploadStatus(null), 3500);
      await refreshLists();
    } catch (err) {
      console.error(err);
      setUploadStatus({ state: 'error', msg: err.message || String(err) });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ----- Switch to an existing dataset -----
  const switchDataset = async (id) => {
    const ds = await dbGetDataset(id);
    if (!ds) return;
    setDataset(ds);
    updateDashboard(d => ({ ...d, datasetId: id }));
    setShowDataMenu(false);
  };

  // ----- Download current data -----
  const downloadCurrentData = async () => {
    if (!dataset) return;
    let blob;
    let name;
    if (dataset.rawXlsx) {
      blob = dataset.rawXlsx;
      name = (dataset.name || 'data') + '.xlsx';
    } else {
      blob = rowsToXlsxBlob(dataset.rows, dataset.sheetName || 'Sheet1');
      name = (dataset.name || 'data') + '.xlsx';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  };

  // ----- Export / import dashboard JSON -----
  const exportDashboard = async () => {
    const exp = {
      dashboard,
      dataset: dataset ? { id: dataset.id, name: dataset.name, rows: dataset.rows, fields: dataset.fields, sheetName: dataset.sheetName } : null,
      version: 1,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (dashboard.name || 'dashboard') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  };

  const importDashboard = async (file) => {
    const txt = await file.text();
    const j = JSON.parse(txt);
    if (!j.dashboard) throw new Error('Invalid dashboard file');
    const d = { ...j.dashboard, id: uid('d_'), createdAt: Date.now(), updatedAt: Date.now() };
    let dsId = null;
    if (j.dataset) {
      const ds = { ...j.dataset, id: uid('ds_'), rawXlsx: null };
      await dbSaveDataset(ds);
      dsId = ds.id;
    }
    d.datasetId = dsId;
    await dbSaveDashboard(d);
    await openDashboard(d.id);
  };

  // ----- Dashboard CRUD -----
  const createDashboard = async () => {
    const d = newDashboard(`Dashboard ${dashboards.length + 1}`);
    await dbSaveDashboard(d);
    await openDashboard(d.id);
    setShowDashboardMenu(false);
  };
  const duplicateCurrent = async () => {
    if (!dashboard) return;
    const copy = { ...JSON.parse(JSON.stringify(dashboard)), id: uid('d_'), name: dashboard.name + ' (copy)', createdAt: Date.now(), updatedAt: Date.now() };
    await dbSaveDashboard(copy);
    await openDashboard(copy.id);
    setShowDashboardMenu(false);
  };
  const deleteDashboard = async (id) => {
    if (!confirm('Delete this dashboard? Its associated data is kept for other dashboards.')) return;
    await dbDeleteDashboard(id);
    const list = await dbListDashboards();
    if (!list.length) {
      const d = newDashboard('My first dashboard');
      await dbSaveDashboard(d);
      await openDashboard(d.id);
    } else if (id === dashboard.id) {
      await openDashboard(list[0].id);
    } else {
      await refreshLists();
    }
  };
  const renameDashboard = (name) => updateDashboard(d => ({ ...d, name }));

  // ----- Theme tweaks -----
  const updateTheme = (patch) => updateDashboard(d => ({ ...d, theme: { ...d.theme, ...patch } }));

  if (!dashboard) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#5F6368' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #E8EAED', borderTopColor: '#1A73E8', animation: 'spin .9s linear infinite' }}></div>
        <div style={{ fontSize: 13 }}>Loading dashboard…</div>
      </div>
    );
  }

  const theme = dashboard.theme || DEFAULT_THEME;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: theme.background, fontFamily: theme.font }}>
      {/* ============== Top bar ============== */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${theme.border}`, padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div onClick={() => setShowDashboardMenu(s => !s)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 10px', borderRadius: 6, background: showDashboardMenu ? '#F1F3F4' : 'transparent' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg,#1A73E8,#9334E6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>S</div>
          <div>
            <EditableTitle value={dashboard.name} onChange={renameDashboard} style={{ fontSize: 14, fontWeight: 500, color: theme.text }} />
            <div style={{ fontSize: 10.5, color: theme.muted }}>{dataset ? `${dataset.name} · ${dataset.rows.length.toLocaleString()} rows` : 'No data attached'}</div>
          </div>
          <span style={{ color: theme.muted, fontSize: 10, marginLeft: 4 }}>▾</span>
          {showDashboardMenu && (
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)', minWidth: 260, zIndex: 50, padding: 6 }}>
              <div style={{ padding: '6px 10px', fontSize: 10.5, color: theme.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your dashboards</div>
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                {dashboards.map(d => (
                  <div key={d.id} onClick={() => { openDashboard(d.id); setShowDashboardMenu(false); }}
                    style={{ padding: '6px 10px', borderRadius: 4, fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: d.id === dashboard.id ? theme.accent + '14' : 'transparent', color: d.id === dashboard.id ? theme.accent : theme.text }}
                    onMouseEnter={e => { if (d.id !== dashboard.id) e.currentTarget.style.background = '#F8F9FA'; }}
                    onMouseLeave={e => { if (d.id !== dashboard.id) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{d.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteDashboard(d.id); }} title="Delete" style={{ border: 'none', background: 'transparent', color: '#C5221F', cursor: 'pointer', padding: '0 4px', fontSize: 13 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 4, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={createDashboard} style={menuItem(theme)}>+ New dashboard</button>
                <button onClick={duplicateCurrent} style={menuItem(theme)}>⎘ Duplicate current</button>
                <label style={{ ...menuItem(theme), cursor: 'pointer' }}>
                  📂 Import from JSON…
                  <input type="file" accept=".json" style={{ display: 'none' }} onChange={async e => { if (e.target.files?.[0]) { try { await importDashboard(e.target.files[0]); } catch (err) { alert(err.message); } setShowDashboardMenu(false); } }} />
                </label>
                <button onClick={() => { exportDashboard(); setShowDashboardMenu(false); }} style={menuItem(theme)}>⤓ Export current as JSON</button>
                <button onClick={async () => {
                  if (!confirm('Reset the current dashboard back to the FY-26 preset layout? Any custom widgets you added will be removed. (Your data is kept.)')) return;
                  const preset = buildFY26Dashboard();
                  const reset = { ...preset, id: dashboard.id, name: dashboard.name, datasetId: dashboard.datasetId, createdAt: dashboard.createdAt };
                  await dbSaveDashboard(reset);
                  await openDashboard(reset.id);
                  setShowDashboardMenu(false);
                }} style={menuItem(theme)}>⟲ Reset to FY-26 preset</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }}></div>

        {uploadStatus && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: uploadStatus.state === 'error' ? '#FCE8E6' : uploadStatus.state === 'success' ? '#E6F4EA' : '#E8F0FE',
            color: uploadStatus.state === 'error' ? '#C5221F' : uploadStatus.state === 'success' ? '#1B873F' : '#1A73E8',
            border: '1px solid ' + (uploadStatus.state === 'error' ? '#F4C7C3' : uploadStatus.state === 'success' ? '#CEEAD6' : '#D2E3FC'),
          }}>
            {uploadStatus.state === 'loading' && <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }}></div>}
            <span>{uploadStatus.msg}</span>
          </div>
        )}

        <button onClick={undo} disabled={!history?.past.length} title="Undo (Ctrl+Z)" style={topIconBtn(theme, !history?.past.length)}>↶</button>
        <button onClick={redo} disabled={!history?.future.length} title="Redo (Ctrl+Shift+Z)" style={topIconBtn(theme, !history?.future.length)}>↷</button>

        {/* Data menu */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowDataMenu(s => !s)} style={topBtn(theme)}>Data ▾</button>
          {showDataMenu && (
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)', minWidth: 280, zIndex: 50, padding: 6 }}>
              <div style={{ padding: '6px 10px', fontSize: 10.5, color: theme.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Recent files</div>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                {datasets.length === 0 && <div style={{ padding: '6px 10px', fontSize: 12, color: theme.muted }}>None yet</div>}
                {datasets.map(d => (
                  <div key={d.id} onClick={() => switchDataset(d.id)} style={{ padding: '6px 10px', borderRadius: 4, fontSize: 12.5, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', background: d.id === dataset?.id ? theme.accent + '14' : 'transparent', color: d.id === dataset?.id ? theme.accent : theme.text }}>
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div>{d.name}</div>
                      <div style={{ fontSize: 10.5, color: theme.muted }}>{d.rowCount.toLocaleString()} rows · {d.fields.length} fields</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this dataset?')) dbDeleteDataset(d.id).then(refreshLists); }} title="Delete" style={{ border: 'none', background: 'transparent', color: '#C5221F', cursor: 'pointer', padding: '0 4px', fontSize: 13 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 4, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label style={{ ...menuItem(theme), cursor: 'pointer' }}>
                  ⤒ Upload Excel…
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { handleUpload(e); setShowDataMenu(false); }} />
                </label>
                <button onClick={() => { downloadCurrentData(); setShowDataMenu(false); }} disabled={!dataset} style={menuItem(theme, !dataset)}>⤓ Download current data</button>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => setEditMode(m => !m)} title={editMode ? 'Switch to view mode' : 'Switch to edit mode'} style={{ ...topBtn(theme, editMode), background: editMode ? theme.accent : '#fff', color: editMode ? '#fff' : theme.text, border: editMode ? 'none' : `1px solid ${theme.border}`, minWidth: 80 }}>
          {editMode ? '👁 View' : '✎ Edit'}
        </button>
      </div>

      {/* ============== Page tabs ============== */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${theme.border}`, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, overflowX: 'auto' }}>
        {dashboard.tabs.map(t => (
          <TabPill key={t.id} tab={t} active={t.id === activeTabId} editMode={editMode} theme={theme}
            onSelect={() => setActiveTabId(t.id)}
            onRename={(name) => renameTab(t.id, name)}
            onDelete={() => dashboard.tabs.length > 1 && removeTab(t.id)}
            canDelete={dashboard.tabs.length > 1}
          />
        ))}
        {editMode && (
          <button onClick={addTab} style={{ padding: '8px 12px', border: 'none', background: 'transparent', color: theme.muted, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }} title="Add page">+ Page</button>
        )}
      </div>

      {/* ============== Widget toolbar (edit mode) ============== */}
      {editMode && (
        <div style={{ background: '#FAFBFC', borderBottom: `1px solid ${theme.border}`, padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: theme.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginRight: 8 }}>Add</span>
          {WIDGET_TYPES.map(wt => (
            <button key={wt.id} onClick={() => addWidget(wt.id)} title={wt.description}
              style={{
                padding: '5px 10px', border: `1px solid ${theme.border}`, borderRadius: 4, background: '#fff',
                fontSize: 12, color: theme.text, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <span style={{ color: theme.accent, fontSize: 13 }}>{wt.icon}</span>{wt.label}
            </button>
          ))}
          <div style={{ flex: 1 }}></div>
          <ThemePicker theme={theme} updateTheme={updateTheme} />
        </div>
      )}

      {/* ============== Body: canvas + properties ============== */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 18, minWidth: 0 }}>
          {!dataset && (
            <div style={{ marginBottom: 14, padding: 14, background: '#FFF8E1', border: `1px solid #F1D67A`, borderRadius: 8, fontSize: 13, color: '#7A5800', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>📊</span>
              <div style={{ flex: 1 }}>
                <strong>No data attached yet.</strong> Upload an Excel file to start building widgets.
              </div>
              <button onClick={() => fileInputRef.current?.click()} style={btnStyle(theme, true)}>Upload Excel</button>
            </div>
          )}
          {activeTab && dataset && (
            <WidgetCanvas tab={activeTab} dataset={datasetView} theme={theme}
              selectedId={selectedWidgetId} onSelect={setSelectedWidgetId} editMode={editMode}
              updateTab={updateTab} />
          )}
          {activeTab && !dataset && activeTab.widgets.length === 0 && (
            <div style={{ padding: 60, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              Upload data to begin, or browse existing dashboards via the title menu.
            </div>
          )}
        </div>
        {editMode && (
          <div style={{ width: 320, borderLeft: `1px solid ${theme.border}`, background: '#fff', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <PropPanel widget={selectedWidget} dataset={datasetView} theme={theme}
              fields={datasetView?.fields || []}
              updateWidget={updateSelectedWidget} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        html, body, #root { margin: 0; padding: 0; height: 100%; }
        body { font-family: ${theme.font}; }
      `}</style>
    </div>
  );
}

function EditableTitle({ value, onChange, style }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  if (editing) {
    return <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { onChange(draft || value); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(draft || value); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
      onClick={e => e.stopPropagation()}
      style={{ ...style, border: '1px solid #1A73E8', borderRadius: 3, padding: '0 4px', outline: 'none', fontFamily: 'inherit' }} />;
  }
  return <div onClick={(e) => { e.stopPropagation(); setEditing(true); }} style={{ ...style, cursor: 'text' }}>{value}</div>;
}

function TabPill({ tab, active, editMode, theme, onSelect, onRename, onDelete, canDelete }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(tab.name);
  React.useEffect(() => setDraft(tab.name), [tab.name]);
  if (editing) {
    return <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { onRename(draft || tab.name); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { onRename(draft || tab.name); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
      style={{ padding: '6px 10px', border: `1px solid ${theme.accent}`, borderRadius: 4, fontSize: 13, fontFamily: 'inherit', margin: '4px 0' }} />;
  }
  return (
    <div onClick={onSelect} onDoubleClick={() => editMode && setEditing(true)} style={{
      padding: '10px 14px', cursor: 'pointer', fontSize: 13,
      color: active ? theme.accent : theme.muted,
      fontWeight: active ? 600 : 500,
      borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    }} title={editMode ? 'Double-click to rename' : ''}>
      {tab.name}
      {editMode && canDelete && (
        <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete page "${tab.name}" and its widgets?`)) onDelete(); }}
          style={{ border: 'none', background: 'transparent', color: theme.muted, cursor: 'pointer', fontSize: 11, padding: 0, opacity: active ? 1 : 0.5 }} title="Delete page">×</button>
      )}
    </div>
  );
}

function ThemePicker({ theme, updateTheme }) {
  const [open, setOpen] = React.useState(false);
  const presets = [
    { name: 'Light', background: '#F1F3F4', cardBg: '#FFFFFF', text: '#202124', muted: '#5F6368', border: '#E8EAED' },
    { name: 'Paper', background: '#FAF8F2', cardBg: '#FFFFFF', text: '#1F1B15', muted: '#6E665A', border: '#EAE2D2' },
    { name: 'Slate', background: '#1F2025', cardBg: '#2A2C33', text: '#E8EAED', muted: '#9AA0A6', border: '#3C4046' },
    { name: 'Mint',  background: '#F0F7F2', cardBg: '#FFFFFF', text: '#1A2E22', muted: '#5C7065', border: '#D9E8DE' },
  ];
  const palettes = [
    ['#1A73E8','#34A853','#FBBC04','#EA4335','#9334E6','#46BDC6','#FF6D00','#0F9D58','#7E57C2','#E37400'],
    ['#0B5394','#1F8A5B','#D97757','#A33E3E','#5E35B1','#00897B','#E65100','#43A047','#5C6BC0','#F9A825'],
    ['#202124','#5F6368','#80868B','#9AA0A6','#BDC1C6','#DADCE0','#F1F3F4','#1A73E8','#EA4335','#34A853'],
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={topBtn(theme)}>🎨 Theme</button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)', padding: 12, minWidth: 240, zIndex: 50 }}>
          <div style={{ fontSize: 11, color: theme.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Background</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {presets.map(p => (
              <button key={p.name} onClick={() => updateTheme(p)} title={p.name}
                style={{ width: 36, height: 32, border: `1px solid ${theme.border}`, borderRadius: 4, cursor: 'pointer',
                  background: `linear-gradient(135deg, ${p.background} 50%, ${p.cardBg} 50%)` }}></button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: theme.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Palette</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {palettes.map((p, i) => (
              <button key={i} onClick={() => updateTheme({ palette: p })} style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 4, overflow: 'hidden', cursor: 'pointer', height: 22, padding: 0, background: 'transparent' }}>
                {p.slice(0, 8).map((c, j) => <div key={j} style={{ flex: 1, background: c }}></div>)}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: theme.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 12, marginBottom: 6 }}>Accent</div>
          <ColorPicker value={theme.accent} onChange={v => updateTheme({ accent: v })} theme={theme} />
        </div>
      )}
    </div>
  );
}

const topBtn = (theme, active) => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${theme.border}`,
  background: active ? theme.accent + '14' : '#fff', color: active ? theme.accent : theme.text,
  fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
});
const topIconBtn = (theme, disabled) => ({
  padding: '6px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
  background: '#fff', color: disabled ? '#BDC1C6' : theme.text,
  fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', minWidth: 32,
});
const menuItem = (theme, disabled) => ({
  display: 'block', width: '100%', textAlign: 'left',
  padding: '7px 10px', border: 'none', background: 'transparent',
  borderRadius: 4, fontSize: 12.5, color: disabled ? '#BDC1C6' : theme.text,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
});

// Keyboard shortcuts
function GlobalKeys() {
  React.useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); document.querySelector('[title="Undo (Ctrl+Z)"]')?.click(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); document.querySelector('[title="Redo (Ctrl+Shift+Z)"]')?.click(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return null;
}

function Root() {
  return <><StudioApp /><GlobalKeys /></>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
