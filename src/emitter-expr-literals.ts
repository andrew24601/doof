/**
 * C++ literal emission — formatting for primitive literals, string interpolation,
 * and identifier sanitisation.
 */

import type { StringLiteral } from "./ast.js";
import type { EmitContext } from "./emitter-context.js";
import { emitExpression } from "./emitter-expr.js";

// ============================================================================
// Numeric literal formatting
// ============================================================================

export function formatFloat(value: number): string {
  const s = String(value);
  if (s.includes(".")) return s + "f";
  return s + ".0f";
}

export function formatDouble(value: number): string {
  const s = String(value);
  if (s.includes(".")) return s;
  return s + ".0";
}

// ============================================================================
// Character / string escaping
// ============================================================================

export function escapeChar(ch: string): string {
  switch (ch) {
    case "'": return "\\'";
    case "\\": return "\\\\";
    case "\n": return "\\n";
    case "\t": return "\\t";
    case "\r": return "\\r";
    case "\0": return "\\0";
    default: return ch;
  }
}

export function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

// ============================================================================
// String literals (with interpolation support)
// ============================================================================

export function emitStringLiteral(expr: StringLiteral, ctx: EmitContext): string {
  // Simple string without interpolation
  if (expr.parts.length === 0 || (expr.parts.length === 1 && typeof expr.parts[0] === "string")) {
    return `std::string("${escapeString(expr.value)}")`;
  }

  // Interpolated string → doof::concat(...)
  const parts: string[] = [];
  for (const part of expr.parts) {
    if (typeof part === "string") {
      if (part.length > 0) {
        parts.push(`"${escapeString(part)}"`);
      }
    } else {
      parts.push(`doof::to_string(${emitExpression(part, ctx)})`);
    }
  }
  if (parts.length === 1) return parts[0];
  return `doof::concat(${parts.join(", ")})`;
}

// ============================================================================
// Identifiers
// ============================================================================

/** C++ reserved words that need escaping. */
const CPP_RESERVED = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor",
  "bool", "break", "case", "catch", "char", "char8_t", "char16_t", "char32_t",
  "class", "compl", "concept", "const", "consteval", "constexpr", "constinit",
  "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype",
  "default", "delete", "do", "double", "dynamic_cast", "else", "enum",
  "explicit", "export", "extern", "false", "float", "for", "friend", "goto",
  "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept",
  "not", "not_eq", "nullptr", "operator", "or", "or_eq", "private",
  "protected", "public", "register", "reinterpret_cast", "requires", "return",
  "short", "signed", "sizeof", "static", "static_assert", "static_cast",
  "struct", "switch", "template", "this", "thread_local", "throw", "true",
  "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
  "virtual", "void", "volatile", "wchar_t", "while", "xor", "xor_eq",
]);

export function emitIdentifierSafe(name: string): string {
  if (CPP_RESERVED.has(name)) return name + "_";
  return name;
}
