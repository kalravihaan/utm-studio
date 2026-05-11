// Canvas + drag/drop/resize for widgets on a 12-col grid.
// Each widget has integer x,y,w,h. Free-form within the grid; collisions allowed
// (Looker Studio behaviour — widgets can overlap; user manages it).

function WidgetCanvas({ tab, dataset, theme, selectedId, onSelect, editMode, updateTab }) {
  const [drag, setDrag] = React.useState(null); // {wid, mode:'move'|'resize', sx, sy, ox, oy, ow, oh}
  const canvasRef = React.useRef(null);
  const [colW, setColW] = React.useState(80);

  React.useLayoutEffect(() => {
    function measure() {
      if (!canvasRef.current) return;
      const cw = canvasRef.current.clientWidth;
      setColW((cw - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const dx = Math.round((e.clientX - drag.sx) / (colW + GRID_GAP));
      const dy = Math.round((e.clientY - drag.sy) / (GRID_ROW_H + GRID_GAP));
      updateTab(t => {
        const widgets = t.widgets.map(w => {
          if (w.id !== drag.wid) return w;
          if (drag.mode === 'move') {
            return { ...w, x: Math.max(0, Math.min(GRID_COLS - w.w, drag.ox + dx)), y: Math.max(0, drag.oy + dy) };
          } else {
            return { ...w, w: Math.max(1, Math.min(GRID_COLS - w.x, drag.ow + dx)), h: Math.max(1, drag.oh + dy) };
          }
        });
        return { ...t, widgets };
      }, /*pushHistory=*/false);
    }
    function onUp() { updateTab(t => t, true); setDrag(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, colW]);

  // Compute canvas height — fit all widgets + extra rows
  const rows = Math.max(10, ...tab.widgets.map(w => w.y + w.h + 1));

  function startDrag(e, w, mode) {
    if (!editMode) return;
    e.stopPropagation();
    setDrag({ wid: w.id, mode, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.w, oh: w.h });
    onSelect(w.id);
  }

  return (
    <div ref={canvasRef} style={{
      position: 'relative',
      width: '100%',
      minHeight: rows * (GRID_ROW_H + GRID_GAP),
      background: theme.background,
      backgroundImage: editMode ? `repeating-linear-gradient(0deg, transparent, transparent ${GRID_ROW_H + GRID_GAP - 1}px, ${theme.border}77 ${GRID_ROW_H + GRID_GAP - 1}px, ${theme.border}77 ${GRID_ROW_H + GRID_GAP}px)` : 'none',
    }}
      onClick={() => onSelect(null)}
    >
      {tab.widgets.length === 0 && editMode && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: theme.muted, fontSize: 14, pointerEvents: 'none' }}>
          <div style={{ fontSize: 32, opacity: 0.4 }}>＋</div>
          <div>Empty page — add a widget from the toolbar above</div>
        </div>
      )}
      {tab.widgets.map(w => (
        <WidgetFrame key={w.id}
          widget={w} dataset={dataset} theme={theme}
          colW={colW} editMode={editMode}
          selected={selectedId === w.id}
          onSelect={(id) => onSelect(id)}
          onStartMove={(e) => startDrag(e, w, 'move')}
          onStartResize={(e) => startDrag(e, w, 'resize')}
          onAction={(action) => updateTab(t => {
            if (action === 'duplicate') {
              const copy = { ...w, id: uid('w_'), x: Math.min(GRID_COLS - w.w, w.x + 1), y: w.y + w.h };
              return { ...t, widgets: [...t.widgets, copy] };
            }
            if (action === 'delete') return { ...t, widgets: t.widgets.filter(x => x.id !== w.id) };
            return t;
          }, true)}
          onRenameTitle={(title) => updateTab(t => ({ ...t, widgets: t.widgets.map(x => x.id === w.id ? { ...x, title } : x) }), true)}
        />
      ))}
    </div>
  );
}

function WidgetFrame({ widget, dataset, theme, colW, editMode, selected, onSelect, onStartMove, onStartResize, onAction, onRenameTitle }) {
  const w = widget;
  const left = w.x * (colW + GRID_GAP);
  const top = w.y * (GRID_ROW_H + GRID_GAP);
  const width = w.w * colW + (w.w - 1) * GRID_GAP;
  const height = w.h * GRID_ROW_H + (w.h - 1) * GRID_GAP;
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState(w.title);
  const [confirmDel, setConfirmDel] = React.useState(false);

  const transparent = w.type === 'text' || w.type === 'divider';
  const ttl = w.title || (
    w.type === 'scorecard' && w.config.metric ? (w.config.metric.name || w.config.metric.fieldId) :
    w.type === 'text' || w.type === 'divider' ? '' :
    WIDGET_TYPES.find(t => t.id === w.type)?.label || w.type
  );

  return (
    <div onClick={(e) => { e.stopPropagation(); onSelect(w.id); }}
      style={{
        position: 'absolute', left, top, width, height,
        background: transparent ? 'transparent' : theme.cardBg,
        border: selected ? `2px solid ${theme.accent}` : transparent ? '1px dashed transparent' : `1px solid ${theme.border}`,
        borderRadius: theme.cardRadius,
        boxShadow: transparent ? 'none' : '0 1px 2px rgba(0,0,0,.04)',
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {editMode && (
        <div onMouseDown={onStartMove}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 20, cursor: 'move', zIndex: 2 }} title="Drag to move"></div>
      )}
      {(w.type !== 'text' && w.type !== 'divider') && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 4px', gap: 8 }}>
          {editingTitle ? (
            <input autoFocus value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
              onBlur={() => { onRenameTitle(draftTitle); setEditingTitle(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { onRenameTitle(draftTitle); setEditingTitle(false); } if (e.key === 'Escape') setEditingTitle(false); }}
              style={{ flex: 1, padding: '2px 6px', border: `1px solid ${theme.accent}`, borderRadius: 4, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', outline: 'none' }} />
          ) : (
            <div onDoubleClick={() => { if (editMode) { setDraftTitle(w.title || ttl); setEditingTitle(true); } }}
              style={{ fontSize: 13, fontWeight: 500, color: w.titleColor || theme.text, flex: 1, cursor: editMode ? 'text' : 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={editMode ? 'Double-click to rename' : ''}>{ttl}</div>
          )}
          {editMode && (
            <div style={{ display: 'flex', gap: 4, zIndex: 3 }}>
              <button onClick={(e) => { e.stopPropagation(); onAction('duplicate'); }} title="Duplicate" style={iconBtn(theme)}>⎘</button>
              <button onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }} title="Delete" style={{ ...iconBtn(theme), color: '#C5221F' }}>🗑</button>
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: transparent ? 4 : '0 14px 14px', position: 'relative' }}>
        <WidgetBody widget={w} dataset={dataset} theme={theme} />
      </div>
      {editMode && (
        <div onMouseDown={onStartResize} title="Resize"
          style={{ position: 'absolute', right: 2, bottom: 2, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 3,
            background: `linear-gradient(135deg, transparent 50%, ${theme.muted} 50%)`, borderBottomRightRadius: theme.cardRadius }}></div>
      )}
      {confirmDel && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.96)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, textAlign: 'center', zIndex: 4 }}>
          <div style={{ fontSize: 13, color: theme.text }}>Delete this widget?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setConfirmDel(false)} style={btnStyle(theme)}>Cancel</button>
            <button onClick={() => { onAction('delete'); setConfirmDel(false); }} style={{ ...btnStyle(theme, true), background: '#C5221F' }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn = (theme) => ({ padding: '2px 6px', border: `1px solid ${theme.border}`, background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: theme.muted, fontFamily: 'inherit' });

Object.assign(window, { WidgetCanvas });
