import { describe, it, expect } from 'vitest';
import { Validator } from '../src/validation/validator.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Program } from '../src/types.js';

function parseAndValidate(code: string): { program: Program; errors: any[] } {
  const lexer = new Lexer(code, 'test.do');
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, errors: context.errors };
}

describe('Validator', () => {
  describe('map key type validation', () => {
    it('allows valid map key types', () => {
      const validCodes = [
        'let stringMap: Map<string, int>;',
        'let intMap: Map<int, string>;',
        'let boolMap: Map<bool, string>;',
        'let charMap: Map<char, string>;'
      ];

      for (const code of validCodes) {
        const { errors } = parseAndValidate(code);
        expect(errors.filter(e => e.message.includes('Invalid map key type'))).toHaveLength(0);
      }
    });

    it('rejects invalid map key types', () => {
      const invalidCodes = [
        'let floatMap: Map<float, int>;',
        'let doubleMap: Map<double, int>;',
        'let voidMap: Map<void, int>;'
      ];

      for (const code of invalidCodes) {
        const { errors } = parseAndValidate(code);
        expect(errors.some(e => e.message.includes('Invalid map key type'))).toBe(true);
      }
    });

    it('allows enum types as map keys', () => {
      const code = 'enum Status { ACTIVE, INACTIVE }';
      const { errors } = parseAndValidate(code);
      // Should not have parsing errors
      expect(errors.filter(e => e.message.includes('Expected enum name'))).toHaveLength(0);
    });
  });

  describe('set element type validation', () => {
    it('allows valid set element types', () => {
      const validCodes = [
        'let stringSet: Set<string>;',
        'let intSet: Set<int>;',
        'let boolSet: Set<bool>;',
        'let charSet: Set<char>;'
      ];

      for (const code of validCodes) {
        const { errors } = parseAndValidate(code);
        expect(errors.filter(e => e.message.includes('Invalid set element type'))).toHaveLength(0);
      }
    });

    it('rejects invalid set element types', () => {
      const invalidCodes = [
        'let floatSet: Set<float>;',
        'let doubleSet: Set<double>;',
        'let voidSet: Set<void>;'
      ];

      for (const code of invalidCodes) {
        const { errors } = parseAndValidate(code);
        expect(errors.some(e => e.message.includes('Invalid set element type'))).toBe(true);
      }
    });

    it('allows enum types as set elements', () => {
      const code = 'enum Status { ACTIVE, INACTIVE }';
      const { errors } = parseAndValidate(code);
      // Should not have parsing errors
      expect(errors.filter(e => e.message.includes('Expected enum name'))).toHaveLength(0);
    });
  });

  describe('map and set literal validation', () => {
    it('validates map literal key types match declared type', () => {
      const code = `
        let stringMap: Map<string, int> = { "Alice": 30, "Bob": 25 };
        let intMap: Map<int, string> = { 1: "one", 2: "two" };
        let boolMap: Map<bool, string> = { true: "enabled", false: "disabled" };
      `;
      const { errors } = parseAndValidate(code);
      // Should not have type compatibility errors
      expect(errors.filter(e => e.message.includes('Type mismatch'))).toHaveLength(0);
    });

    it('validates set literal element types match declared type', () => {
      const code = `
        let stringSet: Set<string> = ["apple", "banana"];
        let intSet: Set<int> = [1, 2, 3];
        let boolSet: Set<bool> = [true, false];
      `;
      const { errors } = parseAndValidate(code);
      // Should not have type compatibility errors
      expect(errors.filter(e => e.message.includes('Type mismatch'))).toHaveLength(0);
    });

    it('validates enum shorthand in map keys', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE, PENDING }
        let statusMap: Map<Status, string> = { .ACTIVE: "running", .INACTIVE: "stopped" };
      `;
      const { errors } = parseAndValidate(code);
      // Should not have validation errors for enum shorthand
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('validates enum shorthand in set elements', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE, PENDING }
        let statusSet: Set<Status> = [.ACTIVE, .INACTIVE];
      `;
      const { errors } = parseAndValidate(code);
      // Should not have validation errors for enum shorthand
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('validates mixed enum syntax in maps', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE, PENDING }
        let statusMap: Map<Status, string> = { .ACTIVE: "running", Status.INACTIVE: "stopped", .PENDING: "waiting" };
      `;
      const { errors } = parseAndValidate(code);
      // Should not have validation errors for mixed enum syntax
      expect(errors.filter(e => e.message.includes('Invalid'))).toHaveLength(0);
    });

    it('rejects enum shorthand with wrong expected type', () => {
      const code = `
        enum Status { ACTIVE, INACTIVE }
        enum Priority { HIGH, LOW }
        let statusMap: Map<Status, string> = { .HIGH: "invalid" };
      `;
      const { errors } = parseAndValidate(code);
      // Should have validation error for wrong enum member
      expect(errors.filter(e => e.message.includes('Invalid enum member'))).toHaveLength(1);
    });
  });

  describe('unknown type handling', () => {
    it('generates unknown type for undefined identifiers', () => {
      const code = 'let x = undefinedVariable;';
      const { program, errors } = parseAndValidate(code);
      // Should have error for undefined identifier
      expect(errors.some(e => e.message.includes('Undefined identifier'))).toBe(true);
      // Should continue validation and infer unknown type
      const varDecl = program.body[0] as any;
      expect(varDecl.inferredType?.kind).toBe('unknown');
    });
  });

  describe('const variable validation', () => {
    it('should require initializers for const variables', () => {
      const { errors } = parseAndValidate('const x: int;');
      expect(errors.some(e => e.message.includes("Const variable 'x' must have an initializer"))).toBe(true);
    });

    it('should allow const variables with initializers', () => {
      const { errors } = parseAndValidate('const x: int = 42;');
      expect(errors.filter(e => e.message.includes('must have an initializer'))).toHaveLength(0);
    });

    it('should allow let variables without initializers', () => {
      const { errors } = parseAndValidate('let x: int;');
      expect(errors.filter(e => e.message.includes('must have an initializer'))).toHaveLength(0);
    });

    it('should catch const arrays without initializers', () => {
      const { errors } = parseAndValidate('const arr: int[];');
      expect(errors.some(e => e.message.includes("Const variable 'arr' must have an initializer"))).toBe(true);
    });
  });

  describe('global variable initialization validation', () => {
    it('should require initialization for global non-nullable arrays', () => {
      const { errors } = parseAndValidate('let globalArray: int[];');
      expect(errors.some(e => e.message.includes("Global variable 'globalArray' of non-nullable type must be initialized"))).toBe(true);
    });

    it('should allow global primitives without initialization', () => {
      const { errors } = parseAndValidate('let globalInt: int;');
      expect(errors.filter(e => e.message.includes('must be initialized'))).toHaveLength(0);
    });

    it('should allow global variables with initializers', () => {
      const { errors } = parseAndValidate('let globalArray: int[] = [1, 2, 3];');
      expect(errors.filter(e => e.message.includes('must be initialized'))).toHaveLength(0);
    });

    it('should allow local variables without initialization', () => {
      const { errors } = parseAndValidate(`
        function test(): void {
          let localArray: int[];
        }
      `);
      expect(errors.filter(e => e.message.includes('must be initialized'))).toHaveLength(0);
    });

    it('should catch the jigsaw board case specifically', () => {
      const { errors } = parseAndValidate(`
        type Row = int[];
        const board: Row[];
      `);
      expect(errors.some(e => e.message.includes("Const variable 'board' must have an initializer"))).toBe(true);
    });
  });
});
