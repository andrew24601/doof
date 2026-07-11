import { describe, expect, it } from "vitest";
import type { Expression, FunctionDeclaration, ClassDeclaration } from "./ast.js";
import type { ResolvedType } from "./checker-types.js";
import { check } from "./checker-test-helpers.js";
import { getUnsupportedDefaultExpressionReason } from "./default-expression.js";

interface DefaultSite {
  expression: Expression;
  contextType?: ResolvedType;
  diagnostics: string[];
}

function parameterDefault(source: string, functionName = "sample", parameterName = "value"): DefaultSite {
  const result = check({ "/main.do": source }, "/main.do");
  const declaration = result.program.statements.find((statement): statement is FunctionDeclaration =>
    statement.kind === "function-declaration" && statement.name === functionName,
  );
  const parameter = declaration?.params.find((candidate) => candidate.name === parameterName);
  if (!parameter?.defaultValue) throw new Error(`Expected default parameter ${functionName}.${parameterName}`);
  return {
    expression: parameter.defaultValue,
    contextType: parameter.resolvedType,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function fieldDefault(source: string, className: string, fieldName: string): DefaultSite {
  const result = check({ "/main.do": source }, "/main.do");
  const declaration = result.program.statements.find((statement): statement is ClassDeclaration =>
    statement.kind === "class-declaration" && statement.name === className,
  );
  const field = declaration?.fields.find((candidate) => candidate.names.includes(fieldName));
  if (!field?.defaultValue) throw new Error(`Expected default field ${className}.${fieldName}`);
  return {
    expression: field.defaultValue,
    contextType: field.resolvedType,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function methodDefault(source: string, className: string, methodName: string, parameterName: string): DefaultSite {
  const result = check({ "/main.do": source }, "/main.do");
  const declaration = result.program.statements.find((statement): statement is ClassDeclaration =>
    statement.kind === "class-declaration" && statement.name === className,
  );
  const method = declaration?.methods.find((candidate) => candidate.name === methodName);
  const parameter = method?.params.find((candidate) => candidate.name === parameterName);
  if (!parameter?.defaultValue) throw new Error(`Expected default parameter ${className}.${methodName}.${parameterName}`);
  return {
    expression: parameter.defaultValue,
    contextType: parameter.resolvedType,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function reason(site: DefaultSite): string | null {
  return getUnsupportedDefaultExpressionReason(site.expression, site.contextType);
}

describe("default expression validation", () => {
  it("accepts literal, enum, caller, and module-value defaults", () => {
    const source = `
      readonly LIMIT = 7
      enum Color { Red, Blue }

      function sample(
        intValue: int = 1,
        longValue: long = 1L,
        floatValue: float = 1.0f,
        doubleValue: double = 1.0,
        charValue: char = 'x',
        boolValue: bool = true,
        nullValue: string | null = null,
        text: string = "plain",
        source: SourceLocation = @caller,
        enumValue: Color = Color.Red,
        shorthand: Color = .Blue,
        moduleValue: int = LIMIT
      ): void {}
    `;

    for (const parameterName of [
      "intValue", "longValue", "floatValue", "doubleValue", "charValue", "boolValue",
      "nullValue", "text", "source", "enumValue", "shorthand", "moduleValue",
    ]) {
      const site = parameterDefault(source, "sample", parameterName);
      expect(site.diagnostics).toEqual([]);
      expect(reason(site)).toBeNull();
    }
  });

  it("reports identifier bindings that cannot be captured by defaults", () => {
    expect(reason(parameterDefault(
      `function sample(other: int, value: int = other): int => value`,
    ))).toBe('identifier "other" resolves to a parameter binding, which is not supported in parameter defaults');

    expect(reason(parameterDefault(
      `function sample(value: int = missing): int => value`,
    ))).toBe('identifier "missing" is unresolved');

    expect(reason(parameterDefault(
      `function helper(): int => 1
       function sample(value: int = helper): int => value`,
    ))).toBe('identifier "helper" resolves to a function binding, which is not supported in parameter defaults');

    expect(reason(parameterDefault(
      `class Widget { value: int }
       function sample(value: int = Widget): int => value`,
    ))).toBe('identifier "Widget" resolves to a class binding, which is not supported in parameter defaults');

    expect(reason(methodDefault(
      `class Config {
         value: int
         function method(other: int = value): void {}
       }`,
      "Config",
      "method",
      "other",
    ))).toBe('identifier "value" resolves to a field binding, which is not supported in parameter defaults');
  });

  it("accepts arrays, sets, and tuples while checking nested defaults", () => {
    const source = `
      class Point { x: int y: int }

      function sample(
        values: int[] = [1, -2],
        names: Set<string> = ["Ada", "Grace"],
        pair: Tuple<int, string> = (3, "three"),
        point: Point = (1, 2)
      ): void {}
    `;

    for (const parameterName of ["values", "names", "pair", "point"]) {
      const site = parameterDefault(source, "sample", parameterName);
      expect(site.diagnostics).toEqual([]);
      expect(reason(site)).toBeNull();
    }

    expect(reason(parameterDefault(
      `function sample(value: int = []): void {}`,
    ))).toBe("array defaults require an array or set parameter type");
    expect(reason(parameterDefault(
      `function sample(value: Tuple<int, string> = (1, "${"${missing}"}")): void {}`,
    ))).toBe('interpolated strings are not supported in parameter defaults');
    expect(reason(parameterDefault(
      `function sample(value: int[] = ["${"${missing}"}"]): void {}`,
    ))).toBe('interpolated strings are not supported in parameter defaults');
    expect(reason(parameterDefault(
      `class Point { x: int y: int }
       function sample(value: Point = (1, "${"${missing}"}")): void {}`,
    ))).toBe('interpolated strings are not supported in parameter defaults');
    expect(reason(parameterDefault(
      `function sample(value: int = (1, 2)): void {}`,
    ))).toBe("tuple defaults require a tuple, class, or struct parameter type");
    expect(reason(parameterDefault(
      `function sample(value: Set<float> = []): void {}`,
    ))).toBe('Set element type "float" is not supported; set elements must be byte, string, int, long, char, bool, or enum');
  });

  it("accepts constructor and static method calls, including named static args", () => {
    const source = `
      class Point {
        x: int
        y: int = 2

        static origin(x: int = 0, y: int = 0): Point => Point(x, y)
      }

      function sample(
        constructor: Point = Point(1),
        staticCall: Point = Point.origin(1),
        shorthandCall: Point = .origin(1),
        namedStaticCall: Point = Point.origin{ y: 4 }
      ): void {}
    `;

    for (const parameterName of ["constructor", "staticCall", "shorthandCall", "namedStaticCall"]) {
      const site = parameterDefault(source, "sample", parameterName);
      expect(site.diagnostics).toEqual([]);
      expect(reason(site)).toBeNull();
    }

    expect(reason(parameterDefault(
      `function make(): int => 1
       function sample(value: int = make()): void {}`,
    ))).toBe("only class/struct constructor calls and static class/struct method calls are supported in parameter defaults");

    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(value: Point = Point.origin(1)): void {}`,
    ))).toBe("only class/struct constructor calls and static class/struct method calls are supported in parameter defaults");
    expect(reason(parameterDefault(
      `class Point { x: int }
       function make(): Point => Point(1)
       function sample(value: int = make().x()): void {}`,
    ))).toBe("only class/struct constructor calls and static class/struct method calls are supported in parameter defaults");
    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(point: Point, value: int = point.x()): void {}`,
    ))).toBe("only class/struct constructor calls and static class/struct method calls are supported in parameter defaults");
    expect(reason(parameterDefault(
      `function sample(text: string, value: int = text.trim()): void {}`,
    ))).toBe("only class/struct constructor calls and static class/struct method calls are supported in parameter defaults");
    expect(reason(parameterDefault(
      `class Point {
         x: int
         static origin(x: int): Point => Point(x)
       }
       function sample(value: Point = Point.origin(1 + 2)): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(value: Point = Point(1 + 2)): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');
  });

  it("validates named and positional constructed defaults", () => {
    const source = `
      class Point { x: int y: int }
      struct Size { width: int height: int }

      function sample(
        namedPoint: Point = Point { x: 1, y: 2 },
        namedSize: Size = Size { width: 3, height: 4 }
      ): void {}
    `;

    for (const parameterName of ["namedPoint", "namedSize"]) {
      const site = parameterDefault(source, "sample", parameterName);
      expect(site.diagnostics).toEqual([]);
      expect(reason(site)).toBeNull();
    }

    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(value: int = Missing { x: 1 }): void {}`,
    ))).toBe('constructed default "Missing" requires a class or struct parameter type');

    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(x: int, value: Point = Point { x }): void {}`,
    ))).toBe('shorthand property "x" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(value: Point = Point { x: 1 + 2 }): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');

    expect(reason(parameterDefault(
      `class Box<T> { value: T }
       function sample(value: Box<int> = Box<int>(1)): void {}`,
    ))).toBeNull();
  });

  it("validates unary, object, and map defaults", () => {
    const source = `
      class Point { x: int y: int }

      function sample(
        negative: int = -1,
        positive: int = +1,
        object: Point = { x: 1, y: 2 },
        emptyMap: Map<string, int> = {},
        map: Map<int, string> = { [1]: "one" }
      ): void {}
    `;

    for (const parameterName of ["negative", "positive", "object", "emptyMap", "map"]) {
      const site = parameterDefault(source, "sample", parameterName);
      expect(site.diagnostics).toEqual([]);
      expect(reason(site)).toBeNull();
    }

    expect(reason(parameterDefault(
      `function sample(value: bool = !true): void {}`,
    ))).toBe('unary operator "!" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `function sample(value: int = {}): void {}`,
    ))).toBe("object defaults require a class or struct parameter type or an empty map default");
    expect(reason(parameterDefault(
      `class Point { x: int y: int }
       function sample(value: Point = { x: 1 + 2, y: 3 }): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(base: Point, value: Point = { ...base }): void {}`,
    ))).toBe("object spread is not supported in parameter defaults");
    expect(reason(parameterDefault(
      `class Point { x: int }
       function sample(x: int, value: Point = { x }): void {}`,
    ))).toBe('shorthand property "x" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `function sample(value: int = { [1]: 2 }): void {}`,
    ))).toBe("map defaults require a map parameter type");
    expect(reason(parameterDefault(
      `function sample(value: Map<float, int> = {}): void {}`,
    ))).toBe('Map key type "float" is not supported; map keys must be byte, string, int, long, char, bool, or enum');
    expect(reason(parameterDefault(
      `function sample(value: Map<float, int> = { [1.0]: 2 }): void {}`,
    ))).toBe('Map key type "float" is not supported; map keys must be byte, string, int, long, char, bool, or enum');
    expect(reason(parameterDefault(
      `function sample(value: Map<int, string> = { [1 + 2]: "ok" }): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');
    expect(reason(parameterDefault(
      `function sample(value: Map<int, int> = { [1]: 1 + 2 }): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');
  });

  it("rejects unsupported nested expressions and preserves recursive diagnostics", () => {
    expect(reason(parameterDefault(
      `function sample(value: int = 1 + 2): void {}`,
    ))).toBe('expression kind "binary-expression" is not supported in parameter defaults');

    expect(reason(parameterDefault(
      `function sample(value: int = .missing): void {}`,
    ))).toBe('dot shorthand ".missing" is unresolved');

    expect(reason(parameterDefault(
      `class Defaults { static readonly value = 1 }
       function sample(value: int = Defaults.value): void {}`,
    ))).toBe('expression kind "member-expression" is not supported in parameter defaults');
  });
});
