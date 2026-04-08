/**
 * Doof Playground — main entry point.
 *
 * Sets up two Monaco editors (Doof source ↔ C++ output), wires up the
 * compiler pipeline with debounced recompilation, renders diagnostics in
 * the bottom panel, and runs the current source through a local build/run
 * endpoint when requested.
 */

import * as monaco from "monaco-editor";

// Monaco workers — Vite handles these via import.meta.url
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

import { registerDoofLanguage } from "./doof-language";
import { compileDoof, type CompileResult, type PlaygroundDiagnostic } from "./compiler";

interface PlaygroundRunResult {
  status: "succeeded" | "compile-failed" | "build-failed" | "run-failed";
  message: string;
  cpp: string;
  buildCommand: string;
  buildStdout: string;
  buildStderr: string;
  runCommand: string;
  runStdout: string;
  runStderr: string;
  exitCode: number | null;
  elapsedMs: number;
}

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

const DEFAULT_SOURCE = `\
// Classes — demonstrates classes, methods, and object construction
class Point {
  x, y: float

  function distanceSquaredTo(other: Point): float {
    dx := x - other.x
    dy := y - other.y
    return dx * dx + dy * dy
  }

  function display(): string {
    return \`(\${x}, \${y})\`
  }
}

class Rectangle {
  origin: Point
  width, height: float

  function area(): float => width * height

  function perimeter(): double => 2.0 * (width + height)
}

function main(): int {
  a := Point { x: 0.0, y: 0.0 }
  b := Point { x: 3.0, y: 4.0 }

  println(\`Point A: \${a.display()}\`)
  println(\`Point B: \${b.display()}\`)
  println(\`Distance squared: \${a.distanceSquaredTo(b)}\`)

  rect := Rectangle {
    origin: Point { x: 1.0, y: 1.0 },
    width: 10.0,
    height: 5.0
  }
  println(\`Area: \${rect.area()}\`)
  println(\`Perimeter: \${rect.perimeter()}\`)

  return 0
}
`;

const SOURCE_STORAGE_KEY = "doof-playground.source";

function getRunShortcutLabel(): string {
  return "F5"
}

function getRunShortcutAria(): string {
  return "F5";
}

function loadInitialSource(): string {
  try {
    return window.localStorage.getItem(SOURCE_STORAGE_KEY) ?? DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

function persistSource(source: string) {
  try {
    window.localStorage.setItem(SOURCE_STORAGE_KEY, source);
  } catch {
    // Ignore unavailable or quota-limited localStorage.
  }
}

function isRunShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();

  return (key == "f5");
}

const initialSource = loadInitialSource();

registerDoofLanguage();

const doofContainer = document.getElementById("doof-editor")!;
const cppContainer = document.getElementById("cpp-editor")!;
const errorList = document.getElementById("error-list")!;
const errorCount = document.getElementById("error-count")!;
const statusEl = document.getElementById("status")!;
const runButton = document.getElementById("run-button") as HTMLButtonElement;
const runButtonLabel = document.getElementById("run-button-label")!;
const runShortcut = document.getElementById("run-shortcut")!;
const runPanel = document.getElementById("run-panel")!;
const runStatus = document.getElementById("run-status")!;
const runOutput = document.getElementById("run-output")!;
const runPanelCloseButton = document.getElementById("run-panel-close") as HTMLButtonElement;

const runShortcutLabel = getRunShortcutLabel();

runShortcut.textContent = runShortcutLabel;
runButton.title = `Run current source (${runShortcutLabel})`;
runButton.setAttribute("aria-keyshortcuts", getRunShortcutAria());

const doofEditor = monaco.editor.create(doofContainer, {
  value: initialSource,
  language: "doof",
  theme: "vs-dark",
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  lineNumbers: "on",
  renderLineHighlight: "line",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 8 },
});

const cppEditor = monaco.editor.create(cppContainer, {
  value: "",
  language: "cpp",
  theme: "vs-dark",
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  lineNumbers: "on",
  readOnly: true,
  renderLineHighlight: "none",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 8 },
});

let compileStatusText = "Ready";
let sourceVersion = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestCompile: CompileResult = compileDoof(initialSource);
let latestRun: PlaygroundRunResult | null = null;
let lastRunSourceVersion: number | null = null;
let isRunning = false;
let activeRunController: AbortController | null = null;

