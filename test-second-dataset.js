const assert = require("node:assert/strict");
const { parseCsv, buildReport } = require("./logic.js");

const orders = parseCsv(`order_id,order_date,currency,amount
A,2026-09-01,USD,100
B,2026-09-02,USD,50
B,2026-09-03,USD,80
C,2026-02-30,USD,70
`);
const refunds = parseCsv(`refund_id,order_id,refund_date,currency,amount
R1,A,2026-09-04,USD,70
R2,A,2026-09-05,USD,50
`);
const report = buildReport(orders, refunds);

assert.equal(report.metrics.grossRevenue, 150);
assert.equal(report.metrics.refunded, 70);
assert.equal(report.metrics.netRevenue, 80);
assert.equal(report.accepted.orders, 2);
assert.equal(report.accepted.refunds, 1);
assert.deepEqual(
  report.issues.map(({ code }) => code),
  ["DUPLICATE_ORDER", "INVALID_DATE", "OVER_REFUND"]
);

console.log("Independent second dataset verified", report.metrics, report.issues.map(({ code }) => code));
