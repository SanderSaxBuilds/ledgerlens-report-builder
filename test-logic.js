const fs = require("fs");
const path = require("path");
const { parseCsv, buildReport } = require("./logic.js");

const orders = parseCsv(fs.readFileSync(path.join(__dirname, "orders.csv"), "utf8"));
const refunds = parseCsv(fs.readFileSync(path.join(__dirname, "refunds.csv"), "utf8"));
const report = buildReport(orders, refunds);

const expected = {
  grossRevenue: 7235,
  netRevenue: 6535,
  orderCount: 6,
  refunded: 700,
  issues: 7
};

for (const [key, value] of Object.entries(expected)) {
  const actual = key === "issues" ? report.issues.length : report.metrics[key];
  if (actual !== value) throw new Error(`${key}: expected ${value}, received ${actual}`);
}

const codes = new Set(report.issues.map((item) => item.code));
for (const code of ["DUPLICATE_ORDER", "INVALID_DATE", "UNSUPPORTED_CURRENCY", "INVALID_AMOUNT", "UNMATCHED_REFUND", "OVER_REFUND"]) {
  if (!codes.has(code)) throw new Error(`Missing expected exception code: ${code}`);
}

console.log("LedgerLens logic verified", report.metrics, `${report.issues.length} exceptions`);
