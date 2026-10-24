const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const GROUPS = ['month', 'quarter', 'customer', 'product', 'size'];
const RANKS = ['net', 'gross', 'refunds', 'orders'];
const CHARTS = ['bars', 'running'];
const TABS = ['summary', 'issues', 'records'];
const defaultView = () => ({ from: '', to: '', group: 'month', rank: 'net', chart: 'bars' });

const state = {
  ordersText: '', refundsText: '',
  origin: { orders: null, refunds: null },
  names: { orders: '', refunds: '' },
  report: null, dirty: false, revision: 0,
  parsed: null, headers: { orders: [], refunds: [] },
  edits: 0, baselineIssues: 0,
  view: defaultView(), tab: 'summary',
  filter: 'all', code: '', search: '', source: 'orders', recordSearch: '', drill: null,
  issuePage: 0, recordPage: 0,
  fileReads: { orders: 0, refunds: 0 },
  activeCol: -1, anchorCol: -1,
  undo: [], redo: [],
  pendingView: null, pendingTab: '',
  fix: null
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PAGE_SIZE = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 100000;
const CHART_COLUMNS = 36;
const CATEGORY_BARS = 10;
const SAMPLE_STORE = 'Saltmarsh Coffee Supply';
const EXPORT_BUTTONS = ['export-json', 'export-csv', 'export-view', 'print-report'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PHONE_QUERY = '(max-width: 759px)';
const VIEWS_KEY = 'ledgerlens.views.v1';
const GROUP_NAMES = { month: 'Month', quarter: 'Quarter', customer: 'Customer', product: 'Product', size: 'Order size' };
const RANK_NAMES = { net: 'net revenue', gross: 'gross sales', refunds: 'refunds', orders: 'paid orders' };

// Plain-language explanations for each exception code, and the fields a fix usually touches.
const PROBLEMS = {
  INELIGIBLE_STATUS: { title: 'Pending or cancelled orders', what: 'These orders are not paid, so they are left out of revenue.', fix: 'Nothing to fix if the status is right. Load a fresh export once pending orders are paid.', fields: ['status'] },
  INVALID_DATE: { title: 'Dates that are not real', what: 'The date is in the wrong format or the day does not exist, so the row cannot be placed in a month.', fix: 'Write the date as YYYY-MM-DD, for example 2026-03-09, and check the day exists in that month.', fields: ['order_date', 'refund_date'] },
  UNSUPPORTED_CURRENCY: { title: 'Not in US dollars', what: 'LedgerLens reports in USD and does not convert currencies.', fix: 'Convert the amount to USD in your store admin, or report this sale separately.', fields: ['currency', 'amount'] },
  INVALID_AMOUNT: { title: 'Amounts that are blank or not a number', what: 'The amount is missing, negative or has extra characters such as a currency sign.', fix: 'Enter a positive number with up to two decimals and no symbols, for example 62.95.', fields: ['amount'] },
  DUPLICATE_ORDER: { title: 'Orders listed twice', what: 'The same order ID appears on more than one row. The first row is counted.', fix: 'Delete the repeated row from the orders file.', fields: ['order_id'], remove: true },
  DUPLICATE_REFUND: { title: 'Refunds listed twice', what: 'The same refund ID appears on more than one row. The first row is counted.', fix: 'Delete the repeated row from the refunds file.', fields: ['refund_id'], remove: true },
  OVER_REFUND: { title: 'Refunds larger than the order', what: 'Together with earlier refunds, this refund would return more than the order was worth.', fix: 'Check the refund amount against the order. A slipped decimal point is the usual cause.', fields: ['amount'] },
  UNMATCHED_REFUND: { title: 'Refunds for an unknown order', what: 'The order ID on the refund does not match any order in the orders file.', fix: 'Check the order ID for typos, such as the letter O in place of a zero, or add the missing order.', fields: ['order_id'] },
  REFUND_FOR_EXCLUDED_ORDER: { title: 'Refunds for orders that were left out', what: 'The order behind the refund was excluded, so the refund is excluded too.', fix: 'Fix the order first. If the order was cancelled, this is expected and needs no change.', fields: ['order_id'] },
  REFUND_BEFORE_ORDER: { title: 'Refunds dated before the order', what: 'A refund cannot be paid before the order it belongs to.', fix: 'Check both dates. One of them was probably keyed in wrong.', fields: ['refund_date'] },
  CURRENCY_MISMATCH: { title: 'Refund and order in different currencies', what: 'The refund currency does not match its order.', fix: 'Record the refund in the same currency as the order.', fields: ['currency'] },
  MISSING_ID: { title: 'Rows without an ID', what: 'Every order needs an order ID, and every refund needs a refund ID and an order ID.', fix: 'Fill in the missing ID, or remove the row if it is not a real transaction.', fields: ['order_id', 'refund_id'] },
  UNSAFE_TOTAL: { title: 'Totals too large to add safely', what: 'Adding this row would push the total past the safe number limit.', fix: 'Split the export into smaller date ranges.', fields: ['amount'] }
};
function problem(code) {
  return PROBLEMS[code] || { title: code, what: 'This row was not counted.', fix: 'Check the row against the column guide.', fields: [] };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function monthName(key, short) {
  const name = MONTHS[Number(key.slice(5, 7)) - 1] || key;
  return short ? name.slice(0, 3) : name;
}
function monthLabel(key) { return monthName(key) + ' ' + key.slice(0, 4); }
function periodLabel(from, to) {
  if (!from) return 'No accepted rows';
  if (from === to) return monthLabel(from);
  if (from.slice(0, 4) === to.slice(0, 4) && from.slice(5) === '01' && to.slice(5) === '12') return 'All of ' + from.slice(0, 4);
  return `${monthLabel(from)} to ${monthLabel(to)}`;
}
function shortPeriod(from, to) {
  if (from === to) return `${monthName(from, true)} ${from.slice(0, 4)}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${monthName(from, true)}${sameYear ? '' : ' ' + from.slice(0, 4)} to ${monthName(to, true)} ${to.slice(0, 4)}`;
}
function plural(count, word, many) { return count + ' ' + (count === 1 ? word : (many || word + 's')); }
function cents(value) { return money.format(value / 100); }
function isPhone() {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches; } catch { return false; }
}
function reducedMotion() {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

function notice(message, kind = 'success') {
  $('#notice').textContent = message;
  $('#notice').className = `notice ${kind}`;
}
let toastTimer = null;
function toast(message, canUndo) {
  const box = $('#toast');
  if (!box) return;
  $('#toast-text').textContent = message;
  $('#toast-undo').hidden = !canUndo;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, canUndo ? 7000 : 3500);
}
function setPill(text, kind) {
  $('#report-state').textContent = text;
  $('#report-state').className = 'state-pill' + (kind ? ' is-' + kind : '');
}
function setExports(enabled) {
  EXPORT_BUTTONS.forEach(id => { $(`#${id}`).disabled = !enabled; });
}
function setStale(stale) {
  document.body.className = stale ? 'is-stale' : '';
}
function setDrop(source, text, kind) {
  $(`#${source}-name`).textContent = text;
  const drop = $(`#drop-${source}`);
  if (drop) drop.className = 'drop' + (kind ? ' is-' + kind : '');
}
function updateImportSummary() {
  const { orders, refunds } = state.names;
  let text = 'No files loaded yet.';
  if (state.origin.orders === 'sample' && state.origin.refunds === 'sample') text = 'Using the sample files.';
  else if (orders && refunds) text = `Using ${orders} and ${refunds}.`;
  else if (orders || refunds) text = `Loaded ${orders || refunds}. The other file is still needed.`;
  $('#import-summary').textContent = text;
}
function setImportCollapsed(collapsed) {
  $('#import').className = 'import' + (collapsed ? ' is-collapsed' : '');
  $('#import-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#import-toggle').textContent = collapsed ? 'Change files' : 'Hide';
}
function setMode(mode) {
  $$('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  $('#paste-box').hidden = mode !== 'paste';
  ['orders', 'refunds'].forEach(source => { $(`#drop-${source}`).hidden = mode === 'paste'; });
}

function markDirty() {
  state.dirty = true;
  state.revision += 1;
  setPill(state.report ? 'Files changed' : 'Ready to build', 'stale');
  setExports(false);
  setStale(Boolean(state.report));
  notice('A source file changed. Build the report again before trusting the totals or exporting.', 'warning');
}

// ---------- Loading files ----------
function placeText(source, text, name, origin) {
  state[`${source}Text`] = text;
  state.origin[source] = origin;
  state.names[source] = name;
  setDrop(source, name);
  updateImportSummary();
}
async function importFile(source, file) {
  const sequence = ++state.fileReads[source];
  state[`${source}Text`] = '';
  state.origin[source] = null;
  state.names[source] = '';
  setDrop(source, file ? `Reading ${file.name}` : 'No file loaded', file ? '' : 'empty');
  markDirty();
  updateImportSummary();
  if (!file) return;
  const label = source === 'orders' ? 'Orders' : 'Refunds';
  if (file.size > MAX_FILE_BYTES) {
    setDrop(source, 'File too large', 'error');
    notice(`${label} file exceeds the 5 MB limit. Export a shorter date range.`, 'error');
    return;
  }
  try {
    const text = await file.text();
    if (state.fileReads[source] !== sequence) return;
    const detected = LedgerLens.detectSource(text);
    if (detected && detected !== source) {
      // The file went into the wrong slot. Put it where it belongs instead of failing the build.
      setDrop(source, 'No file loaded', 'empty');
      state.fileReads[detected] += 1;
      placeText(detected, text, file.name, 'file');
      notice(`${file.name} looks like a ${detected} export, so it was loaded as the ${detected} file.`, 'warning');
      return;
    }
    placeText(source, text, file.name, 'file');
    notice(`${label} file loaded. Build the report when both files are ready.`, 'warning');
  } catch {
    if (state.fileReads[source] !== sequence) return;
    setDrop(source, 'File could not be read', 'error');
    notice('That file could not be read. Choose a CSV export saved as plain text.', 'error');
  }
}
function onFileInput(source, input) {
  const file = input.files && input.files[0];
  // Clear the input so choosing the same file again, after editing it, still triggers a read.
  input.value = '';
  return importFile(source, file);
}
async function importAnywhere(files) {
  const list = Array.from(files || []).slice(0, 4);
  if (!list.length) return;
  const placed = [];
  for (const file of list) {
    if (file.size > MAX_FILE_BYTES) { notice(`${file.name} exceeds the 5 MB limit. Export a shorter date range.`, 'error'); continue; }
    let text = '';
    try { text = await file.text(); } catch { notice(`${file.name} could not be read. Choose a CSV export saved as plain text.`, 'error'); continue; }
    const source = LedgerLens.detectSource(text);
    if (!source) { notice(`${file.name} has neither an order_id nor a refund_id column, so it was not loaded.`, 'error'); continue; }
    if (!placed.length) markDirty();
    state.fileReads[source] += 1;
    placeText(source, text, file.name, 'file');
    placed.push(`${file.name} as ${source}`);
  }
  if (!placed.length) return;
  setMode('files');
  const ready = state.ordersText && state.refundsText && state.origin.orders === state.origin.refunds;
  if (ready) runReport();
  else notice(`Loaded ${placed.join(' and ')}. Add the ${state.origin.orders === 'file' ? 'refunds' : 'orders'} file to build the report.`, 'warning');
}
function usePasted() {
  const text = $('#paste-text').value;
  if (!text.trim()) { notice('Paste a CSV export first, starting with its header row.', 'error'); return; }
  const source = LedgerLens.detectSource(text);
  if (!source) { notice('The first line needs the column names, including order_id for orders or refund_id for refunds.', 'error'); return; }
  markDirty();
  state.fileReads[source] += 1;
  placeText(source, text, `pasted ${source}`, 'file');
  $('#paste-text').value = '';
  const other = source === 'orders' ? 'refunds' : 'orders';
  $('#paste-note').textContent = state.origin[other] === 'file' ? 'Both files are in. Build the report.' : `Added as ${source}. Now paste the ${other}, or a header row if there were none.`;
  if (state.origin[other] === 'file') runReport();
  else notice(`Pasted rows added as the ${source} file. The ${other} file is still needed.`, 'warning');
}

async function loadSamples() {
  markDirty();
  const revision = state.revision;
  state.fileReads.orders += 1;
  state.fileReads.refunds += 1;
  $('#load-samples').disabled = true;
  try {
    const results = await Promise.all(['orders.csv', 'refunds.csv'].map(async name => {
      const response = await fetch(name);
      if (!response.ok) throw new Error('Sample download failed.');
      return response.text();
    }));
    if (state.revision !== revision) return;
    [state.ordersText, state.refundsText] = results;
    state.origin = { orders: 'sample', refunds: 'sample' };
    state.names = { orders: 'orders.csv', refunds: 'refunds.csv' };
    setDrop('orders', 'orders.csv, sample');
    setDrop('refunds', 'refunds.csv, sample');
    updateImportSummary();
    runReport();
  } catch {
    if (state.revision === revision) notice('The sample files could not load. Download them from the column guide and load them as files.', 'error');
  } finally {
    $('#load-samples').disabled = false;
  }
}

// ---------- Building ----------
function headersFor(source) {
  const first = state.parsed && state.parsed[source][0];
  if (first) return Object.keys(first).filter(key => key !== '_row');
  return state.headers[source];
}
function runReport() {
  if (!state.ordersText || !state.refundsText) {
    const missing = !state.ordersText && !state.refundsText ? 'an orders file and a refunds file' : !state.ordersText ? 'an orders file' : 'a refunds file';
    notice(`Load ${missing} first. If there were no refunds, use a refunds file with just the header row.`, 'error');
    return;
  }
  if (state.origin.orders !== state.origin.refunds) {
    const own = state.origin.orders === 'file' ? 'orders' : 'refunds';
    const other = own === 'orders' ? 'refunds' : 'orders';
    notice(`Your ${own} file is loaded, but the ${other} still come from the fictional sample. Load your ${other} file too${other === 'refunds' ? '. If there were no refunds, use a file with just the header row' : ''}.`, 'error');
    return;
  }
  try {
    const orders = LedgerLens.parseCsv(state.ordersText, { source: 'orders' });
    const refunds = LedgerLens.parseCsv(state.refundsText, { source: 'refunds' });
    if (orders.length > MAX_ROWS || refunds.length > MAX_ROWS) throw new Error('Each file can hold at most 100,000 rows. Split the export by date range.');
    state.parsed = { orders, refunds };
    state.headers = { orders: LedgerLens.csvHeaders(state.ordersText), refunds: LedgerLens.csvHeaders(state.refundsText) };
    state.edits = 0;
    state.undo = []; state.redo = [];
    const report = LedgerLens.buildReport(orders, refunds);
    state.report = report;
    state.baselineIssues = report.issues.length;
    state.dirty = false;
    state.issuePage = 0;
    state.recordPage = 0;
    state.code = '';
    state.drill = null;
    state.activeCol = -1;
    const pending = state.pendingView;
    state.pendingView = null;
    state.view = clampView(pending ? { ...state.view, ...pending } : { ...defaultView(), group: state.view.group, rank: state.view.rank, chart: state.view.chart });
    renderReport();
    setPill('Current report');
    setExports(true);
    setStale(false);
    notice(`Read ${plural(orders.length, 'order row')} and ${plural(refunds.length, 'refund row')}. Counted ${plural(report.accepted.orders, 'order')} and ${plural(report.accepted.refunds, 'refund')}, with ${plural(report.issues.length, 'exception')} to review.`);
    if (state.pendingTab) { selectTab(state.pendingTab); state.pendingTab = ''; }
    if (isPhone()) setImportCollapsed(true);
  } catch (error) {
    // A failed build clears the previous result so old totals are never shown as current.
    state.report = null;
    state.parsed = null;
    state.dirty = true;
    $('#report').hidden = true;
    $('#empty-state').hidden = false;
    setPill('Needs attention', 'error');
    setExports(false);
    setStale(false);
    setImportCollapsed(false);
    notice(`${error.message} No report was built. Fix the file and try again.`, 'error');
  }
}
// Rebuild from the rows in memory, after a fix or an undo. The view is kept.
function rebuild() {
  state.report = LedgerLens.buildReport(state.parsed.orders, state.parsed.refunds);
  state.view = clampView(state.view);
  renderReport();
}

// ---------- View state ----------
function allMonths() { return state.report ? state.report.byMonth.map(m => m.month) : []; }
function clampView(view) {
  const months = allMonths();
  const next = { ...defaultView(), ...view };
  if (!GROUPS.includes(next.group)) next.group = 'month';
  if (!RANKS.includes(next.rank)) next.rank = 'net';
  if (!CHARTS.includes(next.chart)) next.chart = 'bars';
  if (!months.length) { next.from = ''; next.to = ''; return next; }
  const first = months[0];
  const last = months[months.length - 1];
  if (!/^\d{4}-\d{2}$/.test(next.from) || next.from < first || next.from > last) next.from = first;
  if (!/^\d{4}-\d{2}$/.test(next.to) || next.to > last || next.to < first) next.to = last;
  if (next.from > next.to) [next.from, next.to] = [next.to, next.from];
  return next;
}
function sameView(a, b) { return ['from', 'to', 'group', 'rank', 'chart'].every(key => a[key] === b[key]); }
function snapshot() { return { view: { ...state.view }, parsed: state.parsed, edits: state.edits }; }
function pushUndo() {
  state.undo.push(snapshot());
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
}
function restore(entry) {
  const dataChanged = entry.parsed !== state.parsed;
  state.view = entry.view;
  state.parsed = entry.parsed;
  state.edits = entry.edits;
  if (dataChanged) rebuild(); else renderView();
}
function undo() {
  if (!state.undo.length || !state.report || state.dirty) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
  toast('Undone.', false);
}
function redo() {
  if (!state.redo.length || !state.report || state.dirty) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
  toast('Redone.', false);
}
function setView(patch, message) {
  if (!state.report) return;
  const next = clampView({ ...state.view, ...patch });
  if (sameView(next, state.view)) return;
  pushUndo();
  state.view = next;
  state.activeCol = -1;
  state.recordPage = 0;
  renderView();
  if (message) toast(message, true);
}
function shiftPeriod(direction) {
  const { from, to } = state.view;
  const length = LedgerLens.monthsBetween(from, to).length;
  const months = allMonths();
  const nextFrom = LedgerLens.shiftMonth(from, direction * length);
  const nextTo = LedgerLens.shiftMonth(to, direction * length);
  if (nextFrom < months[0] || nextTo > months[months.length - 1]) {
    toast(direction < 0 ? 'Already at the start of the data.' : 'Already at the end of the data.', false);
    return;
  }
  setView({ from: nextFrom, to: nextTo });
}

// ---------- Share links and saved views ----------
function viewToHash(view, tab) {
  const params = new URLSearchParams({ from: view.from, to: view.to, group: view.group });
  if (view.group === 'month' || view.group === 'quarter') params.set('chart', view.chart); else params.set('rank', view.rank);
  if (tab && tab !== 'summary') params.set('tab', tab);
  return '#' + params.toString();
}
function hashToView(hash) {
  try {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (!params.has('group') && !params.has('from')) return null;
    const view = {};
    ['from', 'to'].forEach(key => { if (/^\d{4}-\d{2}$/.test(params.get(key) || '')) view[key] = params.get(key); });
    if (GROUPS.includes(params.get('group'))) view.group = params.get('group');
    if (RANKS.includes(params.get('rank'))) view.rank = params.get('rank');
    if (CHARTS.includes(params.get('chart'))) view.chart = params.get('chart');
    return { view, tab: TABS.includes(params.get('tab')) ? params.get('tab') : '' };
  } catch { return null; }
}
function syncHash() {
  try {
    if (typeof history === 'undefined' || !history.replaceState || typeof location === 'undefined') return;
    history.replaceState(null, '', location.pathname + location.search + viewToHash(state.view, state.tab));
  } catch { /* a sandboxed frame can refuse history changes */ }
}
async function copyLink() {
  if (!state.report) return;
  let url = '';
  try { url = location.href.split('#')[0] + viewToHash(state.view, state.tab); } catch { return; }
  const ownData = state.origin.orders === 'file';
  const note = ownData ? ' It holds the view only. Whoever opens it needs your files too.' : '';
  try {
    await navigator.clipboard.writeText(url);
    toast('Link to this view copied.' + note, false);
  } catch {
    toast('Copy this link: ' + url, false);
  }
}
function readSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]');
    return Array.isArray(list) ? list.filter(item => item && typeof item.name === 'string' && item.view).slice(0, 12) : [];
  } catch { return []; }
}
function writeSaved(list) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(list.slice(0, 12))); return true; } catch { return false; }
}
function presets() {
  const months = allMonths();
  if (!months.length) return [];
  const first = months[0];
  const last = months[months.length - 1];
  const lastThree = months[Math.max(0, months.length - 3)];
  const best = state.report.byMonth.reduce((top, m) => (m.netRevenue > top.netRevenue ? m : top), state.report.byMonth[0]);
  const list = [
    { name: 'Whole range, by month', view: { from: first, to: last, group: 'month', chart: 'bars' } },
    { name: 'Last three months, by product', view: { from: lastThree, to: last, group: 'product', rank: 'net' } },
    { name: 'Best customers', view: { from: first, to: last, group: 'customer', rank: 'net' } },
    { name: `Best month, ${monthName(best.month)}, by product`, view: { from: best.month, to: best.month, group: 'product', rank: 'gross' } },
    { name: 'Where refunds come from', view: { from: first, to: last, group: 'product', rank: 'refunds' } },
    { name: 'Order sizes', view: { from: first, to: last, group: 'size' } },
    { name: 'Running total by quarter', view: { from: first, to: last, group: 'quarter', chart: 'running' } }
  ];
  return list;
}
function describeView(view) {
  const v = clampView(view);
  return `${shortPeriod(v.from, v.to)}, ${GROUP_NAMES[v.group].toLowerCase()}`;
}
function renderViews() {
  $('#preset-list').innerHTML = presets().map((item, i) => `<li><button type="button" class="view-pick" data-preset="${i}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(describeView(item.view))}</small></button></li>`).join('');
  const saved = readSaved();
  $('#saved-list').innerHTML = saved.length
    ? saved.map((item, i) => `<li class="saved-row"><button type="button" class="view-pick" data-saved="${i}"><span>${escapeHtml(item.name)}</span><small>${escapeHtml(describeView(item.view))}</small></button><button type="button" class="view-delete" data-delete="${i}" aria-label="Delete ${escapeHtml(item.name)}">Delete</button></li>`).join('')
    : '<li class="view-empty">Nothing saved yet. Name the current view below.</li>';
}
function toggleViews(open) {
  const panel = $('#views-panel');
  const show = open === undefined ? panel.hidden : open;
  panel.hidden = !show;
  $('#views-toggle').setAttribute('aria-expanded', String(show));
  if (show) {
    renderViews();
    const input = $('#view-name');
    if (input && input.focus && !isPhone()) input.focus();
  }
}
function saveView(name) {
  const clean = String(name || '').trim().slice(0, 40) || describeView(state.view);
  const list = readSaved().filter(item => item.name !== clean);
  list.unshift({ name: clean, view: { ...state.view } });
  if (writeSaved(list)) toast(`Saved "${clean}".`, false);
  else toast('This browser blocks storage, so the view could not be saved. Copy the link instead.', false);
  $('#view-name').value = '';
  renderViews();
}

