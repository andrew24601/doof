import { describe, expect, test } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

function generateCodeFromString(source: string): { header: string; source: string; errors: string[] } {
  const transpiler = new Transpiler();
  const result = transpiler.transpile(source, 'test.do');
  
  return {
    header: result.header || '',
    source: result.source || '',
    errors: result.errors.map(err => typeof err === 'string' ? err : err.message)
  };
}

describe('Const Field Integration Test', () => {
  test('should transpile const fields with inferred types', () => {
    const input = `
      enum Status {
        Active,
        Inactive
      }

      class Person {
        const name = "John";
        const age = 30;
        const isActive = true;
        const status = Status.Active;
        
        getName(): string {
          return this.name;
        }
        
        getAge(): int {
          return this.age;
        }
        
        getStatus(): Status {
          return this.status;
        }
      }
    `;
    
    const result = generateCodeFromString(input);
    
    expect(result.errors).toEqual([]);
    expect(result.header).toContain('const std::string name = "John"');
    expect(result.header).toContain('const int age = 30');
    expect(result.header).toContain('const bool isActive = true');
    expect(result.header).toContain('const Status status = Status::Active');
    });

    test('should error if object-initialized const field does not match class type', () => {
      const input = `
        class Point {
          const kind = "point";
          x: int;
          y: int;
        }

        let p = Point { kind: "pointy", x: 1, y: 2};
      `;
      const result = generateCodeFromString(input);
      // Should error because we're trying to override a const field 'kind'
      expect(result.errors.some(e => e.includes('Const field') && e.includes('value must match declared value'))).toBe(true);
  });


});
