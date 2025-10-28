import { describe, it, expect } from 'vitest';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { validateProgramForTests } from './helpers/validation';

describe('Parameter Passing Semantics', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { header: result.header ?? '', source: result.source ?? '' };
  }

  it('should pass arrays by shared_ptr (reference semantics)', () => {
    const code = `
      function processArray(arr: int[]): void {
        // process array
      }
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('void processArray(std::shared_ptr<std::vector<int>> arr);');
    expect(result.source).toContain('void processArray(std::shared_ptr<std::vector<int>> arr)');
  });

  it('should pass strings by const reference', () => {
    const code = `
      function processString(text: string): void {
        // process string
      }
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('void processString(const std::string& text);');
    expect(result.source).toContain('void processString(const std::string& text)');
  });

  it('should pass classes as shared_ptr (already references)', () => {
    const code = `
      class Player {
        id: int = 0;
      }
      
      function processPlayer(p: Player): void {
        p.id = 42;
      }
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('void processPlayer(std::shared_ptr<Player> p);');
    expect(result.source).toContain('void processPlayer(std::shared_ptr<Player> p)');
  });

  it('should pass primitives by value', () => {
    const code = `
      function processInt(x: int): int {
        return x * 2;
      }
      
      function processFloat(f: float): float {
        return f + 1.0;
      }
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('int processInt(int x);');
    expect(result.header).toContain('float processFloat(float f);');
    expect(result.source).toContain('int processInt(int x)');
    expect(result.source).toContain('float processFloat(float f)');
  });

  it('should handle weak references correctly', () => {
    const code = `
      class Node {
        value: int = 0;
        parent: weak Node;
      }
      
      function processNode(n: weak Node): void {
        // process weak reference
      }
    `;
    
    const result = transpileCode(code);
    expect(result.header).toContain('void processNode(std::weak_ptr<Node> n);');
    expect(result.source).toContain('void processNode(std::weak_ptr<Node> n)');
  });

});
