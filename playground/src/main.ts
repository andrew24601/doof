/**
 * Doof Playground — main entry point.
 *
 * Sets up two Monaco editors (Doof source ↔ C++ output), wires up the
 * compiler pipeline with debounced recompilation, and renders diagnostics
 * in the bottom panel with error markers in the Doof editor.
 */

import * as monaco from "monaco-editor";

// Monaco workers — Vite handles these via import.meta.url
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

import { registerDoofLanguage } from "./doof-language";
import { compileDoof, type PlaygroundDiagnostic } from "./compiler";

// ============================================================================
// Monaco worker setup
// ============================================================================

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// ============================================================================
// Default sample code
// ============================================================================

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

// ============================================================================
// Initialize
// ============================================================================

// Register Doof language before creating editors
registerDoofLanguage();

// Grab DOM elements
const doofContainer = document.getElementById("doof-editor")!;
const cppContainer = document.getElementById("cpp-editor")!;
const errorList = document.getElementById("error-list")!;
const errorCount = document.getElementById("error-count")!;
const statusEl = document.getElementById("status")!;

// ---- Doof editor (left) ----
const doofEditor = monaco.editor.create(doofContainer, {
  value: DEFAULT_SOURCE,
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

// ---- C++ editor (right, read-only) ----
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

// ============================================================================
// Compilation & diagnostics
// ============================================================================

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
  // Set Monaco markers on the Doof model
  const model = doofEditor.getModel();
  if (model) {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
      severity: severityToMarker(d.severity),
      message: d.message,
      // Monaco uses 1-based lines/columns; our diagnostics are 0-based
      startLineNumber: d.startLine + 1,
      startColumn: d.startColumn + 1,
      endLineNumber: d.endLine + 1,
      endColumn: d.endColumn + 1,
    }));
    monaco.editor.setModelMarkers(model, "doof", markers);
  }

  // Update the error panel
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
  errorCount.textContent = parts.length > 0 ? parts.join(", ") : "";

  if (diagnostics.length === 0) {
    errorList.innerHTML = '<div class="no-errors">No problems</div>';
    return;
  }

  errorList.innerHTML = diagnostics
    .map((d) => {
      const line = d.startLine + 1;
      const col = d.startColumn + 1;
      return `<div class="diagnostic-row" data-line="${d.startLine}" data-col="${d.startColumn}">
        <span class="diagnostic-icon ${d.severity}">${severityIcon(d.severity)}</span>
        <span class="diagnostic-location">${line}:${col}</span>
        <span class="diagnostic-message">${escapeHtml(d.message)}</span>
      </div>`;
    })
    .join("");

  // Click to navigate to error location
  errorList.querySelectorAll(".diagnostic-row").forEach((row) => {
    row.addEventListener("click", () => {
      const line = parseInt((row as HTMLElement).dataset.line ?? "0") + 1;
      const col = parseInt((row as HTMLElement).dataset.col ?? "0") + 1;
      doofEditor.revealLineInCenter(line);
      doofEditor.setPosition({ lineNumber: line, column: col });
      doofEditor.focus();
    });
  });
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
  statusEl.textContent = "Compiling…";

  try {
    const t0 = performance.now();
    const result = compileDoof(source);
    const elapsed = Math.round(performance.now() - t0);

    cppEditor.setValue(result.cpp);
    renderDiagnostics(result.diagnostics);

    const hasErrors = result.diagnostics.some((d) => d.severity === "error");
    statusEl.textContent = hasErrors
      ? `Compiled with errors (${elapsed}ms)`
      : `Compiled successfully (${elapsed}ms)`;
  } catch (e) {
    statusEl.textContent = "Compilation crashed";
    renderDiagnostics([
      {
        severity: "error",
        message: `Internal error: ${e instanceof Error ? e.message : String(e)}`,
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
      },
    ]);
  }
}

// ============================================================================
// Debounced recompilation on edit
// ============================================================================

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

doofEditor.onDidChangeModelContent(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(compile, 300);
});

// Initial compile
compile();
