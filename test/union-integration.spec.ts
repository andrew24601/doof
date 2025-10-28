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

describe('Union Common-Member Integration Test', () => {
  test('should transpile union common-member access', () => {
    const input = `
      class StringType {
        value: string;
        
        getValue(): string {
          return this.value;
        }
      }
      
      class IntType {
        value: int;
        
        getValue(): string {
          return "integer_value";
        }
      }
      
      class UnionTest {
        testCommonMethod(data: StringType | IntType): string {
          // Both StringType and IntType have getValue() method
          return data.getValue();
        }
      }
    `;
    
    const result = generateCodeFromString(input);
    
    expect(result.errors).toEqual([]);
    expect(result.header).toContain('std::string testCommonMethod(std::variant<std::shared_ptr<StringType>, std::shared_ptr<IntType>> data)');
    expect(result.source).toContain('std::visit([](auto&& variant) { return variant->getValue(); }, data)');
  });
});
