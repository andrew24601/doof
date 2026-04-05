/**
 * Shared helpers for analyzer test suites.
 */
import { ModuleAnalyzer } from "./analyzer.js";
import { createBundledModuleResolver, withBundledStdlib } from "./stdlib.js";
import { VirtualFS } from "./test-helpers.js";
import type { ModuleSymbolTable } from "./types.js";
import type { NamedType, TypeAnnotation, Statement, Program } from "./ast.js";

/** Collect all NamedType nodes from AST type annotations. */
export function collectNamedTypes(program: Program): NamedType[] {
  const types: NamedType[] = [];

  function walkType(t: TypeAnnotation): void {
    switch (t.kind) {
      case "named-type": types.push(t); t.typeArgs.forEach(walkType); break;
      case "array-type": walkType(t.elementType); break;
      case "union-type": t.types.forEach(walkType); break;
      case "function-type":
        t.params.forEach((p) => walkType(p.type));
        walkType(t.returnType);
        break;
      case "tuple-type": t.elements.forEach(walkType); break;
      case "weak-type": walkType(t.type); break;
    }
  }

  function walkStmt(s: Statement): void {
    switch (s.kind) {
      case "function-declaration":
        s.params.forEach((p) => { if (p.type) walkType(p.type); });
        if (s.returnType) walkType(s.returnType);
        break;
      case "class-declaration":
        s.fields.forEach((f) => { if (f.type) walkType(f.type); });
        s.methods.forEach((m) => {
          m.params.forEach((p) => { if (p.type) walkType(p.type); });
          if (m.returnType) walkType(m.returnType);
        });
        break;
      case "interface-declaration":
        s.fields.forEach((f) => walkType(f.type));
        s.methods.forEach((m) => {
          m.params.forEach((p) => { if (p.type) walkType(p.type); });
          walkType(m.returnType);
        });
        break;
      case "type-alias-declaration": walkType(s.type); break;
      case "const-declaration": case "readonly-declaration":
      case "immutable-binding": case "let-declaration":
        if (s.type) walkType(s.type); break;
      case "export-declaration": walkStmt(s.declaration); break;
    }
  }

  program.statements.forEach(walkStmt);
  return types;
}

export function analyze(files: Record<string, string>, entry: string) {
  const fs = new VirtualFS(files);
  const resolver = createBundledModuleResolver(fs);
  const analyzer = new ModuleAnalyzer(withBundledStdlib(fs), resolver);
  return analyzer.analyzeModule(entry);
}

export function getTable(files: Record<string, string>, entry: string): ModuleSymbolTable {
  const result = analyze(files, entry);
  const table = result.modules.get(entry);
  if (!table) throw new Error(`No table for ${entry}`);
  return table;
}
