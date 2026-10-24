// Application checks with a small simulated DOM. This runs the real app.js and
// logic.js, but it does not check browser layout or completed downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

let activeElement = null;
class Element {
  constructor(id = '') { this.id = id; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.value = ''; this.className = ''; this.dataset = {}; this.attributes = {}; this.handlers = {}; this.files = []; this.children = []; this.style = {}; }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  async fire(type, extra = {}) { for (const fn of this.handlers[type] || []) await fn({ target: this, preventDefault() {}, ...extra }); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(node) { this.children.push(node); if (node.id) nodes.set(node.id, node); }
  after(node) { if (node.id) nodes.set(node.id, node); }
  closest() { return this; }
  focus() { activeElement = this; }
  click() { downloads.push(this); }
  remove() {}
}
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element(m[1])]));
assert.equal(nodes.size, [...html.matchAll(/\bid="/g)].length, 'HTML IDs must be unique');
for (const [, target] of html.matchAll(/aria-(?:controls|labelledby|describedby)="([^"]+)"/g)) {
  for (const id of target.split(' ')) assert.ok(nodes.has(id), `ARIA reference #${id} must exist`);
}
for (const [, target] of html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)) assert.ok(nodes.has(target), `label target #${target} must exist`);
const groups = {};
for (const name of ['tab', 'filter', 'record', 'group', 'rank', 'chart', 'mode']) {
  groups[`[data-${name}]`] = [...html.matchAll(new RegExp(`data-${name}="([^"]+)"`, 'g'))].map(m => { const e = new Element(); e.dataset[name] = m[1]; return e; });
}
const downloads = [];
const blobs = [];
const body = new Element('body');
const document = {
  querySelector: s => { if (!s.startsWith('#')) throw Error('Unsupported test selector ' + s); return nodes.get(s.slice(1)) || null; },
  querySelectorAll: s => groups[s] || [],
  createElement: () => new Element(),
  body,
  get activeElement() { return activeElement; }
};
const files = Object.fromEntries(['orders.csv', 'refunds.csv'].map(name => [name, fs.readFileSync(path.join(__dirname, name), 'utf8')]));
const context = vm.createContext({ document, console, Intl, Date, Blob, setTimeout: () => {}, clearTimeout: () => {}, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL: () => {} }, fetch: async name => ({ ok: true, text: async () => files[name] }), window: { print: () => {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'logic.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
const tick = () => new Promise(resolve => setImmediate(resolve));
const $ = id => nodes.get(id);
const csvFile = (name, text) => ({ name, size: text.length, text: async () => text });

const passed = [];
const failed = [];
async function check(name, fn) {
  try { await fn(); passed.push(name); console.log('PASS ' + name); }
  catch (error) { failed.push(name); console.log('FAIL ' + name + '\n     ' + String(error.message).split('\n')[0]); }
}

(async () => {
  await tick();
  const orderInput = $('orders-file');
  const refundInput = $('refunds-file');

  await check('sample report renders reconciled totals', () => {
    assert.equal($('gross').textContent, '$32,663.05');
    assert.equal($('refunded').textContent, '$1,278.90');
    assert.equal($('net').textContent, '$31,384.15');
    assert.equal($('orders').textContent, '288');
    assert.equal($('report').hidden, false);
    assert.equal($('export-json').disabled, false);
    assert.match($('dataset-line').innerHTML, /Saltmarsh Coffee Supply/);
    assert.equal($('report-title').textContent, 'October 2025 to September 2026');
  });
  await check('chart draws twelve months with a net line', () => {
    assert.equal(($('monthly-chart').innerHTML.match(/class="month-col"/g) || []).length, 12);
    assert.match($('monthly-chart').innerHTML, /class="net-line"/);
    assert.match($('monthly-chart').attributes['aria-label'], /peaked at \$6,700\.85 in December 2025/);
  });
  await check('month table lists every month with change', () => {
    assert.equal(($('month-body').innerHTML.match(/<tr/g) || []).length, 12);
    assert.match($('month-body').innerHTML, /December 2025/);
  });
  await check('KPI cards compare the last two months', () => {
    assert.match($('delta-net').innerHTML, /September vs August/);
    assert.match($('delta-refunded').innerHTML, /% of gross sales/);
  });
  await check('exceptions are grouped by problem with a fix', () => {
    const groupsHtml = $('issue-groups').innerHTML;
    assert.equal((groupsHtml.match(/class="issue-group /g) || []).length, 10);
    assert.match(groupsHtml, /Orders listed twice/);
    assert.match(groupsHtml, /Fix\.<\/strong>/);
    assert.equal($('issue-total').textContent, 27);
  });
  await check('choosing a problem group filters the exception table', async () => {
    for (const fn of $('issue-groups').handlers.click) fn({ target: { closest: () => ({ dataset: { code: 'DUPLICATE_ORDER' } }) } });
    assert.equal(($('issue-body').innerHTML.match(/<tr>/g) || []).length, 1);
    assert.match($('issue-body').innerHTML, /appears more than once/);
    assert.equal($('code-filter').hidden, false);
    await $('code-filter-clear').fire('click');
    assert.equal(($('issue-body').innerHTML.match(/<tr>/g) || []).length, 27);
  });
  await check('severity filter shows only warnings', async () => {
    await groups['[data-filter]'].find(e => e.dataset.filter === 'warning').fire('click');
    assert.match($('issue-body').innerHTML, /Only USD is counted/);
    assert.doesNotMatch($('issue-body').innerHTML, /appears more than once/);
    await groups['[data-filter]'].find(e => e.dataset.filter === 'all').fire('click');
  });
  await check('search matches an order ID', async () => {
    $('issue-search').value = 'SCS-10062';
    await $('issue-search').fire('input');
    assert.equal(($('issue-body').innerHTML.match(/<tr>/g) || []).length, 1);
    $('issue-search').value = '';
    await $('issue-search').fire('input');
  });
  await check('tabs switch panels by click and arrow key', async () => {
    const [summary, issues, records] = groups['[data-tab]'];
    await records.fire('click');
    assert.equal($('panel-records').hidden, false);
    assert.equal($('panel-summary').hidden, true);
    assert.equal(records.attributes['aria-selected'], 'true');
    await records.fire('keydown', { key: 'ArrowRight' });
    assert.equal($('panel-summary').hidden, false, 'ArrowRight on the last tab wraps to the first');
    assert.equal(activeElement, summary);
    await summary.fire('keydown', { key: 'ArrowRight' });
    assert.equal($('panel-issues').hidden, false);
    assert.equal(issues.attributes.tabindex, '0');
    assert.equal(summary.attributes.tabindex, '-1');
  });
  await check('accepted rows switch between orders and refunds', async () => {
    assert.match($('records-body').innerHTML, /SCS-10001/);
    assert.match($('records-head').innerHTML, /Items/);
    await groups['[data-record]'].find(e => e.dataset.record === 'refunds').fire('click');
    assert.match($('records-body').innerHTML, /RF-5001/);
    await groups['[data-record]'].find(e => e.dataset.record === 'orders').fire('click');
  });

  // Report builder.
  const pick = (name, value) => groups[`[data-${name}]`].find(e => e.dataset[name] === value);
  await check('grouping by product ranks products and counts each order once', async () => {
    await pick('group', 'product').fire('click');
    assert.equal($('summary-title').textContent, 'Products, ranked by net revenue');
    assert.ok(($('monthly-chart').innerHTML.match(/class="rank-row"/g) || []).length > 1);
    assert.match($('breakdown-foot').innerHTML, /Total, each order once/);
    assert.match($('breakdown-foot').innerHTML, />288</);
    await pick('rank', 'orders').fire('click');
    assert.equal($('summary-title').textContent, 'Products, ranked by paid orders');
  });
  await check('undo and redo step through view changes', async () => {
    await $('undo').fire('click');
    assert.equal($('summary-title').textContent, 'Products, ranked by net revenue');
    await $('undo').fire('click');
    assert.equal($('summary-title').textContent, 'Month by month');
    await $('redo').fire('click');
    assert.equal($('summary-title').textContent, 'Products, ranked by net revenue');
    await pick('group', 'quarter').fire('click');
    await pick('chart', 'running').fire('click');
    assert.equal($('summary-title').textContent, 'Running total, quarter by quarter');
    assert.equal($('redo').disabled, true, 'a new change clears redo');
  });
  await check('this view as CSV reconciles with the headline figures', async () => {
    await pick('group', 'customer').fire('click');
    await $('export-view').fire('click');
    const lines = (await blobs.at(-1).text()).split('\r\n');
    assert.equal(lines[0], '"group","orders","gross","refunds","net"');
    assert.equal(lines.at(-1), '"Total",288,32663.05,1278.90,31384.15');
  });
  await check('fixing a row in place clears its exception and can be undone', async () => {
    await pick('group', 'month').fire('click');
    for (const fn of $('issue-body').handlers.click) fn({ target: { closest: () => ({ dataset: { fix: 'orders:128:INVALID_DATE' } }) } });
    assert.equal($('fix-dialog').hidden, false);
    assert.match($('fix-title').textContent, /Fix order SCS-10126/);
    assert.match($('fix-fields').innerHTML, /is-flagged"><label for="fix-field-order_date"/);
    await $('fix-fields').fire('input', { target: { dataset: { field: 'order_date' }, value: '2026-02-28' } });
    assert.match($('fix-check').className, /is-clear/);
    await $('fix-form').fire('submit');
    assert.equal($('issue-total').textContent, 26);
    assert.equal($('gross').textContent, '$32,694.00');
    assert.equal($('export-fixed').hidden, false);
    await $('export-fixed-orders').fire('click');
    const corrected = await blobs.at(-1).text();
    assert.match(corrected, /SCS-10126,2026-02-28,/);
    assert.doesNotMatch(corrected, /2026-02-30/);
    await $('toast-undo').fire('click');
    assert.equal($('issue-total').textContent, 27);
    assert.equal($('gross').textContent, '$32,663.05');
  });
  await check('removing a duplicate refund row', async () => {
    for (const fn of $('issue-body').handlers.click) fn({ target: { closest: () => ({ dataset: { fix: 'refunds:20:DUPLICATE_REFUND' } }) } });
    await $('fix-remove').fire('click');
    assert.equal($('issue-total').textContent, 26);
    assert.equal($('refunded').textContent, '$1,278.90', 'the kept first row still counts');
    await $('undo').fire('click');
    assert.equal($('issue-total').textContent, 27);
  });
  await check('pasted text is routed by its header row', async () => {
    $('paste-text').value = 'refund_id,order_id,refund_date,currency,amount\nR-1,A-1,2026-08-09,USD,5.00';
    await $('paste-use').fire('click');
    assert.match($('paste-note').textContent, /Added as refunds/);
    $('paste-text').value = 'order_id,order_date,currency,amount,status\nA-1,2026-08-02,USD,40.00,paid\nA-2,2026-09-03,USD,25.50,paid';
    await $('paste-use').fire('click');
    assert.equal($('net').textContent, '$60.50');
    $('paste-text').value = 'hello,world\n1,2';
    await $('paste-use').fire('click');
    assert.match($('notice').textContent, /column names/);
    await $('load-samples').fire('click');
    assert.equal($('net').textContent, '$31,384.15');
  });

  // Regression: an own file was silently combined with the other bundled sample file.
  await check('own orders file is not mixed with sample refunds', async () => {
    orderInput.files = [csvFile('mine.csv', 'order_id,order_date,currency,amount,status\nMY-1,2026-10-01,USD,10.00,paid')];
    await orderInput.fire('change');
    await $('run-report').fire('click');
    assert.match($('notice').textContent, /still come from the fictional sample/);
    assert.equal($('export-json').disabled, true);
  });
  // Regression: the input kept its value, so choosing the same edited file again did nothing.
  await check('re-selecting the same file triggers a fresh read', async () => {
    orderInput.value = 'C:\\fakepath\\mine.csv';
    orderInput.files = [csvFile('mine.csv', 'order_id,order_date,currency,amount,status,customer\nO1,2026-10-01,USD,25.50,paid,<script>alert(1)</script>')];
    await orderInput.fire('change');
    assert.equal(orderInput.value, '');
  });
  await check('source change disables stale exports', async () => {
    assert.equal($('export-json').disabled, true);
    const before = blobs.length;
    await $('export-json').fire('click');
    assert.equal(blobs.length, before);
    assert.equal(body.className, 'is-stale', 'print marks the stale report');
  });
  await check('header-only refunds file builds a report and escapes content', async () => {
    refundInput.files = [csvFile('empty-refunds.csv', 'refund_id,order_id,refund_date,currency,amount')];
    await refundInput.fire('change');
    await $('run-report').fire('click');
    assert.equal($('gross').textContent, '$25.50');
    assert.match($('records-body').innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch($('records-body').innerHTML, /<script>/);
    assert.match($('dataset-line').innerHTML, /mine\.csv/);
    assert.match($('monthly-chart').innerHTML, /at least two months/, 'one month does not draw a chart');
    assert.match($('delta-net').innerHTML, /One month of data/);
    assert.equal(body.className, '');
  });
  await check('JSON export keeps the source trace', async () => {
    await $('export-json').fire('click');
    assert.equal(JSON.parse(await blobs.at(-1).text()).records.orders[0].customer, '<script>alert(1)</script>');
  });
  await check('exceptions CSV export guards formulas', async () => {
    orderInput.files = [csvFile('formula.csv', 'order_id,order_date,currency,amount,status\n=cmd,2026-10-01,USD,1.00,pending')];
    await orderInput.fire('change');
    await $('run-report').fire('click');
    await $('export-csv').fire('click');
    const csv = await blobs.at(-1).text();
    assert.match(csv, /"Order =cmd is pending/);
    assert.doesNotMatch(csv, /^"=|,"=/m);
  });
  // Regression: pagination rebuilt its buttons, so keyboard focus was lost after each page.
  await check('pagination keeps its buttons and focus between pages', async () => {
    orderInput.files = [csvFile('many.csv', 'order_id,order_date,currency,amount,status\n' + Array.from({ length: 150 }, (_, i) => `P${i},2026-01-01,USD,1.00,pending`).join('\n'))];
    await orderInput.fire('change');
    await $('run-report').fire('click');
    const paging = $('issue-body-paging');
    const [prev, next] = paging.children;
    assert.equal(paging.hidden, false);
    assert.equal(prev.disabled, true);
    next.focus();
    await next.fire('click');
    assert.equal(paging.children[1], next, 'same Next button after paging');
    assert.equal(next.disabled, true);
    assert.equal(activeElement, prev, 'focus moves to Previous when Next is disabled');
    assert.match(paging.children[2].textContent, /Page 2 of 2/);
  });
  await check('failed build hides old totals', async () => {
    orderInput.files = [csvFile('broken.csv', 'wrong,headers\na,b')];
    await orderInput.fire('change');
    await $('run-report').fire('click');
    assert.equal($('report').hidden, true);
    assert.equal($('export-json').disabled, true);
    assert.match($('notice').textContent, /missing required headers/);
  });
  await check('sample data can be restored', async () => {
    await $('load-samples').fire('click');
    assert.equal($('net').textContent, '$31,384.15');
    assert.match($('import-summary').textContent, /sample files/);
  });
  await check('file size guard', async () => {
    orderInput.files = [{ name: 'large.csv', size: 5 * 1024 * 1024 + 1, text: async () => { throw Error('Oversized file should never be read'); } }];
    await orderInput.fire('change');
    assert.match($('notice').textContent, /exceeds the 5 MB limit/);
  });

  console.log(`${passed.length} of ${passed.length + failed.length} app checks passed (DOM simulation, not browser layout)`);
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
