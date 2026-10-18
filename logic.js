(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LedgerLens = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SUPPORTED_CURRENCIES = new Set(["USD"]);
  const REQUIRED_HEADERS = Object.freeze({
    orders: Object.freeze(["order_id", "order_date", "currency", "amount", "status"]),
    refunds: Object.freeze(["refund_id", "order_id", "refund_date", "currency", "amount"])
  });
  const RESERVED_HEADERS = new Set(["_row", "__proto__", "constructor", "prototype"]);
  const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

  function csvError(message) {
    throw new Error("CSV error: " + message);
  }

  function parseCsv(text, options) {
    if (typeof text !== "string") {
      csvError("expected CSV text.");
    }

    const source = options && options.source;
    if (source !== undefined && !Object.prototype.hasOwnProperty.call(REQUIRED_HEADERS, source)) {
      csvError("unknown source " + String(source) + ". Use orders or refunds.");
    }

    const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rows = [];
    let row = [];
    let cell = "";
    let state = "field";
    let line = 1;
    let rowStartLine = 1;
    let quoteStartLine = null;
    let atFieldStart = true;
    let rowHadSyntax = false;
    let lineStartIndex = 0;

    function column(index) {
      return index - lineStartIndex + 1;
    }

    function pushCell() {
      row.push(cell.trim());
      cell = "";
      state = "field";
      quoteStartLine = null;
      atFieldStart = true;
    }

    function pushRow() {
      pushCell();
      if (rowHadSyntax || row.some((value) => value !== "")) {
        rows.push({ values: row, line: rowStartLine });
      }
      row = [];
      rowHadSyntax = false;
      rowStartLine = line + 1;
    }

    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      const next = input[index + 1];

      // Blank and whitespace-only lines are skipped. Anything else makes the line a row.
      if (character !== "\r" && character !== "\n" && character !== " " && character !== "\t") rowHadSyntax = true;

      if (state === "quoted") {
        if (character === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          state = "closed";
        } else if (character === "\r" || character === "\n") {
          if (character === "\r" && next === "\n") {
            cell += "\r\n";
            index += 1;
          } else {
            cell += character;
          }
          line += 1;
          lineStartIndex = index + 1;
        } else {
          cell += character;
        }
        continue;
      }

      if (state === "closed") {
        if (character === ",") {
          pushCell();
        } else if (character === "\r" || character === "\n") {
          pushRow();
          if (character === "\r" && next === "\n") index += 1;
          line += 1;
          lineStartIndex = index + 1;
          rowStartLine = line;
        } else if (character !== " " && character !== "\t") {
          csvError("unexpected character after a closing quote at line " + line + ", column " + column(index) + ".");
        }
        continue;
      }

      if (character === ",") {
        pushCell();
      } else if (character === "\r" || character === "\n") {
        pushRow();
        if (character === "\r" && next === "\n") index += 1;
        line += 1;
        lineStartIndex = index + 1;
        rowStartLine = line;
      } else if (character === '"') {
        if (!atFieldStart) {
          csvError("quote inside an unquoted field at line " + line + ", column " + column(index) + ".");
        }
        // Spaces before an opening quote are padding, not part of the value.
        cell = "";
        state = "quoted";
        quoteStartLine = line;
        atFieldStart = false;
      } else {
        cell += character;
        if (character !== " " && character !== "\t") atFieldStart = false;
      }
    }

    if (state === "quoted") {
      csvError("unclosed quoted field starting at line " + quoteStartLine + ".");
    }
    if (cell !== "" || row.length > 0 || state === "closed") {
      pushRow();
    }

    if (rows.length === 0) {
      if (source) {
        csvError("missing header row for " + source + ". Expected: " + REQUIRED_HEADERS[source].join(", ") + ".");
      }
      return [];
    }

    const headers = rows[0].values.map((header) => header.trim());
    if (headers.some((header) => header === "")) {
      const position = headers.findIndex((header) => header === "") + 1;
      csvError("blank header at column " + position + " on line " + rows[0].line + ".");
    }

    // Headers are matched without regard to letter case, so Order_ID and order_id
    // are the same column. Records use the lowercase key.
    const keys = headers.map((header) => header.toLocaleLowerCase("en-US"));
    const headerKeys = new Set();
    headers.forEach((header, index) => {
      const key = keys[index];
      if (RESERVED_HEADERS.has(key)) {
        csvError("reserved header " + header + " at column " + (index + 1) + " conflicts with parser metadata or object properties.");
      }
      if (headerKeys.has(key)) {
        csvError("duplicate header " + header + " at column " + (index + 1) + ".");
      }
      headerKeys.add(key);
    });

    if (source) {
      const missing = REQUIRED_HEADERS[source].filter((header) => !headerKeys.has(header));
      if (missing.length) {
        csvError(source + " is missing required header" + (missing.length === 1 ? " " : "s ") + missing.join(", ") + ".");
      }
    }

    const records = [];
    for (const parsedRow of rows.slice(1)) {
      const values = parsedRow.values;
      if (values.length !== headers.length) {
        csvError("row starting at line " + parsedRow.line + " has " + values.length + " fields, expected " + headers.length + ".");
      }
      const record = { _row: parsedRow.line };
      keys.forEach((key, index) => {
        record[key] = values[index];
      });
      records.push(record);
    }
    return records;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const daysInMonth = monthLengths[month - 1];
    return day <= daysInMonth;
  }

  // ref is the order or refund ID the issue belongs to, blank when the row has none.
  function issue(severity, source, row, code, message, ref) {
    return { severity, source, row, code, message, ref: ref || "" };
  }

  function nextMonth(month) {
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextNumber = monthNumber === 12 ? 1 : monthNumber + 1;
    return String(nextYear).padStart(4, "0") + "-" + String(nextNumber).padStart(2, "0");
  }

  function cleanText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function parseAmountCents(value) {
    const text = cleanText(value);
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
    const pieces = text.split(".");
    const whole = BigInt(pieces[0]);
    const fraction = BigInt(pieces.length === 2 ? (pieces[1] + "00").slice(0, 2) : "0");
    const cents = whole * 100n + fraction;
    if (cents > BigInt(MAX_SAFE_CENTS)) return null;
    return Number(cents);
  }

  function dollars(cents) {
    return cents / 100;
  }

  function formatCents(cents) {
    const sign = cents < 0 ? "-" : "";
    const absolute = Math.abs(cents);
    const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return sign + "$" + whole + "." + String(absolute % 100).padStart(2, "0");
  }

  function buildReport(orders, refunds) {
    if (!Array.isArray(orders) || !Array.isArray(refunds)) {
      throw new TypeError("buildReport expects orders and refunds arrays returned by parseCsv.");
    }

    const issues = [];
    const seenOrderIds = new Set();
    const validOrders = [];
    const orderById = new Map();
    let grossCents = 0;

    orders.forEach((order, index) => {
      const rowNumber = Number.isInteger(order && order._row) ? order._row : index + 2;
      const orderId = cleanText(order && order.order_id);
      const orderDate = cleanText(order && order.order_date);
      const currency = cleanText(order && order.currency).toUpperCase();
      const status = cleanText(order && order.status).toLowerCase();
      const cents = parseAmountCents(order && order.amount);
      let valid = true;

      const label = orderId || "this row";
      const rawAmount = cleanText(order && order.amount);
      if (!orderId) {
        issues.push(issue("error", "orders", rowNumber, "MISSING_ID", "Order ID is required."));
        valid = false;
      } else if (seenOrderIds.has(orderId)) {
        issues.push(issue("error", "orders", rowNumber, "DUPLICATE_ORDER", "Order " + orderId + " appears more than once. The first row was kept.", orderId));
        valid = false;
      }
      if (!isValidDate(orderDate)) {
        issues.push(issue("error", "orders", rowNumber, "INVALID_DATE", "Order " + label + (orderDate ? " has the date \"" + orderDate + "\", which is not a real YYYY-MM-DD date." : " has no date."), orderId));
        valid = false;
      }
      if (!SUPPORTED_CURRENCIES.has(currency)) {
        issues.push(issue("warning", "orders", rowNumber, "UNSUPPORTED_CURRENCY", "Order " + label + " is in " + (currency || "a blank currency") + ". Only USD is counted.", orderId));
        valid = false;
      }
      if (status !== "paid") {
        issues.push(issue("warning", "orders", rowNumber, "INELIGIBLE_STATUS", "Order " + label + " is " + (status || "missing a status") + ", so it is not counted as revenue yet.", orderId));
        valid = false;
      }
      if (cents === null || cents <= 0) {
        issues.push(issue("error", "orders", rowNumber, "INVALID_AMOUNT", "Order " + label + (rawAmount ? " has the amount \"" + rawAmount + "\"" : " has no amount") + ". Use a positive number with up to two decimals, such as 64.00.", orderId));
        valid = false;
      }
      if (orderId) seenOrderIds.add(orderId);
      if (valid && grossCents > MAX_SAFE_CENTS - cents) {
        issues.push(issue("error", "orders", rowNumber, "UNSAFE_TOTAL", "Accepting this order would exceed the safe total amount limit.", orderId));
        valid = false;
      }
      if (valid) {
        const normalized = {
          ...order,
          order_id: orderId,
          order_date: orderDate,
          currency,
          amount: dollars(cents),
          status,
          _amountCents: cents
        };
        validOrders.push(normalized);
        orderById.set(orderId, normalized);
        grossCents += cents;
      }
    });

    const validRefunds = [];
    const refundedByOrder = new Map();
    const seenRefundIds = new Set();
    let refundedCents = 0;

    refunds.forEach((refund, index) => {
      const rowNumber = Number.isInteger(refund && refund._row) ? refund._row : index + 2;
      const refundId = cleanText(refund && refund.refund_id);
      const orderId = cleanText(refund && refund.order_id);
      const refundDate = cleanText(refund && refund.refund_date);
      const currency = cleanText(refund && refund.currency).toUpperCase();
      const cents = parseAmountCents(refund && refund.amount);
      let valid = true;
      const order = orderById.get(orderId);

      const label = refundId || "on this row";
      const ref = refundId || orderId;
      const rawAmount = cleanText(refund && refund.amount);
      if (!refundId || !orderId) {
        issues.push(issue("error", "refunds", rowNumber, "MISSING_ID", "Refund ID and order ID are required.", ref));
        valid = false;
      }
      if (refundId && seenRefundIds.has(refundId)) {
        issues.push(issue("error", "refunds", rowNumber, "DUPLICATE_REFUND", "Refund " + refundId + " appears more than once. The first row was kept.", ref));
        valid = false;
      }
      if (refundId) seenRefundIds.add(refundId);
      if (!isValidDate(refundDate)) {
        issues.push(issue("error", "refunds", rowNumber, "INVALID_DATE", "Refund " + label + (refundDate ? " has the date \"" + refundDate + "\", which is not a real YYYY-MM-DD date." : " has no date."), ref));
        valid = false;
      }
      const currencySupported = SUPPORTED_CURRENCIES.has(currency);
      if (!currencySupported) {
        issues.push(issue("warning", "refunds", rowNumber, "UNSUPPORTED_CURRENCY", "Refund " + label + " is in " + (currency || "a blank currency") + ". Only USD is counted.", ref));
        valid = false;
      }
      if (cents === null || cents <= 0) {
        issues.push(issue("error", "refunds", rowNumber, "INVALID_AMOUNT", "Refund " + label + (rawAmount ? " has the amount \"" + rawAmount + "\"" : " has no amount") + ". Use a positive number with up to two decimals, such as 18.00.", ref));
        valid = false;
      }
      if (!order) {
        if (orderId && seenOrderIds.has(orderId)) {
          issues.push(issue("warning", "refunds", rowNumber, "REFUND_FOR_EXCLUDED_ORDER", "Refund " + label + " belongs to order " + orderId + ", which was excluded, so the refund is excluded too.", ref));
        } else {
          issues.push(issue("error", "refunds", rowNumber, "UNMATCHED_REFUND", "Refund " + label + " points to order " + (orderId || "with a blank ID") + ", which is not in the orders file.", ref));
        }
        valid = false;
      } else {
        // Only compare currencies the report supports. An unsupported currency is already reported once above.
        if (currencySupported && currency !== order.currency) {
          issues.push(issue("error", "refunds", rowNumber, "CURRENCY_MISMATCH", "Refund " + label + " is in " + currency + " but order " + orderId + " is in " + order.currency + ".", ref));
          valid = false;
        }
        if (isValidDate(refundDate) && refundDate < order.order_date) {
          issues.push(issue("error", "refunds", rowNumber, "REFUND_BEFORE_ORDER", "Refund " + label + " is dated " + refundDate + ", before order " + orderId + " on " + order.order_date + ".", ref));
          valid = false;
        }
        const alreadyRefunded = refundedByOrder.get(orderId) || 0;
        if (cents !== null && cents > order._amountCents - alreadyRefunded) {
          issues.push(issue("error", "refunds", rowNumber, "OVER_REFUND", "Refund " + label + " is " + formatCents(cents) + ", but only " + formatCents(order._amountCents - alreadyRefunded) + " of order " + orderId + " is left to refund.", ref));
          valid = false;
        }
      }
      if (valid && refundedCents > MAX_SAFE_CENTS - cents) {
        issues.push(issue("error", "refunds", rowNumber, "UNSAFE_TOTAL", "Accepting this refund would exceed the safe total amount limit.", ref));
        valid = false;
      }
      if (valid) {
        const normalized = {
          ...refund,
          refund_id: refundId,
          order_id: orderId,
          refund_date: refundDate,
          currency,
          amount: dollars(cents),
          _amountCents: cents
        };
        validRefunds.push(normalized);
        refundedByOrder.set(orderId, (refundedByOrder.get(orderId) || 0) + cents);
        refundedCents += cents;
      }
    });

    const byMonthMap = new Map();
    function getMonth(month) {
      if (!byMonthMap.has(month)) {
        byMonthMap.set(month, { month, grossCents: 0, refundedCents: 0, orderCount: 0 });
      }
      return byMonthMap.get(month);
    }

    validOrders.forEach((order) => {
      const month = getMonth(order.order_date.slice(0, 7));
      month.grossCents += order._amountCents;
      month.orderCount += 1;
    });
    validRefunds.forEach((refund) => {
      getMonth(refund.refund_date.slice(0, 7)).refundedCents += refund._amountCents;
    });

    // Fill months with no accepted activity so the trend never skips a month.
    const knownMonths = Array.from(byMonthMap.keys()).sort();
    if (knownMonths.length) {
      const last = knownMonths[knownMonths.length - 1];
      for (let month = knownMonths[0]; month < last; month = nextMonth(month)) getMonth(month);
    }

    const byMonth = Array.from(byMonthMap.values())
      .sort((left, right) => left.month.localeCompare(right.month))
      .map((month) => ({
        month: month.month,
        grossRevenue: dollars(month.grossCents),
        netRevenue: dollars(month.grossCents - month.refundedCents),
        refunded: dollars(month.refundedCents),
        orderCount: month.orderCount
      }));
    const orderCount = validOrders.length;
    const netCents = grossCents - refundedCents;
    const records = {
      orders: validOrders.map(({ _amountCents, ...record }) => record),
      refunds: validRefunds.map(({ _amountCents, ...record }) => record)
    };

    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        grossRevenue: dollars(grossCents),
        netRevenue: dollars(netCents),
        orderCount,
        averageOrderValue: orderCount ? dollars(Math.round(grossCents / orderCount)) : 0,
        refundRate: grossCents ? (refundedCents / grossCents) * 100 : 0,
        refunded: dollars(refundedCents)
      },
      accepted: { orders: validOrders.length, refunds: validRefunds.length },
      sourceRows: { orders: orders.length, refunds: refunds.length },
      issues,
      records,
      byMonth
    };
  }

  function csvTextCell(value) {
    let text = value === undefined || value === null ? "" : String(value);
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\u0000-\u001F\u007F]/.test(text)) {
      text = "'" + text;
    }
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportIssuesCsv(issues) {
    if (!Array.isArray(issues)) {
      throw new TypeError("exportIssuesCsv expects an issues array.");
    }
    const columns = ["severity", "source", "row", "code", "message"];
    const lines = [columns.map(csvTextCell).join(",")];
    issues.forEach((item) => {
      lines.push(columns.map((column) => csvTextCell(item && item[column])).join(","));
    });
    return lines.join("\r\n");
  }

  return { parseCsv, buildReport, exportIssuesCsv, REQUIRED_HEADERS };
});
