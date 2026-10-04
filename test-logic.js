const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCsv, buildReport, exportIssuesCsv } = require("./logic.js");

const originalRoot = __dirname;
const originalOrders = fs.readFileSync(path.join(originalRoot, "orders.csv"), "utf8");
const originalRefunds = fs.readFileSync(path.join(originalRoot, "refunds.csv"), "utf8");

const baseline = buildReport(
  parseCsv(originalOrders, { source: "orders" }),
  parseCsv(originalRefunds, { source: "refunds" })
);
assert.deepEqual(baseline.metrics, {
  grossRevenue: 7235,
  netRevenue: 6535,
  orderCount: 6,
  averageOrderValue: 1205.8333333333333,
  refundRate: (700 / 7235) * 100,
  refunded: 700
});
assert.deepEqual(baseline.accepted, { orders: 6, refunds: 2 });
assert.deepEqual(baseline.sourceRows, { orders: 10, refunds: 5 });
assert.equal(baseline.issues.length, 7);
assert.equal(baseline.records.orders.length, 6);
assert.equal(baseline.records.refunds.length, 2);
assert.ok(baseline.byMonth.every((entry) => /^\d{4}-\d{2}$/.test(entry.month)));

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
  averageOrderValue: 0.775,
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
assert.deepEqual(new Set(timingAndCurrency.issues.map(({ code }) => code)), new Set([
  "REFUND_BEFORE_ORDER",
  "UNSUPPORTED_CURRENCY",
  "CURRENCY_MISMATCH"
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

console.log("LedgerLens v2 verified", JSON.stringify({
  result: "passed",
  originalSample: baseline.metrics,
  accepted: baseline.accepted,
  originalIssues: baseline.issues.length,
  cleanRows: { orders: clean.accepted.orders, refunds: clean.accepted.refunds },
  byMonthEntries: clean.byMonth.length
}));
