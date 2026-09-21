(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LedgerLens = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SUPPORTED_CURRENCIES = new Set(["USD"]);

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell.trim());
        cell = "";
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) return [];

    const headers = rows[0];
    return rows.slice(1).map((values, index) => {
      const record = { _row: index + 2 };
      headers.forEach((header, headerIndex) => {
        record[header] = values[headerIndex] || "";
      });
      return record;
    });
  }

  function isValidDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  }

  function issue(severity, source, row, code, message) {
    return { severity, source, row, code, message };
  }

  function buildReport(orders, refunds) {
    const issues = [];
    const seenOrderIds = new Set();
    const validOrders = [];
    const orderById = new Map();

    orders.forEach((order) => {
      const amount = Number(order.amount);
      let valid = true;
      if (!order.order_id) {
        issues.push(issue("error", "orders", order._row, "MISSING_ID", "Order ID is required."));
        valid = false;
      } else if (seenOrderIds.has(order.order_id)) {
        issues.push(issue("error", "orders", order._row, "DUPLICATE_ORDER", `Duplicate order ID ${order.order_id}.`));
        valid = false;
      }
      if (!isValidDate(order.order_date)) {
        issues.push(issue("error", "orders", order._row, "INVALID_DATE", `Invalid order date for ${order.order_id || "this row"}.`));
        valid = false;
      }
      if (!SUPPORTED_CURRENCIES.has(order.currency)) {
        issues.push(issue("warning", "orders", order._row, "UNSUPPORTED_CURRENCY", `${order.currency || "Blank currency"} is outside the USD-only demo.`));
        valid = false;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        issues.push(issue("error", "orders", order._row, "INVALID_AMOUNT", `Order amount must be greater than zero for ${order.order_id || "this row"}.`));
        valid = false;
      }
      if (order.order_id) seenOrderIds.add(order.order_id);
      if (valid) {
        const normalized = { ...order, amount };
        validOrders.push(normalized);
        orderById.set(order.order_id, normalized);
      }
    });

    const validRefunds = [];
    refunds.forEach((refund) => {
      const amount = Number(refund.amount);
      let valid = true;
      const order = orderById.get(refund.order_id);
      if (!refund.refund_id || !refund.order_id) {
        issues.push(issue("error", "refunds", refund._row, "MISSING_ID", "Refund ID and order ID are required."));
        valid = false;
      }
      if (!isValidDate(refund.refund_date)) {
        issues.push(issue("error", "refunds", refund._row, "INVALID_DATE", `Invalid refund date for ${refund.refund_id || "this row"}.`));
        valid = false;
      }
      if (!SUPPORTED_CURRENCIES.has(refund.currency)) {
        issues.push(issue("warning", "refunds", refund._row, "UNSUPPORTED_CURRENCY", `${refund.currency || "Blank currency"} is outside the USD-only demo.`));
        valid = false;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        issues.push(issue("error", "refunds", refund._row, "INVALID_AMOUNT", `Refund amount must be greater than zero for ${refund.refund_id || "this row"}.`));
        valid = false;
      }
      if (!order) {
        issues.push(issue("error", "refunds", refund._row, "UNMATCHED_REFUND", `No valid order matches ${refund.order_id || "this refund"}.`));
        valid = false;
      } else if (Number.isFinite(amount) && amount > order.amount) {
        issues.push(issue("error", "refunds", refund._row, "OVER_REFUND", `${refund.refund_id} exceeds order ${refund.order_id}.`));
        valid = false;
      }
      if (valid) validRefunds.push({ ...refund, amount });
    });

    const grossRevenue = validOrders.reduce((sum, order) => sum + order.amount, 0);
    const refunded = validRefunds.reduce((sum, refund) => sum + refund.amount, 0);
    const orderCount = validOrders.length;
    const netRevenue = grossRevenue - refunded;
    const averageOrderValue = orderCount ? grossRevenue / orderCount : 0;
    const refundRate = grossRevenue ? (refunded / grossRevenue) * 100 : 0;

    return {
      generatedAt: new Date().toISOString(),
      metrics: { grossRevenue, netRevenue, orderCount, averageOrderValue, refundRate, refunded },
      accepted: { orders: validOrders.length, refunds: validRefunds.length },
      sourceRows: { orders: orders.length, refunds: refunds.length },
      issues
    };
  }

  return { parseCsv, buildReport };
});
