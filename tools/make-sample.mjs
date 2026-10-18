// Builds the bundled fictional sample: twelve months of orders and refunds for
// Saltmarsh Coffee Supply, a made-up online coffee gear shop.
//
//   node tools/make-sample.mjs          writes orders.csv and refunds.csv
//   node tools/make-sample.mjs --check  exits 1 if the files on disk differ
//
// The output is deterministic. The same seed always gives the same files.
// makeSample() also returns the ground truth the data was built from, so the
// tests can check the report against figures that never passed through logic.js.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const STORE = 'Saltmarsh Coffee Supply';
export const SEED = 20261019;

// Orders per month. Gift season peaks in December, January and February are quiet.
const MONTHS = [
  ['2025-10', 22], ['2025-11', 34], ['2025-12', 47], ['2026-01', 19],
  ['2026-02', 18], ['2026-03', 23], ['2026-04', 25], ['2026-05', 27],
  ['2026-06', 22], ['2026-07', 21], ['2026-08', 23], ['2026-09', 27]
];
const LAST_DAY = '2026-09-30';

// name, price in cents, base weight, months with a seasonal boost
const PRODUCTS = [
  ['Gooseneck kettle', 6400, 5, []],
  ['Hand grinder', 12900, 4, ['2025-11', '2025-12']],
  ['Flat burr grinder', 24900, 1.5, ['2025-12']],
  ['Brew scale', 4200, 4, []],
  ['Ceramic dripper', 2800, 5, []],
  ['Paper filters', 850, 7, []],
  ['House blend 250 g', 1800, 8, []],
  ['Single origin 250 g', 2200, 6, []],
  ['House blend 1 kg', 5600, 3, []],
  ['Gift set', 8900, 0.4, ['2025-11', '2025-12']],
  ['Cold brew jar', 3400, 0.5, ['2026-06', '2026-07', '2026-08']],
  ['Travel mug', 2600, 3, []],
  ['Cleaning tablets', 1200, 3, []]
];
const SHIPPING_CENTS = 695;
const FREE_SHIPPING_FROM = 6000;