// ---------- Rendering ----------
function renderReport() {
  $('#issue-total').textContent = state.report.issues.length;
  $('#generated').textContent = new Date(state.report.generatedAt).toLocaleString();
  $('#generated').dateTime = state.report.generatedAt;
  const months = allMonths();
  const range = months.length ? periodLabel(months[0], months[months.length - 1]) : 'No accepted rows';
  const who = state.origin.orders === 'sample' ? `sample data for <strong>${SAMPLE_STORE}</strong>` : `<strong>${escapeHtml(state.names.orders)}</strong> and <strong>${escapeHtml(state.names.refunds)}</strong>`;
  const edited = state.edits ? `, with ${plural(state.edits, 'row')} fixed here` : '';
  $('#dataset-line').innerHTML = `Showing ${who}, ${escapeHtml(months.length ? range : 'with no accepted rows yet')}${edited}.`;
  // Show the report first. The chart measures its container, which is zero wide while hidden.
  $('#empty-state').hidden = true;
  $('#report').hidden = false;
  renderPeriodPickers();
  renderView();
  renderIssueGroups();
  renderIssues();
  renderFixState();
}
function renderPeriodPickers() {
  const months = allMonths();
  const options = months.map(m => `<option value="${m}">${monthName(m, true)} ${m.slice(0, 4)}</option>`).join('');
  $('#from-month').innerHTML = options;
  $('#to-month').innerHTML = options;
  $('#from-month').disabled = $('#to-month').disabled = months.length < 2;
}
function currentView() {
  return LedgerLens.summarizeView(state.report, { from: state.view.from, to: state.view.to, groupBy: state.view.group });
}
function isTimeGroup() { return state.view.group === 'month' || state.view.group === 'quarter'; }
function renderView() {
  if (!state.report) return;
  const v = state.view;
  $('#from-month').value = v.from;
  $('#to-month').value = v.to;
  $$('[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === v.group)));
  $$('[data-rank]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rank === v.rank)));
  $$('[data-chart]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chart === v.chart)));
  $('#chart-field').hidden = !isTimeGroup();
  $('#rank-field').hidden = isTimeGroup();
  const months = allMonths();
  $('#whole-range').hidden = !months.length || (v.from === months[0] && v.to === months[months.length - 1]);
  $('#undo').disabled = !state.undo.length;
  $('#redo').disabled = !state.redo.length;
  $('#report-title').textContent = periodLabel(v.from, v.to);
  const count = LedgerLens.monthsBetween(v.from, v.to).length;
  $('#report-sub').textContent = v.from ? `${plural(count, 'month')}, grouped by ${GROUP_NAMES[v.group].toLowerCase()}.` : '';
  const view = currentView();
  renderKpis(view);
  renderChart(view);
  renderBreakdown(view);
  renderRecords();
  syncHash();
}

function changeHtml(current, previous, upIsGood, when) {
  if (current === null || previous === null) return `No orders to compare, ${when}`;
  if (previous === 0) return current === 0 ? `No change, ${when}` : `<strong class="${upIsGood ? 'is-good' : 'is-bad'}">Up from zero</strong>, ${when}`;
  const change = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(change) < 0.05) return `<strong class="is-flat">No change</strong>, ${when}`;
  const up = change > 0;
  const good = up === upIsGood;
  return `<strong class="${good ? 'is-good' : 'is-bad'}">${up ? 'Up' : 'Down'} ${percent.format(Math.abs(change))}%</strong>, ${when}`;
}
// What the period is compared with: the same number of months just before it, or,
// when the data does not reach back that far, its last month against the month before.
function comparison() {
  const { from, to } = state.view;
  const months = allMonths();
  if (!from || months.length < 2) return null;
  const prev = LedgerLens.previousPeriod(from, to);
  const length = LedgerLens.monthsBetween(from, to).length;
  if (prev.from >= months[0]) {
    return {
      current: LedgerLens.summarizeView(state.report, { from, to, groupBy: 'month' }).totals,
      previous: LedgerLens.summarizeView(state.report, prev).totals,
      when: length === 1 ? `${monthName(to)} vs ${monthName(prev.to)}` : `vs the ${length} months before`
    };
  }
  if (length < 2) return null;
  const before = LedgerLens.shiftMonth(to, -1);
  return {
    current: LedgerLens.summarizeView(state.report, { from: to, to, groupBy: 'month' }).totals,
    previous: LedgerLens.summarizeView(state.report, { from: before, to: before, groupBy: 'month' }).totals,
    when: `${monthName(to)} vs ${monthName(before)}`
  };
}
function countTo(id, value, format) {
  const el = $(`#${id}`);
  const from = typeof el._value === 'number' ? el._value : null;
  el._value = value;
  if (from === null || from === value || reducedMotion() || typeof requestAnimationFrame !== 'function') { el.textContent = format(value); return; }
  const start = Date.now();
  const step = () => {
    if (el._value !== value) return;
    const t = Math.min(1, (Date.now() - start) / 420);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(t === 1 ? value : Math.round(from + (value - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function renderKpis(view) {
  const t = view.totals;
  const aov = t.orders ? Math.round(t.grossCents / t.orders) : 0;
  countTo('net', t.netCents, cents);
  countTo('gross', t.grossCents, cents);
  countTo('refunded', t.refundCents, cents);
  countTo('orders', t.orders, n => n.toLocaleString('en-US'));
  countTo('aov', aov, cents);
  $('#recon-gross').textContent = cents(t.grossCents);
  $('#recon-refunds').textContent = cents(t.refundCents);
  $('#recon-net').textContent = cents(t.netCents);
  const share = `${percent.format(t.grossCents ? t.refundCents / t.grossCents * 100 : 0)}% of gross sales. `;
  const cmp = comparison();
  if (!cmp) {
    ['net', 'gross', 'orders', 'aov'].forEach(id => { $(`#delta-${id}`).innerHTML = allMonths().length < 2 ? 'One month of data, so no monthly change yet.' : 'No earlier period in the data to compare.'; });
    $('#delta-refunded').innerHTML = escapeHtml(share);
    return;
  }
  const { current: c, previous: p, when } = cmp;
  const avg = x => (x.orders ? x.grossCents / x.orders : null);
  $('#delta-net').innerHTML = changeHtml(c.netCents, p.netCents, true, when);
  $('#delta-gross').innerHTML = changeHtml(c.grossCents, p.grossCents, true, when);
  $('#delta-refunded').innerHTML = escapeHtml(share) + changeHtml(c.refundCents, p.refundCents, false, when);
  $('#delta-orders').innerHTML = changeHtml(c.orders, p.orders, true, when);
  $('#delta-aov').innerHTML = changeHtml(avg(c), avg(p), true, when);
}

// ---------- Chart ----------
function niceStep(raw) {
  if (raw <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}
function compactMoney(value) {
  const sign = value < 0 ? '−' : '';
  const v = Math.abs(value);
  if (v >= 1e6) return `${sign}$${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${sign}$${+(v / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(v)}`;
}
function barPath(x, yFrom, yTo, width, radius) {
  const height = Math.abs(yTo - yFrom);
  if (height < 0.5) return '';
  const r = Math.min(radius, height, width / 2);
  const up = yTo < yFrom;
  const tip = yTo;
  const dir = up ? 1 : -1;
  return `M${x},${yFrom}V${tip + dir * r}Q${x},${tip} ${x + r},${tip}H${x + width - r}Q${x + width},${tip} ${x + width},${tip + dir * r}V${yFrom}Z`;
}
// Columns of the time chart. Bars show the whole data range so a period can be dragged out of it.
// The running total shows the chosen period only.
function chartColumns() {
  if (!state.report || !isTimeGroup()) return [];
  const months = allMonths();
  if (!months.length) return [];
  const running = state.view.chart === 'running';
  const from = running ? state.view.from : months[Math.max(0, months.length - CHART_COLUMNS * (state.view.group === 'quarter' ? 3 : 1))];
  const to = running ? state.view.to : months[months.length - 1];
  const view = LedgerLens.summarizeView(state.report, { from, to, groupBy: state.view.group });
  let gross = 0; let net = 0;
  return view.rows.map(row => {
    const span = state.view.group === 'month' ? [row.key, row.key] : quarterSpan(row.key);
    gross += row.grossCents; net += row.netCents;
    const inPeriod = span[1] >= state.view.from && span[0] <= state.view.to;
    return { ...row, span, inPeriod, runGross: gross, runNet: net, short: state.view.group === 'month' ? monthName(row.key, true) : row.label.slice(0, 2), year: row.key.slice(0, 4) };
  });
}
function quarterSpan(key) {
  const q = Number(key.slice(6));
  const year = key.slice(0, 4);
  return [`${year}-${String(q * 3 - 2).padStart(2, '0')}`, `${year}-${String(q * 3).padStart(2, '0')}`];
}
function columnSentence(c) {
  const label = state.view.group === 'month' ? monthLabel(c.key) : c.label;
  const running = state.view.chart === 'running' ? ` Net so far ${cents(c.runNet)}.` : '';
  return `${label}. Gross sales ${cents(c.grossCents)}, refunds ${cents(c.refundCents)}, net revenue ${cents(c.netCents)}, ${plural(c.orders, 'paid order')}.${running}`;
}
function setLegend(items) {
  $('#legend').innerHTML = items.map(([cls, label]) => `<li><i class="key ${cls}" aria-hidden="true"></i>${label}</li>`).join('');
}
function renderChart(view) {
  const el = $('#monthly-chart');
  hideTip();
  el._layout = null;
  el.className = 'chart';
  if (!isTimeGroup()) { renderCategoryChart(el, view); return; }
  const cols = chartColumns();
  const unit = state.view.group === 'month' ? 'month' : 'quarter';
  const running = state.view.chart === 'running';
  $('#summary-title').textContent = running ? `Running total, ${unit} by ${unit}` : (unit === 'month' ? 'Month by month' : 'Quarter by quarter');
  $('#summary-sub').textContent = 'Orders count in the month they were placed, refunds in the month they were paid out.';
  setLegend(running ? [['key-gross', 'Gross so far'], ['key-net', 'Net so far']] : [['key-gross', 'Gross sales'], ['key-refund', 'Refunds'], ['key-net', 'Net revenue']]);
  if (cols.length < 2) {
    el.innerHTML = `<p class="chart-empty">The trend needs at least two ${unit}s. ${running ? 'Widen the period, or switch to bars.' : 'The table below has the figures.'}</p>`;
    el.setAttribute('aria-label', 'Not enough periods to draw a trend.');
    $('#chart-help').textContent = running ? 'Pick a longer period to see the running total.' : 'Load a longer date range to see the monthly trend.';
    return;
  }
  if (el.clientWidth === 0) return; // hidden panel, drawn when the report tab is shown
  const width = Math.max(260, Math.round(el.clientWidth || 720));
  const height = width < 520 ? 250 : 320;
  const margin = { top: 28, right: 8, bottom: 44, left: width < 520 ? 44 : 56 };
  const plotW = width - margin.left - margin.right;
  const plotBottom = height - margin.bottom;
  const val = c => (running ? [c.runGross, c.runNet] : [c.grossCents, c.netCents]);
  const maxUp = Math.max(100, ...cols.map(c => Math.max(...val(c)))) / 100;
  const maxDown = Math.max(0, ...cols.map(c => Math.max(running ? 0 : c.refundCents, -(running ? c.runNet : c.netCents)))) / 100;
  const step = niceStep(maxUp / 4);
  const yMax = Math.ceil(maxUp / step) * step;
  const yMin = maxDown > step * 0.6 ? -Math.ceil(maxDown / step) * step : -maxDown * 1.25;
  const y = v => margin.top + (yMax - v) / (yMax - yMin || 1) * (plotBottom - margin.top);
  const slot = plotW / cols.length;
  const barW = Math.max(5, Math.min(26, slot * 0.46));
  const cx = i => margin.left + slot * (i + 0.5);
  const zero = y(0);

  const ticks = [];
  for (let v = yMin < 0 && Math.abs(yMin % step) < 1e-9 ? yMin : 0; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const grid = ticks.map(v => `<line class="${v === 0 ? 'baseline' : 'grid'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tick-label" x="${margin.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${compactMoney(v)}</text>`).join('');

  const every = Math.max(1, Math.ceil(36 / slot));
  const lastIndex = cols.length - 1;
  const parts = cols.map((c, i) => {
    const x = cx(i);
    const showLabel = (lastIndex - i) % every === 0;
    const showYear = showLabel && (i === 0 || c.key.endsWith('-01') || c.key.endsWith('Q1') || (every > 1 && i < every));
    const label = showLabel ? `<text x="${x.toFixed(1)}" y="${plotBottom + 18}" text-anchor="middle">${c.short}</text>` : '';
    const year = showYear ? `<text x="${x.toFixed(1)}" y="${plotBottom + 34}" text-anchor="middle">${c.year}</text>` : '';
    const bars = running ? '' : [barPath(x - barW / 2, zero - 1, y(c.grossCents / 100), barW, 4), barPath(x - barW / 2, zero + 1, y(-c.refundCents / 100), barW, 3)].map((d, k) => (d ? `<path class="${k ? 'bar-refund' : 'bar-gross'}" d="${d}"/>` : '')).join('');
    return `<g class="month-col" data-i="${i}"${c.inPeriod ? '' : ' data-out="1"'}><rect class="hover-band" x="${(x - slot / 2).toFixed(1)}" y="${margin.top - 12}" width="${slot.toFixed(1)}" height="${(plotBottom - margin.top + 12).toFixed(1)}" rx="2"/>${bars}${label}${year}</g>`;
  }).join('');
  const netKey = running ? 'runNet' : 'netCents';
  const linePoints = cols.map((c, i) => `${cx(i).toFixed(1)},${y(c[netKey] / 100).toFixed(1)}`).join(' ');
  let area = '';
  if (running) {
    const top = cols.map((c, i) => `${cx(i).toFixed(1)},${y(c.runGross / 100).toFixed(1)}`).join(' ');
    area = `<polygon class="run-area" points="${cx(0).toFixed(1)},${zero.toFixed(1)} ${top} ${cx(lastIndex).toFixed(1)},${zero.toFixed(1)}"/><polyline class="run-gross" points="${top}"/>`;
  }
  const dots = cols.map((c, i) => `<circle class="net-dot" data-dot="${i}" cx="${cx(i).toFixed(1)}" cy="${y(c[netKey] / 100).toFixed(1)}" r="${slot < 14 ? 2.5 : 4}"/>`).join('');
  const last = cols[lastIndex];
  const labelSpan = cols.slice(-3);
  const labelTop = Math.min(...labelSpan.map(c => Math.min(y(c[netKey] / 100), y((running ? c.runGross : c.grossCents) / 100))));
  const endLabel = `<text class="end-label" x="${(cx(lastIndex) + 6).toFixed(1)}" y="${Math.max(12, labelTop - 12).toFixed(1)}" text-anchor="end">${running ? 'Net so far' : 'Net'} ${cents(last[netKey])}</text>`;
  const firstIn = cols.findIndex(c => c.inPeriod);
  const lastIn = cols.length - 1 - [...cols].reverse().findIndex(c => c.inPeriod);
  const partial = !running && firstIn >= 0 && (firstIn > 0 || lastIn < lastIndex);
  const period = partial ? `<rect class="period-band" x="${(cx(firstIn) - slot / 2).toFixed(1)}" y="${margin.top - 14}" width="${(slot * (lastIn - firstIn + 1)).toFixed(1)}" height="${(plotBottom - margin.top + 14).toFixed(1)}"/>` : '';
  const brush = `<rect class="brush" id="chart-brush" x="0" y="${margin.top - 14}" width="0" height="${(plotBottom - margin.top + 14).toFixed(1)}"/>`;
  const hits = cols.map((c, i) => `<rect class="hit" data-i="${i}" x="${(cx(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}"/>`).join('');

  el.className = 'chart' + (running ? ' is-running' : '') + (partial ? ' has-period' : '');
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${period}${grid}${area}${parts}<polyline class="net-line" points="${linePoints}"/>${dots}${endLabel}${brush}${hits}</svg>`;
  const peak = cols.reduce((best, c) => (c.netCents > best.netCents ? c : best), cols[0]);
  const name = c => (unit === 'month' ? monthLabel(c.key) : c.label);
  el.setAttribute('aria-label', running
    ? `Running total from ${name(cols[0])} to ${name(last)}. Net revenue reached ${cents(last.runNet)} on gross sales of ${cents(last.runGross)}.`
    : `Monthly trend, ${name(cols[0])} to ${name(last)}. Net revenue peaked at ${cents(peak.netCents)} in ${name(peak)} and was ${cents(last.netCents)} in ${name(last)}. Every value is in the table below.`);
  const total = allMonths().length;
  const capped = !running && unit === 'month' && total > CHART_COLUMNS ? `The chart shows the last ${CHART_COLUMNS} months. ` : '';
  $('#chart-help').textContent = capped + (running
    ? `Hover or tap a ${unit} for the total so far. With a keyboard, focus the chart and use the arrow keys.`
    : `Drag across the bars to pick a period, or hover and tap a ${unit} for its figures. With a keyboard, use the arrow keys, Shift with an arrow to widen the period and Enter to pick one ${unit}.`);
  el._layout = { slot, width, cx, cols };
  if (state.activeCol >= 0) setActiveCol(Math.min(state.activeCol, lastIndex), false);
}
function categoryValue(row) {
  return { net: row.netCents, gross: row.grossCents, refunds: row.refundCents, orders: row.orders }[state.view.rank];
}
function renderCategoryChart(el, view) {
  const g = state.view.group;
  const titles = { customer: 'Customers', product: 'Products', size: 'Order sizes' };
  $('#summary-title').textContent = `${titles[g]}, ranked by ${RANK_NAMES[state.view.rank]}`;
  $('#summary-sub').textContent = g === 'product'
    ? 'An order with several products counts under each of them, so product rows add up to more than the total. Refunds count against the products of their order.'
    : g === 'customer' ? 'Refunds count against the customer who placed the order.' : 'Orders are banded by their full amount. Refunds count against the band of their order.';
  setLegend(state.view.rank === 'refunds' ? [['key-refund', 'Refunds']] : state.view.rank === 'orders' ? [['key-net', 'Paid orders']] : [[state.view.rank === 'gross' ? 'key-gross' : 'key-bar', state.view.rank === 'gross' ? 'Gross sales' : 'Net revenue']]);
  const rows = rankedRows(view);
  if (!rows.length) {
    el.innerHTML = '<p class="chart-empty">No accepted rows in this period.</p>';
    el.setAttribute('aria-label', 'No rows in this period.');
    $('#chart-help').textContent = 'Pick a wider period.';
    return;
  }
  const shown = g === 'size' ? rows : rows.slice(0, CATEGORY_BARS);
  const max = Math.max(1, ...shown.map(r => Math.abs(categoryValue(r))));
  const fmt = v => (state.view.rank === 'orders' ? v.toLocaleString('en-US') : cents(v));
  el.className = 'chart is-ranked';
  el.innerHTML = `<ol class="rank-list">${shown.map((row, i) => {
    const value = categoryValue(row);
    const pct = Math.max(0.6, Math.abs(value) / max * 100);
    return `<li><button type="button" class="rank-row" data-drill="${escapeHtml(row.key)}" data-i="${i}"><span class="rank-name">${escapeHtml(row.label)}</span><span class="rank-track"><span class="rank-bar rank-${state.view.rank}${value < 0 ? ' is-negative' : ''}" style="width:${pct.toFixed(1)}%"></span></span><span class="rank-value">${fmt(value)}</span></button></li>`;
  }).join('')}</ol>`;
  const more = rows.length - shown.length;
  el.setAttribute('aria-label', `${titles[g]} ranked by ${RANK_NAMES[state.view.rank]}. ${rows[0].label} leads with ${fmt(categoryValue(rows[0]))}.`);
  $('#chart-help').textContent = (more > 0 ? `The top ${shown.length} of ${rows.length} are drawn. The table lists them all. ` : '') + 'Choose a bar to see the rows behind it.';
}
function rankedRows(view) {
  if (state.view.group === 'size') return view.rows.filter(r => r.orders || r.refunds);
  return [...view.rows].sort((a, b) => categoryValue(b) - categoryValue(a) || a.label.localeCompare(b.label));
}
function hideTip() {
  const tip = $('#chart-tip');
  if (tip) tip.hidden = true;
}
function setActiveCol(index, announce) {
  const el = $('#monthly-chart');
  if (!el._layout || typeof el.querySelectorAll !== 'function') return;
  const { cols, cx, slot, width } = el._layout;
  state.activeCol = index;
  el.querySelectorAll('.month-col').forEach(group => {
    group.setAttribute('class', 'month-col' + (Number(group.getAttribute('data-i')) === index ? ' is-active' : ''));
  });
  if (index < 0 || !cols[index]) { hideTip(); return; }
  const c = cols[index];
  const tip = $('#chart-tip');
  const label = state.view.group === 'month' ? monthLabel(c.key) : c.label;
  const running = state.view.chart === 'running';
  tip.innerHTML = `<h4>${label}</h4><dl><dt><i class="key key-gross"></i>Gross sales</dt><dd>${cents(c.grossCents)}</dd><dt><i class="key key-refund"></i>Refunds</dt><dd>${cents(c.refundCents)}</dd><dt><i class="key key-net"></i>Net revenue</dt><dd>${cents(c.netCents)}</dd><dt>Paid orders</dt><dd>${c.orders}</dd>${running ? `<dt class="tip-run">Net so far</dt><dd class="tip-run">${cents(c.runNet)}</dd>` : ''}</dl>`;
  tip.hidden = false;
  const scale = (el.clientWidth || width) / width;
  const x = cx(index) * scale;
  const tipWidth = tip.offsetWidth || 200;
  const room = el.clientWidth || width;
  let left = x + (slot * scale) / 2 + 8;
  if (left + tipWidth > room) left = x - (slot * scale) / 2 - 8 - tipWidth;
  tip.style.left = `${Math.max(0, Math.round(left))}px`;
  tip.style.top = '8px';
  if (announce) $('#chart-live').textContent = columnSentence(c);
}
function drawBrush(a, b) {
  const el = $('#monthly-chart');
  const brush = typeof el.querySelector === 'function' ? el.querySelector('#chart-brush') : null;
  if (!brush || !el._layout) return;
  const { cx, slot } = el._layout;
  const lo = Math.min(a, b); const hi = Math.max(a, b);
  brush.setAttribute('x', (cx(lo) - slot / 2).toFixed(1));
  brush.setAttribute('width', a < 0 ? '0' : (slot * (hi - lo + 1)).toFixed(1));
}
function pickColumns(a, b) {
  const el = $('#monthly-chart');
  if (!el._layout) return;
  const { cols } = el._layout;
  const lo = cols[Math.min(a, b)]; const hi = cols[Math.max(a, b)];
  if (!lo || !hi) return;
  const from = lo.span[0]; const to = hi.span[1];
  setView({ from, to }, `Period set to ${shortPeriod(clampView({ from, to }).from, clampView({ from, to }).to)}.`);
}

// ---------- Breakdown table ----------
function renderBreakdown(view) {
  const g = state.view.group;
  const time = isTimeGroup();
  const rows = time ? view.rows : rankedRows(view);
  const share = row => (view.totals.netCents ? `${percent.format(row.netCents / view.totals.netCents * 100)}%` : '');
  $('#month-caption').textContent = time ? (g === 'month' ? 'Monthly figures' : 'Quarterly figures') : `${GROUP_NAMES[g]} figures`;
  $('#breakdown-head').innerHTML = `<tr><th scope="col">${GROUP_NAMES[g]}</th><th scope="col" class="numeric">Orders</th><th scope="col" class="numeric">Gross</th><th scope="col" class="numeric">Refunds</th><th scope="col" class="numeric">Net</th><th scope="col" class="numeric">${time ? 'Net change' : g === 'product' ? 'Refund rate' : 'Share of net'}</th><th scope="col" class="row-cell"><span class="sr-only">Rows</span></th></tr>`;
  const peak = rows.reduce((best, r) => (r.netCents > best ? r.netCents : best), -Infinity);
  $('#month-body').innerHTML = rows.length ? rows.map((r, i) => {
    let extra;
    if (time) {
      const prev = rows[i - 1];
      extra = '<span class="muted">First</span>';
      if (prev) {
        if (prev.netCents === 0) extra = '<span class="muted">No prior net</span>';
        else {
          const pct = (r.netCents - prev.netCents) / Math.abs(prev.netCents) * 100;
          extra = `<span class="${pct >= 0 ? 'change-up' : 'change-down'}">${pct >= 0 ? '+' : '−'}${percent.format(Math.abs(pct))}%</span>`;
        }
      }
    } else if (g === 'product') {
      extra = r.grossCents ? `${percent.format(r.refundCents / r.grossCents * 100)}%` : '<span class="muted">No sales</span>';
    } else extra = share(r);
    const label = g === 'month' ? monthLabel(r.key) : r.label;
    const drill = r.orders || r.refunds ? `<button type="button" class="row-link" data-drill="${escapeHtml(r.key)}" aria-label="Rows for ${escapeHtml(label)}">Rows</button>` : '';
    return `<tr${time && r.netCents === peak && rows.length > 1 ? ' class="is-peak"' : ''}><th scope="row">${escapeHtml(label)}</th><td class="numeric">${r.orders}</td><td class="numeric">${cents(r.grossCents)}</td><td class="numeric">${cents(r.refundCents)}</td><td class="numeric">${cents(r.netCents)}</td><td class="numeric">${extra}</td><td class="row-cell">${drill}</td></tr>`;
  }).join('') : '<tr><td colspan="7">No accepted rows in this period.</td></tr>';
  const t = view.totals;
  $('#breakdown-foot').innerHTML = rows.length > 1 ? `<tr><th scope="row">${view.overlapping ? 'Total, each order once' : 'Total'}</th><td class="numeric">${t.orders}</td><td class="numeric">${cents(t.grossCents)}</td><td class="numeric">${cents(t.refundCents)}</td><td class="numeric">${cents(t.netCents)}</td><td class="numeric">${time || g === 'product' ? '' : '100%'}</td><td></td></tr>` : '';
  const note = $('#breakdown-note');
  note.hidden = g !== 'customer' && g !== 'product';
  if (g === 'customer') {
    const repeat = rows.filter(r => r.orders > 1).length;
    note.textContent = `${plural(rows.length, 'customer')} in the period, ${repeat} of them with more than one order.`;
  } else if (g === 'product') {
    note.textContent = `${plural(rows.length, 'product')}. Product rows overlap, so the total counts each order once.`;
  }
}

// ---------- Exceptions and fixes ----------
function issueGroups() {
  const groups = new Map();
  state.report.issues.forEach(item => {
    if (!groups.has(item.code)) groups.set(item.code, { code: item.code, severity: item.severity, items: [] });
    const group = groups.get(item.code);
    if (item.severity === 'error') group.severity = 'error';
    group.items.push(item);
  });
  return Array.from(groups.values()).sort((a, b) => (a.severity === b.severity ? b.items.length - a.items.length : a.severity === 'error' ? -1 : 1));
}
function renderIssueGroups() {
  const issues = state.report.issues;
  const errors = issues.filter(item => item.severity === 'error').length;
  const warnings = issues.length - errors;
  const groups = issueGroups();
  $('#issues-sub').textContent = issues.length
    ? `${plural(issues.length, 'exception')} across ${plural(groups.length, 'kind')} of problem. ${errors} need a fix in the source file. ${warnings} are worth a check but may be fine as they are.`
    : 'Every row was accepted.';
  $('#issue-groups').innerHTML = groups.length ? groups.map(group => {
    const info = problem(group.code);
    const refs = group.items.map(item => item.ref || `line ${item.row}`);
    const shown = refs.slice(0, 6).map(ref => `<li>${escapeHtml(ref)}</li>`).join('');
    const more = refs.length > 6 ? `<li>and ${refs.length - 6} more</li>` : '';
    return `<article class="issue-group ${group.severity}"><div class="issue-group-head"><h3>${escapeHtml(info.title)}</h3><span class="group-count">${plural(group.items.length, 'row')}</span></div><p><span class="pill ${group.severity}">${group.severity === 'error' ? 'Needs a fix' : 'Check'}</span></p><p>${escapeHtml(info.what)}</p><p class="fix"><strong>Fix.</strong> ${escapeHtml(info.fix)}</p><ul class="issue-refs" aria-label="Affected IDs">${shown}${more}</ul><button type="button" class="link-button" data-code="${escapeHtml(group.code)}">Show ${group.items.length === 1 ? 'this row' : `these ${group.items.length} rows`}</button></article>`;
  }).join('') : '<p class="all-clear">Every row was accepted. Nothing to fix.</p>';
}
function renderFixState() {
  const left = state.report.issues.length;
  const base = Math.max(state.baselineIssues, left);
  const cleared = base - left;
  $('#fix-meter-text').innerHTML = state.edits
    ? `<strong>${cleared}</strong> of ${base} cleared, ${plural(left, 'exception')} left`
    : left ? `${plural(left, 'exception')}. Use Fix on any row to correct it here.` : 'Nothing left to fix.';
  $('#fix-bar').style.width = `${base ? (cleared / base) * 100 : 100}%`;
  $('#fix-meter').className = 'fix-meter' + (left === 0 ? ' is-clear' : '');
  const fixedBox = $('#export-fixed');
  fixedBox.hidden = !state.edits;
  $('#export-fixed-text').textContent = state.edits ? `${plural(state.edits, 'change')} made in this browser. Download the corrected files to keep them.` : '';
}
function pageControls(container, page, total, change) {
  let control = $(`#${container}-paging`);
  if (!control) {
    control = document.createElement('div');
    control.id = `${container}-paging`;
    control.className = 'paging';
    const prev = document.createElement('button');
    const next = document.createElement('button');
    const label = document.createElement('span');
    prev.type = 'button'; next.type = 'button';
    prev.className = next.className = 'button secondary';
    prev.textContent = 'Previous page';
    next.textContent = 'Next page';
    prev.addEventListener('click', () => control._change(control._page - 1));
    next.addEventListener('click', () => control._change(control._page + 1));
    control.append(prev); control.append(next); control.append(label);
    $(`#${container}`).closest('.table-scroll').after(control);
  }
  // Buttons are kept between pages, so keyboard focus stays where it was.
  const [prev, next, label] = control.children;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  control._page = page;
  control._change = change;
  control.hidden = pages === 1;
  const focused = document.activeElement;
  prev.disabled = page === 0;
  next.disabled = page >= pages - 1;
  label.textContent = `Page ${page + 1} of ${pages}`;
  if (focused === prev && prev.disabled) next.focus();
  if (focused === next && next.disabled) prev.focus();
}
function filteredIssues() {
  const query = state.search.trim().toLowerCase();
  return state.report.issues.filter(item =>
    (state.filter === 'all' || item.severity === state.filter) &&
    (!state.code || item.code === state.code) &&
    (!query || [item.source, item.code, item.message, item.ref, item.row, problem(item.code).title].join(' ').toLowerCase().includes(query)));
}
function renderIssues() {
  if (!state.report) return;
  const rows = filteredIssues();
  state.issuePage = Math.min(state.issuePage, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const start = state.issuePage * PAGE_SIZE;
  $('#issue-body').innerHTML = rows.length ? rows.slice(start, start + PAGE_SIZE).map(item => `<tr><td><span class="pill ${item.severity === 'error' ? 'error' : 'warning'}">${item.severity === 'error' ? 'Needs a fix' : 'Check'}</span></td><td>${item.source === 'orders' ? 'Orders' : 'Refunds'}</td><td class="numeric">${item.row}</td><td class="mono">${escapeHtml(item.ref || '')}</td><td class="wrap-cell">${escapeHtml(item.message)}</td><td class="row-cell"><button type="button" class="row-link" data-fix="${item.source}:${item.row}:${escapeHtml(item.code)}" aria-label="Fix ${item.source === 'orders' ? 'orders' : 'refunds'} line ${item.row}">Fix</button></td></tr>`).join('') : `<tr><td colspan="6">${state.report.issues.length ? 'No exceptions match this filter.' : 'No exceptions. Every row was counted.'}</td></tr>`;
  const total = state.report.issues.length;
  $('#issue-count').textContent = `${rows.length} of ${plural(total, 'exception')} shown.` + (rows.length > PAGE_SIZE ? ` Rows ${start + 1} to ${Math.min(start + PAGE_SIZE, rows.length)}.` : '');
  $('#code-filter').hidden = !state.code;
  $('#code-filter-text').textContent = state.code ? `Showing only: ${problem(state.code).title}.` : '';
  pageControls('issue-body', state.issuePage, rows.length, page => { state.issuePage = page; renderIssues(); });
}
function rowIssues(source, row, orders, refunds) {
  return LedgerLens.buildReport(orders, refunds).issues.filter(item => item.source === source && item.row === row);
}
function openFix(source, row, code) {
  if (!state.parsed || state.dirty) { notice('Build the report again before fixing rows, so the fix lands on the current files.', 'warning'); return; }
  const record = state.parsed[source].find(item => item._row === row);
  if (!record) return;
  const info = problem(code);
  const keys = headersFor(source);
  state.fix = { source, row, code, draft: { ...record } };
  $('#fix-title').textContent = `Fix ${source === 'orders' ? 'order' : 'refund'} ${record[source === 'orders' ? 'order_id' : 'refund_id'] || 'row'}`;
  $('#fix-sub').textContent = `${source === 'orders' ? 'Orders' : 'Refunds'} file, line ${row}. ${info.title}.`;
  $('#fix-hint').textContent = info.fix;
  $('#fix-remove').className = 'button ' + (info.remove ? 'primary' : 'ghost');
  $('#fix-save').className = 'button ' + (info.remove ? 'ghost' : 'primary');
  $('#fix-fields').innerHTML = keys.map(key => {
    const flagged = info.fields.includes(key);
    const id = `fix-field-${key.replace(/[^a-z0-9_]/gi, '')}`;
    return `<div class="fix-field${flagged ? ' is-flagged' : ''}"><label for="${id}">${escapeHtml(key)}</label><input id="${id}" type="text" data-field="${escapeHtml(key)}" value="${escapeHtml(record[key] ?? '')}" autocomplete="off" spellcheck="false"></div>`;
  }).join('');
  checkFix();
  const dialog = $('#fix-dialog');
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    const first = typeof dialog.querySelector === 'function' ? dialog.querySelector('.is-flagged input') || dialog.querySelector('input') : null;
    if (first) { first.focus(); if (first.select) first.select(); }
  } else dialog.hidden = false;
}
function withDraft(source, row, draft) {
  const swap = list => (draft === null ? list.filter(item => item._row !== row) : list.map(item => (item._row === row ? draft : item)));
  return source === 'orders' ? { orders: swap(state.parsed.orders), refunds: state.parsed.refunds } : { orders: state.parsed.orders, refunds: swap(state.parsed.refunds) };
}
function checkFix() {
  if (!state.fix) return;
  const { source, row, draft } = state.fix;
  const next = withDraft(source, row, draft);
  const left = rowIssues(source, row, next.orders, next.refunds);
  const box = $('#fix-check');
  box.className = 'fix-check' + (left.length ? ' is-open' : ' is-clear');
  box.innerHTML = left.length ? `<strong>Still open.</strong> ${left.map(item => escapeHtml(item.message)).join(' ')}` : '<strong>This row is clean.</strong> It will be counted after you save.';
}
function closeFix() {
  state.fix = null;
  const dialog = $('#fix-dialog');
  if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); } else dialog.hidden = true;
}
function commitFix(remove) {
  if (!state.fix) return;
  const { source, row, draft } = state.fix;
  const before = state.report.issues.length;
  const label = draft[source === 'orders' ? 'order_id' : 'refund_id'] || `line ${row}`;
  pushUndo();
  state.parsed = withDraft(source, row, remove ? null : { ...draft, _row: row });
  state.edits += 1;
  closeFix();
  rebuild();
  const after = state.report.issues.length;
  const change = before - after;
  toast(`${remove ? 'Removed' : 'Fixed'} ${label}. ${change > 0 ? `${plural(change, 'exception')} cleared` : 'No exceptions cleared'}, ${after} left.`, true);
  notice(`${remove ? 'Removed' : 'Changed'} ${label} in this browser and rebuilt the report. Download the corrected file to keep the change.`);
}

// ---------- Rows ----------
function drillMatches(record, isOrder, orderById) {
  const d = state.drill;
  if (!d) return true;
  const order = isOrder ? record : orderById.get(record.order_id) || {};
  const date = isOrder ? record.order_date : record.refund_date;
  if (d.group === 'month') return date.slice(0, 7) === d.key;
  if (d.group === 'quarter') { const [a, b] = quarterSpan(d.key); return date.slice(0, 7) >= a && date.slice(0, 7) <= b; }
  if (d.group === 'customer') return (String(order.customer || '').trim() || '(no customer name)') === d.key;
  if (d.group === 'product') return LedgerLens.productsOf(order.items).includes(d.key);
  if (d.group === 'size') { const amount = Math.round(Number(order.amount) * 100); const band = LedgerLens.SIZE_BANDS.find(b => amount < b.below); return Boolean(band) && band.key === d.key; }
  return true;
}
function drillTo(key) {
  const view = currentView();
  const row = view.rows.find(r => r.key === key);
  state.drill = { group: state.view.group, key, label: row ? (state.view.group === 'month' ? monthLabel(key) : row.label) : key };
  state.source = row && !row.orders && row.refunds ? 'refunds' : 'orders';
  $$('[data-record]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.record === state.source)));
  state.recordPage = 0;
  selectTab('records', true);
  renderRecords();
}
function renderRecords() {
  if (!state.report) return;
  const isOrders = state.source === 'orders';
  const orderById = new Map(state.report.records.orders.map(o => [o.order_id, o]));
  const { from, to } = state.view;
  const query = state.recordSearch.trim().toLowerCase();
  const all = state.report.records[state.source];
  const rows = all.filter(row => {
    const month = (isOrders ? row.order_date : row.refund_date).slice(0, 7);
    if (from && (month < from || month > to)) return false;
    if (!drillMatches(row, isOrders, orderById)) return false;
    if (!query) return true;
    const extra = isOrders ? '' : [(orderById.get(row.order_id) || {}).customer, (orderById.get(row.order_id) || {}).items].join(' ');
    return Object.entries(row).filter(([k]) => k !== '_row').map(([, v]) => v).join(' ').concat(' ', extra).toLowerCase().includes(query);
  });
  const hasItems = isOrders && all.some(row => row.items);
  const hasCustomer = isOrders && all.some(row => row.customer);
  const columns = isOrders
    ? [['_row', 'Line', 'numeric'], ['order_id', 'Order', 'mono'], ['order_date', 'Date', 'mono'], ...(hasCustomer ? [['customer', 'Customer', '']] : []), ...(hasItems ? [['items', 'Items', 'wrap-cell']] : []), ['amount', 'Amount', 'numeric']]
    : [['_row', 'Line', 'numeric'], ['refund_id', 'Refund', 'mono'], ['order_id', 'Order', 'mono'], ['refund_date', 'Date', 'mono'], ['reason', 'Reason', ''], ['amount', 'Amount', 'numeric']];
  state.recordPage = Math.min(state.recordPage, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const start = state.recordPage * PAGE_SIZE;
  $('#records-head').innerHTML = `<tr>${columns.map(([, label, cls]) => `<th scope="col"${cls === 'numeric' ? ' class="numeric"' : ''}>${label}</th>`).join('')}</tr>`;
  $('#records-body').innerHTML = rows.length ? rows.slice(start, start + PAGE_SIZE).map(row => `<tr>${columns.map(([field, , cls]) => `<td${cls ? ` class="${cls}"` : ''}>${escapeHtml(field === 'amount' ? money.format(row[field]) : row[field])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}">No accepted ${state.source} match. ${state.drill || query ? 'Clear the filter to see more.' : 'Try a wider period.'}</td></tr>`;
  $('#records-caption').textContent = `Accepted ${state.source}`;
  const sum = rows.reduce((total, row) => total + Math.round(Number(row.amount) * 100), 0);
  $('#records-summary').textContent = `${plural(rows.length, isOrders ? 'accepted order' : 'accepted refund')} in ${from ? shortPeriod(from, to) : 'the data'}, totalling ${cents(sum)}.` + (rows.length > PAGE_SIZE ? ` Rows ${start + 1} to ${Math.min(start + PAGE_SIZE, rows.length)}.` : '');
  $('#drill').hidden = !state.drill;
  $('#drill-text').textContent = state.drill ? `Only rows for ${GROUP_NAMES[state.drill.group].toLowerCase()}: ${state.drill.label}.` : '';
  pageControls('records-body', state.recordPage, rows.length, page => { state.recordPage = page; renderRecords(); });
}

function selectTab(name, focus) {
  state.tab = name;
  $$('[data-tab]').forEach(tab => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.setAttribute('tabindex', selected ? '0' : '-1');
    $(`#panel-${tab.dataset.tab}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  // The chart cannot measure itself while its panel is hidden, so redraw it on return.
  if (name === 'summary' && state.report) renderChart(currentView());
  if (state.report) syncHash();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canExport() { return Boolean(state.report) && !state.dirty; }
function baseName(source) { return (state.names[source] || source).replace(/\.csv$/i, '').replace(/[^\w.-]+/g, '-') || source; }

// ---------- Wiring ----------
['orders', 'refunds'].forEach(source => {
  $(`#${source}-file`).addEventListener('change', event => onFileInput(source, event.target));
  const drop = $(`#drop-${source}`);
  drop.addEventListener('dragover', event => { event.preventDefault(); if (event.stopPropagation) event.stopPropagation(); drop.className = 'drop is-over'; });
  drop.addEventListener('dragleave', () => setDrop(source, $(`#${source}-name`).textContent, state.names[source] ? '' : 'empty'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    hideOverlay();
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length > 1) { importAnywhere(files); return; }
    const file = files && files[0];
    if (file) importFile(source, file); else setDrop(source, $(`#${source}-name`).textContent, state.names[source] ? '' : 'empty');
  });
});
$('#run-report').addEventListener('click', runReport);
$('#load-samples').addEventListener('click', loadSamples);
$('#import-toggle').addEventListener('click', () => setImportCollapsed($('#import-toggle').getAttribute('aria-expanded') === 'true'));
$$('[data-mode]').forEach(button => button.addEventListener('click', () => { setMode(button.dataset.mode); if (button.dataset.mode === 'paste' && $('#paste-text').focus) $('#paste-text').focus(); }));
$('#paste-use').addEventListener('click', usePasted);
$('#export-json').addEventListener('click', () => { if (canExport()) download('ledgerlens-report.json', JSON.stringify(state.report, null, 2), 'application/json'); });
$('#export-csv').addEventListener('click', () => { if (canExport()) download('ledgerlens-exceptions.csv', LedgerLens.exportIssuesCsv(state.report.issues), 'text/csv;charset=utf-8'); });
$('#export-view').addEventListener('click', exportView);
$('#export-fixed-orders').addEventListener('click', () => { if (canExport() && state.edits) download(`${baseName('orders')}-corrected.csv`, LedgerLens.recordsToCsv(headersFor('orders'), state.parsed.orders), 'text/csv;charset=utf-8'); });
$('#export-fixed-refunds').addEventListener('click', () => { if (canExport() && state.edits) download(`${baseName('refunds')}-corrected.csv`, LedgerLens.recordsToCsv(headersFor('refunds'), state.parsed.refunds), 'text/csv;charset=utf-8'); });
$('#print-report').addEventListener('click', () => { if (canExport()) window.print(); });
function exportView() {
  if (!canExport()) return;
  const v = state.view;
  download(`ledgerlens-${v.group}-${v.from}-to-${v.to}.csv`, LedgerLens.exportViewCsv(currentView()), 'text/csv;charset=utf-8');
  toast('This view was downloaded as CSV.', false);
}

const tabs = $$('[data-tab]');
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const target = tabs[(keys[event.key] + tabs.length) % tabs.length];
    selectTab(target.dataset.tab, true);
  });
});
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  state.issuePage = 0;
  $$('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderIssues();
}));
$$('[data-record]').forEach(button => button.addEventListener('click', () => {
  state.source = button.dataset.record;
  state.recordPage = 0;
  $$('[data-record]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderRecords();
}));
$$('[data-group]').forEach(button => button.addEventListener('click', () => setView({ group: button.dataset.group })));
$$('[data-rank]').forEach(button => button.addEventListener('click', () => setView({ rank: button.dataset.rank })));
$$('[data-chart]').forEach(button => button.addEventListener('click', () => setView({ chart: button.dataset.chart })));
$('#from-month').addEventListener('change', event => {
  const from = event.target.value;
  setView(from > state.view.to ? { from, to: from } : { from });
});
$('#to-month').addEventListener('change', event => {
  const to = event.target.value;
  setView(to < state.view.from ? { from: to, to } : { to });
});
$('#whole-range').addEventListener('click', () => { const m = allMonths(); setView({ from: m[0], to: m[m.length - 1] }); });
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#toast-undo').addEventListener('click', () => { undo(); $('#toast').hidden = true; });
$('#share-view').addEventListener('click', copyLink);
$('#views-toggle').addEventListener('click', () => toggleViews());
$('#views-panel').addEventListener('click', event => {
  const target = event.target && event.target.closest ? event.target.closest('[data-preset],[data-saved],[data-delete]') : null;
  if (!target) return;
  const data = target.dataset;
  if (data.delete !== undefined) {
    const list = readSaved();
    const [gone] = list.splice(Number(data.delete), 1);
    writeSaved(list);
    renderViews();
    if (gone) toast(`Deleted "${gone.name}".`, false);
    return;
  }
  const item = data.preset !== undefined ? presets()[Number(data.preset)] : readSaved()[Number(data.saved)];
  if (!item) return;
  toggleViews(false);
  setView(item.view, `Showing "${item.name}".`);
});
$('#save-form').addEventListener('submit', event => { event.preventDefault(); saveView($('#view-name').value); });
$('#issue-search').addEventListener('input', event => { state.search = event.target.value; state.issuePage = 0; renderIssues(); });
$('#record-search').addEventListener('input', event => { state.recordSearch = event.target.value; state.recordPage = 0; renderRecords(); });
$('#drill-clear').addEventListener('click', () => { state.drill = null; state.recordPage = 0; renderRecords(); });
$('#issue-groups').addEventListener('click', event => {
  const button = event.target && event.target.closest ? event.target.closest('[data-code]') : null;
  if (!button) return;
  state.code = button.dataset.code;
  state.filter = 'all';
  state.issuePage = 0;
  $$('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')));
  renderIssues();
  const head = $('#issue-table');
  if (head && head.scrollIntoView) head.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const title = $('#issue-table-title');
  if (title && title.focus) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
});
$('#code-filter-clear').addEventListener('click', () => { state.code = ''; state.issuePage = 0; renderIssues(); });
$('#issue-body').addEventListener('click', event => {
  const button = event.target && event.target.closest ? event.target.closest('[data-fix]') : null;
  if (!button) return;
  const [source, row, code] = button.dataset.fix.split(':');
  openFix(source, Number(row), code);
});
$('#fix-fields').addEventListener('input', event => {
  const field = event.target && event.target.dataset && event.target.dataset.field;
  if (!state.fix || !field) return;
  state.fix.draft[field] = event.target.value;
  checkFix();
});
$('#fix-remove').addEventListener('click', () => commitFix(true));
$('#fix-cancel').addEventListener('click', closeFix);
$('#fix-dialog').addEventListener('close', () => { state.fix = null; });
$('#fix-form').addEventListener('submit', event => { event.preventDefault(); commitFix(false); });
$('#month-body').addEventListener('click', event => {
  const button = event.target && event.target.closest ? event.target.closest('[data-drill]') : null;
  if (button) drillTo(button.dataset.drill);
});
$('#shortcuts-open').addEventListener('click', () => openShortcuts());
$('#shortcuts-close').addEventListener('click', () => { const d = $('#shortcuts-dialog'); if (typeof d.close === 'function') d.close(); else d.hidden = true; });
function openShortcuts() {
  const d = $('#shortcuts-dialog');
  if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.hidden = false;
}

const chart = $('#monthly-chart');
let drag = null;
const colFromEvent = event => {
  const hit = event.target && event.target.closest ? event.target.closest('[data-i]') : null;
  return hit ? Number(hit.getAttribute('data-i')) : -1;
};
const colFromX = event => {
  const layout = chart._layout;
  if (!layout || typeof chart.getBoundingClientRect !== 'function') return -1;
  const box = chart.getBoundingClientRect();
  const x = (event.clientX - box.left) * (layout.width / (box.width || layout.width));
  return Math.max(0, Math.min(layout.cols.length - 1, Math.floor((x - layout.cx(0) + layout.slot / 2) / layout.slot)));
};
chart.addEventListener('click', event => {
  const row = event.target && event.target.closest ? event.target.closest('[data-drill]') : null;
  if (row) drillTo(row.dataset.drill);
});
chart.addEventListener('pointerdown', event => {
  const i = colFromEvent(event);
  if (i < 0 || !chart._layout) return;
  setActiveCol(i, true);
  if (state.view.chart !== 'running') drag = { start: i, end: i, id: event.pointerId, moved: false };
});
chart.addEventListener('pointermove', event => {
  if (drag && event.pointerId === drag.id) {
    const i = colFromX(event);
    if (i >= 0 && i !== drag.end) {
      drag.end = i; drag.moved = true;
      if (chart.setPointerCapture) { try { chart.setPointerCapture(event.pointerId); } catch { /* not capturable */ } }
      drawBrush(drag.start, drag.end);
      setActiveCol(i, false);
    }
    return;
  }
  const i = colFromEvent(event);
  if (i >= 0 && i !== state.activeCol) setActiveCol(i, false);
});
function endDrag(event, cancel) {
  if (!drag || (event && event.pointerId !== drag.id)) return;
  const done = drag;
  drag = null;
  drawBrush(-1, -1);
  if (!cancel && done.moved && done.start !== done.end) pickColumns(done.start, done.end);
}
chart.addEventListener('pointerup', event => endDrag(event, false));
chart.addEventListener('pointercancel', event => endDrag(event, true));
chart.addEventListener('dblclick', event => { const i = colFromEvent(event); if (i >= 0 && state.view.chart !== 'running') pickColumns(i, i); });
// Touch pointers leave as soon as the finger lifts, so only a mouse leaving clears the tooltip.
chart.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && !drag && document.activeElement !== chart) setActiveCol(-1); });
chart.addEventListener('focus', () => {
  if (state.report && state.activeCol < 0 && chart._layout) { const last = chart._layout.cols.length - 1; state.anchorCol = last; setActiveCol(last, true); }
});
chart.addEventListener('blur', () => { if (chart._layout) setActiveCol(-1); });
chart.addEventListener('keydown', event => {
  const layout = chart._layout;
  if (!layout) return;
  const count = layout.cols.length;
  if (event.key === 'Enter' && state.activeCol >= 0 && state.view.chart !== 'running') { event.preventDefault(); pickColumns(state.activeCol, state.activeCol); return; }
  const moves = { ArrowRight: state.activeCol + 1, ArrowLeft: state.activeCol - 1, Home: 0, End: count - 1 };
  if (!(event.key in moves)) { if (event.key === 'Escape') setActiveCol(-1); return; }
  event.preventDefault();
  const next = Math.max(0, Math.min(count - 1, moves[event.key]));
  if (event.shiftKey && state.view.chart !== 'running') {
    const anchor = state.anchorCol >= 0 ? state.anchorCol : state.activeCol;
    state.anchorCol = anchor;
    setActiveCol(next, true);
    pickColumns(anchor, next);
    const fresh = chart._layout;
    if (fresh) setActiveCol(Math.min(next, fresh.cols.length - 1), false);
    return;
  }
  state.anchorCol = next;
  setActiveCol(next, true);
});

