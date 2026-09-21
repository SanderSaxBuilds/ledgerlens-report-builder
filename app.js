const $ = (selector) => document.querySelector(selector);
const state = { ordersText: "", refundsText: "", report: null, filter: "all" };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

async function readLocalFile(input) {
  const file = input.files && input.files[0];
  return file ? file.text() : "";
}

async function loadSamples() {
  const [orders, refunds] = await Promise.all([fetch("orders.csv"), fetch("refunds.csv")]);
  state.ordersText = await orders.text();
  state.refundsText = await refunds.text();
  $("#orders-name").textContent = "orders.csv sample loaded";
  $("#refunds-name").textContent = "refunds.csv sample loaded";
  runReport();
}

function runReport() {
  if (!state.ordersText || !state.refundsText) {
    showNotice("Load both source files before generating a report.", true);
    return;
  }
  const orders = LedgerLens.parseCsv(state.ordersText);
  const refunds = LedgerLens.parseCsv(state.refundsText);
  state.report = LedgerLens.buildReport(orders, refunds);
  renderReport();
  showNotice(`Report generated from ${orders.length + refunds.length} source rows.`, false);
}

function renderReport() {
  const { metrics, accepted, sourceRows, issues } = state.report;
  $("#gross").textContent = money.format(metrics.grossRevenue);
  $("#net").textContent = money.format(metrics.netRevenue);
  $("#orders").textContent = String(metrics.orderCount);
  $("#aov").textContent = money.format(metrics.averageOrderValue);
  $("#refund-rate").textContent = `${percent.format(metrics.refundRate)}%`;
  $("#quality-summary").textContent = `${accepted.orders}/${sourceRows.orders} orders and ${accepted.refunds}/${sourceRows.refunds} refunds accepted`;
  $("#issue-total").textContent = `${issues.length} exceptions`;
  $("#generated").textContent = new Date(state.report.generatedAt).toLocaleString();
  renderIssues();
  $("#empty-state").hidden = true;
  $("#report").hidden = false;
}

function renderIssues() {
  const rows = state.report.issues.filter((item) => state.filter === "all" || item.severity === state.filter);
  $("#issue-body").innerHTML = rows.length
    ? rows.map((item) => `<tr><td><span class="pill ${item.severity}">${item.severity}</span></td><td>${escapeHtml(item.source)}</td><td>${item.row}</td><td><code>${escapeHtml(item.code)}</code></td><td>${escapeHtml(item.message)}</td></tr>`).join("")
    : '<tr><td colspan="5" class="empty-row">No exceptions match this filter.</td></tr>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function showNotice(message, error) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = error ? "notice error" : "notice success";
}

function download(name, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

$("#orders-file").addEventListener("change", async (event) => {
  state.ordersText = await readLocalFile(event.target);
  $("#orders-name").textContent = event.target.files[0]?.name || "No file selected";
});

$("#refunds-file").addEventListener("change", async (event) => {
  state.refundsText = await readLocalFile(event.target);
  $("#refunds-name").textContent = event.target.files[0]?.name || "No file selected";
});

$("#load-samples").addEventListener("click", loadSamples);
$("#run-report").addEventListener("click", runReport);
$("#print-report").addEventListener("click", () => window.print());
$("#export-json").addEventListener("click", () => state.report && download("ledgerlens-report.json", JSON.stringify(state.report, null, 2), "application/json"));
$("#export-csv").addEventListener("click", () => {
  if (!state.report) return;
  const header = "severity,source,row,code,message";
  const lines = state.report.issues.map((item) => [item.severity, item.source, item.row, item.code, item.message].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  download("ledgerlens-exceptions.csv", [header, ...lines].join("\n"), "text/csv");
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    if (state.report) renderIssues();
  });
});

loadSamples().catch(() => showNotice("Use the file controls to load the two bundled CSV files.", true));
