import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "./checker-test-helpers.js";

interface CodeBlock {
  language: string;
  code: string;
}

interface VerificationCase {
  blockNumber: number;
  label: string;
  expectSuccess: boolean;
  source: string;
}

interface CheckOutcome {
  errors: Array<{ message: string; module?: string; span?: { start: { line: number; column: number } } }>;
}

const SPEC_PATH = path.resolve(process.cwd(), "spec/02-type-system.md");
const SPEC_MARKDOWN = fs.readFileSync(SPEC_PATH, "utf8");
const BLOCKS = extractCodeBlocks(SPEC_MARKDOWN);

const BLOCK_PRELUDES: Record<number, string> = {
  6: `enum ParseError { InvalidFormat, Overflow, Underflow, EmptyInput }`,
  25: `
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200, NoContent = 204 }
enum LogLevel { Debug = "DEBUG" }
`,
  27: `
enum Direction { North, South, East, West }
function moveUp(): void { }
function moveDown(): void { }
function moveRight(): void { }
function moveLeft(): void { }
`,
  28: `enum Direction { North, South, East, West }`,
  29: `
enum HttpStatus { OK = 200 }
enum LogLevel { Debug = "DEBUG" }
`,
  30: `
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200 }
enum LogLevel { Debug = "DEBUG" }
`,
  31: `
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200, NoContent = 204 }
`,
  53: `class Point { x, y: float }`,
  67: `
class Success {
  const kind = "Success"
  value: int
}

class Failure {
  const kind = "Failure"
  error: string
}
`,
  63: `
class Widget { }
class Panel { }
`,
};

