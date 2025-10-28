import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { validateProgramForTests } from './helpers/validation';

describe('Array Printing', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  describe('Validation', () => {
    it('should allow printing array of primitives', () => {
      const code = `
        let numbers: int[] = [1, 2, 3];
        println(numbers);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow printing array of strings', () => {
      const code = `
        let strings: string[] = ["hello", "world"];
        println(strings);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow printing array of booleans', () => {
      const code = `
        let bools: bool[] = [true, false];
        println(bools);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow printing array of objects', () => {
      const code = `
        class Point {
          x: int;
          y: int;
        }
        let points: Point[] = [{x: 1, y: 2}, {x: 3, y: 4}];
        println(points);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow printing nested arrays', () => {
      const code = `
        type Row = int[];
        let matrix: Row[] = [[1, 2], [3, 4]];
        println(matrix);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
    });

  });

  describe('Code Generation', () => {
    it('should generate println call for array', () => {
      const code = `
        let numbers: int[] = [1, 2, 3];
        println(numbers);
      `;
      
      const result = transpileCode(code);
      expect(result.source).toContain('std::cout << numbers << std::endl;');
      expect(result.source).toContain('std::shared_ptr<std::vector<int>> numbers = std::make_shared<std::vector<int>>(std::initializer_list<int>{1, 2, 3})');
    });

    it('should include vector header for dynamic arrays', () => {
      const code = `
        let numbers: int[] = [1, 2, 3];
        println(numbers);
      `;
      
      const result = transpileCode(code);
      expect(result.header).toContain('#include <vector>');
    });

    it('should include array header for constant arrays', () => {
      const code = `
        function printCoords(): void {
          const coords: int[] = [1, 2, 3];
          println(coords);
        }
      `;

      const result = transpileCode(code);
      expect(result.header).toContain('#include <array>');
    });
  });

  describe('Integration with Objects', () => {
    it('should handle arrays of classes with generated operator<< overloads', () => {
      const code = `
        class Person {
          name: string;
          age: int;
        }
        let people: Person[] = [{name: "Alice", age: 30}, {name: "Bob", age: 25}];
        println(people);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      
      // Should generate operator<< for Person class
      expect(result.header).toContain('std::ostream& operator<<(std::ostream& os, const Person& obj)');
      expect(result.header).toContain('std::ostream& operator<<(std::ostream& os, const std::shared_ptr<Person>& obj)');
      
      // Should generate _toJSON method for Person class
      expect(result.header).toContain('void _toJSON(std::ostream& os) const');
      
      // Should allow printing the array
      expect(result.source).toContain('std::cout << people << std::endl;');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed array operations and printing', () => {
      const code = `
        function main(): int {
          let numbers: int[] = [];
          numbers.push(1);
          numbers.push(2);
          numbers.push(3);
          println("Array contents:");
          println(numbers);
          return 0;
        }
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::cout << numbers << std::endl;');
    });

    it('should handle array access and printing', () => {
      const code = `
        type Row = int[];
        let matrix: Row[] = [[1, 2], [3, 4]];
        println("First row:");
        println(matrix[0]);
        println("Full matrix:");
        println(matrix);
      `;
      
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::cout << matrix->at(0) << std::endl;');
      expect(result.source).toContain('std::cout << matrix << std::endl;');
    });
  });

  describe('Type Compatibility', () => {
    it('should allow arrays of non-printable types (validation limitation)', () => {
      // Current implementation allows this at validation time but would fail at C++ compile time
      // This documents a known limitation where arrays are considered printable regardless of element type
      const code = `
        function test() {
          let maps: Map<string, int>[] = [];
          println(maps);
        }
      `;
      
      const result = transpileCode(code);
      // Current behavior - validation passes but C++ compilation would fail
      expect(result.errors.length).toBe(0);
      expect(result.source).toContain('std::cout << maps << std::endl');
    });
  });
});
