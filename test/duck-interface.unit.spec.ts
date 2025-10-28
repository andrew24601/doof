import { describe, it, expect } from 'vitest';
import { Lexer, Parser } from '../src';
import type { ClassDeclaration, InterfaceDeclaration, Program } from '../src/types';
import { structurallyMatches } from '../src/validation/structural';

function parse(code: string, filename = 'test.do'): Program {
  const lexer = new Lexer(code, filename);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, filename);
  return parser.parse();
}

function getInterface(program: Program, name: string): InterfaceDeclaration {
  const match = program.body.find(stmt => stmt.kind === 'interface' && stmt.name.name === name) as InterfaceDeclaration | undefined;
  if (!match) {
    throw new Error(`Interface '${name}' not found in test program`);
  }
  return match;
}

function getClass(program: Program, name: string): ClassDeclaration {
  const match = program.body.find(stmt => stmt.kind === 'class' && stmt.name.name === name) as ClassDeclaration | undefined;
  if (!match) {
    throw new Error(`Class '${name}' not found in test program`);
  }
  return match;
}

describe('structurallyMatches', () => {
  it('accepts class with required members', () => {
    const program = parse(`
      interface Drivable {
        speed: int;
        drive(distance: int): void;
      }

      class Car {
        speed: int = 0;
        drive(distance: int): void {
          println(distance);
        }
      }
    `);

    const iface = getInterface(program, 'Drivable');
    const car = getClass(program, 'Car');

    const result = structurallyMatches(iface, { kind: 'class', declaration: car });
    expect(result.matches).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts candidate with extra members', () => {
    const program = parse(`
      interface Named {
        name: string;
      }

      class Person {
        name: string = "";
        age: int = 0;
      }
    `);

    const iface = getInterface(program, 'Named');
    const person = getClass(program, 'Person');

    const result = structurallyMatches(iface, { kind: 'class', declaration: person });
    expect(result.matches).toBe(true);
  });

  it('rejects missing required property', () => {
    const program = parse(`
      interface Named {
        name: string;
      }

      class Anonymous {
        id: int = 1;
      }
    `);

    const iface = getInterface(program, 'Named');
    const anonymous = getClass(program, 'Anonymous');

    const result = structurallyMatches(iface, { kind: 'class', declaration: anonymous });
    expect(result.matches).toBe(false);
    expect(result.errors?.[0]).toContain('name');
  });

  it('allows optional members to be omitted', () => {
    const program = parse(`
      interface UserLike {
        id: int;
        email?: string;
      }

      class BasicUser {
        id: int = 0;
      }
    `);

    const iface = getInterface(program, 'UserLike');
    const basic = getClass(program, 'BasicUser');

    const result = structurallyMatches(iface, { kind: 'class', declaration: basic });
    expect(result.matches).toBe(true);
  });

  it('validates method signature compatibility', () => {
    const program = parse(`
      interface Serializer {
        serialize(value: string): string;
      }

      class JsonSerializer {
        serialize(value: string): string {
          return value;
        }
      }
    `);

    const iface = getInterface(program, 'Serializer');
    const serializer = getClass(program, 'JsonSerializer');

    const result = structurallyMatches(iface, { kind: 'class', declaration: serializer });
    expect(result.matches).toBe(true);
  });

  it('rejects incompatible method signatures', () => {
    const program = parse(`
      interface Serializer {
        serialize(value: string): string;
      }

      class BadSerializer {
        serialize(value: int): int {
          return value;
        }
      }
    `);

    const iface = getInterface(program, 'Serializer');
    const serializer = getClass(program, 'BadSerializer');

    const result = structurallyMatches(iface, { kind: 'class', declaration: serializer });
    expect(result.matches).toBe(false);
    expect(result.errors?.some((msg: string) => msg.includes('serialize'))).toBe(true);
  });

  it('merges members from extended interfaces', () => {
    const program = parse(`
      interface Identified {
        id: int;
      }

      interface UserLike extends Identified {
        email: string;
      }

      class Account {
        id: int = 0;
        email: string = "";
      }
    `);

    const iface = getInterface(program, 'UserLike');
    const account = getClass(program, 'Account');

    const result = structurallyMatches(
      iface,
      { kind: 'class', declaration: account },
      { resolveInterface: (name: string) => getInterface(program, name) }
    );
    expect(result.matches).toBe(true);
  });

  it('requires readonly interface members to map to readonly fields', () => {
    const program = parse(`
      interface Identified {
        readonly id: int;
      }

      class MutableId {
        id: int = 0;
      }

      class ImmutableId {
        readonly id: int;

        static create(): ImmutableId {
          return ImmutableId { id: 0 };
        }
      }
    `);

    const iface = getInterface(program, 'Identified');
    const mutable = getClass(program, 'MutableId');
    const immutable = getClass(program, 'ImmutableId');

    const mutableResult = structurallyMatches(iface, { kind: 'class', declaration: mutable });
    expect(mutableResult.matches).toBe(false);
    expect(mutableResult.errors.some((err: string) => err.includes('readonly'))).toBe(true);

    const immutableResult = structurallyMatches(iface, { kind: 'class', declaration: immutable });
    expect(immutableResult.matches).toBe(true);
  });
});
