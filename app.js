const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const state = {
  ordersText: '', refundsText: '',
  origin: { orders: null, refunds: null },
  names: { orders: '', refunds: '' },
  report: null, dirty: false, revision: 0,
  filter: 'all', code: '', search: '', source: 'orders',
  issuePage: 0, recordPage: 0,
  fileReads: { orders: 0, refunds: 0 },
  activeMonth: -1
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PAGE_SIZE = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 100000;
const CHART_MONTHS = 12;
const SAMPLE_STORE = 'Saltmarsh Coffee Supply';
const EXPORT_BUTTONS = ['export-json', 'export-csv', 'print-report'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PHONE_QUERY = '(max-width: 759px)';

// Plain-language explanations for each exception code.
const PROBLEMS = {
  INELIGIBLE_STATUS: { title: 'Pending or cancelled orders', what: 'These orders are not paid, so they are left out of revenue.', fix: 'Nothing to fix if the status is right. Load a fresh export once pending orders are paid.' },
  INVALID_DATE: { title: 'Dates that are not real', what: 'The date is in the wrong format or the day does not exist, so the row cannot be placed in a month.', fix: 'Write the date as YYYY-MM-DD, for example 2026-03-09, and check the day exists in that month.' },
  UNSUPPORTED_CURRENCY: { title: 'Not in US dollars', what: 'LedgerLens reports in USD and does not convert currencies.', fix: 'Convert the amount to USD in your store admin, or report this sale separately.' },
  INVALID_AMOUNT: { title: 'Amounts that are blank or not a number', what: 'The amount is missing, negative or has extra characters such as a currency sign.', fix: 'Enter a positive number with up to two decimals and no symbols, for example 62.95.' },
  DUPLICATE_ORDER: { title: 'Orders listed twice', what: 'The same order ID appears on more than one row. The first row is counted.', fix: 'Delete the repeated row from the orders file.' },
  DUPLICATE_REFUND: { title: 'Refunds listed twice', what: 'The same refund ID appears on more than one row. The first row is counted.', fix: 'Delete the repeated row from the refunds file.' },
  OVER_REFUND: { title: 'Refunds larger than the order', what: 'Together with earlier refunds, this refund would return more than the order was worth.', fix: 'Check the refund amount against the order. A slipped decimal point is the usual cause.' },
  UNMATCHED_REFUND: { title: 'Refunds for an unknown order', what: 'The order ID on the refund does not match any order in the orders file.', fix: 'Check the order ID for typos, such as the letter O in place of a zero, or add the missing order.' },
  REFUND_FOR_EXCLUDED_ORDER: { title: 'Refunds for orders that were left out', what: 'The order behind the refund was excluded, so the refund is excluded too.', fix: 'Fix the order first. If the order was cancelled, this is expected and needs no change.' },
  REFUND_BEFORE_ORDER: { title: 'Refunds dated before the order', what: 'A refund cannot be paid before the order it belongs to.', fix: 'Check both dates. One of them was probably keyed in wrong.' },
  CURRENCY_MISMATCH: { title: 'Refund and order in different currencies', what: 'The refund currency does not match its order.', fix: 'Record the refund in the same currency as the order.' },
  MISSING_ID: { title: 'Rows without an ID', what: 'Every order needs an order ID, and every refund needs a refund ID and an order ID.', fix: 'Fill in the missing ID, or remove the row if it is not a real transaction.' },
  UNSAFE_TOTAL: { title: 'Totals too large to add safely', what: 'Adding this row would push the total past the safe number limit.', fix: 'Split the export into smaller date ranges.' }
};
function problem(code) {
  return PROBLEMS[code] || { title: code, what: 'This row was not counted.', fix: 'Check the row against the column guide.' };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function monthName(key, short) {
  const name = MONTHS[Number(key.slice(5, 7)) - 1] || key;
  return short ? name.slice(0, 3) : name;
}
function monthLabel(key) { return monthName(key) + ' ' + key.slice(0, 4); }
function plural(count, word, many) { return count + ' ' + (count === 1 ? word : (many || word + 's')); }
function isPhone() {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches; } catch { return false; }
}

function notice(message, kind = 'success') {
  $('#notice').textContent = message;
  $('#notice').className = `notice ${kind}`;
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

function markDirty() {
  state.dirty = true;
  state.revision += 1;
  setPill(state.report ? 'Files changed' : 'Ready to build', 'stale');
  setExports(false);
  setStale(Boolean(state.report));
  notice('A source file changed. Build the report again before trusting the totals or exporting.', 'warning');
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
    state[`${source}Text`] = text;
    state.origin[source] = 'file';
    state.names[source] = file.name;
    setDrop(source, file.name);
    updateImportSummary();
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
    const report = LedgerLens.buildReport(orders, refunds);
    state.report = report;
    state.dirty = false;
    state.issuePage = 0;
    state.recordPage = 0;
    state.code = '';
    state.activeMonth = -1;
    renderReport();
    setPill('Current report');
    setExports(true);
    setStale(false);
    notice(`Read ${plural(orders.length, 'order row')} and ${plural(refunds.length, 'refund row')}. Counted ${plural(report.accepted.orders, 'order')} and ${plural(report.accepted.refunds, 'refund')}, with ${plural(report.issues.length, 'exception')} to review.`);
    if (isPhone()) setImportCollapsed(true);
  } catch (error) {
    // A failed build clears the previous result so old totals are never shown as current.
    state.report = null;
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

function renderReport() {
  const { metrics, byMonth } = state.report;
  $('#gross').textContent = money.format(metrics.grossRevenue);
  $('#net').textContent = money.format(metrics.netRevenue);
  $('#refunded').textContent = money.format(metrics.refunded);
  $('#orders').textContent = metrics.orderCount.toLocaleString('en-US');
  $('#aov').textContent = money.format(metrics.averageOrderValue);
  $('#issue-total').textContent = state.report.issues.length;
  $('#generated').textContent = new Date(state.report.generatedAt).toLocaleString();
  $('#generated').dateTime = state.report.generatedAt;
  $('#recon-gross').textContent = money.format(metrics.grossRevenue);
  $('#recon-refunds').textContent = money.format(metrics.refunded);
  $('#recon-net').textContent = money.format(metrics.netRevenue);
  const range = byMonth.length ? (byMonth.length === 1 ? monthLabel(byMonth[0].month) : `${monthLabel(byMonth[0].month)} to ${monthLabel(byMonth[byMonth.length - 1].month)}`) : 'No accepted rows';
  $('#report-title').textContent = range;
  const who = state.origin.orders === 'sample' ? `sample data for <strong>${SAMPLE_STORE}</strong>` : `<strong>${escapeHtml(state.names.orders)}</strong> and <strong>${escapeHtml(state.names.refunds)}</strong>`;
  $('#dataset-line').innerHTML = `Showing ${who}, ${escapeHtml(byMonth.length ? range : 'with no accepted rows yet')}.`;
  // Show the report first. The chart measures its container, which is zero wide while hidden.
  $('#empty-state').hidden = true;
  $('#report').hidden = false;
  renderKpiChanges();
  renderChart();
  renderMonthTable();
  renderIssueGroups();
  renderIssues();
  renderRecords();
}

function changeHtml(current, previous, upIsGood, months) {
  const when = `${monthName(months[1])} vs ${monthName(months[0])}`;
  if (current === null || previous === null) return `No orders in ${monthName(previous === null ? months[0] : months[1])} to compare`;
  if (previous === 0) return current === 0 ? `No change, ${when}` : `<strong class="${upIsGood ? 'is-good' : 'is-bad'}">Up from zero</strong>, ${when}`;
  const change = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(change) < 0.05) return `<strong class="is-flat">No change</strong>, ${when}`;
  const up = change > 0;
  const good = up === upIsGood;
  return `<strong class="${good ? 'is-good' : 'is-bad'}">${up ? 'Up' : 'Down'} ${percent.format(Math.abs(change))}%</strong>, ${when}`;
}
function renderKpiChanges() {
  const { byMonth, metrics } = state.report;
  const share = `${percent.format(metrics.refundRate)}% of gross sales. `;
  if (byMonth.length < 2) {
    ['net', 'gross', 'orders', 'aov'].forEach(id => { $(`#delta-${id}`).innerHTML = 'One month of data, so no monthly change yet.'; });
    $('#delta-refunded').innerHTML = escapeHtml(share);
    return;
  }
  const [prev, last] = byMonth.slice(-2);
  const months = [prev.month, last.month];
  const aov = m => (m.orderCount ? m.grossRevenue / m.orderCount : null);
  $('#delta-net').innerHTML = changeHtml(last.netRevenue, prev.netRevenue, true, months);
  $('#delta-gross').innerHTML = changeHtml(last.grossRevenue, prev.grossRevenue, true, months);
  $('#delta-refunded').innerHTML = escapeHtml(share) + changeHtml(last.refunded, prev.refunded, false, months);
  $('#delta-orders').innerHTML = changeHtml(last.orderCount, prev.orderCount, true, months);
  $('#delta-aov').innerHTML = changeHtml(aov(last), aov(prev), true, months);
}

// Monthly chart: gross sales up from the baseline, refunds down from it, net revenue as a line.
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
function chartMonths() {
  return state.report ? state.report.byMonth.slice(-CHART_MONTHS) : [];
}
function monthSentence(m) {
  return `${monthLabel(m.month)}. Gross sales ${money.format(m.grossRevenue)}, refunds ${money.format(m.refunded)}, net revenue ${money.format(m.netRevenue)}, ${plural(m.orderCount, 'paid order')}.`;
}
function renderChart() {
  const el = $('#monthly-chart');
  const months = chartMonths();
  const all = state.report.byMonth;
  hideTip();
  if (months.length < 2) {
    el.innerHTML = `<p class="chart-empty">The trend needs at least two months of data. The table below has the figures.</p>`;
    el.setAttribute('aria-label', 'Not enough months to draw a trend.');
    $('#chart-help').textContent = 'Load a longer date range to see the monthly trend.';
    return;
  }
  if (el.clientWidth === 0) return; // hidden panel, drawn when the trend tab is shown
  const width = Math.max(280, Math.round(el.clientWidth || 720));
  const height = width < 520 ? 250 : 320;
  const margin = { top: 28, right: 8, bottom: 44, left: width < 520 ? 44 : 56 };
  const plotW = width - margin.left - margin.right;
  const plotBottom = height - margin.bottom;
  const maxUp = Math.max(1, ...months.map(m => Math.max(m.grossRevenue, m.netRevenue)));
  const maxDown = Math.max(0, ...months.map(m => Math.max(m.refunded, -m.netRevenue)));
  const step = niceStep(maxUp / 4);
  const yMax = Math.ceil(maxUp / step) * step;
  const yMin = maxDown > step * 0.6 ? -Math.ceil(maxDown / step) * step : -maxDown * 1.25;
  const y = v => margin.top + (yMax - v) / (yMax - yMin) * (plotBottom - margin.top);
  const slot = plotW / months.length;
  const barW = Math.max(6, Math.min(24, slot * 0.46));
  const cx = i => margin.left + slot * (i + 0.5);
  const zero = y(0);

  const ticks = [];
  for (let v = yMin < 0 && Math.abs(yMin % step) < 1e-9 ? yMin : 0; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  const grid = ticks.map(v => `<line class="${v === 0 ? 'baseline' : 'grid'}" x1="${margin.left}" x2="${width - margin.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tick-label" x="${margin.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${compactMoney(v)}</text>`).join('');

  const sparse = slot < 34;
  const lastIndex = months.length - 1;
  const cols = months.map((m, i) => {
    const x = cx(i);
    const showLabel = !sparse || i % 2 === lastIndex % 2;
    const showYear = i === 0 || m.month.endsWith('-01');
    const label = showLabel ? `<text x="${x.toFixed(1)}" y="${plotBottom + 18}" text-anchor="middle">${monthName(m.month, true)}</text>` : '';
    const year = showYear && showLabel ? `<text x="${x.toFixed(1)}" y="${plotBottom + 34}" text-anchor="middle">${m.month.slice(0, 4)}</text>` : '';
    const gross = barPath(x - barW / 2, zero - 1, y(m.grossRevenue), barW, 4);
    const refund = barPath(x - barW / 2, zero + 1, y(-m.refunded), barW, 3);
    return `<g class="month-col" data-i="${i}"><rect class="hover-band" x="${(x - slot / 2).toFixed(1)}" y="${margin.top - 12}" width="${slot.toFixed(1)}" height="${(plotBottom - margin.top + 12).toFixed(1)}" rx="6"/>${gross ? `<path class="bar-gross" d="${gross}"/>` : ''}${refund ? `<path class="bar-refund" d="${refund}"/>` : ''}${label}${year}</g>`;
  }).join('');
  const linePoints = months.map((m, i) => `${cx(i).toFixed(1)},${y(m.netRevenue).toFixed(1)}`).join(' ');
  const dots = months.map((m, i) => `<circle class="net-dot" data-dot="${i}" cx="${cx(i).toFixed(1)}" cy="${y(m.netRevenue).toFixed(1)}" r="4"/>`).join('');
  const last = months[lastIndex];
  // Sit the end label above the last stretch of the line and any bar tops it spans, so nothing crosses it.
  const labelSpan = months.slice(-3);
  const labelTop = Math.min(...labelSpan.map(m => Math.min(y(m.netRevenue), y(m.grossRevenue))));
  const endLabel = `<text class="end-label" x="${(cx(lastIndex) + 6).toFixed(1)}" y="${Math.max(12, labelTop - 12).toFixed(1)}" text-anchor="end">Net ${money.format(last.netRevenue)}</text>`;
  const hits = months.map((m, i) => `<rect class="hit" data-i="${i}" x="${(cx(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}"/>`).join('');

  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${grid}${cols}<polyline class="net-line" points="${linePoints}"/>${dots}${endLabel}${hits}</svg>`;
  const peak = months.reduce((best, m) => (m.netRevenue > best.netRevenue ? m : best), months[0]);
  el.setAttribute('aria-label', `Monthly trend, ${monthLabel(months[0].month)} to ${monthLabel(last.month)}. Net revenue peaked at ${money.format(peak.netRevenue)} in ${monthLabel(peak.month)} and was ${money.format(last.netRevenue)} in ${monthLabel(last.month)}. Every value is in the table below.`);
  $('#chart-help').textContent = (all.length > CHART_MONTHS ? `The chart shows the last ${CHART_MONTHS} months. The table lists all ${all.length}. ` : '') + 'Hover or tap a month for its figures. With a keyboard, focus the chart and use the arrow keys.';
  el._layout = { slot, left: margin.left, width, cx };
  if (state.activeMonth >= 0) setActiveMonth(Math.min(state.activeMonth, lastIndex), false);
}
function hideTip() {
  const tip = $('#chart-tip');
  if (tip) tip.hidden = true;
}
function setActiveMonth(index, announce) {
  const el = $('#monthly-chart');
  const months = chartMonths();
  if (!months.length || !el._layout || typeof el.querySelectorAll !== 'function') return;
  state.activeMonth = index;
  el.querySelectorAll('.month-col').forEach(group => {
    group.setAttribute('class', 'month-col' + (Number(group.getAttribute('data-i')) === index ? ' is-active' : ''));
  });
  if (index < 0) { hideTip(); return; }
  const m = months[index];
  const tip = $('#chart-tip');
  tip.innerHTML = `<h4>${monthLabel(m.month)}</h4><dl><dt><i class="key key-gross"></i>Gross sales</dt><dd>${money.format(m.grossRevenue)}</dd><dt><i class="key key-refund"></i>Refunds</dt><dd>${money.format(m.refunded)}</dd><dt><i class="key key-net"></i>Net revenue</dt><dd>${money.format(m.netRevenue)}</dd><dt>Paid orders</dt><dd>${m.orderCount}</dd></dl>`;
  tip.hidden = false;
  const { cx, slot } = el._layout;
  const scale = (el.clientWidth || el._layout.width) / el._layout.width;
  const x = cx(index) * scale;
  const tipWidth = tip.offsetWidth || 200;
  const room = el.clientWidth || el._layout.width;
  let left = x + (slot * scale) / 2 + 8;
  if (left + tipWidth > room) left = x - (slot * scale) / 2 - 8 - tipWidth;
  tip.style.left = `${Math.max(0, Math.round(left))}px`;
  tip.style.top = '8px';
  if (announce) $('#chart-live').textContent = monthSentence(m);
}

function renderMonthTable() {
  const months = state.report.byMonth;
  const peak = months.reduce((best, m) => (m.netRevenue > best ? m.netRevenue : best), -Infinity);
  $('#month-body').innerHTML = months.length ? months.map((m, i) => {
    const prev = months[i - 1];
    let change = '<span class="muted">First month</span>';
    if (prev) {
      if (prev.netRevenue === 0) change = '<span class="muted">No prior net</span>';
      else {
        const pct = (m.netRevenue - prev.netRevenue) / Math.abs(prev.netRevenue) * 100;
        change = `<span class="${pct >= 0 ? 'change-up' : 'change-down'}">${pct >= 0 ? '+' : '−'}${percent.format(Math.abs(pct))}%</span>`;
      }
    }
    return `<tr${m.netRevenue === peak && months.length > 1 ? ' class="is-peak"' : ''}><th scope="row">${escapeHtml(monthLabel(m.month))}</th><td class="numeric">${m.orderCount}</td><td class="numeric">${money.format(m.grossRevenue)}</td><td class="numeric">${money.format(m.refunded)}</td><td class="numeric">${money.format(m.netRevenue)}</td><td class="numeric">${change}</td></tr>`;
  }).join('') : '<tr><td colspan="6">No accepted rows.</td></tr>';
}

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
  $('#issue-body').innerHTML = rows.length ? rows.slice(start, start + PAGE_SIZE).map(item => `<tr><td><span class="pill ${item.severity === 'error' ? 'error' : 'warning'}">${item.severity === 'error' ? 'Needs a fix' : 'Check'}</span></td><td>${item.source === 'orders' ? 'Orders' : 'Refunds'}</td><td class="numeric">${item.row}</td><td class="mono">${escapeHtml(item.ref || '')}</td><td class="wrap-cell">${escapeHtml(item.message)}</td></tr>`).join('') : '<tr><td colspan="5">No exceptions match this filter.</td></tr>';
  const total = state.report.issues.length;
  $('#issue-count').textContent = `${rows.length} of ${plural(total, 'exception')} shown.` + (rows.length > PAGE_SIZE ? ` Rows ${start + 1} to ${Math.min(start + PAGE_SIZE, rows.length)}.` : '');
  $('#code-filter').hidden = !state.code;
  $('#code-filter-text').textContent = state.code ? `Showing only: ${problem(state.code).title}.` : '';
  pageControls('issue-body', state.issuePage, rows.length, page => { state.issuePage = page; renderIssues(); });
}

function renderRecords() {
  if (!state.report) return;
  const isOrders = state.source === 'orders';
  const rows = state.report.records[state.source];
  const hasItems = isOrders && rows.some(row => row.items);
  const columns = isOrders
    ? [['_row', 'Line', 'numeric'], ['order_id', 'Order', 'mono'], ['order_date', 'Date', 'mono'], ['customer', 'Customer', ''], ...(hasItems ? [['items', 'Items', 'wrap-cell']] : []), ['amount', 'Amount', 'numeric']]
    : [['_row', 'Line', 'numeric'], ['refund_id', 'Refund', 'mono'], ['order_id', 'Order', 'mono'], ['refund_date', 'Date', 'mono'], ['reason', 'Reason', ''], ['amount', 'Amount', 'numeric']];
  state.recordPage = Math.min(state.recordPage, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const start = state.recordPage * PAGE_SIZE;
  $('#records-head').innerHTML = `<tr>${columns.map(([, label, cls]) => `<th scope="col"${cls === 'numeric' ? ' class="numeric"' : ''}>${label}</th>`).join('')}</tr>`;
  $('#records-body').innerHTML = rows.length ? rows.slice(start, start + PAGE_SIZE).map(row => `<tr>${columns.map(([field, , cls]) => `<td${cls ? ` class="${cls}"` : ''}>${escapeHtml(field === 'amount' ? money.format(row[field]) : row[field])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}">No accepted ${state.source}.</td></tr>`;
  $('#records-caption').textContent = `Accepted ${state.source}`;
  $('#records-summary').textContent = `${plural(rows.length, isOrders ? 'accepted order' : 'accepted refund')}.` + (rows.length > PAGE_SIZE ? ` Rows ${start + 1} to ${Math.min(start + PAGE_SIZE, rows.length)}.` : '');
  pageControls('records-body', state.recordPage, rows.length, page => { state.recordPage = page; renderRecords(); });
}

function selectTab(name, focus) {
  $$('[data-tab]').forEach(tab => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.setAttribute('tabindex', selected ? '0' : '-1');
    $(`#panel-${tab.dataset.tab}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  // The chart cannot measure itself while its panel is hidden, so redraw it on return.
  if (name === 'summary' && state.report) renderChart();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function canExport() { return Boolean(state.report) && !state.dirty; }

// Wiring
['orders', 'refunds'].forEach(source => {
  $(`#${source}-file`).addEventListener('change', event => onFileInput(source, event.target));
  const drop = $(`#drop-${source}`);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.className = 'drop is-over'; });
  drop.addEventListener('dragleave', () => setDrop(source, $(`#${source}-name`).textContent, state.names[source] ? '' : 'empty'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) importFile(source, file); else setDrop(source, $(`#${source}-name`).textContent, state.names[source] ? '' : 'empty');
  });
});
$('#run-report').addEventListener('click', runReport);
$('#load-samples').addEventListener('click', loadSamples);
$('#import-toggle').addEventListener('click', () => setImportCollapsed($('#import-toggle').getAttribute('aria-expanded') === 'true'));
$('#export-json').addEventListener('click', () => { if (canExport()) download('ledgerlens-report.json', JSON.stringify(state.report, null, 2), 'application/json'); });
$('#export-csv').addEventListener('click', () => { if (canExport()) download('ledgerlens-exceptions.csv', LedgerLens.exportIssuesCsv(state.report.issues), 'text/csv;charset=utf-8'); });
$('#print-report').addEventListener('click', () => { if (canExport()) window.print(); });

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
$('#issue-search').addEventListener('input', event => { state.search = event.target.value; state.issuePage = 0; renderIssues(); });
$('#issue-groups').addEventListener('click', event => {
  const button = event.target && event.target.closest ? event.target.closest('[data-code]') : null;
  if (!button) return;
  state.code = button.dataset.code;
  state.filter = 'all';
  state.issuePage = 0;
  $$('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')));
  renderIssues();
  const head = $('#issue-table');
  if (head && head.scrollIntoView) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const title = $('#issue-table-title');
  if (title && title.focus) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
});
$('#code-filter-clear').addEventListener('click', () => { state.code = ''; state.issuePage = 0; renderIssues(); });

const chart = $('#monthly-chart');
const monthFromEvent = event => {
  const hit = event.target && event.target.closest ? event.target.closest('[data-i]') : null;
  return hit ? Number(hit.getAttribute('data-i')) : -1;
};
chart.addEventListener('pointermove', event => { const i = monthFromEvent(event); if (i >= 0 && i !== state.activeMonth) setActiveMonth(i, false); });
chart.addEventListener('pointerdown', event => { const i = monthFromEvent(event); if (i >= 0) setActiveMonth(i, true); });
// Touch pointers leave as soon as the finger lifts, so only a mouse leaving clears the tooltip.
chart.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && document.activeElement !== chart) setActiveMonth(-1); });
chart.addEventListener('focus', () => { if (state.report && state.activeMonth < 0) setActiveMonth(chartMonths().length - 1, true); });
chart.addEventListener('blur', () => setActiveMonth(-1));
chart.addEventListener('keydown', event => {
  const count = chartMonths().length;
  if (!count) return;
  const moves = { ArrowRight: state.activeMonth + 1, ArrowLeft: state.activeMonth - 1, Home: 0, End: count - 1 };
  if (!(event.key in moves)) { if (event.key === 'Escape') setActiveMonth(-1); return; }
  event.preventDefault();
  setActiveMonth(Math.max(0, Math.min(count - 1, moves[event.key])), true);
});
if (typeof window.addEventListener === 'function') {
  let resizeTimer = null;
  let lastWidth = chart.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.report || chart.clientWidth === lastWidth) return;
      lastWidth = chart.clientWidth;
      renderChart();
    }, 120);
  });
}

setExports(false);
loadSamples();
