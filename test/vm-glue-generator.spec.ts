import { describe, it, expect } from 'vitest';
import { Lexer, Parser, Validator } from '../src';
import { generateVmGlueFromProgram, generateRegisterAllGlue } from '../src/codegen/vm-glue-generator';

function parseProgram(source: string) {
  const lexer = new Lexer(source, 'test_input.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const validationContext = validator.validate(program);
  expect(validationContext.errors).toHaveLength(0);
  return { program, validationContext };
}

describe('VM glue generator', () => {
  it('generates glue for extern classes with primitive and extern references', () => {
    const source = `
      extern class Foo {
        static create(count: int): Foo;
        attach(other: Foo | null): void;
      }

      extern class Bar {
        consume(target: Foo): void;
        static build(label: string): Bar;
      }
    `;

    const { program, validationContext } = parseProgram(source);
    const files = generateVmGlueFromProgram(program, validationContext);
    expect(files).toHaveLength(2);

    const fooGlue = files.find(file => file.className === 'Foo');
    expect(fooGlue).toBeDefined();
    expect(fooGlue!.headerContent).toContain('void register_Foo_glue');
    expect(fooGlue!.sourceContent).toContain('#include "Foo_glue.h"');
    expect(fooGlue!.sourceContent).toContain('#include "vm_glue_helpers.h"');
    expect(fooGlue!.sourceContent).toContain('auto Foo_class_handle = vm.ensure_extern_class("Foo")');
    expect(fooGlue!.sourceContent).toContain('return DoofVMGlue::dispatch("Foo::create", args, [&]() -> Value {');
    expect(fooGlue!.sourceContent).toContain('return DoofVM::wrap_extern_object<Foo>(Foo_class_handle, Foo::create(');
    expect(fooGlue!.sourceContent).toContain('DoofVMGlue::expect_optional_object<Foo>(args, 1, Foo_class_handle, "Foo::attach", "other")');

    const barGlue = files.find(file => file.className === 'Bar');
    expect(barGlue).toBeDefined();
    expect(barGlue!.sourceContent).toContain('#include "Foo.h"');
    expect(barGlue!.sourceContent).toContain('auto Foo_class_handle = vm.ensure_extern_class("Foo")');
    expect(barGlue!.sourceContent).toContain('DoofVMGlue::expect_object<Foo>(args, 1, Foo_class_handle, "Bar::consume", "target")');
  });

  it('throws for unsupported parameter types', () => {
    const source = `
      extern class Data {
        ingest(values: int[]): void;
      }
    `;

    const { program, validationContext } = parseProgram(source);
    expect(() => generateVmGlueFromProgram(program, validationContext)).toThrowError(
      /does not support type 'int\[\]' for parameter 'values' of Data::ingest/
    );
  });

  it('creates aggregator glue for multiple classes', () => {
    const glue = generateRegisterAllGlue(['Foo', 'Bar', 'Foo']);
    expect(glue).toBeDefined();
    expect(glue!.headerContent).toContain('void register_all_vm_glue');
    expect(glue!.sourceContent).toContain('#include "Foo_glue.h"');
    expect(glue!.sourceContent).toContain('#include "Bar_glue.h"');
    expect(glue!.sourceContent).toContain('register_Bar_glue(vm);');
  });
});