function severityToMarker(sev: "error" | "warning" | "info"): monaco.MarkerSeverity {
  switch (sev) {
    case "error": return monaco.MarkerSeverity.Error;
    case "warning": return monaco.MarkerSeverity.Warning;
    case "info": return monaco.MarkerSeverity.Info;
  }
}

function severityIcon(sev: "error" | "warning" | "info"): string {
  switch (sev) {
    case "error": return "⊘";
    case "warning": return "⚠";
    case "info": return "ℹ";
  }
}

function renderDiagnostics(diagnostics: PlaygroundDiagnostic[]) {
  const model = doofEditor.getModel();
  if (model) {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map((diagnostic) => ({
      severity: severityToMarker(diagnostic.severity),
      message: diagnostic.message,
      startLineNumber: diagnostic.startLine + 1,
      startColumn: diagnostic.startColumn + 1,
      endLineNumber: diagnostic.endLine + 1,
      endColumn: diagnostic.endColumn + 1,
    }));
    monaco.editor.setModelMarkers(model, "doof", markers);
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  errorCount.textContent = parts.length > 0 ? parts.join(", ") : "";

  if (diagnostics.length === 0) {
    errorList.innerHTML = '<div class="no-errors">No problems</div>';
    return;
  }

  errorList.innerHTML = diagnostics
    .map((diagnostic) => {
      const line = diagnostic.startLine + 1;
      const col = diagnostic.startColumn + 1;
      return `<div class="diagnostic-row" data-line="${diagnostic.startLine}" data-col="${diagnostic.startColumn}">
        <span class="diagnostic-icon ${diagnostic.severity}">${severityIcon(diagnostic.severity)}</span>
        <span class="diagnostic-location">${line}:${col}</span>
        <span class="diagnostic-message">${escapeHtml(diagnostic.message)}</span>
      </div>`;
    })
    .join("");

  errorList.querySelectorAll(".diagnostic-row").forEach((row) => {
    row.addEventListener("click", () => {
      const line = parseInt((row as HTMLElement).dataset.line ?? "0", 10) + 1;
      const col = parseInt((row as HTMLElement).dataset.col ?? "0", 10) + 1;
      doofEditor.revealLineInCenter(line);
      doofEditor.setPosition({ lineNumber: line, column: col });
      doofEditor.focus();
    });
  });
}

function hasCompileErrors(): boolean {
  return latestCompile.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function updateToolbarStatus() {
  statusEl.textContent = isRunning ? `${compileStatusText} • Running…` : compileStatusText;
}

function updateRunButton() {
  runButton.disabled = isRunning || hasCompileErrors();
  runButtonLabel.textContent = isRunning ? "Running…" : "Run";
}

function openRunPanel() {
  runPanel.classList.remove("is-hidden");
  runPanel.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => cppEditor.layout());
}

function closeRunPanel() {
  runPanel.classList.add("is-hidden");
  runPanel.setAttribute("aria-hidden", "true");
  requestAnimationFrame(() => cppEditor.layout());
}

function renderRunPanel(result: PlaygroundRunResult | null) {
  if (!result) {
    runStatus.textContent = "";
    runStatus.className = "panel-status";
    runOutput.innerHTML = '<div class="empty-output">Run the current source to capture build and program output.</div>';
    return;
  }

  const stale = lastRunSourceVersion !== null && lastRunSourceVersion !== sourceVersion;
  const exitSuffix = result.exitCode === null ? "" : ` • exit ${result.exitCode}`;
  const staleSuffix = stale ? " • stale" : "";
  runStatus.textContent = `${runStatusLabel(result.status)} • ${result.elapsedMs}ms${exitSuffix}${staleSuffix}`;
  runStatus.className = `panel-status ${result.status}`;

  const sections: string[] = [];
  appendOutputSection(sections, "Build Command", result.buildCommand, "command");
  appendOutputSection(sections, "Build Stdout", result.buildStdout);
  appendOutputSection(sections, "Build Stderr", result.buildStderr, "stderr");
  appendOutputSection(sections, "Run Command", result.runCommand, "command");
  appendOutputSection(sections, "Run Stdout", result.runStdout);
  appendOutputSection(sections, "Run Stderr", result.runStderr, "stderr");
  appendOutputSection(sections, "Summary", result.message);

  runOutput.innerHTML = sections.length > 0
    ? sections.join("")
    : '<div class="empty-output">No build or runtime output.</div>';
}

function renderCompileBlockedRun() {
  const diagnostics = latestCompile.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .slice(0, 10)
    .map((diagnostic) => `${diagnostic.startLine + 1}:${diagnostic.startColumn + 1} ${diagnostic.message}`)
    .join("\n");

  latestRun = {
    status: "compile-failed",
    message: "Fix compiler errors before running.",
    cpp: latestCompile.cpp,
    buildCommand: "",
    buildStdout: diagnostics,
    buildStderr: "",
    runCommand: "",
    runStdout: "",
    runStderr: "",
    exitCode: null,
    elapsedMs: 0,
  };
  lastRunSourceVersion = null;
  renderRunPanel(latestRun);
}

function appendOutputSection(
  sections: string[],
  title: string,
  content: string,
  kind: "output" | "command" | "stderr" = "output",
) {
  if (!content) {
    return;
  }

  sections.push(`<section class="output-section ${kind}"><span class="output-section-title">${escapeHtml(title)}</span><pre>${escapeHtml(content)}</pre></section>`);
}

function runStatusLabel(status: PlaygroundRunResult["status"]): string {
  switch (status) {
    case "succeeded":
      return "Succeeded";
    case "compile-failed":
      return "Compile Failed";
    case "build-failed":
      return "Build Failed";
    case "run-failed":
      return "Run Failed";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compile() {
  const source = doofEditor.getValue();
  compileStatusText = "Compiling…";
  updateToolbarStatus();

  try {
    const startedAt = performance.now();
    latestCompile = compileDoof(source);
    const elapsedMs = Math.round(performance.now() - startedAt);

    cppEditor.setValue(latestCompile.cpp);
    renderDiagnostics(latestCompile.diagnostics);

    compileStatusText = hasCompileErrors()
      ? `Compiled with errors (${elapsedMs}ms)`
      : `Compiled successfully (${elapsedMs}ms)`;
  } catch (error) {
    latestCompile = {
      cpp: "",
      diagnostics: [
        {
          severity: "error",
          message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
          startLine: 0,
          startColumn: 0,
          endLine: 0,
          endColumn: 0,
        },
      ],
    };
    cppEditor.setValue("");
    renderDiagnostics(latestCompile.diagnostics);
    compileStatusText = "Compilation crashed";
  }

  updateToolbarStatus();
  updateRunButton();
  renderRunPanel(latestRun);
}

async function runCurrentSource() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  compile();
  openRunPanel();

  if (hasCompileErrors()) {
    renderCompileBlockedRun();
    return;
  }

  if (activeRunController) {
    activeRunController.abort();
  }

  const controller = new AbortController();
  const requestSource = doofEditor.getValue();
  const requestSourceVersion = sourceVersion;

  activeRunController = controller;
  isRunning = true;
  updateToolbarStatus();
  updateRunButton();
  runStatus.textContent = "Running…";
  runStatus.className = "panel-status";
  runOutput.innerHTML = '<div class="empty-output">Building generated C++ and running the program…</div>';

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: requestSource }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Run request failed with status ${response.status}`);
    }

    const result = await response.json() as PlaygroundRunResult;
    latestRun = result;
    lastRunSourceVersion = requestSourceVersion;

    if (result.cpp && result.cpp !== latestCompile.cpp) {
      latestCompile = { ...latestCompile, cpp: result.cpp };
      cppEditor.setValue(result.cpp);
    }

    renderRunPanel(result);
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    latestRun = {
      status: "build-failed",
      message: error instanceof Error ? error.message : String(error),
      cpp: latestCompile.cpp,
      buildCommand: "",
      buildStdout: "",
      buildStderr: "",
      runCommand: "",
      runStdout: "",
      runStderr: "",
      exitCode: null,
      elapsedMs: 0,
    };
    lastRunSourceVersion = null;
    renderRunPanel(latestRun);
  } finally {
    if (activeRunController === controller) {
      activeRunController = null;
    }
    isRunning = false;
    updateToolbarStatus();
    updateRunButton();
  }
}

doofEditor.onDidChangeModelContent(() => {
  persistSource(doofEditor.getValue());
  sourceVersion += 1;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    compile();
  }, 300);
});

window.addEventListener("keydown", (event) => {
  if (!isRunShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void runCurrentSource();
});

runButton.addEventListener("click", () => {
  void runCurrentSource();
});

runPanelCloseButton.addEventListener("click", () => {
  closeRunPanel();
});

compile();
renderRunPanel(null);
updateRunButton();