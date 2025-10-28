import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { Validator } from '../src/validation/validator.js';
import { 
  Program, Statement, Expression, ValidationContext,
  VariableDeclaration, InterpolatedString, Identifier
} from '../src/types.js';

function parseSource(source: string): Program {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, 'test.do');
  return parser.parse();
}

function parseExpression(source: string): Expression {
  const program = parseSource(`const x = ${source};`);
  const varDecl = program.body[0] as VariableDeclaration;
  return varDecl.initializer!;
}

function validateProgram(source: string): { program: Program; validator: Validator; context: ValidationContext } {
  const program = parseSource(source);
  const validator = new Validator({ allowTopLevelStatements: true });
  const context = validator.validate(program);
  return { program, validator, context };
}

describe('Tagged Templates', () => {
  describe('Parser', () => {
    it('parses tagged template with backticks', () => {
      const expr = parseExpression('html`<p>Hello</p>`') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(true);
      expect(expr.tagIdentifier).toBeDefined();
      expect(expr.tagIdentifier!.kind).toBe('identifier');
      expect(expr.tagIdentifier!.name).toBe('html');
      expect(expr.parts).toEqual(['<p>Hello</p>']);
    });

    it('parses tagged template with double quotes', () => {
      const expr = parseExpression('sql"SELECT * FROM users"') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(false);
      expect(expr.tagIdentifier).toBeDefined();
      expect(expr.tagIdentifier!.kind).toBe('identifier');
      expect(expr.tagIdentifier!.name).toBe('sql');
      expect(expr.parts).toEqual(['SELECT * FROM users']);
    });

    it('parses tagged template with interpolation', () => {
      const expr = parseExpression('html`<p>${name}</p>`') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(true);
      expect(expr.tagIdentifier).toBeDefined();
      expect(expr.tagIdentifier!.name).toBe('html');
      expect(expr.parts).toHaveLength(3);
      expect(expr.parts[0]).toBe('<p>');
      expect(expr.parts[1]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'name' }));
      expect(expr.parts[2]).toBe('</p>');
    });

    it('parses tagged template with multiple interpolations', () => {
      const expr = parseExpression('msg`Hello ${firstName} ${lastName}!`') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.tagIdentifier!.name).toBe('msg');
      expect(expr.parts).toHaveLength(5);
      expect(expr.parts[0]).toBe('Hello ');
      expect(expr.parts[1]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'firstName' }));
      expect(expr.parts[2]).toBe(' ');
      expect(expr.parts[3]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'lastName' }));
      expect(expr.parts[4]).toBe('!');
    });

    it('parses untagged template string (no identifier)', () => {
      const expr = parseExpression('`Hello ${name}`') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(true);
      expect(expr.tagIdentifier).toBeUndefined();
      expect(expr.parts).toHaveLength(2); // ["Hello ", name] - no empty string at end
      expect(expr.parts[0]).toBe('Hello ');
      expect(expr.parts[1]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'name' }));
    });

    it('parses untagged double-quoted template string', () => {
      const expr = parseExpression('"Hello ${name}"') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.isTemplate).toBe(false);
      expect(expr.tagIdentifier).toBeUndefined();
      expect(expr.parts).toHaveLength(2); // ["Hello ", name] - no empty string at end
      expect(expr.parts[0]).toBe('Hello ');
      expect(expr.parts[1]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'name' }));
    });

    it('parses identifier without adjacent template as regular identifier', () => {
      const expr = parseExpression('html') as Identifier;
      expect(expr.kind).toBe('identifier');
      expect(expr.name).toBe('html');
    });

    it('rejects tagged template with whitespace between identifier and template', () => {
      // This should parse as two separate expressions, not a tagged template
      const program = parseSource('const x = html `hello`;');
      expect(program.errors).toHaveLength(1); // Should have a parse error due to incomplete variable declaration
      // The parse error should be about expecting semicolon after identifier
      expect(program.errors![0].message).toContain("Expected ';'");
    });

    it('handles complex expressions in interpolation within tagged templates', () => {
      const expr = parseExpression('html`<div class="${className || "default"}">${content}</div>`') as InterpolatedString;
      expect(expr.kind).toBe('interpolated-string');
      expect(expr.tagIdentifier!.name).toBe('html');
      expect(expr.parts).toHaveLength(5);
      expect(expr.parts[0]).toBe('<div class="');
      expect(expr.parts[1]).toEqual(expect.objectContaining({ kind: 'binary' })); // className || "default"
      expect(expr.parts[2]).toBe('">');
      expect(expr.parts[3]).toEqual(expect.objectContaining({ kind: 'identifier', name: 'content' }));
      expect(expr.parts[4]).toBe('</div>');
    });
  });

  describe('Validator', () => {
    it('validates tagged template with correct function signature', () => {
      const source = `
        function html(quasis: string[], values: string[]): string {
          return "";
        }
        const name = "world";
        const result = html\`<p>\${name}</p>\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors).toHaveLength(0);
    });

    it('validates tagged template with generic value array', () => {
      const source = `
        function tag(quasis: string[], values: int[]): string {
          return "";
        }
        const x = 42;
        const result = tag\`Value: \${x}\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors).toHaveLength(0);
    });

    it('reports error when tag is not a function', () => {
      const source = `
        const notAFunction = "hello";
        const result = notAFunction\`template\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain('must be a function');
    });

    it('reports error when tag function has wrong number of parameters', () => {
      const source = `
        function wrongParams(onlyOne: string[]): string {
          return "";
        }
        const result = wrongParams\`template\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain('must have exactly 2 parameters');
    });

    it('reports error when first parameter is not string[]', () => {
      const source = `
        function wrongFirstParam(first: int, second: string[]): string {
          return "";
        }
        const result = wrongFirstParam\`template\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain('first parameter must be');
    });

    it('reports error when second parameter is not an array', () => {
      const source = `
        function wrongSecondParam(first: string[], second: string): string {
          return "";
        }
        const result = wrongSecondParam\`template\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain('second parameter must be an array');
    });

    it('reports error when interpolated expression type does not match expected type', () => {
      const source = `
        function strictTag(quasis: string[], values: int[]): string {
          return "";
        }
        const name = "string";
        const result = strictTag\`Value: \${name}\`;
      `;
      const { context } = validateProgram(source);
      expect(context.errors.length).toBeGreaterThan(0);
      expect(context.errors[0].message).toContain('expression has type');
    });

    it('allows compatible types in expressions', () => {
      const source = `
        function flexibleTag(quasis: string[], values: double[]): string {
          return "";
        }
        const x = 42;
        const result = flexibleTag\`Value: \${x}\`; // int should convert to double
      `;
      const { context } = validateProgram(source);
      expect(context.errors).toStrictEqual([]);
    });
  });
});