// Drop files anywhere on the page.
let overlayDepth = 0;
function hideOverlay() { overlayDepth = 0; const o = $('#drop-overlay'); if (o) o.hidden = true; }
function hasFiles(event) { const types = event.dataTransfer && event.dataTransfer.types; return Boolean(types) && Array.from(types).includes('Files'); }
if (typeof window.addEventListener === 'function') {
  window.addEventListener('dragenter', event => { if (!hasFiles(event)) return; overlayDepth += 1; $('#drop-overlay').hidden = false; });
  window.addEventListener('dragleave', () => { overlayDepth = Math.max(0, overlayDepth - 1); if (!overlayDepth) hideOverlay(); });
  window.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
  window.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hideOverlay();
    importAnywhere(event.dataTransfer.files);
  });

  let resizeTimer = null;
  let lastWidth = chart.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.report || chart.clientWidth === lastWidth) return;
      lastWidth = chart.clientWidth;
      if (isTimeGroup()) renderChart(currentView());
    }, 120);
  });

  window.addEventListener('hashchange', () => {
    const parsed = hashToView(location.hash);
    if (!parsed || !state.report) return;
    setView(parsed.view);
    if (parsed.tab && parsed.tab !== state.tab) selectTab(parsed.tab);
  });

  window.addEventListener('keydown', event => {
    const target = event.target || {};
    const tag = (target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    const modal = typeof document.querySelector === 'function' && document.querySelector('dialog[open]');
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'Z' || key === 'y')) {
      if (typing || modal || !state.report) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo(); else undo();
      return;
    }
    if (key === 'Escape' && !modal && !$('#views-panel').hidden) { toggleViews(false); $('#views-toggle').focus(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || typing || modal) return;
    if (key === '?') { event.preventDefault(); openShortcuts(); return; }
    if (!state.report || state.dirty) return;
    const groupKeys = { m: 'month', q: 'quarter', c: 'customer', p: 'product', o: 'size' };
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (key === '1' || key === '2' || key === '3') { selectTab(TABS[Number(key) - 1], true); }
    else if (groupKeys[lower]) setView({ group: groupKeys[lower] });
    else if (key === '[') shiftPeriod(-1);
    else if (key === ']') shiftPeriod(1);
    else if (lower === 'a') { const m = allMonths(); setView({ from: m[0], to: m[m.length - 1] }); }
    else if (lower === 'r' && isTimeGroup()) setView({ chart: state.view.chart === 'bars' ? 'running' : 'bars' });
    else if (lower === 'v') toggleViews();
    else if (lower === 'l') copyLink();
    else if (lower === 'e') exportView();
    else if (key === '/') {
      event.preventDefault();
      if (state.tab === 'summary') selectTab('records');
      const input = state.tab === 'issues' ? $('#issue-search') : $('#record-search');
      if (input && input.focus) input.focus();
    } else return;
  });

  document.addEventListener && document.addEventListener('click', event => {
    const panel = $('#views-panel');
    if (panel.hidden) return;
    const inside = event.target && event.target.closest && event.target.closest('.views');
    if (!inside) toggleViews(false);
  });
}

try {
  const parsed = typeof location !== 'undefined' ? hashToView(location.hash) : null;
  if (parsed) { state.pendingView = parsed.view; state.pendingTab = parsed.tab; }
} catch { /* no location in this environment */ }
setExports(false);
loadSamples();
