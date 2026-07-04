const metricsBody = document.getElementById("metricsBody");
const emptyState = document.getElementById("emptyState");
const filterInput = document.getElementById("filterInput");
const updatedAt = document.getElementById("updatedAt");
const refreshButton = document.getElementById("refreshButton");
const status = document.querySelector(".status");
const statusText = document.getElementById("statusText");

let latestMetrics = [];
let latestDisplayMetrics = [];
const lastDisplayedValues = new Map();

const CLASS_CREATED_PREFIX = "doof_class_created_total";
const CLASS_DISPOSED_PREFIX = "doof_class_disposed_total";

function splitMetricIdentity(name) {
  const labelStart = name.indexOf("{");
  if (labelStart === -1) {
    return { base: name, labels: "" };
  }
  return {
    base: name.slice(0, labelStart),
    labels: name.slice(labelStart),
  };
}

function composeMetricIdentity(base, labels) {
  return `${base}${labels}`;
}

function formatDelta(delta) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return "0";
}

function displayedMetrics(metrics) {
  const lifecycle = new Map();
  const custom = [];

  for (const metric of metrics) {
    const identity = splitMetricIdentity(metric.name);
    if (identity.base === CLASS_CREATED_PREFIX || identity.base === CLASS_DISPOSED_PREFIX) {
      const existing = lifecycle.get(identity.labels) ?? { created: 0, disposed: 0 };
      if (identity.base === CLASS_CREATED_PREFIX) {
        existing.created = metric.value;
      } else {
        existing.disposed = metric.value;
      }
      lifecycle.set(identity.labels, existing);
    } else {
      custom.push(metric);
    }
  }

  const consolidated = Array.from(lifecycle.entries()).map(([labels, values]) => {
    const name = composeMetricIdentity("doof_class_live", labels);
    const value = values.created - values.disposed;
    const previous = lastDisplayedValues.get(name);
    const delta = previous === undefined ? null : value - previous;
    lastDisplayedValues.set(name, value);
    return { name, value, delta, consolidated: true };
  });

  custom.sort((left, right) => left.name.localeCompare(right.name));
  consolidated.sort((left, right) => left.name.localeCompare(right.name));
  return [...consolidated, ...custom];
}

function setStatus(kind, text) {
  status.classList.toggle("ok", kind === "ok");
  status.classList.toggle("error", kind === "error");
  statusText.textContent = text;
}

function renderMetrics() {
  const needle = filterInput.value.trim().toLowerCase();
  const rows = latestDisplayMetrics.filter((metric) => metric.name.toLowerCase().includes(needle));
  metricsBody.replaceChildren(...rows.map((metric) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const value = document.createElement("td");
    const delta = document.createElement("td");
    name.className = "name";
    value.className = "number";
    delta.className = "number delta";
    name.textContent = metric.name;
    value.textContent = String(metric.value);
    if (metric.consolidated && metric.delta !== null) {
      delta.textContent = formatDelta(metric.delta);
      delta.classList.toggle("positive", metric.delta > 0);
      delta.classList.toggle("negative", metric.delta < 0);
      delta.classList.toggle("flat", metric.delta === 0);
    } else {
      delta.textContent = "";
    }
    tr.append(name, value, delta);
    return tr;
  }));
  emptyState.classList.toggle("hidden", rows.length > 0);
  emptyState.textContent = latestDisplayMetrics.length === 0 ? "No metrics yet." : "No metrics match the filter.";
}

async function refresh() {
  try {
    const jsonResponse = await fetch("/api/metrics", { cache: "no-store" });
    if (!jsonResponse.ok) {
      throw new Error("observer request failed");
    }
    latestMetrics = await jsonResponse.json();
    latestDisplayMetrics = displayedMetrics(latestMetrics);
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
