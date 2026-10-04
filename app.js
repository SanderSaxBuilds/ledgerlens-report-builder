const $ = selector => document.querySelector(selector);
const state = { ordersText: '', refundsText: '', report: null, dirty: false, revision: 0, filter: 'all', search: '', source: 'orders', issuePage: 0, recordPage: 0, fileReads: { orders: 0, refunds: 0 } };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PAGE_SIZE = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 100000;
const EXPORT_BUTTONS = ['export-json','export-csv','print-report'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function notice(message, kind = 'success') {
  $('#notice').textContent = message;
  $('#notice').className = `notice ${kind}`;
}
function markDirty() {
  state.dirty = true;
  state.revision += 1;
  $('#report-state').textContent = state.report ? 'Sources changed' : 'Ready to generate';
  $('#report-state').className = 'state-pill stale';
  EXPORT_BUTTONS.forEach(id => $(`#${id}`).disabled = true);
  notice('Source files changed. Generate a new report before using the displayed totals or exports.', 'warning');
}
async function importFile(source, input) {
  const sequence = ++state.fileReads[source];
  const file = input.files?.[0];
  state[`${source}Text`] = '';
  $(`#${source}-name`).textContent = file ? `Reading ${file.name}` : 'No file loaded';
  markDirty();
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    $(`#${source}-name`).textContent = 'File too large';
    notice(`${source === 'orders' ? 'Orders' : 'Refunds'} file exceeds the 5 MB limit. Export a smaller date range.`, 'error');
    return;
  }
  try {
    const text = await file.text();
    if (state.fileReads[source] !== sequence) return;
    state[`${source}Text`] = text;
    $(`#${source}-name`).textContent = file.name;
    notice('Source loaded. Generate a new report to validate these files.', 'warning');
  } catch {
    if (state.fileReads[source] !== sequence) return;
    $(`#${source}-name`).textContent = 'File could not be read';
    notice('The selected file could not be read. Choose a readable CSV export.', 'error');
  }
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
    $('#orders-file').value = '';
    $('#refunds-file').value = '';
    $('#orders-name').textContent = 'orders.csv / fictional sample';
    $('#refunds-name').textContent = 'refunds.csv / fictional sample';
    runReport();
  } catch {
    if (state.revision === revision) notice('The bundled samples could not load. Download both CSV files and import them using the source controls.', 'error');
  } finally { $('#load-samples').disabled = false; }
}
function runReport() {
  if (!state.ordersText || !state.refundsText) {
    notice('Load both CSV files. If there are no refunds, supply a file with the required refund headers and no data rows.', 'error');
    return;
  }
  try {
    const orders = LedgerLens.parseCsv(state.ordersText, { source: 'orders' });
    const refunds = LedgerLens.parseCsv(state.refundsText, { source: 'refunds' });
    if (orders.length > MAX_ROWS || refunds.length > MAX_ROWS) throw new Error('Each source must contain at most 100,000 rows. Split the export by date range.');
    const report = LedgerLens.buildReport(orders, refunds);
    state.report = report;
    state.dirty = false;
    state.issuePage = 0;
    state.recordPage = 0;
    renderReport();
    $('#report-state').textContent = 'Current report';
    $('#report-state').className = 'state-pill';
    EXPORT_BUTTONS.forEach(id => $(`#${id}`).disabled = false);
    notice(`Processed ${orders.length + refunds.length} source rows. ${report.accepted.orders} orders and ${report.accepted.refunds} refunds accepted, ${report.issues.length} exceptions recorded.`);
  } catch (error) {
    // Invalidate the previous report after a failed generation.
    state.report = null;
    state.dirty = true;
    $('#report').hidden = true;
    $('#empty-state').hidden = false;
    $('#report-state').textContent = 'Source needs attention';
    $('#report-state').className = 'state-pill stale';
    EXPORT_BUTTONS.forEach(id => $(`#${id}`).disabled = true);
    notice(`${error.message} No report was generated. Correct the source and try again.`, 'error');
  }
}
function renderReport() {
  const { metrics, accepted, sourceRows, issues } = state.report;
  $('#gross').textContent = money.format(metrics.grossRevenue);
  $('#net').textContent = money.format(metrics.netRevenue);
  $('#orders').textContent = metrics.orderCount;
  $('#aov').textContent = money.format(metrics.averageOrderValue);
  $('#refund-rate').textContent = `${percent.format(metrics.refundRate)}%`;
  $('#quality-summary').textContent = `${accepted.orders}/${sourceRows.orders} orders and ${accepted.refunds}/${sourceRows.refunds} refunds accepted`;
  $('#issue-total').textContent = issues.length;
  $('#generated').textContent = new Date(state.report.generatedAt).toLocaleString();
  $('#generated').dateTime = state.report.generatedAt;
  $('#recon-gross').textContent = money.format(metrics.grossRevenue);
  $('#recon-refunds').textContent = money.format(metrics.refunded);
  $('#recon-net').textContent = money.format(metrics.netRevenue);
  renderMonths(); renderIssues(); renderRecords();
  $('#empty-state').hidden = true;
  $('#report').hidden = false;
}
function renderMonths() {
  const months = state.report.byMonth;
  const visible = months.slice(-12);
  const max = Math.max(1, ...visible.flatMap(m => [m.grossRevenue, Math.abs(m.netRevenue)]));
  $('#monthly-chart').innerHTML = visible.length ? visible.map(m => `<div class="chart-month"><div class="chart-bars"><div class="bar" style="height:${Math.max(1,m.grossRevenue/max*100)}%" title="Gross ${escapeHtml(money.format(m.grossRevenue))}"></div><div class="bar net ${m.netRevenue < 0 ? 'negative' : ''}" style="height:${Math.max(1,Math.abs(m.netRevenue)/max*100)}%" title="Net ${escapeHtml(money.format(m.netRevenue))}"></div></div><span class="chart-label">${escapeHtml(m.month)}</span></div>`).join('') : '<p>No accepted revenue or refunds to chart.</p>';
  $('#monthly-chart').setAttribute('aria-label', `Last ${visible.length} months. Negative net values use striped red bars. Exact values are in the table.`);
  $('#month-body').innerHTML = months.length ? months.map(m => `<tr><th scope="row">${escapeHtml(m.month)}</th><td>${m.orderCount}</td><td class="numeric">${money.format(m.grossRevenue)}</td><td class="numeric">${money.format(m.refunded)}</td><td class="numeric">${money.format(m.netRevenue)}</td></tr>`).join('') : '<tr><td colspan="5">No accepted rows.</td></tr>';
}
function pageControls(container, page, total, change) {
  let control = $(`#${container}-paging`);
  if (!control) {
    control = document.createElement('div'); control.id = `${container}-paging`; control.className = 'paging';
    $(`#${container}`).closest('.table-scroll').after(control);
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  control.replaceChildren();
  if (pages === 1) return;
  for (const [text, delta] of [['Previous page', -1], ['Next page', 1]]) {
    const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = text;
    button.disabled = delta < 0 ? page === 0 : page >= pages - 1;
    button.addEventListener('click', () => change(page + delta)); control.append(button);
  }
  const label = document.createElement('span'); label.textContent = `Page ${page + 1} of ${pages}`; control.append(label);
}
function renderIssues() {
  if (!state.report) return;
  const query = state.search.trim().toLowerCase();
  const rows = state.report.issues.filter(item => (state.filter === 'all' || item.severity === state.filter) && (!query || [item.source,item.code,item.message].join(' ').toLowerCase().includes(query)));
  state.issuePage = Math.min(state.issuePage, Math.max(0, Math.ceil(rows.length/PAGE_SIZE) - 1));
  const start = state.issuePage * PAGE_SIZE;
  $('#issue-body').innerHTML = rows.length ? rows.slice(start,start+PAGE_SIZE).map(item => `<tr><td><span class="pill ${item.severity === 'error' ? 'error' : 'warning'}">${escapeHtml(item.severity)}</span></td><td>${escapeHtml(item.source)}</td><td>${item.row}</td><td><code>${escapeHtml(item.code)}</code></td><td>${escapeHtml(item.message)}</td></tr>`).join('') : '<tr><td colspan="5">No exceptions match this filter.</td></tr>';
  $('#issue-count').textContent = `${rows.length} matching exceptions. ${rows.length ? `Showing ${start+1}-${Math.min(start+PAGE_SIZE,rows.length)}.` : ''}`;
  pageControls('issue-body', state.issuePage, rows.length, page => { state.issuePage = page; renderIssues(); });
}
function renderRecords() {
  if (!state.report) return;
  const isOrders = state.source === 'orders';
  const fields = isOrders ? ['_row','order_id','order_date','customer','amount','status'] : ['_row','refund_id','order_id','refund_date','amount','reason'];
  const labels = isOrders ? ['Source row','Order ID','Order date','Customer','USD amount','Status'] : ['Source row','Refund ID','Order ID','Refund date','USD amount','Reason'];
  const rows = state.report.records[state.source];
  state.recordPage = Math.min(state.recordPage, Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1));
  const start = state.recordPage * PAGE_SIZE;
  $('#records-head').innerHTML = `<tr>${labels.map(label => `<th scope="col">${label}</th>`).join('')}</tr>`;
  $('#records-body').innerHTML = rows.length ? rows.slice(start,start+PAGE_SIZE).map(row => `<tr>${fields.map(field => `<td${field === 'amount' ? ' class="numeric"' : ''}>${escapeHtml(field === 'amount' ? money.format(row[field]) : row[field])}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="6">No accepted records.</td></tr>';
  $('#records-summary').textContent = `${rows.length} accepted ${state.source}. ${rows.length ? `Showing ${start+1}-${Math.min(start+PAGE_SIZE,rows.length)}.` : ''} All accepted records are included in the JSON export.`;
  pageControls('records-body', state.recordPage, rows.length, page => { state.recordPage = page; renderRecords(); });
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canExport() { return state.report && !state.dirty; }
$('#orders-file').addEventListener('change', event => importFile('orders',event.target));
$('#refunds-file').addEventListener('change', event => importFile('refunds',event.target));
$('#run-report').addEventListener('click',runReport);
$('#load-samples').addEventListener('click',loadSamples);
$('#export-json').addEventListener('click', () => { if (canExport()) download('ledgerlens-report.json', JSON.stringify(state.report,null,2),'application/json'); });
$('#export-csv').addEventListener('click', () => { if (canExport()) download('ledgerlens-exceptions.csv',LedgerLens.exportIssuesCsv(state.report.issues),'text/csv;charset=utf-8'); });
$('#print-report').addEventListener('click', () => { if (canExport()) window.print(); });
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click',() => {
  document.querySelectorAll('[data-tab]').forEach(item => { const selected = item === button; item.setAttribute('aria-pressed',String(selected)); $(`#panel-${item.dataset.tab}`).hidden = !selected; });
}));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click',() => { state.filter = button.dataset.filter; state.issuePage = 0; document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed',String(item === button))); renderIssues(); }));
document.querySelectorAll('[data-record]').forEach(button => button.addEventListener('click',() => { state.source = button.dataset.record; state.recordPage = 0; document.querySelectorAll('[data-record]').forEach(item => item.setAttribute('aria-pressed',String(item === button))); renderRecords(); }));
$('#issue-search').addEventListener('input', event => { state.search = event.target.value; state.issuePage = 0; renderIssues(); });
EXPORT_BUTTONS.forEach(id => $(`#${id}`).disabled = true);
loadSamples();
