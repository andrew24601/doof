import type { SourceSpan } from "./ast.js";
import {
  BOOL_TYPE,
  STRING_TYPE,
  type EnumType,
  type ModuleTypeInfo,
  NULL_TYPE,
  type ResolvedType,
  typesEqual,
  typeToString,
  UNKNOWN_TYPE,
} from "./checker-types.js";
import type { ModuleSymbolTable } from "./types.js";

export function inferBinaryType(
  op: string,
  left: ResolvedType,
  right: ResolvedType,
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
): ResolvedType {
  if (["==", "!=", "<", "<=", ">", ">="].includes(op)) return BOOL_TYPE;
  if (op === "&&" || op === "||") {
    if (left.kind !== "unknown" && !(left.kind === "primitive" && left.name === "bool")) {
      info.diagnostics.push({
        severity: "error",
        message: `Operator "${op}" requires bool operands, got "${typeToString(left)}"`,
        span,
        module: table.path,
      });
    }
    if (right.kind !== "unknown" && !(right.kind === "primitive" && right.name === "bool")) {
      info.diagnostics.push({
        severity: "error",
        message: `Operator "${op}" requires bool operands, got "${typeToString(right)}"`,
        span,
        module: table.path,
      });
    }
    return BOOL_TYPE;
  }
  if (op === "??") return inferNullCoalescingType(left, right);
  if (
    op === "+" &&
    ((left.kind === "primitive" && left.name === "string") ||
      (right.kind === "primitive" && right.name === "string"))
  ) {
    return STRING_TYPE;
  }
  if (left.kind === "primitive" && right.kind === "primitive") {
    const numOps = ["+", "-", "*", "/", "\\", "%", "**", "&", "|", "^", "<<", ">>", ">>>"];
    if (numOps.includes(op)) {
      const numericTypes = new Set(["int", "long", "float", "double"]);
      const integerTypes = new Set(["int", "long"]);
      if (!numericTypes.has(left.name)) {
        info.diagnostics.push({
          severity: "error",
          message: `Operator "${op}" cannot be applied to type "${typeToString(left)}"`,
          span,
          module: table.path,
        });
      }
      if (!numericTypes.has(right.name)) {
        info.diagnostics.push({
          severity: "error",
          message: `Operator "${op}" cannot be applied to type "${typeToString(right)}"`,
          span,
          module: table.path,
        });
      }
      if (op === "/" && integerTypes.has(left.name) && integerTypes.has(right.name)) {
        info.diagnostics.push({
          severity: "error",
          message: "Operator \"/\" cannot be applied to two integer operands; use \"\\\" for integer division or cast to float/double",
          span,
          module: table.path,
        });
      }
      if (op === "\\" && numericTypes.has(left.name) && numericTypes.has(right.name)) {
        if (!integerTypes.has(left.name) || !integerTypes.has(right.name)) {
          info.diagnostics.push({
            severity: "error",
            message: `Operator "\\" requires integer operands, got "${typeToString(left)}" and "${typeToString(right)}"`,
            span,
            module: table.path,
          });
        }
      }
      if (op === "%" && numericTypes.has(left.name) && numericTypes.has(right.name)) {
        if (!integerTypes.has(left.name) || !integerTypes.has(right.name)) {
          info.diagnostics.push({
            severity: "error",
            message: `Operator "%" requires integer operands, got "${typeToString(left)}" and "${typeToString(right)}"`,
            span,
            module: table.path,
          });
        }
      }
    }
    if (op === "\\") {
      const intOrder = ["int", "long"];
      const ai = intOrder.indexOf(left.name);
      const bi = intOrder.indexOf(right.name);
      if (ai >= 0 && bi >= 0) {
        const wider = intOrder[Math.max(ai, bi)];
        return { kind: "primitive", name: wider as "int" | "long" };
      }
      return UNKNOWN_TYPE;
    }
    return widenNumeric(left.name, right.name);
  }
  return left;
}

export function inferUnaryType(
  op: string,
  operand: ResolvedType,
  info: ModuleTypeInfo,
  table: ModuleSymbolTable,
  span: SourceSpan,
): ResolvedType {
  if (op === "!") return BOOL_TYPE;
  if (op === "try!" || op === "try?") {
    if (operand.kind === "unknown") return UNKNOWN_TYPE;
    if (operand.kind !== "result") {
      info.diagnostics.push({
        severity: "error",
        message: `"${op}" can only be applied to a Result type, but got "${typeToString(operand)}"`,
        span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }
    if (op === "try!") return operand.successType;
    if (operand.successType.kind === "void") {
      info.diagnostics.push({
        severity: "error",
        message: '"try?" is not supported on Result<void, E> because there is no success value to convert to null',
        span,
        module: table.path,
      });
      return UNKNOWN_TYPE;
    }
    return { kind: "union", types: [operand.successType, NULL_TYPE] };
  }
  return operand;
}

export function widenNumeric(a: string, b: string): ResolvedType {
  const order = ["int", "long", "float", "double"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai < 0 || bi < 0) return UNKNOWN_TYPE;
  const wider = order[Math.max(ai, bi)];
  return { kind: "primitive", name: wider as "int" | "long" | "float" | "double" };
}

export function resolveExpectedEnumType(type?: ResolvedType): EnumType | undefined {
  if (!type) return undefined;
  if (type.kind === "enum") return type;
  if (type.kind === "union") {
    const enumTypes = type.types.filter((member): member is EnumType => member.kind === "enum");
    if (enumTypes.length === 1) return enumTypes[0];
  }
  return undefined;
}

export function inferNullCoalescingType(left: ResolvedType, right: ResolvedType): ResolvedType {
  if (left.kind === "null") return right;
  if (left.kind !== "union") return left;

  const nonNullTypes = left.types.filter((type) => type.kind !== "null");
  if (nonNullTypes.length === left.types.length) return left;
  if (nonNullTypes.length === 0) return right;

  const combinedTypes: ResolvedType[] = [];
  const pushUnique = (type: ResolvedType) => {
    if (!combinedTypes.some((existing) => typesEqual(existing, type))) {
      combinedTypes.push(type);
    }
  };

  for (const type of nonNullTypes) pushUnique(type);
  if (right.kind === "union") {
    for (const type of right.types) pushUnique(type);
  } else {
    pushUnique(right);
  }

  return combinedTypes.length === 1 ? combinedTypes[0] : { kind: "union", types: combinedTypes };
}