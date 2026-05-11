// Dashboard schema + factory functions + undo stack.

const DEFAULT_THEME = {
  background: '#F1F3F4',
  cardBg: '#FFFFFF',
  text: '#202124',
  muted: '#5F6368',
  border: '#E8EAED',
  accent: '#1A73E8',
  palette: ['#1A73E8', '#34A853', '#FBBC04', '#EA4335', '#9334E6', '#46BDC6', '#FF6D00', '#0F9D58', '#7E57C2', '#E37400'],
  font: "'Roboto','Helvetica Neue',Arial,sans-serif",
  density: 'comfortable', // 'compact' | 'comfortable'
  cardRadius: 10,
};

const WIDGET_TYPES = [
  { id: 'scorecard',  label: 'Scorecard',           icon: '#',  description: 'A big number with a label' },
  { id: 'line',       label: 'Line chart',          icon: '~',  description: 'Trend over a dimension' },
  { id: 'bar',        label: 'Bar chart',           icon: '▮',  description: 'Vertical bars by category' },
  { id: 'hbar',       label: 'Horizontal bar',      icon: '▬',  description: 'Horizontal bars by category' },
  { id: 'pie',        label: 'Pie chart',           icon: '◐',  description: 'Share of total' },
  { id: 'donut',      label: 'Donut chart',         icon: '◯',  description: 'Pie with a hole' },
  { id: 'area',       label: 'Area chart',          icon: '◢',  description: 'Stacked area trend' },
  { id: 'stacked',    label: 'Stacked bar',         icon: '▤',  description: 'Bars split by sub-dimension' },
  { id: 'table',      label: 'Table',               icon: '☰',  description: 'Sortable tabular data' },
  { id: 'pivot',      label: 'Pivot table',         icon: '⊞',  description: 'Cross-tabulated table' },
  { id: 'heatmap',    label: 'Heatmap',             icon: '▦',  description: 'Color-coded matrix' },
  { id: 'treemap',    label: 'Treemap',             icon: '▣',  description: 'Nested rectangles' },
  { id: 'text',       label: 'Text',                icon: 'T',  description: 'Free-form label' },
  { id: 'divider',    label: 'Divider',             icon: '—',  description: 'Section break' },
];

// 12-col grid, row height in px
const GRID_COLS = 12;
const GRID_ROW_H = 56;
const GRID_GAP = 12;

function newWidget(type, x = 0, y = 0) {
  const base = { id: uid('w_'), type, x, y, w: 4, h: 4, title: '', config: {} };
  if (type === 'scorecard') {
    return { ...base, w: 3, h: 2, config: { metric: null, compareToTotal: false, showSparkline: false, accent: null } };
  }
  if (type === 'line' || type === 'area') {
    return { ...base, w: 8, h: 5, config: { dimension: null, metrics: [], breakdown: null, smooth: true, showLegend: true } };
  }
  if (type === 'bar' || type === 'hbar' || type === 'stacked') {
    return { ...base, w: 6, h: 5, config: { dimension: null, metrics: [], breakdown: null, showLegend: true, sortDesc: true, limit: 20 } };
  }
  if (type === 'pie' || type === 'donut') {
    return { ...base, w: 4, h: 5, config: { dimension: null, metric: null, limit: 10, showLegend: true } };
  }
  if (type === 'table') {
    return { ...base, w: 12, h: 6, config: { dimensions: [], metrics: [], pageSize: 10, showRowNumbers: false } };
  }
  if (type === 'pivot') {
    return { ...base, w: 12, h: 6, config: { rowDims: [], colDim: null, metric: null } };
  }
  if (type === 'heatmap') {
    return { ...base, w: 12, h: 6, config: { rowDim: null, colDim: null, metric: null, limit: 15 } };
  }
  if (type === 'treemap') {
    return { ...base, w: 6, h: 5, config: { dimension: null, metric: null, limit: 30 } };
  }
  if (type === 'text') {
    return { ...base, w: 12, h: 1, config: { text: 'Section heading', size: 18, weight: 500, color: null, align: 'left' } };
  }
  if (type === 'divider') {
    return { ...base, w: 12, h: 1, config: { color: null } };
  }
  return base;
}

function newTab(name = 'Page 1') {
  return { id: uid('t_'), name, widgets: [] };
}

function newDashboard(name = 'Untitled dashboard') {
  return {
    id: uid('d_'),
    name,
    theme: { ...DEFAULT_THEME },
    tabs: [newTab('Page 1')],
    datasetId: null,
    filters: [],          // dashboard-level filters
    calcFields: [],       // user calculated fields
    fieldOverrides: {},   // {fieldId: {name, role, dataType}}
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Find next free Y position on the grid for a new widget
function placeNew(widgets, w = 4, h = 4) {
  let y = 0;
  for (const wg of widgets) y = Math.max(y, wg.y + wg.h);
  return { x: 0, y, w, h };
}

// Lightweight undo stack — wraps any setter so callers don't need to track history.
function makeHistory(initial, max = 50) {
  return { past: [], present: initial, future: [], max };
}
function historyPush(h, next) {
  if (next === h.present) return h;
  return {
    past: [...h.past.slice(-(h.max - 1)), h.present],
    present: next,
    future: [],
    max: h.max,
  };
}
function historyUndo(h) {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  const prev = h.past[h.past.length - 1];
  return { ...h, past, present: prev, future: [h.present, ...h.future] };
}
function historyRedo(h) {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { ...h, past: [...h.past, h.present], present: next, future: rest };
}

Object.assign(window, {
  DEFAULT_THEME, WIDGET_TYPES, GRID_COLS, GRID_ROW_H, GRID_GAP,
  newWidget, newTab, newDashboard, placeNew,
  makeHistory, historyPush, historyUndo, historyRedo,
});
