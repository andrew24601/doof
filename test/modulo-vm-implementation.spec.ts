import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';

describe('Modulo Operator VM Implementation', () => {
  it('should handle basic modulo operations', () => {
    const code = `
      function main(): int {
        let a: int = 10;
        let b: int = 3;
        println(a % b);
        let result: int = 0;
        return result;
      }
    `;
    
    const result = transpile(code, { target: 'vm' });
    expect(result.errors).toEqual([]);
  });

  it('should handle modulo in loop conditions', () => {
    const code = `
      function main(): int {
        let ten: int = 10;
        for (let i: int = 0; i < ten; i++) {
          let zero: int = 0;
          let two: int = 2;
          if (i % two == zero) {
            continue;
          }
          println(i);
        }
        let result: int = 0;
        return result;
      }
    `;
    
    const result = transpile(code, { target: 'vm' });
    expect(result.errors).toEqual([]);
  });

  it('should handle modulo in for..of range loops with break/continue', () => {
    const code = `
      function main(): int {
        for (let i of 0..<10) {
          let two: int = 2;
          let zero: int = 0;
          let six: int = 6;
          if (i % two == zero) {
            continue;
          }
          if (i > six) {
            break;
          }
          println(i);
        }
        let result: int = 0;
        return result;
      }
    `;
    
    const result = transpile(code, { target: 'vm' });
    expect(result.errors).toEqual([]);
  });

  it('should handle modulo with array iteration and break/continue', () => {
    const code = `
      function main(): int {
        let arr: int[] = [1, 2, 3, 4, 5];
        for (let x of arr) {
          let two: int = 2;
          let zero: int = 0;
          let four: int = 4;
          if (x % two == zero) {
            continue;
          }
          if (x > four) {
            break;
          }
          println(x);
        }
        let result: int = 0;
        return result;
      }
    `;
    
    const result = transpile(code, { target: 'vm' });
    expect(result.errors).toEqual([]);
  });

  it('should handle negative modulo operations', () => {
    const code = `
      function main(): int {
        let a: int = -7;
        let b: int = 3;
        println(a % b);
        let result: int = 0;
        return result;
      }
    `;
    
    const result = transpile(code, { target: 'vm' });
    expect(result.errors).toEqual([]);
  });

  it('should generate correct VM bytecode for modulo operations', () => {
    const code = `
      function main(): int {
        let a: int = 10;
        let b: int = 3;
        let result: int = a % b;
        return result;
      }
    `;
    
    const vmResult = transpile(code, { target: 'vm' });
    expect(vmResult.errors).toEqual([]);
    expect(vmResult.source).toContain('"opcode": 36'); // MOD_INT = 0x24 = 36
  });
});
