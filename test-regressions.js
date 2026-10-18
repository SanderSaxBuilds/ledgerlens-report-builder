// Regression tests for defects found in the October 2026 review.
// Each test is named after the defect it pins. Run: node test-regressions.js
const assert = require("node:assert/strict");
const { parseCsv, buildReport } = require("./logic.js");

const ORDER_HEADER = "order_id,order_date,currency,amount,status";
const REFUND_HEADER = "refund_id,order_id,refund_date,currency,amount";
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("parser accepts a space before a quoted field", () => {
  const rows = parseCsv("order_id,customer,order_date,currency,amount,status\nO1, \"Brennan, Ruth\",2026-01-05,USD,12.00,paid", { source: "orders" });
  assert.equal(rows[0].customer, "Brennan, Ruth");
  assert.equal(rows[0].order_date, "2026-01-05");
});

test("parser accepts a space after a closing quote", () => {
  const rows = parseCsv("order_id,customer,order_date,currency,amount,status\nO1,\"Brennan, Ruth\" ,2026-01-05,USD,12.00,paid", { source: "orders" });
  assert.equal(rows[0].customer, "Brennan, Ruth");
});

test("parser ignores a whitespace-only line instead of rejecting the file", () => {
  const rows = parseCsv(ORDER_HEADER + "\r\nO1,2026-01-05,USD,12.00,paid\r\n   \r\nO2,2026-01-06,USD,3.00,paid\r\n  \t", { source: "orders" });
  assert.deepEqual(rows.map((row) => [row.order_id, row._row]), [["O1", 2], ["O2", 4]]);
});

test("parser error columns count from the start of the line, not the file", () => {
  assert.throws(() => parseCsv('a,b\nx"y,z'), /line 2, column 2\./);
  assert.throws(() => parseCsv('a,b\nok,fine\n"x"tail,y'), /line 3, column 4\./);
});

test("required headers match regardless of letter case", () => {
  const rows = parseCsv("Order_ID,Order_Date,Customer,Currency,Amount,Status\nO1,2026-01-05,Ana Ruiz,USD,12.00,paid", { source: "orders" });
  assert.equal(rows[0].order_id, "O1");
  assert.equal(rows[0].customer, "Ana Ruiz");
  assert.equal(buildReport(rows, []).accepted.orders, 1);
});

test("monthly trend includes empty months between the first and last month", () => {
  const report = buildReport(
    parseCsv(ORDER_HEADER + "\nO1,2025-11-30,USD,10.00,paid\nO2,2026-02-01,USD,20.00,paid", { source: "orders" }),
    []
  );
  assert.deepEqual(report.byMonth.map((month) => [month.month, month.grossRevenue, month.orderCount]), [
    ["2025-11", 10, 1],
    ["2025-12", 0, 0],
    ["2026-01", 0, 0],
    ["2026-02", 20, 1]
  ]);
});

test("a wrong-currency refund is reported once, not twice", () => {
  const report = buildReport(
    parseCsv(ORDER_HEADER + "\nO1,2026-02-10,USD,10.00,paid", { source: "orders" }),
    parseCsv(REFUND_HEADER + "\nR1,O1,2026-02-11,EUR,2.00", { source: "refunds" })
  );
  assert.deepEqual(report.issues.map(({ code }) => code), ["UNSUPPORTED_CURRENCY"]);
});

test("average order value is rounded to whole cents", () => {
  const report = buildReport(
    parseCsv(ORDER_HEADER + "\nO1,2026-01-01,USD,0.01,paid\nO2,2026-01-02,USD,0.01,paid\nO3,2026-01-03,USD,0.02,paid", { source: "orders" }),
    []
  );
  // 4 cents over 3 orders is 1.333 cents, which rounds to 1 cent.
  assert.equal(report.metrics.averageOrderValue, 0.01);
});

test("a refund for an excluded order explains that the order was excluded", () => {
  const report = buildReport(
    parseCsv(ORDER_HEADER + "\nO1,2026-01-01,USD,10.00,cancelled", { source: "orders" }),
    parseCsv(REFUND_HEADER + "\nR1,O1,2026-01-03,USD,10.00\nR2,O9,2026-01-03,USD,1.00", { source: "refunds" })
  );
  assert.deepEqual(report.issues.map(({ code, ref }) => [code, ref]), [
    ["INELIGIBLE_STATUS", "O1"],
    ["REFUND_FOR_EXCLUDED_ORDER", "R1"],
    ["UNMATCHED_REFUND", "R2"]
  ]);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log("PASS " + name); }
  catch (error) { failed += 1; console.log("FAIL " + name + "\n     " + String(error.message).split("\n")[0]); }
}
console.log(`${tests.length - failed} of ${tests.length} regression tests passed`);
if (failed) process.exitCode = 1;
