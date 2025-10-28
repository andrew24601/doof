import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { ConditionalExpression, BinaryExpression, IfStatement, WhileStatement, ForStatement, UnaryExpression, VariableDeclaration } from '../src/types.js';

describe('Flow-Managed Conditionals - Parser Support', () => {
  function parseSource(source: string) {
    const lexer = new Lexer(source, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
  }

  function parseExpression(source: string) {
    const program = parseSource(`const x = ${source};`);
    const varDecl = program.body[0] as any;
    return varDecl.initializer!;
  }

  describe('Conditional Expressions (Ternary)', () => {
    it('should parse simple conditional expressions', () => {
      const expr = parseExpression('x > 0 ? "positive" : "negative"') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.test.kind).toBe('binary');
      expect((expr.test as BinaryExpression).operator).toBe('>');
      expect(expr.consequent.kind).toBe('literal');
      expect(expr.alternate.kind).toBe('literal');
    });

    it('should parse nested conditional expressions', () => {
      const expr = parseExpression('x > 90 ? "A" : x > 80 ? "B" : "C"') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.alternate.kind).toBe('conditional');
      
      const nestedCondition = expr.alternate as ConditionalExpression;
      expect(nestedCondition.test.kind).toBe('binary');
      expect((nestedCondition.test as BinaryExpression).operator).toBe('>');
    });

    it('should respect operator precedence in ternary expressions', () => {
      const expr = parseExpression('1 + 2 > 3 ? a : b') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.test.kind).toBe('binary');
      
      const comparison = expr.test as BinaryExpression;
      expect(comparison.operator).toBe('>');
      expect(comparison.left.kind).toBe('binary'); // Should be the addition
      
      const addition = comparison.left as BinaryExpression;
      expect(addition.operator).toBe('+');
    });

    it('should handle complex expressions in ternary branches', () => {
      const expr = parseExpression('condition ? func(a, b) : obj.method()') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.consequent.kind).toBe('call');
      expect(expr.alternate.kind).toBe('call');
    });
  });

  describe('Short-Circuit Logical Operators', () => {
    it('should parse logical AND expressions', () => {
      const expr = parseExpression('x > 0 && y < 10') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('&&');
      expect(expr.left.kind).toBe('binary');
      expect(expr.right.kind).toBe('binary');
    });

    it('should parse logical OR expressions', () => {
      const expr = parseExpression('x < 0 || y > 10') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('||');
      expect(expr.left.kind).toBe('binary');
      expect(expr.right.kind).toBe('binary');
    });

    it('should handle complex logical expressions with proper precedence', () => {
      const expr = parseExpression('a && b || c && d') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('||');
      
      // Left side should be (a && b)
      expect(expr.left.kind).toBe('binary');
      expect((expr.left as BinaryExpression).operator).toBe('&&');
      
      // Right side should be (c && d)
      expect(expr.right.kind).toBe('binary');
      expect((expr.right as BinaryExpression).operator).toBe('&&');
    });

    it('should parse nested logical expressions', () => {
      const expr = parseExpression('(a && b) || (c && d)') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('||');
      expect(expr.left.kind).toBe('binary');
      expect(expr.right.kind).toBe('binary');
    });

    it('should handle mixed logical and comparison operators', () => {
      const expr = parseExpression('x > 0 && y < 10 || z == 5') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('||');
      
      const leftAnd = expr.left as BinaryExpression;
      expect(leftAnd.operator).toBe('&&');
      expect(leftAnd.left.kind).toBe('binary'); // x > 0
      expect(leftAnd.right.kind).toBe('binary'); // y < 10
    });
  });

  describe('Negation and Unary Operators', () => {
    it('should parse logical negation', () => {
      const expr = parseExpression('!(x > 0)') as UnaryExpression;
      expect(expr.kind).toBe('unary');
      expect(expr.operator).toBe('!');
      expect(expr.operand.kind).toBe('binary');
    });

    it('should parse double negation', () => {
      const expr = parseExpression('!!(x > 0)') as UnaryExpression;
      expect(expr.kind).toBe('unary');
      expect(expr.operator).toBe('!');
      
      const innerNegation = expr.operand as UnaryExpression;
      expect(innerNegation.kind).toBe('unary');
      expect(innerNegation.operator).toBe('!');
      expect(innerNegation.operand.kind).toBe('binary');
    });

    it('should handle De Morgan\'s law patterns', () => {
      const expr1 = parseExpression('!(x > 0 && y < 10)') as UnaryExpression;
      expect(expr1.kind).toBe('unary');
      expect(expr1.operator).toBe('!');
      expect(expr1.operand.kind).toBe('binary');
      expect((expr1.operand as BinaryExpression).operator).toBe('&&');

      const expr2 = parseExpression('!(x > 0 || y < 10)') as UnaryExpression;
      expect(expr2.kind).toBe('unary');
      expect(expr2.operator).toBe('!');
      expect(expr2.operand.kind).toBe('binary');
      expect((expr2.operand as BinaryExpression).operator).toBe('||');
    });
  });

  describe('Control Flow Statements', () => {
    it('should parse if statements with complex conditions', () => {
      const program = parseSource(`
        if (x > 0 && y < 10) {
          console.log("in range");
        }
      `);
      
      const ifStmt = program.body[0] as IfStatement;
      expect(ifStmt.kind).toBe('if');
      expect(ifStmt.condition.kind).toBe('binary');
      expect((ifStmt.condition as BinaryExpression).operator).toBe('&&');
    });

    it('should parse if-else statements', () => {
      const program = parseSource(`
        if (x > 0) {
          console.log("positive");
        } else {
          console.log("non-positive");
        }
      `);
      
      const ifStmt = program.body[0] as IfStatement;
      expect(ifStmt.kind).toBe('if');
      expect(ifStmt.thenStatement).toBeDefined();
      expect(ifStmt.elseStatement).toBeDefined();
    });

    it('should parse while loops with conditional expressions', () => {
      const program = parseSource(`
        while (x > 0 && !done) {
          x = x - 1;
        }
      `);
      
      const whileStmt = program.body[0] as WhileStatement;
      expect(whileStmt.kind).toBe('while');
      expect(whileStmt.condition.kind).toBe('binary');
      expect((whileStmt.condition as BinaryExpression).operator).toBe('&&');
    });

    it('should parse for loops with complex conditions', () => {
      const program = parseSource(`
        for (let i = 0; i < 10 && !shouldStop; i++) {
          console.log(i);
        }
      `);
      
      const forStmt = program.body[0] as ForStatement;
      expect(forStmt.kind).toBe('for');
      expect(forStmt.condition?.kind).toBe('binary');
      expect((forStmt.condition as BinaryExpression).operator).toBe('&&');
    });

    it('should handle nested control flow with complex conditions', () => {
      const program = parseSource(`
        if (x > 0) {
          while (y < 10 && z != 5) {
            if (a == b || c < d) {
              break;
            }
            y++;
          }
        }
      `);
      
      expect(program.body.length).toBe(1);
      const outerIf = program.body[0] as IfStatement;
      expect(outerIf.kind).toBe('if');
    });
  });

  describe('Comparison Operators', () => {
    it('should parse all comparison operators', () => {
      const operators = ['==', '!=', '<', '<=', '>', '>='];
      
      operators.forEach(op => {
        const expr = parseExpression(`a ${op} b`) as BinaryExpression;
        expect(expr.kind).toBe('binary');
        expect(expr.operator).toBe(op);
      });
    });

    it('should handle chained comparisons', () => {
      const expr = parseExpression('a < b && b < c && c < d') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('&&');
      
      // Verify the structure represents the intended chaining
      const leftAnd = expr.left as BinaryExpression;
      expect(leftAnd.operator).toBe('&&');
      expect(leftAnd.left.kind).toBe('binary'); // a < b
      expect(leftAnd.right.kind).toBe('binary'); // b < c
      expect(expr.right.kind).toBe('binary'); // c < d
    });

    it('should respect comparison operator precedence', () => {
      const expr = parseExpression('a + b < c * d') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('<');
      expect(expr.left.kind).toBe('binary'); // a + b
      expect(expr.right.kind).toBe('binary'); // c * d
    });
  });

  describe('Complex Expression Combinations', () => {
    it('should parse ternary with logical operators', () => {
      const expr = parseExpression('a && b ? c || d : e && f') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.test.kind).toBe('binary');
      expect((expr.test as BinaryExpression).operator).toBe('&&');
      expect(expr.consequent.kind).toBe('binary');
      expect((expr.consequent as BinaryExpression).operator).toBe('||');
      expect(expr.alternate.kind).toBe('binary');
      expect((expr.alternate as BinaryExpression).operator).toBe('&&');
    });

    it('should parse function calls in conditions', () => {
      const expr = parseExpression('func() && getValue() > 0') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('&&');
      expect(expr.left.kind).toBe('call');
      expect(expr.right.kind).toBe('binary');
    });

    it('should parse member access in conditions', () => {
      const expr = parseExpression('obj.isValid && obj.value > 0') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('&&');
      expect(expr.left.kind).toBe('member');
      expect(expr.right.kind).toBe('binary');
    });

    it('should handle parenthesized expressions correctly', () => {
      const expr = parseExpression('(a || b) && (c || d)') as BinaryExpression;
      expect(expr.kind).toBe('binary');
      expect(expr.operator).toBe('&&');
      expect(expr.left.kind).toBe('binary');
      expect((expr.left as BinaryExpression).operator).toBe('||');
      expect(expr.right.kind).toBe('binary');
      expect((expr.right as BinaryExpression).operator).toBe('||');
    });
  });

  describe('Edge Cases', () => {
    it('should handle literal values in conditionals', () => {
      const tests = [
        'true ? 1 : 0',
        'false && x',
        'null || defaultValue',
        '0 && y',
        '"" || "default"'
      ];
      
      tests.forEach(test => {
        const expr = parseExpression(test);
        expect(expr).toBeDefined();
        expect(expr.kind).toMatch(/^(conditional|binary)$/);
      });
    });

    it('should handle empty string and zero in conditionals', () => {
      const expr1 = parseExpression('value || ""') as BinaryExpression;
      expect(expr1.kind).toBe('binary');
      expect(expr1.operator).toBe('||');

      const expr2 = parseExpression('count > 0 && active') as BinaryExpression;
      expect(expr2.kind).toBe('binary');
      expect(expr2.operator).toBe('&&');
    });

    it('should parse complex nested expressions', () => {
      const expr = parseExpression('(a && (b || c)) ? (d && e) : (f || (g && h))') as ConditionalExpression;
      expect(expr.kind).toBe('conditional');
      expect(expr.test.kind).toBe('binary');
      expect(expr.consequent.kind).toBe('binary');
      expect(expr.alternate.kind).toBe('binary');
    });
  });
});