const BLOCK_OVERRIDES: Record<number, (raw: string) => VerificationCase[]> = {
  2: () => [
    makeCase(2, "default numeric literal types", true, `
let intValue = 42
let longValue = 42L
let doubleValue = 3.14
let floatValue = 3.14f
let groupedInt = 30_000
let groupedDouble = 3.141_59
`),
    makeCase(2, "contextual literal interpretation", true, `
let byteValue: byte = 42
let longValue: long = 42
let floatValue: float = 3.14
`),
  ],
  3: () => [
    makeCase(3, "byte to int widening", true, `
let b: byte = 42
let i: int = b
`),
    makeCase(3, "int to long widening", true, `
let i: int = 42
let l: long = i
`),
    makeCase(3, "float to double widening", true, `
let f: float = 3.14f
let d: double = f
`),
    makeCase(3, "long to int narrowing fails", false, `
let l: long = 1000L
let i: int = l
`),
    makeCase(3, "int to byte narrowing fails", false, `
let i: int = 255
let b: byte = i
`),
  ],
  4: () => [
    makeCase(4, "explicit numeric casts compile", true, `
let sourceInt: int = 42
let asByte: byte = byte(sourceInt)
let asFloat: float = float(sourceInt)
let asDouble: double = double(sourceInt)
let truncated: int = int(3.14)
let asLong: long = long(sourceInt)
`),
    makeCase(4, "integer division guidance example compiles", true, `
a := 7
b := 2
result := float(a) / float(b)
`),
  ],
  10: () => [
    makeSourceCase(10, "non-null assertion in argument position", true, `
function greet(name: string): void { }

function main(): void {
  name: string | null := "Alice"
  println(name!)
  greet(name!)
}
`),
    makeSourceCase(10, "force-unwrapped member access", true, `
class Node {
  next: Node | null = null
  value: int = 0
}

function test(node: Node): int {
  return node.next!.value
}
`),
  ],
  9: () => [
    makeCase(9, "array property and mutable methods compile", true, `
nums := [1, 2, 3, 4]
nums.push(5)
popped := nums.pop()
last := case popped {
  s: Success -> s.value,
  _: Failure -> -1,
}
tail := nums.slice(1, 3)
hasTwo := nums.contains(2)
`),
    makeCase(9, "buildReadonly pattern compiles", true, `
let builder: int[] = []
builder.push(1)
builder.push(2)
result := builder.buildReadonly()
`),
    makeCase(9, "typed readonly local array example", true, `
let frozen: readonly int[] = [1, 2, 3]
  copy := frozen.cloneMutable()
copy.push(4)
`),
  ],
  11: () => [
    makeCase(11, "basic inference from initializers", true, `
let x = 42
let y = 3.14
let names = ["Alice", "Bob"]
let point = Point(1.0, 2.0)
scores: Map := { "Alice": 100 }
unique: Set := [1, 2, 3]
`, `class Point { x, y: float }`),
    makeCase(11, "empty array inference is currently accepted", true, `let empty = []`),
    makeCase(11, "annotated empty array works", true, `let nums: int[] = []`),
    makeCase(11, "empty map inference fails", false, `m: Map := {}`),
    makeCase(11, "empty set inference fails", false, `s: Set := []`),
    makeCase(11, "null inference is currently accepted", true, `let x = null`),
    makeCase(11, "annotated null works", true, `let x: int | null = null`),
  ],
  12: () => [
    makeCase(12, "argument and array inference", true, `
function process(items: int[]): void { }
process([1, 2, 3])

let nums = [1, 2, 3]
process(nums)
`),
    makeCase(12, "contextual object and positional construction", true, `
function draw(p: Point): void { }
draw({ x: 1.0, y: 2.0 })
draw((1.0, 2.0))
`, `class Point { x, y: float }`),
    makeCase(12, "explicit annotation provides context", true, `
let p: Point = { x: 1.0, y: 2.0 }
`, `class Point { x, y: float }`),
    makeCase(12, "object literal without context fails", false, `
let q = { x: 1.0, y: 2.0 }
`, `class Point { x, y: float }`),
  ],
  13: () => [
    makeCase(13, "contextual numeric narrowing works", true, `
let d = 0.0
let i = 42
let p = Point(0.0, 0.0)
p2 := Point { x: 0.0, y: 0.0 }
x: float := 3.14
n: long := 42
f: float := 1
`, `class Point { x, y: float }`),
  ],
  14: () => [
    makeCase(14, "context flows into array literals", true, `
points: Point[] := [{ x: 1.0, y: 2.0 }, { x: 3.0, y: 4.0 }]
points2: Point[] := [(1.0, 2.0), (3.0, 4.0)]
`, `class Point { x, y: float }`),
    makeCase(14, "context flows through function arguments", true, `
function process(points: Point[]): void { }
process([{ x: 0.0, y: 0.0 }])
`, `class Point { x, y: float }`),
    makeCase(14, "context flows through push and array methods", true, `
let verts: Point[] = []
verts.push({ x: 1.0, y: 2.0 })
verts.push((3.0, 4.0))

nums := [1, 2, 3, 4]
tail := nums.slice(1, 3)
hasTwo := nums.contains(2)
`, `class Point { x, y: float }`),
  ],
  15: () => [
    makeCase(15, "immutable binding keeps mutable array", true, `
items := [1, 2, 3]
items.push(4)
`),
    makeCase(15, "immutable binding cannot be reassigned", false, `
items := [1, 2, 3]
items = [5, 6]
`),
    makeCase(15, "let binding remains mutable", true, `
let buffer = [1, 2, 3]
buffer.push(4)
buffer = [5, 6]
`),
    makeCase(15, "readonly array rejects mutation", false, `
readonly frozen = [1, 2, 3]
frozen.push(4)
`),
    makeCase(15, "readonly binding rejects reassignment", false, `
readonly frozen = [1, 2, 3]
frozen = [5, 6]
`),
    makeCase(15, "readonly literal rejects push", false, `
data := readonly [1, 2, 3]
data.push(4)
`),
    makeCase(15, "explicit type overrides inference", true, `
explicit: int[] := [1, 2, 3]
`),
  ],
  16: () => [
    makeSourceCase(16, "unambiguous return type infers", true, `
function double(x: int) => x * 2
`),
    makeSourceCase(16, "mixed return types without annotation fail", false, `
function choose(flag: bool) {
  if flag {
    return 1
  }
  return "hello"
}
`),
    makeSourceCase(16, "explicit return annotation resolves ambiguity", true, `
function clarified(flag: bool): int | string {
  if flag {
    return 1
  }
  return "hello"
}
`),
  ],
  17: () => [
    makeCase(17, "non-nullable int rejects null", false, `let x: int = null`),
    makeCase(17, "nullable int accepts null", true, `let y: int | null = null`),
  ],
  18: () => [
    makeCase(18, "required nullable field must still be provided", true, `
let u1 = User { name: "Alice", email: null }
let u2 = User { name: "Bob", email: "bob@example.com" }
let u4 = User { name: "Alice", email: null, nickname: "Ali" }
`, `
class User {
  name: string
  email: string | null
  nickname: string | null = null
}
`),
    makeCase(18, "missing required nullable field fails", false, `
let u3 = User { name: "Charlie" }
`, `
class User {
  name: string
  email: string | null
  nickname: string | null = null
}
`),
  ],
  19: () => [
    makeSourceCase(19, "explicit non-null assertion after null check works", true, `
function safeLengthV1(s: string | null): int {
  if s == null {
    return 0
  }
  return s!.length
}
`),
    makeSourceCase(19, "declaration-else narrowing works", true, `
function safeLengthV2(s: string | null): int {
  value := s else { return 0 }
  return value.length
}
`),
  ],
  20: () => [
    makeSourceCase(20, "union assignments stay within members", true, `
type Value = int | string | bool
type Optional<T> = T | null

function main(): void {
  let x: int | string = 42
  x = "hello"
}
`),
    makeSourceCase(20, "assignment outside union fails", false, `
type Value = int | string | bool
type Optional<T> = T | null

function main(): void {
  let x: int | string = 42
  x = true
}
`),
  ],
  26: () => [
    makeSourceCase(26, "enum shorthand uses contextual type", true, `
enum Direction { North, South, East, West }
enum LogLevel { Debug = "DEBUG", Info = "INFO", Warn = "WARN", Error = "ERROR" }

function move(dir: Direction): void { }
function getLevel(): LogLevel {
  return .Info
}

function main(): void {
  let c: Direction = .East
  let level: LogLevel = .Warn
  move(.North)
  getLevel()
}
`),
  ],
  30: () => [
    makeSourceCase(30, "enum values and fromName compile", true, `
enum Direction { North, South, East, West }
enum HttpStatus { OK = 200 }
enum LogLevel { Debug = "DEBUG" }

function main(): void {
  Direction.values()
  Direction.fromName("North")
  HttpStatus.fromValue(200)
}
`),
  ],
  35: () => [
    makeCase(35, "nominal classes reject structurally identical types", false, `
let p: Point = Vector { x: 1.0, y: 2.0 }
`, `
class Point {
  readonly x: float
  readonly y: float
}

class Vector {
  readonly x: float
  readonly y: float
}
`),
    makeCase(35, "matching nominal constructor works", true, `
let p: Point = Point { x: 1.0, y: 2.0 }
`, `
class Point {
  readonly x: float
  readonly y: float
}

class Vector {
  readonly x: float
  readonly y: float
}
`),
  ],
  37: () => [
    makeSourceCase(37, "explicit interface implementation validates", true, `
interface Thing2D {
  readonly x: float
  readonly y: float
}

class Point implements Thing2D {
  readonly x: float
  readonly y: float
}
`),
    makeSourceCase(37, "mismatched explicit implementation fails", false, `
interface Thing2D {
  readonly x: float
  readonly y: float
}

class BadPoint implements Thing2D {
  x: float
  readonly y: float
}
`),
  ],
  38: () => [
    makeSourceCase(38, "ambiguous interface construction fails", false, `
interface Positioned {
  readonly x: float
  readonly y: float
}

class Point {
  readonly x: float
  readonly y: float
}

class Vector {
  readonly x: float
  readonly y: float
}

function main(): void {
  let p: Positioned = { x: 1.0, y: 2.0 }
}
`),
    makeSourceCase(38, "explicit constructors disambiguate", true, `
interface Positioned {
  readonly x: float
  readonly y: float
}

class Point {
  readonly x: float
  readonly y: float
}

class Vector {
  readonly x: float
  readonly y: float
}

function main(): void {
  let p: Positioned = Point { x: 1.0, y: 2.0 }
  let v: Positioned = Vector { x: 1.0, y: 2.0 }
}
`),
  ],
  39: () => [
    makeSourceCase(39, "explicit constructors build discriminated unions", true, `
class Success {
  const kind = "Success"
  value: int
}

class Failure {
  const kind = "Failure"
  error: string
}

type Result = Success | Failure

function show(r: Result): void {
  case r {
    s: Success -> print(s.value)
    _: Failure -> print("unexpected")
  }
}

function main(): void {
  show(Success { value: 42 })
  show(Failure { error: "timeout" })
}
`),
  ],
  40: () => [
    makeCase(40, "generic collection literals compile", true, `
let nums: int[] = [1, 2, 3]
let matrix: int[][] = [[1, 2], [3, 4]]
let scores: Map<string, int> = { "Alice": 100, "Bob": 95 }
let unique: Set<int> = [1, 2, 3, 2, 1]
`),
    makeCase(40, "readonly array surface rejects writes", false, `
readonly immutable: readonly string[] = ["a", "b", "c"]
immutable[0] = "x"
`),
  ],
  42: () => [
    makeCase(42, "bare Map inference compiles", true, `
scores: Map := { "Alice": 100, "Bob": 95 }
`),
    makeCase(42, "bare ReadonlyMap inference compiles", true, `
scores: ReadonlyMap := { "Alice": 100 }
`),
    makeCase(42, "readonly Map shorthand compiles", true, `
  let scores: readonly Map<string, int> = { "Alice": 100 }
`),
    makeCase(42, "explicit Map type compiles", true, `
  let scores: Map<string, int> = { "Alice": 100 }
`),
  ],
  47: () => [
    makeCase(47, "Set literal examples compile", true, `
enum Color { Red, Blue }

let unique: Set<int> = [1, 2, 3, 2, 1]
let empty: Set<string> = []
let palette: Set<Color> = [Color.Red, Color.Blue, Color.Red]
let ids: Set<long> = [1, 2, 3]
unique2: Set := [1, 2, 3]
frozen: ReadonlySet := [1, 2, 3]
`),
    makeCase(47, "readonly Set shorthand compiles", true, `
let frozen2: readonly Set<int> = [1, 2, 3]
`),
  ],
  48: () => [
    makeCase(48, "same-site set inference compiles", true, `
unique: Set := [1, 2, 3]
frozen: ReadonlySet := [1, 2, 3]
let unique2: Set<int> = [1, 2, 3]
`),
    makeCase(48, "empty bare set inference fails", false, `
empty: Set := []
`),
  ],
  54: () => [
    makeSourceCase(54, "divmod tuple example compiles", true, `
function divmod(a: int, b: int): Tuple<int, int> {
  return (a \\ b, a % b)
}

function main(): void {
  (quotient, remainder) := divmod(17, 5)
  let (q, r) = divmod(17, 5)
  q = 0
}
`),
    makeSourceCase(54, "partial tuple destructuring compiles", true, `
function getRecord(): Tuple<int, string, bool> {
  return (1, "Alice", true)
}

function main(): void {
  (id, name) := getRecord()
}
`),
  ],
  58: () => [
    makeCase(58, "shallow immutable binding still allows collection mutation", true, `
data := [1, 2, 3]
data.push(4)
`),
    makeCase(58, "shallow immutable binding rejects rebinding", false, `
data := [1, 2, 3]
data = [5, 6]
`),
    makeCase(58, "readonly binding rejects array mutation", false, `
readonly frozen = [1, 2, 3]
frozen.push(4)
`),
    makeCase(58, "readonly binding rejects rebinding", false, `
readonly frozen = [1, 2, 3]
frozen = [5, 6]
`),
    makeCase(58, "readonly collection annotation remains shallow for elements", true, `
let points: readonly MutablePoint[] = readonly [MutablePoint { x: 1.0, y: 2.0 }]
points[0].x = 2.0
`, `
class MutablePoint {
  x: float
  y: float
}
`),
    makeCase(58, "readonly collection surface rejects push", false, `
let points: readonly MutablePoint[] = readonly [MutablePoint { x: 1.0, y: 2.0 }]
points.push(MutablePoint { x: 3.0, y: 4.0 })
`, `
class MutablePoint {
  x: float
  y: float
}
`),
  ],
  59: () => [
    makeCase(59, "deeply readonly-compatible class can back readonly binding", true, `
readonly p1 = ImmutablePoint { x: 1.0, y: 2.0 }
`, `
class ImmutablePoint {
  readonly x: float
  readonly y: float
}

class MutablePoint {
  x: float
  y: float
}
`),
    makeCase(59, "mutable class cannot back readonly binding", false, `
readonly p2 = MutablePoint { x: 1.0, y: 2.0 }
`, `
class ImmutablePoint {
  readonly x: float
  readonly y: float
}

class MutablePoint {
  x: float
  y: float
}
`),
  ],
  60: () => [
    makeSourceCase(60, "readonly-compatible fields compile", true, `
class Container {
  readonly items: int[]
  readonly count: int
}
`),
    makeSourceCase(60, "readonly field cannot hold mutable class", false, `
class MutablePoint {
  x: float
  y: float
}

class BadContainer {
  readonly data: MutablePoint
}
`),
    makeSourceCase(60, "readonly field cannot hold array of mutable classes", false, `
class MutablePoint {
  x: float
  y: float
}

class BadPoints {
  readonly items: MutablePoint[]
}
`),
  ],
  61: () => [
    makeSourceCase(61, "readonly field surface blocks item reassignment", false, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  c1 := Container { items: [1, 2, 3], count: 3 }
  c1.items = [4, 5]
}
`),
    makeSourceCase(61, "readonly field surface blocks array mutation", false, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  c1 := Container { items: [1, 2, 3], count: 3 }
  c1.items.push(4)
}
`),
    makeSourceCase(61, "immutable binding still allows mutable fields", true, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  c1 := Container { items: [1, 2, 3], count: 3 }
  c1.count = 4
}
`),
    makeSourceCase(61, "immutable binding rejects rebinding", false, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  c1 := Container { items: [1, 2, 3], count: 3 }
  c1 = Container { items: [4, 5], count: 2 }
}
`),
    makeSourceCase(61, "mutable binding allows field mutation and rebinding", true, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  let c2 = Container { items: [1, 2, 3], count: 3 }
  c2.count = 4
  c2 = Container { items: [4, 5], count: 2 }
}
`),
    makeSourceCase(61, "deep readonly binding blocks field writes", false, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  readonly c3 = Container { items: [1, 2, 3], count: 3 }
  c3.count = 4
}
`),
    makeSourceCase(61, "deep readonly binding blocks rebinding", false, `
class Container {
  readonly items: int[]
  count: int
}

function main(): void {
  readonly c3 = Container { items: [1, 2, 3], count: 3 }
  c3 = Container { items: [4, 5], count: 2 }
}
`),
  ],
  66: () => [
    makeSourceCase(66, "if null check still requires explicit assertion in branch", true, `
function getValue(): int | null => 1

function main(): void {
  value: int | null := getValue()

  if value != null {
    print(value!)
  }
}
`),
    makeSourceCase(66, "if guard does not narrow after the statement", true, `
function getValue(): int | null => 1

function main(): void {
  value: int | null := getValue()

  if value == null {
    return
  }

  print(value!)
}
`),
  ],
  70: () => [
    makeSourceCase(70, "non-null assertion compiles with nullable input", true, `
function maybeName(): string | null => "Ada"

function main(): void {
  name: string | null := maybeName()
  println(name!)
}
`),
  ],
};

