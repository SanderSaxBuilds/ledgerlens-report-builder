const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv, buildReport, exportIssuesCsv, summarizeView, previousPeriod, exportViewCsv, recordsToCsv, csvHeaders, detectSource, monthsBetween, shiftMonth, productsOf, SIZE_BANDS } = require("./logic.js");

(async () => {
const root = __dirname;
const sampleOrders = fs.readFileSync(path.join(root, "orders.csv"), "utf8");
const sampleRefunds = fs.readFileSync(path.join(root, "refunds.csv"), "utf8");

// The bundled sample must be exactly what the seeded generator writes.
const { makeSample } = await import("./tools/make-sample.mjs");
const sample = makeSample();
assert.equal(sampleOrders, sample.ordersCsv, "orders.csv is out of date. Run node tools/make-sample.mjs");
assert.equal(sampleRefunds, sample.refundsCsv, "refunds.csv is out of date. Run node tools/make-sample.mjs");
const truth = sample.truth;

const baseline = buildReport(
  parseCsv(sampleOrders, { source: "orders" }),
  parseCsv(sampleRefunds, { source: "refunds" })
);
const toCents = (value) => Math.round(value * 100);

// Compare the report with the generator's ground truth, which never touches logic.js.
assert.equal(toCents(baseline.metrics.grossRevenue), truth.grossCents);
assert.equal(toCents(baseline.metrics.refunded), truth.refundedCents);
assert.equal(toCents(baseline.metrics.netRevenue), truth.grossCents - truth.refundedCents);
assert.equal(baseline.metrics.orderCount, truth.acceptedOrders);
assert.equal(toCents(baseline.metrics.averageOrderValue), Math.round(truth.grossCents / truth.acceptedOrders));
assert.deepEqual(baseline.accepted, { orders: truth.acceptedOrders, refunds: truth.acceptedRefunds });
assert.deepEqual(baseline.sourceRows, truth.sourceRows);
assert.deepEqual(
  baseline.byMonth.map((m) => [m.month, toCents(m.grossRevenue), toCents(m.refunded), toCents(m.netRevenue), m.orderCount]),
  Object.entries(truth.byMonth).map(([month, m]) => [month, m.grossCents, m.refundedCents, m.grossCents - m.refundedCents, m.orderCount])
);
const issueCounts = {};
for (const { code } of baseline.issues) issueCounts[code] = (issueCounts[code] || 0) + 1;
assert.deepEqual(issueCounts, truth.issueCounts);

// Shape of the sample, as promised in the README.
assert.equal(baseline.byMonth.length, 12, "sample covers twelve consecutive months");
assert.equal(baseline.byMonth[0].month, "2025-10");
assert.equal(baseline.byMonth[11].month, "2026-09");
assert.ok(truth.problemCount >= 8 && truth.problemCount <= 15, "sample has 8 to 15 planted data problems");
assert.ok(baseline.sourceRows.orders >= 250 && baseline.sourceRows.orders <= 400);
const refundShare = baseline.accepted.refunds / baseline.accepted.orders;
assert.ok(refundShare >= 0.06 && refundShare <= 0.1, "roughly 6 to 10 percent of orders are refunded");
const december = baseline.byMonth.find((m) => m.month === "2025-12").grossRevenue;
const february = baseline.byMonth.find((m) => m.month === "2026-02").grossRevenue;
assert.ok(december > february * 2, "gift season shows in the trend");

// Headline figures quoted in the README. Changing the sample means updating both.
assert.deepEqual(
  { gross: baseline.metrics.grossRevenue, refunded: baseline.metrics.refunded, net: baseline.metrics.netRevenue, orders: baseline.metrics.orderCount, refunds: baseline.accepted.refunds, issues: baseline.issues.length },
  { gross: 32663.05, refunded: 1278.9, net: 31384.15, orders: 288, refunds: 23, issues: 27 }
);

const cleanOrders = parseCsv([
  "order_id,order_date,currency,amount,status",
  "O-030,2026-01-31,USD,0.30,paid",
  "O-125,2026-03-01,USD,1.25,PAID"
].join("\n"), { source: "orders" });
const cleanRefunds = parseCsv([
  "refund_id,order_id,refund_date,currency,amount",
  "R-010,O-030,2026-02-01,USD,0.10",
  "R-020,O-030,2026-02-02,USD,0.20"
].join("\n"), { source: "refunds" });
const clean = buildReport(cleanOrders, cleanRefunds);
assert.deepEqual(clean.metrics, {
  grossRevenue: 1.55,
  netRevenue: 1.25,
  orderCount: 2,
  averageOrderValue: 0.78,
  refundRate: (0.3 / 1.55) * 100,
  refunded: 0.3
});
assert.deepEqual(clean.accepted, { orders: 2, refunds: 2 });
assert.deepEqual(clean.byMonth, [
  { month: "2026-01", grossRevenue: 0.3, netRevenue: 0.3, refunded: 0, orderCount: 1 },
  { month: "2026-02", grossRevenue: 0, netRevenue: -0.3, refunded: 0.3, orderCount: 0 },
  { month: "2026-03", grossRevenue: 1.25, netRevenue: 1.25, refunded: 0, orderCount: 1 }
]);
assert.deepEqual(clean.records.orders.map(({ order_id, amount }) => ({ order_id, amount })), [
  { order_id: "O-030", amount: 0.3 },
  { order_id: "O-125", amount: 1.25 }
]);

const duplicateRefunds = buildReport(
  parseCsv("order_id,order_date,currency,amount,status\nO1,2026-01-01,USD,0.30,paid", { source: "orders" }),
  parseCsv([
    "refund_id,order_id,refund_date,currency,amount",
    "R1,O1,2026-01-02,USD,0.10",
    "R1,O1,2026-01-03,USD,0.20"
  ].join("\n"), { source: "refunds" })
);
assert.equal(duplicateRefunds.accepted.refunds, 1);
assert.deepEqual(duplicateRefunds.issues.map(({ code }) => code), ["DUPLICATE_REFUND"]);
assert.equal(duplicateRefunds.metrics.refunded, 0.1);

const cumulativeOverRefund = buildReport(
  parseCsv("order_id,order_date,currency,amount,status\nO1,2026-01-01,USD,0.30,paid", { source: "orders" }),
  parseCsv([
    "refund_id,order_id,refund_date,currency,amount",
    "R1,O1,2026-01-02,USD,0.20",
    "R2,O1,2026-01-03,USD,0.20"
  ].join("\n"), { source: "refunds" })
);
assert.equal(cumulativeOverRefund.accepted.refunds, 1);
assert.deepEqual(cumulativeOverRefund.issues.map(({ code }) => code), ["OVER_REFUND"]);
assert.equal(cumulativeOverRefund.metrics.refunded, 0.2);

assert.throws(
  () => parseCsv("order_id,order_date,currency,amount,status\nO1,2026-01-01,USD,1.00", { source: "orders" }),
  /row starting at line 2 has 4 fields, expected 5/
);
assert.throws(
  () => parseCsv("order_id,order_id,order_date,currency,amount,status", { source: "orders" }),
  /duplicate header order_id/
);
assert.throws(
  () => parseCsv("order_id,,order_date,currency,amount,status", { source: "orders" }),
  /blank header at column 2/
);
assert.throws(
  () => parseCsv("order_id,order_date,currency,amount", { source: "orders" }),
  /orders is missing required header status/
);
for (const header of ["_row", "__proto__", "constructor", "prototype"]) {
  assert.throws(() => parseCsv("id," + header + "\nX,Y"), /reserved header/);
}
assert.throws(() => parseCsv('a,b\n"x"tail,y'), /unexpected character after a closing quote/);
assert.throws(() => parseCsv('a,b\nx"y,z'), /quote inside an unquoted field/);
assert.throws(() => parseCsv('a,b\n"unfinished,y'), /unclosed quoted field starting at line 2/);

const bomRecords = parseCsv("\uFEFForder_id,order_date,currency,amount,status\nO1,2026-01-01,USD,1.00,paid", { source: "orders" });
assert.equal(bomRecords[0].order_id, "O1");
assert.equal(bomRecords[0]._row, 2);

const multiline = parseCsv([
  "order_id,order_date,customer,currency,amount,status",
  'O1,2026-01-01,"First line',
  'second line",USD,1.00,paid',
  "O2,2026-01-02,Regular,USD,2.00,paid"
].join("\n"), { source: "orders" });
assert.equal(multiline[0].customer, "First line\nsecond line");
assert.equal(multiline[0]._row, 2);
assert.equal(multiline[1]._row, 4);

const dateRows = parseCsv([
  "order_id,order_date,currency,amount,status",
  "Y0,0000-01-01,USD,1.00,paid",
  "Y4,0004-02-29,USD,1.00,paid",
  "Y96,0096-02-29,USD,1.00,paid",
  "Y25,2025-02-29,USD,1.00,paid"
].join("\n"), { source: "orders" });
const dateReport = buildReport(dateRows, []);
assert.deepEqual(dateReport.issues.map(({ code, row }) => [code, row]), [
  ["INVALID_DATE", 2],
  ["INVALID_DATE", 5]
]);
assert.equal(dateReport.accepted.orders, 2);

const statusReport = buildReport(
  parseCsv([
    "order_id,order_date,currency,amount,status",
    "CANCEL,2026-01-01,USD,1.00,cancelled",
    "PENDING,2026-01-02,USD,1.00,pending",
    "BLANK,2026-01-03,USD,1.00,",
    "PAID,2026-01-04,USD,1.00,Paid"
  ].join("\n"), { source: "orders" }),
  []
);
assert.equal(statusReport.accepted.orders, 1);
assert.deepEqual(statusReport.issues.map(({ code, severity }) => [code, severity]), [
  ["INELIGIBLE_STATUS", "warning"],
  ["INELIGIBLE_STATUS", "warning"],
  ["INELIGIBLE_STATUS", "warning"]
]);
assert.equal(statusReport.records.orders[0].status, "paid");

const invalidAmountValues = ["1e2", "Infinity", "1.001", "-1", "+1", "01.00", "0.00"];
const invalidAmounts = buildReport(
  parseCsv([
    "order_id,order_date,currency,amount,status",
    ...invalidAmountValues.map((amount, index) => "BAD" + index + ",2026-01-01,USD," + amount + ",paid")
  ].join("\n"), { source: "orders" }),
  []
);
assert.equal(invalidAmounts.accepted.orders, 0);
assert.equal(invalidAmounts.issues.filter(({ code }) => code === "INVALID_AMOUNT").length, invalidAmountValues.length);

const oversized = buildReport(
  parseCsv([
    "order_id,order_date,currency,amount,status",
    "MAX,2026-01-01,USD,90071992547409.91,paid",
    "EXTRA,2026-01-02,USD,0.01,paid"
  ].join("\n"), { source: "orders" }),
  []
);
assert.equal(oversized.accepted.orders, 1);
assert.equal(oversized.issues[0].code, "UNSAFE_TOTAL");
assert.equal(oversized.metrics.orderCount, 1);

const timingAndCurrency = buildReport(
  parseCsv("order_id,order_date,currency,amount,status\nO1,2026-02-10,USD,1.00,paid", { source: "orders" }),
  parseCsv([
    "refund_id,order_id,refund_date,currency,amount",
    "BEFORE,O1,2026-02-09,USD,0.25",
    "CURRENCY,O1,2026-02-11,EUR,0.25"
  ].join("\n"), { source: "refunds" })
);
// A EUR refund is reported once as an unsupported currency, not also as a mismatch.
assert.deepEqual(new Set(timingAndCurrency.issues.map(({ code }) => code)), new Set([
  "REFUND_BEFORE_ORDER",
  "UNSUPPORTED_CURRENCY"
]));
assert.equal(timingAndCurrency.accepted.refunds, 0);

const safeCsv = exportIssuesCsv([
  { severity: "error", source: "orders", row: 2, code: "FORMULA", message: "=HYPERLINK(\"https://example.invalid\")" },
  { severity: "error", source: "+cmd", row: 3, code: "TEXT", message: "plain, text" }
]);
assert.ok(safeCsv.startsWith('"severity","source","row","code","message"\r\n'));
assert.ok(safeCsv.includes('"\'=HYPERLINK(""https://example.invalid"")"'));
assert.ok(safeCsv.includes('"\'+cmd"'));
assert.ok(safeCsv.includes('"plain, text"'));
assert.equal(exportIssuesCsv([]), '"severity","source","row","code","message"');

// Report builder views. Every grouping must reconcile with the headline figures.
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
for (const groupBy of ["month", "quarter", "customer", "size"]) {
  const view = summarizeView(baseline, { groupBy });
  assert.equal(view.totals.grossCents, truth.grossCents, groupBy + " gross total");
  assert.equal(view.totals.refundCents, truth.refundedCents, groupBy + " refund total");
  assert.equal(view.totals.orders, truth.acceptedOrders, groupBy + " order count");
  assert.equal(view.totals.refunds, truth.acceptedRefunds, groupBy + " refund count");
  assert.equal(sum(view.rows, "grossCents"), view.totals.grossCents, groupBy + " rows add up to gross");
  assert.equal(sum(view.rows, "refundCents"), view.totals.refundCents, groupBy + " rows add up to refunds");
  assert.equal(sum(view.rows, "orders"), view.totals.orders, groupBy + " rows add up to orders");
  assert.equal(view.overlapping, false);
}
const monthView = summarizeView(baseline, { groupBy: "month" });
assert.deepEqual(monthView.rows.map((row) => [row.key, row.grossCents, row.refundCents]),
  Object.entries(truth.byMonth).map(([month, m]) => [month, m.grossCents, m.refundedCents]));
const quarterView = summarizeView(baseline, { groupBy: "quarter" });
assert.deepEqual(quarterView.rows.map((row) => row.label), ["Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026"]);
const sizeView = summarizeView(baseline, { groupBy: "size" });
assert.ok(sizeView.rows.every((row) => SIZE_BANDS.some((band) => band.label === row.label)));
const customerView = summarizeView(baseline, { groupBy: "customer" });
for (let i = 1; i < customerView.rows.length; i++) assert.ok(customerView.rows[i - 1].netCents >= customerView.rows[i].netCents, "customers ranked by net");
// Products overlap: an order with two products counts under both, but the totals count it once.
const productView = summarizeView(baseline, { groupBy: "product" });
assert.equal(productView.overlapping, true);
assert.equal(productView.totals.grossCents, truth.grossCents);
assert.ok(sum(productView.rows, "orders") > productView.totals.orders);

// A period narrows both orders and refunds, and empty months still get a row.
const gap = buildReport(
  parseCsv("order_id,order_date,customer,items,currency,amount,status\nA,2026-01-05,Ann,\"Tea x2, Cups\",USD,30.00,paid\nB,2026-03-09,Bo,Tea,USD,300.00,paid", { source: "orders" }),
  parseCsv("refund_id,order_id,refund_date,currency,amount\nR,A,2026-03-01,USD,5.00", { source: "refunds" })
);
const marchOnly = summarizeView(gap, { from: "2026-03", to: "2026-03", groupBy: "customer" });
assert.deepEqual(marchOnly.totals, { grossCents: 30000, refundCents: 500, netCents: 29500, orders: 1, refunds: 1 });
assert.deepEqual(marchOnly.rows.map((row) => [row.label, row.netCents]), [["Bo", 30000], ["Ann", -500]]);
assert.deepEqual(summarizeView(gap, { groupBy: "month" }).rows.map((row) => [row.key, row.orders]), [["2026-01", 1], ["2026-02", 0], ["2026-03", 1]]);
assert.deepEqual(summarizeView(gap, { groupBy: "product" }).rows.map((row) => row.label).sort(), ["Cups", "Tea"]);
assert.deepEqual(summarizeView(gap, { groupBy: "size" }).rows.map((row) => row.label), ["$25 to $49.99", "$250 and over"]);
assert.deepEqual(productsOf("House blend 1 kg x3, Paper filters, Paper filters x2"), ["House blend 1 kg", "Paper filters"]);
assert.deepEqual(productsOf(""), ["(no items listed)"]);
assert.throws(() => summarizeView(gap, { groupBy: "weekday" }), /Unknown grouping/);
assert.deepEqual(previousPeriod("2026-01", "2026-03"), { from: "2025-10", to: "2025-12" });
assert.deepEqual(monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
assert.equal(shiftMonth("2026-01", -1), "2025-12");

// View export: formula guard on labels and a total row that says how products are counted.
const viewCsv = exportViewCsv({ rows: [{ label: "=SUM(A1)", orders: 2, grossCents: 1050, refundCents: 50, netCents: 1000 }], totals: { orders: 1, grossCents: 1050, refundCents: 50, netCents: 1000 }, overlapping: true });
assert.deepEqual(viewCsv.split("\r\n"), ['"group","orders","gross","refunds","net"', '"\'=SUM(A1)",2,10.50,0.50,10.00', '"Total, each order once",1,10.50,0.50,10.00']);

// Corrected files written back keep every value and parse to the same rows.
const awkward = "order_id,order_date,customer,currency,amount,status\nO1,2026-01-01,\"Hollis and Rowe, Bakers\",USD,1.00,paid\nO2,2026-01-02,\"Say \"\"hi\"\"\",USD,2.00,paid\n";
const awkwardRows = parseCsv(awkward, { source: "orders" });
const written = recordsToCsv(csvHeaders(awkward), awkwardRows);
assert.deepEqual(parseCsv(written, { source: "orders" }), awkwardRows);
assert.ok(written.includes('"Hollis and Rowe, Bakers"'));

// Pasted or dropped text is routed by its header row.
assert.equal(detectSource(sampleOrders), "orders");
assert.equal(detectSource(sampleRefunds), "refunds");
assert.equal(detectSource("﻿\"Order_ID\",Status\nX,paid"), "orders");
assert.equal(detectSource("hello,world\n1,2"), "");

console.log("LedgerLens logic verified", JSON.stringify({
  result: "passed",
  sample: baseline.metrics,
  accepted: baseline.accepted,
  sampleIssues: baseline.issues.length,
  months: baseline.byMonth.length,
  cleanRows: { orders: clean.accepted.orders, refunds: clean.accepted.refunds }
}));
})().catch((error) => { console.error(error); process.exitCode = 1; });
