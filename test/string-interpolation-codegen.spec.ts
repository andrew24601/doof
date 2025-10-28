import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';

describe('String Interpolation Code Generation', () => {
  it('should generate C++ code for simple string literals', () => {
    const source = 'let message: string = "Hello, world!";';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('std::string message = "Hello, world!";');
  });

  it('should generate C++ code for template string literals', () => {
    const source = 'let message: string = `Hello, world!`;';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('std::string message = "Hello, world!";');
  });

  it('should generate C++ code for interpolated strings', () => {
    const source = 'const name="bob"; let message: string = "Hello ${name}!";';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('doof_runtime::StringBuilder');
    expect(result.source).toContain('->append("Hello ");');
    expect(result.source).toContain('->append(name);');
    expect(result.source).toContain('->append("!");');
    expect(result.source).toContain('->toString();');
  });

  it('should generate C++ code for template interpolated strings', () => {
    const source = 'const name="bob"; let message: string = `Hello ${name}!`;';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('doof_runtime::StringBuilder');
    expect(result.source).toContain('->append("Hello ");');
    expect(result.source).toContain('->append(name);');
    expect(result.source).toContain('->append("!");');
  });

  it('should generate C++ code for multiple interpolations', () => {
    const source = 'const name="bob"; const age=25; let message: string = "Hello ${name}, you are ${age} years old";';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('->append("Hello ");');
    expect(result.source).toContain('->append(name);');
    expect(result.source).toContain('->append(", you are ");');
    expect(result.source).toContain('->append(age);');
    expect(result.source).toContain('->append(" years old");');
  });

  it('should generate C++ code for complex expressions in interpolation', () => {
    const source = 'const a=5; const b=10; let message: string = "Result: ${a + b}";';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('->append("Result: ");');
    expect(result.source).toContain('->append((a + b));');
  });

  it('should generate C++ code for interpolation with only expressions', () => {
    const source = 'const first="Hello"; const second="World"; let message: string = "${first}${second}";';
    const result = transpile(source);

    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('->append(first);');
    expect(result.source).toContain('->append(second);');
    expect(result.source).not.toContain('->append("");'); // Should not generate empty strings
  });

  it('should generate C++ code for multiline template string literals', () => {
    const source = 'let message: string = `Line 1\nLine 2\nLine 3`;';
    const result = transpile(source);

    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('std::string message = "Line 1\\nLine 2\\nLine 3";');
  });

  it('should generate C++ code for multiline template string with interpolation', () => {
    const source = 'const value=42; let message: string = `Line 1\nValue: ${value}\nLine 3`;';
    const result = transpile(source);
    
    expect(result.errors).toStrictEqual([]);
    expect(result.source).toContain('doof_runtime::StringBuilder');
    expect(result.source).toContain('->append("Line 1\\nValue: ");');
    expect(result.source).toContain('->append(value);');
    expect(result.source).toContain('->append("\\nLine 3");');
  });
});
