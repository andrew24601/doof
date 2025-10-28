import { describe, it, expect } from 'vitest';
import { Lexer, Parser } from '../../src';
import type { ClassTypeNode, Program, TypeAliasDeclaration, UnionTypeNode } from '../../src/types';
import { desugarInterfaces } from '../../src/validation/desugar';

function parse(code: string, filename = 'test.do'): Program {
  const lexer = new Lexer(code, filename);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, filename);
  return parser.parse();
}

describe('desugarInterfaces', () => {
  it('converts an interface into a union of matching classes', () => {
    const program = parse(`
      interface Drivable {
        drive(): void;
      }

      class Car {
        drive(): void {}
      }

      class Boat {
        sail(): void {}
      }
    `);

    const result = desugarInterfaces([program], { closedWorld: true });
    expect(result.errors).toEqual([]);

    const alias = program.body.find(stmt => stmt.kind === 'typeAlias' && stmt.name.name === 'Drivable') as TypeAliasDeclaration | undefined;
    expect(alias).toBeDefined();

  const aliasType = alias?.type as ClassTypeNode | undefined;
  expect(aliasType?.kind).toBe('class');
  expect(aliasType?.name).toBe('Car');

    const leftoverInterface = program.body.find(stmt => stmt.kind === 'interface');
    expect(leftoverInterface).toBeUndefined();
  });

  it('creates a union when multiple classes satisfy the interface', () => {
    const program = parse(`
      interface Drivable {
        drive(): void;
      }

      class Car {
        drive(): void {}
      }

      class Truck {
        drive(): void {}
      }
    `);

    const result = desugarInterfaces([program], { closedWorld: true });
    expect(result.errors).toEqual([]);

    const alias = program.body.find(stmt => stmt.kind === 'typeAlias' && stmt.name.name === 'Drivable') as TypeAliasDeclaration | undefined;
    expect(alias).toBeDefined();

  const union = alias?.type as UnionTypeNode | undefined;
  expect(union?.kind).toBe('union');
  expect(union?.types).toHaveLength(2);

  const carType = union?.types[0] as ClassTypeNode | undefined;
  const truckType = union?.types[1] as ClassTypeNode | undefined;
  expect(carType?.kind).toBe('class');
  expect(carType?.name).toBe('Car');
  expect(truckType?.kind).toBe('class');
  expect(truckType?.name).toBe('Truck');
  });

  it('emits an error when no candidates match', () => {
    const program = parse(`
      interface Serializable {
        serialize(): string;
      }

      class Logger {
        log(): void {}
      }
    `);

    const result = desugarInterfaces([program], { closedWorld: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Serializable');
  });

  it('skips desugaring when not in closed world mode', () => {
    const program = parse(`
      interface Flyable {
        fly(): void;
      }

      class Plane {
        fly(): void {}
      }
    `);

    const result = desugarInterfaces([program], { closedWorld: false });
    expect(result.transformed).toBe(false);

    const iface = program.body.find(stmt => stmt.kind === 'interface');
    expect(iface).toBeDefined();
  });
});