const FIRST = ['Ana', 'Ben', 'Chloe', 'Dev', 'Elif', 'Femi', 'Grace', 'Hugo', 'Imani', 'Jonah', 'Kira', 'Luis', 'Maya', 'Niall', 'Olga', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vince', 'Wren', 'Yusuf', 'Zoë', 'Aoife', 'Bruno', 'Carmen', 'Dmitri', 'Esme', 'José', 'Leah', 'Marcus', 'Nadia', 'Owen', 'Siobhán', 'Theo', 'Ines', 'Kofi', 'Mei'];
const LAST = ['Abbott', 'Brennan', 'Castillo', 'Duarte', 'Ekström', 'Fischer', 'Garnier', 'Hale', 'Iqbal', 'Jensen', 'Kowalski', 'Lindqvist', 'Mensah', 'Novak', "O'Brien", 'Park', 'Quayle', 'Rahman', 'Santos', 'Tanaka', 'Ulloa', 'Varga', 'Whitlock', 'Yamada', 'Zielinski', 'Achebe', 'Bianchi', 'Cho', 'Delgado', 'Ferreira', 'Holm', 'Ibarra', 'Kaur', 'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Reyes', 'Sorensen', 'Vogel'];
const CAFES = ['Pier Nine Café', 'Low Tide Espresso Bar', 'Hollis and Rowe, Bakers'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daysIn(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function money(cents) {
  return (cents < 0 ? '-' : '') + Math.floor(Math.abs(cents) / 100) + '.' + String(Math.abs(cents) % 100).padStart(2, '0');
}
function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function toCsv(header, rows) {
  return [header.join(','), ...rows.map((row) => header.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n';
}

export function makeSample(seed = SEED) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const weighted = (entries) => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = rand() * total;
    for (const [value, w] of entries) { roll -= w; if (roll < 0) return value; }
    return entries[entries.length - 1][0];
  };

  // A small pool of returning customers gets roughly one order in six.
  const regulars = Array.from({ length: 18 }, () => pick(FIRST) + ' ' + pick(LAST));

  // 1. Draft every order with its line items.
  const drafts = [];
  for (const [month, count] of MONTHS) {
    const cafeOrders = 2 + (rand() < 0.5 ? 1 : 0);
    for (let n = 0; n < count; n += 1) {
      const day = 1 + Math.floor(rand() * daysIn(month));
      const date = month + '-' + String(day).padStart(2, '0');
      const isCafe = n < cafeOrders;
      let customer;
      const lines = [];
      if (isCafe) {
        customer = CAFES[(n + Number(month.slice(5))) % CAFES.length];
        lines.push(['House blend 1 kg', 5600, 3 + Math.floor(rand() * 5)]);
        if (rand() < 0.6) lines.push(['Paper filters', 850, 4 + Math.floor(rand() * 6)]);
        if (rand() < 0.25) lines.push(['Cleaning tablets', 1200, 2]);
      } else {
        customer = rand() < 0.17 ? pick(regulars) : pick(FIRST) + ' ' + pick(LAST);
        const itemCount = weighted([[1, 55], [2, 32], [3, 13]]);
        const used = new Set();
        while (lines.length < itemCount) {
          const product = weighted(PRODUCTS.map((p) => [p, p[2] * (p[3].includes(month) ? 6 : 1)]));
          if (used.has(product[0])) continue;
          used.add(product[0]);
          const consumable = product[1] < 2500;
          lines.push([product[0], product[1], consumable && rand() < 0.3 ? 2 : 1]);
        }
      }
      const subtotal = lines.reduce((sum, [, price, qty]) => sum + price * qty, 0);
      const shipping = subtotal < FREE_SHIPPING_FROM ? SHIPPING_CENTS : 0;
      drafts.push({ date, customer, isCafe, lines, shipping, cents: subtotal + shipping });
    }
  }
  drafts.sort((a, b) => a.date.localeCompare(b.date));

  // 2. Assign IDs and statuses. Late September orders are still pending.
  const orders = drafts.map((draft, index) => {
    let status = 'paid';
    const roll = rand();
    if (draft.date >= '2026-09-25' && roll < 0.45) status = 'pending';
    else if (!draft.isCafe && roll < 0.04) status = 'cancelled';
    else if (roll > 0.995) status = 'pending';
    return {
      ...draft,
      order_id: 'SCS-' + (10001 + index),
      status,
      currency: 'USD',
      items: draft.lines.map(([name, , qty]) => (qty > 1 ? name + ' x' + qty : name)).join(', ')
    };
  });

  // 3. Real refunds, about one paid order in twelve.
  const refunds = [];
  for (const order of orders) {
    if (order.status !== 'paid' || order.isCafe || rand() >= 0.085) continue;
    const priciest = order.lines.reduce((best, line) => (line[1] > best[1] ? line : best));
    const reasons = [['Arrived damaged', 4], ['Changed mind', 3], ['Late delivery', order.shipping ? 2 : 0], ['Out of stock, partial refund', order.lines.length > 1 ? 2 : 0], ['Wrong grind size', order.lines.some((l) => /250 g|1 kg/.test(l[0])) ? 2 : 0]];
    const reason = weighted(reasons.filter(([, w]) => w > 0));
    let cents;
    let lag = 3 + Math.floor(rand() * 12);
    if (reason === 'Changed mind') cents = order.cents - order.shipping;
    else if (reason === 'Late delivery') { cents = order.shipping; lag += 6; }
    else if (reason === 'Wrong grind size') cents = order.lines.find((l) => /250 g|1 kg/.test(l[0]))[1];
    else if (reason === 'Out of stock, partial refund') { cents = order.lines[order.lines.length - 1][1]; lag = 1 + Math.floor(rand() * 4); }
    else cents = priciest[1];
    const date = addDays(order.date, lag);
    if (date > LAST_DAY) continue;
    refunds.push({ order, order_id: order.order_id, refund_date: date, currency: 'USD', cents, reason, legit: true });
  }

  // 4. Deliberate data-quality problems, the kind a real export picks up.
  const problems = [];
  const refunded = new Set(refunds.map((r) => r.order_id));
  const clean = (month) => orders.filter((o) => o.status === 'paid' && !o.isCafe && !refunded.has(o.order_id) && !o.problem && o.date.startsWith(month));
  const mark = (order, problem) => { order.problem = problem; problems.push(problem); return order; };

  const badDay = mark(pick(clean('2026-02')), 'INVALID_DATE');
  badDay.dateText = '2026-02-30';
  const usDate = mark(pick(clean('2026-03')), 'INVALID_DATE');
  usDate.dateText = usDate.date.slice(5, 7) + '/' + usDate.date.slice(8) + '/' + usDate.date.slice(0, 4);
  const euro = mark(pick(clean('2026-04')), 'UNSUPPORTED_CURRENCY');
  euro.currency = 'EUR';
  const dollarSign = mark(pick(clean('2026-06')), 'INVALID_AMOUNT');
  dollarSign.amountText = '$' + money(dollarSign.cents);
  const blank = mark(pick(clean('2026-08')), 'INVALID_AMOUNT');
  blank.amountText = '';
  const duplicated = pick(clean('2025-12'));
  duplicated.duplicate = true;
  problems.push('DUPLICATE_ORDER');

  const target = (month) => { const o = pick(clean(month)); o.problem = 'refund target'; return o; };
  const typo = target('2026-01');
  refunds.push({ order_id: typo.order_id, refund_date: addDays(typo.date, 5), currency: 'USD', cents: typo.cents * 10, reason: 'Arrived damaged' });
  problems.push('OVER_REFUND');
  const missing = target('2026-03');
  refunds.push({ order_id: missing.order_id.replace(/0(?=\d*$)/, 'O'), refund_date: addDays(missing.date, 6), currency: 'USD', cents: missing.lines[0][1], reason: 'Changed mind' });
  problems.push('UNMATCHED_REFUND');
  const cancelled = orders.find((o) => o.status === 'cancelled' && o.date >= '2026-04-01');
  refunds.push({ order_id: cancelled.order_id, refund_date: addDays(cancelled.date, 2), currency: 'USD', cents: cancelled.cents, reason: 'Order cancelled after payment' });
  problems.push('REFUND_FOR_EXCLUDED_ORDER');
  const early = target('2026-05');
  refunds.push({ order_id: early.order_id, refund_date: addDays(early.date, -1), currency: 'USD', cents: early.lines[0][1], reason: 'Arrived damaged' });
  problems.push('REFUND_BEFORE_ORDER');
  const negative = target('2026-07');
  refunds.push({ order_id: negative.order_id, refund_date: addDays(negative.date, 8), currency: 'USD', cents: -negative.lines[0][1], reason: 'Wrong grind size' });
  problems.push('INVALID_AMOUNT');

  // Refunds are listed by date and numbered in that order.
  refunds.sort((a, b) => a.refund_date.localeCompare(b.refund_date) || a.order_id.localeCompare(b.order_id));
  refunds.forEach((refund, index) => { refund.refund_id = 'RF-' + (5001 + index); });
  // A partial refund that was keyed in twice.
  const twiceIndex = refunds.findIndex((r) => r.legit && r.cents * 2 <= r.order.cents && r.refund_date >= '2026-05-01');
  refunds.splice(twiceIndex + 1, 0, { ...refunds[twiceIndex], legit: false, duplicate: true });
  problems.push('DUPLICATE_REFUND');

  // 5. Ground truth from the model, before anything is written as text.
  const truth = { byMonth: {}, grossCents: 0, refundedCents: 0, acceptedOrders: 0, acceptedRefunds: 0, issueCounts: {} };
  for (const [month] of MONTHS) truth.byMonth[month] = { grossCents: 0, refundedCents: 0, orderCount: 0 };
  for (const order of orders) {
    if (order.status !== 'paid' || (order.problem && order.problem !== 'refund target')) continue;
    truth.byMonth[order.date.slice(0, 7)].grossCents += order.cents;
    truth.byMonth[order.date.slice(0, 7)].orderCount += 1;
    truth.grossCents += order.cents;
    truth.acceptedOrders += 1;
  }
  for (const refund of refunds) {
    if (!refund.legit || refund.duplicate) continue;
    truth.byMonth[refund.refund_date.slice(0, 7)].refundedCents += refund.cents;
    truth.refundedCents += refund.cents;
    truth.acceptedRefunds += 1;
  }
  const notPaid = orders.filter((o) => o.status !== 'paid').length;
  for (const code of ['INELIGIBLE_STATUS', ...problems]) truth.issueCounts[code] = (truth.issueCounts[code] || 0) + (code === 'INELIGIBLE_STATUS' ? notPaid : 1);
  truth.problemCount = problems.length;

  // 6. Write rows as an export would show them.
  const orderRows = [];
  for (const order of orders) {
    const row = {
      order_id: order.order_id,
      order_date: order.dateText ?? order.date,
      customer: order.customer,
      items: order.items,
      currency: order.currency,
      amount: order.amountText ?? money(order.cents),
      status: order.status
    };
    orderRows.push(row);
    if (order.duplicate) orderRows.push({ ...row });
  }
  const refundRows = refunds.map((r) => ({ refund_id: r.refund_id, order_id: r.order_id, refund_date: r.refund_date, currency: r.currency, amount: money(r.cents), reason: r.reason }));
  truth.sourceRows = { orders: orderRows.length, refunds: refundRows.length };

  return {
    ordersCsv: toCsv(['order_id', 'order_date', 'customer', 'items', 'currency', 'amount', 'status'], orderRows),
    refundsCsv: toCsv(['refund_id', 'order_id', 'refund_date', 'currency', 'amount', 'reason'], refundRows),
    truth
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { ordersCsv, refundsCsv, truth } = makeSample();
  if (process.argv.includes('--check')) {
    const same = readFileSync(join(root, 'orders.csv'), 'utf8') === ordersCsv && readFileSync(join(root, 'refunds.csv'), 'utf8') === refundsCsv;
    console.log(same ? 'Sample files match the generator.' : 'Sample files differ from the generator output.');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(join(root, 'orders.csv'), ordersCsv);
  writeFileSync(join(root, 'refunds.csv'), refundsCsv);
  console.log(JSON.stringify({ store: STORE, sourceRows: truth.sourceRows, acceptedOrders: truth.acceptedOrders, acceptedRefunds: truth.acceptedRefunds, gross: money(truth.grossCents), refunded: money(truth.refundedCents), net: money(truth.grossCents - truth.refundedCents), issueCounts: truth.issueCounts, problems: truth.problemCount }, null, 1));
}
