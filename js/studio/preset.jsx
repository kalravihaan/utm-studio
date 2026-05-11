// FY-26 preset dashboard.
// Built around the canonical column names from the master sheet:
//   Brand, Article Type, Style id, Total Sales Qty, Total Return Qty,
//   GMV, Revenue, Inventory, Active Days, (optional) Month / Date
//
// All widget configs reference fields by their column name as fieldId, so
// the preset works for any uploaded workbook that uses the same headers.

const FY26_PRESET_NAME = 'FY-26 Performance Dashboard';

const _dim  = (col)        => ({ fieldId: col, name: col });
const _met  = (col, agg='SUM', name) => ({ fieldId: col, agg, name: name || col });

function fy26Widget(type, x, y, w, h, title, cfg) {
  return { id: uid('w_'), type, x, y, w, h, title: title || '', config: cfg || {} };
}

function buildFY26Dashboard() {
  // ===== Tab 1: Overview =====
  const overview = {
    id: uid('t_'),
    name: 'Overview',
    widgets: [
      // Top KPI row — 5 scorecards
      fy26Widget('scorecard', 0,  0, 3, 2, 'Revenue',     { metric: _met('Revenue') }),
      fy26Widget('scorecard', 3,  0, 3, 2, 'GMV',         { metric: _met('GMV') }),
      fy26Widget('scorecard', 6,  0, 2, 2, 'Sales Qty',   { metric: _met('Total Sales Qty', 'SUM', 'Units Sold') }),
      fy26Widget('scorecard', 8,  0, 2, 2, 'Returns',     { metric: _met('Total Return Qty', 'SUM', 'Units Returned') }),
      fy26Widget('scorecard', 10, 0, 2, 2, 'Inventory',   { metric: _met('Inventory') }),

      // Revenue by Brand — bar
      fy26Widget('bar', 0, 2, 8, 5, 'Revenue by Brand', {
        dimension: _dim('Brand'),
        metrics: [_met('Revenue')],
        showLegend: false, sortDesc: true, limit: 20,
      }),

      // GMV share by Brand — donut
      fy26Widget('donut', 8, 2, 4, 5, 'GMV share by Brand', {
        dimension: _dim('Brand'),
        metric: _met('GMV'),
        limit: 8, showLegend: true,
      }),

      // Top article types by revenue — horizontal bar
      fy26Widget('hbar', 0, 7, 6, 5, 'Top Article Types · Revenue', {
        dimension: _dim('Article Type'),
        metrics: [_met('Revenue')],
        showLegend: false, sortDesc: true, limit: 12,
      }),

      // Sales vs Returns by Brand — stacked
      fy26Widget('bar', 6, 7, 6, 5, 'Sales vs Returns by Brand', {
        dimension: _dim('Brand'),
        metrics: [_met('Total Sales Qty', 'SUM', 'Sales'), _met('Total Return Qty', 'SUM', 'Returns')],
        showLegend: true, sortDesc: true, limit: 20,
      }),

      // Brand summary table
      fy26Widget('table', 0, 12, 12, 6, 'Brand summary', {
        dimensions: [_dim('Brand')],
        metrics: [
          _met('Revenue'),
          _met('GMV'),
          _met('Total Sales Qty', 'SUM', 'Sales Qty'),
          _met('Total Return Qty', 'SUM', 'Return Qty'),
          _met('Inventory'),
        ],
        pageSize: 10, showRowNumbers: true,
      }),
    ],
  };

  // ===== Tab 2: By Article Type =====
  const byArticle = {
    id: uid('t_'),
    name: 'By Article Type',
    widgets: [
      fy26Widget('hbar', 0, 0, 6, 7, 'Revenue by Article Type', {
        dimension: _dim('Article Type'),
        metrics: [_met('Revenue')],
        sortDesc: true, limit: 25,
      }),
      fy26Widget('hbar', 6, 0, 6, 7, 'Inventory by Article Type', {
        dimension: _dim('Article Type'),
        metrics: [_met('Inventory')],
        sortDesc: true, limit: 25,
      }),
      fy26Widget('table', 0, 7, 12, 6, 'Article Type breakdown', {
        dimensions: [_dim('Article Type'), _dim('Brand')],
        metrics: [
          _met('Revenue'),
          _met('GMV'),
          _met('Total Sales Qty', 'SUM', 'Sales Qty'),
          _met('Inventory'),
        ],
        pageSize: 15, showRowNumbers: false,
      }),
    ],
  };

  // ===== Tab 3: Raw =====
  const raw = {
    id: uid('t_'),
    name: 'Raw data',
    widgets: [
      fy26Widget('text', 0, 0, 12, 1, '', {
        text: 'Raw rows from the uploaded workbook',
        size: 14, weight: 500, align: 'left',
      }),
      fy26Widget('table', 0, 1, 12, 11, '', {
        dimensions: [_dim('Brand'), _dim('Article Type'), _dim('Style id')],
        metrics: [
          _met('Revenue'),
          _met('GMV'),
          _met('Total Sales Qty', 'SUM', 'Sales Qty'),
          _met('Total Return Qty', 'SUM', 'Return Qty'),
          _met('Inventory'),
        ],
        pageSize: 25, showRowNumbers: true,
      }),
    ],
  };

  return {
    id: uid('d_'),
    name: FY26_PRESET_NAME,
    theme: { ...DEFAULT_THEME },
    tabs: [overview, byArticle, raw],
    datasetId: null,
    filters: [],
    calcFields: [],
    fieldOverrides: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    _isFY26Preset: true,
  };
}

// Try to fetch the bundled master sheet (works when served over http(s),
// silently fails on file:// or in standalone bundles).
async function loadBundledFY26Dataset(onProgress) {
  const candidates = [
    'data/master_data_final.xlsx',
    'data/master data final.xlsx',
  ];
  for (const path of candidates) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      // Wrap as a File so parseAnyExcel's arrayBuffer() call works
      const file = new File([blob], path.split('/').pop(), {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      if (onProgress) onProgress('Reading bundled FY-26 data…');
      const parsed = await parseAnyExcel(file, onProgress);
      const ds = {
        id: uid('ds_'),
        name: 'FY-26 master data',
        rows: parsed.rows,
        fields: parsed.fields,
        rawXlsx: parsed.rawBlob,
        sheetName: parsed.sheetName,
      };
      await dbSaveDataset(ds);
      return ds;
    } catch (e) {
      console.warn('Bundled FY-26 dataset fetch failed for', path, e);
    }
  }
  return null;
}

Object.assign(window, { buildFY26Dashboard, loadBundledFY26Dataset, FY26_PRESET_NAME });
