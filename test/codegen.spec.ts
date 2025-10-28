import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler';
import type { TranspilerOptions } from '../src/transpiler';

type GenerateOptions = {
  filename?: string;
  transpilerOptions?: TranspilerOptions;
};

function generateCode(source: string, options: GenerateOptions = {}) {
  const transpiler = new Transpiler({
    target: 'cpp',
    outputHeader: true,
    outputSource: true,
    ...options.transpilerOptions
  });
  const filename = options.filename ?? 'test.do';
  const result = transpiler.transpile(source, filename);
  if (result.errors.length > 0) {
    const details = result.errors
      .map(error => `${error.filename ?? filename}:${error.line ?? '?'}:${error.column ?? '?'} ${error.message}`)
      .join('\n');
    throw new Error(`Transpilation failed:\n${details}`);
  }
  return {
    header: result.header ?? '',
    source: result.source ?? ''
  };
}

describe('CppGenerator', () => {
  describe('control flow', () => {
    it('generates if/else statements', () => {
      const { source } = generateCode(`
        function testIf(value: int): void {
          if (value > 0) {
            println("positive");
          } else {
            println("non-positive");
          }
        }
      `);

      expect(source).toContain('if ((value > 0))');
      expect(source).toContain('else');
    });

    it('generates while loops', () => {
      const { source } = generateCode(`
        function testWhile(flag: bool): void {
          let mutableFlag = flag;
          while (mutableFlag) {
            println("loop");
            mutableFlag = false;
          }
        }
      `);

      expect(source).toContain('while (mutableFlag)');
      expect(source).toContain('mutableFlag = false;');
    });

    it('generates indexed for loops', () => {
      const { source } = generateCode(`
        function testFor(limit: int): void {
          for (let i = 0; i < limit; i += 1) {
            println(i);
          }
        }
      `);

  expect(source).toContain('for (int i = 0; (i < limit); i += 1)');
    });

    it('generates range-based for-of loops', () => {
      const { source } = generateCode(`
        function sum(values: int[]): int {
          let total = 0;
          for (let value of values) {
            total += value;
          }
          return total;
        }
      `);

      expect(source).toContain('for (const auto& value : *values)');
      expect(source).toContain('total += value;');
    });

    it('generates switch statements with ranges', () => {
      const { source } = generateCode(`
        function bucket(value: int): int {
          switch (value) {
            case 0..5:
              return 1;
            case 6..<10:
              return 2;
            default:
              return 3;
          }
          return 0;
        }
      `);

      expect(source).toContain('switch (value)');
      expect(source).toContain('case 0:');
      expect(source).toContain('case 5:');
      expect(source).toContain('default:');
    });
  });

  describe('array intrinsics', () => {
    it('generates reduce with accumulator and index support', () => {
      const { source } = generateCode(`
        function compute(): int {
          let arr: int[] = [1, 2, 3];
          let doubled: int[] = arr.map(=> it * 2);
          let total = doubled.reduce(0, (acc: int, it: int, index: int, array: int[]) => acc + it);
          return total;
        }
      `);

      expect(source).toContain('auto accumulator = 0;');
      expect(source).toContain('int index = 0;');
      expect(source).toContain('for (const auto& it : *doubled)');
      expect(source).toContain('(accumulator, it, index, doubled);');
    });
  });

  describe('classes', () => {
    it('generates class declarations and implementations', () => {
      const { header, source } = generateCode(`
        class TestClass {
          value: int;
          private name: string = "default";

          getValue(): int {
            return value;
          }
        }
      `);

      expect(header).toContain('class TestClass : public std::enable_shared_from_this<TestClass> {');
      expect(header).toContain('int getValue();');
      expect(header).toContain('int value;');
      expect(header).toContain('std::string name = "default";');

      expect(source).toContain('TestClass::TestClass()');
      expect(source).toContain('int TestClass::getValue()');
    });

    it('generates static members', () => {
      const { header, source } = generateCode(`
        class StaticTest {
          static count: int = 0;

          static increment(): void {}
        }
      `);

      expect(header).toContain('static int count;');
      expect(header).toContain('static void increment();');
      expect(source).toContain('int StaticTest::count = 0;');
    });

    it('wires factory helpers when constructor exists', () => {
      const { header, source } = generateCode(`
        class Widget {
          value: int = 0;
          message: string = "hi";

          constructor(value: int, message: string = "hi") {
            this.value = value;
            this.message = message;
          }
        }

        function build(): Widget {
          return Widget { value: 42 };
        }
      `);

      expect(header).toContain('static std::shared_ptr<Widget> _new(int value, const std::string& message = "hi");');
      expect(header).toContain('private:\n        Widget();');
      expect(source).toContain('std::shared_ptr<Widget> Widget::_new(int value, const std::string& message)');
      expect(source).toContain('obj->constructor(value, message);');
      expect(source).toContain('return Widget::_new(42)');
    });
  });

  describe('expressions', () => {
    it('generates binary expressions', () => {
      const { source } = generateCode(`
        function testBinary(): int {
          return 1 + 2;
        }
      `);

      expect(source).toContain('return (1 + 2);');
    });

    it('generates unary expressions', () => {
      const { source } = generateCode(`
        function testUnary(): int {
          return -42;
        }
      `);

      expect(source).toContain('return -42;');
    });

    it('generates postfix operators', () => {
      const { source } = generateCode(`
        function testPostfix(): int {
          let x: int = 5;
          return x++;
        }
      `);

      expect(source).toContain('return (x++);');
    });

    it('generates call expressions', () => {
      const { source } = generateCode(`
        function foo(value: int, text: string): void {}

        function testCall(): void {
          foo(1, "test");
        }
      `);

      expect(source).toContain('foo(1, "test");');
    });

    it('generates member access', () => {
      const { source } = generateCode(`
        class Example {
          value: int = 42;

          getValue(): int {
            return this.value;
          }
        }
      `);

      expect(source).toContain('return this->value;');
    });

    it('generates array expressions', () => {
      const { source } = generateCode(`
        function testArray(): int[] {
          return [1, 2, 3];
        }
      `);

      expect(source).toContain('return std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2, 3});');
    });

    it('generates lambda expressions', () => {
      const { source } = generateCode(`
        function testLambda(): void {
          let fn: (x: int): int = (x: int): int => x * 2;
        }
      `);

      expect(source).toContain('[](int x) { return (x * 2); }');
    });
  });

  describe('object and map literals', () => {
    it('generates object construction with field initialization precedence', () => {
      const { source } = generateCode(`
        class Point {
          x: int;
          y: int;
        }

        function build(): void {
          let obj: Point = new Point { x: 10, y: 20 };
        }
      `);

      expect(source).toContain('std::shared_ptr<Point> obj = std::make_shared<Point>(10, 20)');
    });

    it('generates map literals with string keys', () => {
      const { source } = generateCode(`
        function makeStringMap(): Map<string, int> {
          let mapping: Map<string, int> = { "Alice": 30, "Bob": 25 };
          return mapping;
        }
      `);

      expect(source).toContain('std::map<std::string, int> mapping = {{"Alice", 30}, {"Bob", 25}};');
      expect(source).toContain('return mapping;');
    });

    it('generates map literals with number keys', () => {
      const { source } = generateCode(`
        function makeIntMap(): Map<int, string> {
          let mapping: Map<int, string> = { 1: "one", 2: "two" };
          return mapping;
        }
      `);

      expect(source).toContain('std::map<int, std::string> mapping = {{1, "one"}, {2, "two"}};');
      expect(source).toContain('return mapping;');
    });

    it('generates map literals with boolean keys', () => {
      const { source } = generateCode(`
        function makeBoolMap(): Map<bool, string> {
          let mapping: Map<bool, string> = { true: "enabled", false: "disabled" };
          return mapping;
        }
      `);

      expect(source).toContain('std::map<bool, std::string> mapping = {{true, "enabled"}, {false, "disabled"}};');
      expect(source).toContain('return mapping;');
    });
  });

  describe('runtime namespaces', () => {
    it('maps Math namespace functions', () => {
      const { source } = generateCode(`
        function testMath(): double {
          return Math.sqrt(16);
        }
      `);

      expect(source).toContain('return std::sqrt(16);');
    });
  });

  describe('types', () => {
    it('generates primitive declarations', () => {
      const { source } = generateCode(`
        function declarePrimitives(): void {
          let a: int;
          let b: string;
          let c: bool;
          let d: double;
        }
      `);

      expect(source).toContain('int a;');
      expect(source).toContain('std::string b;');
      expect(source).toContain('bool c;');
      expect(source).toContain('double d;');
    });

    it('generates collection declarations', () => {
      const { source } = generateCode(`
        function declareCollections(): void {
          let arr: int[];
          let mapping: Map<string, int>;
          let names: Set<string>;
        }
      `);

      expect(source).toContain('std::shared_ptr<std::vector<int>> arr;');
      expect(source).toContain('std::map<std::string, int> mapping;');
      expect(source).toContain('std::unordered_set<std::string> names;');
    });

    it('generates shared and weak pointer types', () => {
      const { source } = generateCode(`
        class MyClass {}

        function declareReferences(): void {
          let obj: MyClass;
          let weakRef: weak MyClass;
        }
      `);

      expect(source).toContain('std::shared_ptr<MyClass> obj;');
      expect(source).toContain('std::weak_ptr<MyClass> weakRef;');
    });
  });

  describe('enums', () => {
    it('generates enum declarations', () => {
      const { header } = generateCode(`
        enum Status {
          ACTIVE = 1,
          INACTIVE,
          PENDING = 3
        }
      `);

      expect(header).toContain('enum Status {');
      expect(header).toContain('ACTIVE = 1,');
      expect(header).toContain('INACTIVE,');
      expect(header).toContain('PENDING = 3');
    });

    it('supports enum shorthand in sets', () => {
      const { source } = generateCode(`
        enum Status {
          ACTIVE,
          INACTIVE,
          PENDING
        }

        function buildSet(): Set<Status> {
          let statuses: Set<Status> = { .ACTIVE, .INACTIVE };
          return statuses;
        }
      `);

      expect(source).toContain('std::unordered_set<Status> statuses = {Status::ACTIVE, Status::INACTIVE};');
      expect(source).toContain('return statuses;');
    });

    it('supports enum shorthand in maps', () => {
      const { source } = generateCode(`
        enum Status {
          ACTIVE,
          INACTIVE,
          PENDING
        }

        function buildMap(): Map<Status, string> {
          let mapping: Map<Status, string> = { .ACTIVE: "Running", Status.PENDING: "Waiting" };
          return mapping;
        }
      `);

      expect(source).toContain('std::map<Status, std::string> mapping = {{Status::ACTIVE, "Running"}, {Status::PENDING, "Waiting"}};');
      expect(source).toContain('return mapping;');
    });
  });

  describe('header generation', () => {
    it('includes standard headers', () => {
      const { header } = generateCode('function noop(): void {}');

      expect(header).toContain('#include <iostream>');
      expect(header).toContain('#include <string>');
      expect(header).toContain('#include <vector>');
      expect(header).toContain('#include <memory>');
      expect(header).toContain('#include <cmath>');
    });

    it('generates header guards', () => {
      const { header } = generateCode('function noop(): void {}', { filename: 'myfile.do' });

      expect(header).toMatch(/^#ifndef MYFILE_H/);
      expect(header).toContain('#define MYFILE_H');
      expect(header).toContain('#endif // MYFILE_H');
    });

    it('emits forward declarations for classes', () => {
      const { header } = generateCode(`
        class TestClass {
          value: int;
        }
      `);

      expect(header).toContain('class TestClass;');
    });
  });

  describe('namespace support', () => {
    it('wraps output in namespaces', () => {
      const { header, source } = generateCode('function test(): void {}', {
        transpilerOptions: { namespace: 'MyNamespace' }
      });

      expect(header).toContain('namespace MyNamespace {');
      expect(header).toContain('} // namespace MyNamespace');
      expect(source).toContain('namespace MyNamespace {');
      expect(source).toContain('} // namespace MyNamespace');
    });
  });
});
