const metricsBody = document.getElementById("metricsBody");
const emptyState = document.getElementById("emptyState");
const filterInput = document.getElementById("filterInput");
const updatedAt = document.getElementById("updatedAt");
const rawMetrics = document.getElementById("rawMetrics");
const refreshButton = document.getElementById("refreshButton");
const status = document.querySelector(".status");
const statusText = document.getElementById("statusText");

let latestMetrics = [];

function setStatus(kind, text) {
  status.classList.toggle("ok", kind === "ok");
  status.classList.toggle("error", kind === "error");
  statusText.textContent = text;
}

function renderMetrics() {
  const needle = filterInput.value.trim().toLowerCase();
  const rows = latestMetrics.filter((metric) => metric.name.toLowerCase().includes(needle));
  metricsBody.replaceChildren(...rows.map((metric) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const value = document.createElement("td");
    name.className = "name";
    value.className = "number";
    name.textContent = metric.name;
    value.textContent = String(metric.value);
    tr.append(name, value);
    return tr;
  }));
  emptyState.classList.toggle("hidden", rows.length > 0);
  emptyState.textContent = latestMetrics.length === 0 ? "No metrics yet." : "No metrics match the filter.";
}

async function refresh() {
  try {
    const [jsonResponse, textResponse] = await Promise.all([
      fetch("/api/metrics", { cache: "no-store" }),
      fetch("/api/metrics/prometheus", { cache: "no-store" }),
    ]);
    if (!jsonResponse.ok || !textResponse.ok) {
      throw new Error("observer request failed");
    }
    latestMetrics = await jsonResponse.json();
    rawMetrics.textContent = await textResponse.text();
    updatedAt.textContent = new Date().toLocaleTimeString();
    setStatus("ok", "Live");
    renderMetrics();
  } catch {
    setStatus("error", "Disconnected");
  }
}

filterInput.addEventListener("input", renderMetrics);
refreshButton.addEventListener("click", refresh);
refresh();
setInterval(refresh, 1000);