const CASES = buildCases(BLOCKS);

describe("spec/02-type-system.md examples", () => {
  it("tracks the current fenced block count", () => {
    expect(BLOCKS).toHaveLength(70);
  });

  for (const testCase of CASES) {
    it(`[block ${testCase.blockNumber}] ${testCase.label}`, () => {
      const result = runCheck(testCase.source);
      const errors = result.errors;
      const summary = formatDiagnostics(errors);

      if (testCase.expectSuccess) {
        expect(errors, summary).toHaveLength(0);
      } else {
        expect(errors.length, "Expected an error but diagnostics were empty").toBeGreaterThan(0);
      }
    });
  }
});

function buildCases(blocks: CodeBlock[]): VerificationCase[] {
  return blocks.flatMap((block, index) => {
    const blockNumber = index + 1;
    const override = BLOCK_OVERRIDES[blockNumber];
    if (override) {
      return override(block.code);
    }

    const expectSuccess = !looksNegative(block.code);
    const prelude = BLOCK_PRELUDES[blockNumber] ?? "";
    return [makeCase(blockNumber, "raw snippet", expectSuccess, block.code, prelude)];
  });
}

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push({
      language: match[1],
      code: match[2].trim(),
    });
  }

  return blocks.filter((block) => block.language === "javascript");
}

