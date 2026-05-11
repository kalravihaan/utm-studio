// IndexedDB layer: persists dashboards + uploaded datasets across sessions.
// Stores:
//   - meta:       { key:'currentDashboardId', value:'...' } single-row settings
//   - dashboards: { id, name, theme, tabs:[{id,name,widgets:[]}], datasetId, createdAt, updatedAt }
//   - datasets:   { id, name, rows:[], fields:[], rawXlsx:Blob, createdAt, updatedAt }

const DB_NAME = 'looker-clone-db';
const DB_VERSION = 1;

let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('dashboards')) db.createObjectStore('dashboards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function txStore(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}
function reqAsync(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// ---------- meta ----------
async function dbMetaGet(key) {
  const store = await txStore('meta', 'readonly');
  const row = await reqAsync(store.get(key));
  return row ? row.value : null;
}
async function dbMetaSet(key, value) {
  const store = await txStore('meta', 'readwrite');
  await reqAsync(store.put({ key, value }));
}

// ---------- dashboards ----------
async function dbListDashboards() {
  const store = await txStore('dashboards', 'readonly');
  const items = await reqAsync(store.getAll());
  return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function dbGetDashboard(id) {
  const store = await txStore('dashboards', 'readonly');
  return reqAsync(store.get(id));
}
async function dbSaveDashboard(d) {
  d.updatedAt = Date.now();
  d.createdAt = d.createdAt || d.updatedAt;
  const store = await txStore('dashboards', 'readwrite');
  await reqAsync(store.put(d));
  return d;
}
async function dbDeleteDashboard(id) {
  const store = await txStore('dashboards', 'readwrite');
  await reqAsync(store.delete(id));
}

// ---------- datasets ----------
async function dbListDatasets() {
  const store = await txStore('datasets', 'readonly');
  const items = await reqAsync(store.getAll());
  // strip heavy bits for listing
  return items
    .map(d => ({ id: d.id, name: d.name, fields: d.fields, rowCount: (d.rows||[]).length, createdAt: d.createdAt, updatedAt: d.updatedAt, hasRaw: !!d.rawXlsx }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
async function dbGetDataset(id) {
  const store = await txStore('datasets', 'readonly');
  return reqAsync(store.get(id));
}
async function dbSaveDataset(d) {
  d.updatedAt = Date.now();
  d.createdAt = d.createdAt || d.updatedAt;
  const store = await txStore('datasets', 'readwrite');
  await reqAsync(store.put(d));
  return d;
}
async function dbDeleteDataset(id) {
  const store = await txStore('datasets', 'readwrite');
  await reqAsync(store.delete(id));
}

// Crude UUID
function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

Object.assign(window, {
  openDB,
  dbMetaGet, dbMetaSet,
  dbListDashboards, dbGetDashboard, dbSaveDashboard, dbDeleteDashboard,
  dbListDatasets, dbGetDataset, dbSaveDataset, dbDeleteDataset,
  uid,
});
