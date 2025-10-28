import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/index.js';

describe('String interpolation codegen with StringBuilder', () => {
  it('should transpile simple template literal to StringBuilder usage', () => {
    const input = `
      function test(): string {
        let name = "World";
        let age = 25;
        let message = \`Hello \${name}, you are \${age} years old\`;
        return message;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
    expect(result.errors).toStrictEqual([]);
    
    // Should contain StringBuilder usage
    expect(output).toContain('doof_runtime::StringBuilder');
    expect(output).toContain('__sb_');
    expect(output).toContain('->append("Hello ")');
    expect(output).toContain('->append(name)');
    expect(output).toContain('->append(", you are ")');
    expect(output).toContain('->append(age)');
    expect(output).toContain('->append(" years old")');
    expect(output).toContain('->toString()');
  });

  it('should use reserve heuristic for StringBuilder', () => {
    const input = `
      function test(): string {
        let expr1 = "test";
        let expr2 = "value";
        let message = \`Very long prefix text \${expr1} middle text \${expr2} suffix text\`;
        return message;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
      expect(result.errors).toStrictEqual([]);

    // Should contain reserve call with estimated size
    expect(output).toContain('->reserve(');
  });

  it('should handle enum expressions in templates with to_string', () => {
    const input = `
      enum Status { ACTIVE, INACTIVE }
      function test(): string {
        let status = Status.ACTIVE;
        let message = \`Status is \${status}\`;
        return message;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
      expect(result.errors).toStrictEqual([]);

    // Should call to_string for enum values
    expect(output).toContain('to_string(');
    expect(output).toMatch(/->append\(to_string\([^)]+\)\)/);
  });

  it('should keep tagged templates unchanged', () => {
    const input = `
      function html(strings: string[], values: string[]): string {
        return "";
      }
      function test(): string {
        let name = "test";
        let result = html\`<div>\${name}</div>\`;
        return result;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
        expect(result.errors).toStrictEqual([]);

    // Should NOT use StringBuilder for tagged templates
    expect(output).not.toContain('doof_runtime::StringBuilder');
    // Should use vector-based tagged template generation
    expect(output).toContain('std::vector<std::string>');
  });

  it('should handle single string literal efficiently', () => {
    const input = `
      function test(): string {
        let message = \`Just a simple string\`;
        return message;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
    
    // For single string literals, should generate simple string literal
    expect(output).toContain('"Just a simple string"');
    // Should NOT use StringBuilder for simple cases
    expect(output).not.toContain('doof_runtime::StringBuilder');
  });

  it('should handle empty template literal', () => {
    const input = `
      function test(): string {
        let message = \`\`;
        return message;
      }
    `;

    const result = transpile(input);
    const output = result.source || '';
    
    // Should generate empty string literal
    expect(output).toContain('""');
    // Should NOT use StringBuilder for empty case
    expect(output).not.toContain('doof_runtime::StringBuilder');
  });
});