function makeCase(
  blockNumber: number,
  label: string,
  expectSuccess: boolean,
  snippet: string,
  extraPrelude = "",
): VerificationCase {
  return {
    blockNumber,
    label,
    expectSuccess,
    source: buildModuleSource(snippet, extraPrelude),
  };
}

function makeSourceCase(
  blockNumber: number,
  label: string,
  expectSuccess: boolean,
  source: string,
): VerificationCase {
  return {
    blockNumber,
    label,
    expectSuccess,
    source: trimBlankLines(source),
  };
}

function buildModuleSource(snippet: string, extraPrelude = ""): string {
  const { prelude, body } = splitSnippet(snippet);
  const parts: string[] = [];

  if (extraPrelude.trim().length > 0) {
    parts.push(trimBlankLines(extraPrelude));
  }
  if (prelude.trim().length > 0) {
    parts.push(prelude.trim());
  }
  if (body.trim().length > 0) {
    parts.push(`function main(): void {\n${indent(body.trim())}\n}`);
  }

  return parts.join("\n\n");
}

function splitSnippet(snippet: string): { prelude: string; body: string } {
  const lines = trimBlankLines(snippet).split("\n");
  const prelude: string[] = [];
  const body: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (body.length === 0 && (trimmed.length === 0 || trimmed.startsWith("//"))) {
      prelude.push(line);
      index += 1;
      continue;
    }

    if (body.length === 0 && startsTopLevelDeclaration(trimmed)) {
      let depth = 0;
      do {
        const current = lines[index];
        prelude.push(current);
        depth += braceDelta(current);
        index += 1;
      } while (index < lines.length && depth > 0);
      continue;
    }

    body.push(line);
    index += 1;
  }

  return {
    prelude: prelude.join("\n"),
    body: body.join("\n"),
  };
}

function startsTopLevelDeclaration(trimmedLine: string): boolean {
  return [
    "class ",
    "interface ",
    "enum ",
    "type ",
    "function ",
    "isolated function ",
    "const ",
    "readonly ",
    "import ",
    "export ",
  ].some((prefix) => trimmedLine.startsWith(prefix));
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}

function looksNegative(snippet: string): boolean {
  return /❌|\/\/\s*Error\b|Error:/.test(snippet);
}

function trimBlankLines(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

function indent(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

function formatDiagnostics(
  diagnostics: Array<{ message: string; module?: string; span?: { start: { line: number; column: number } } }>,
): string {
  if (diagnostics.length === 0) {
    return "No diagnostics";
  }

  return diagnostics.map((diagnostic) => {
    const location = diagnostic.span
      ? `${diagnostic.module ?? "/main.do"}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`
      : diagnostic.module ?? "/main.do";
    return `${location} ${diagnostic.message}`;
  }).join("\n");
}

function runCheck(source: string): CheckOutcome {
  try {
    const result = check({ "/main.do": source }, "/main.do");
    return {
      errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    };
  } catch (error) {
    return {
      errors: [{ message: error instanceof Error ? error.message : String(error), module: "/main.do" }],
    };
  }
}