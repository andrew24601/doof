// Tests for the Doof formatter

import { describe, it, expect } from 'vitest';
import { formatDoofCode, Formatter, DEFAULT_FORMATTER_OPTIONS } from '../src/formatter';

describe('Doof Formatter', () => {
  describe('Basic Formatting', () => {
    it('should format simple function declarations', () => {
      const input = `function main():int{return 0;}`;
      const expected = `function main(): int {
    return 0;
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format variable declarations', () => {
      const input = `let x:int=42;const y:string="hello";`;
      const expected = `let x: int = 42;
const y: string = "hello";
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format class declarations', () => {
      const input = `class Point{x:int;y:int;move(dx:int,dy:int):void{this.x+=dx;this.y+=dy;}}`;
      const expected = `class Point {
    x: int;
    y: int;

    move(dx: int, dy: int): void {
        this.x += dx;
        this.y += dy;
    }
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format enum declarations', () => {
      const input = `enum Color{Red,Green,Blue}`;
      const expected = `enum Color {
    Red,
    Green,
    Blue
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Expression Formatting', () => {
    it('should format binary expressions with proper spacing', () => {
      const input = `let result=a+b*c-d/e;`;
      const expected = `let result = a + b * c - d / e;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format function calls', () => {
      const input = `println("Hello world");doSomething(x,y,z);`;
      const expected = `println("Hello world");
doSomething(x, y, z);
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format array expressions', () => {
      const input = `let arr=[1,2,3,4,5];`;
      const expected = `let arr = [1, 2, 3, 4, 5];
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format object expressions', () => {
      const input = `let obj=Point{x:1,y:2};`;
      const expected = `let obj = Point { x: 1, y: 2 };
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format string interpolation', () => {
      const input = `let msg=\`Hello \${name}, you are \${age} years old\`;`;
      const expected = `let msg = \`Hello \${name}, you are \${age} years old\`;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Control Flow Formatting', () => {
    it('should format if statements', () => {
      const input = `if(x>0){println("positive");}else{println("non-positive");}`;
      const expected = `if (x > 0) {
    println("positive");
} else {
    println("non-positive");
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format else-if chains', () => {
      const input = `if(x>0){println("positive");}else if(x<0){println("negative");}else{println("zero");}`;
      const expected = `if (x > 0) {
    println("positive");
} else if (x < 0) {
    println("negative");
} else {
    println("zero");
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format for loops', () => {
      const input = `for(let i=0;i<10;i++){println(i);}`;
      const expected = `for (let i = 0; i < 10; i++) {
    println(i);
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format for-of loops', () => {
      const input = `for(const item of items){println(item);}`;
      const expected = `for (const item of items) {
    println(item);
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format while loops', () => {
      const input = `while(condition){doSomething();}`;
      const expected = `while (condition) {
    doSomething();
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format switch statements', () => {
      const input = `switch(value){case 1,2:println("small");case 3..10:println("medium");default:println("other");}`;
      const expected = `switch (value) {
    case 1, 2:
        println("small");
    case 3..10:
        println("medium");
    default:
        println("other");
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Import/Export Formatting', () => {
    it('should format import statements', () => {
      const input = `import{add,subtract}from"./math";import{User}from"./user";`;
      const expected = `import { add, subtract } from "./math";
import { User } from "./user";
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format export statements', () => {
      const input = `export function greet(name:string):void{println("Hello "+name);}`;
      const expected = `export function greet(name: string): void {
    println("Hello " + name);
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Advanced Features', () => {
    it('should format lambda expressions', () => {
      const input = `let add=(a:int,b:int):int=>a+b;`;
      const expected = `let add = (a: int, b: int): int => a + b;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format type guards', () => {
      const input = `if(value is string){println("It's a string");}`;
      const expected = `if (value is string) {
    println("It's a string");
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format enum shorthand', () => {
      const input = `let status:Status=.ACTIVE;`;
      const expected = `let status: Status = .ACTIVE;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format range expressions', () => {
      const input = `for(const i of 1..10){println(i);}`;
      const expected = `for (const i of 1..10) {
    println(i);
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format null coalescing', () => {
      const input = `let result=maybeNull??defaultValue;`;
      const expected = `let result = maybeNull ?? defaultValue;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format optional chaining', () => {
      const input = `let result=obj?.property?.method?.();`;
      const expected = `let result = obj?.property?.method?.();
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Indentation Options', () => {
    it('should respect custom indent size', () => {
      const input = `function test():void{if(true){println("hello");}}`;
      const expected = `function test(): void {
  if (true) {
    println("hello");
  }
}
`;
  expect(formatDoofCode(input, { indentSize: 2 })).toBe(expected);
    });

    it('should format deeply nested structures', () => {
      const input = `class Outer{class Inner{method():void{if(true){for(let i=0;i<5;i++){println(i);}}}}}`;
      const expected = `class Outer {
    class Inner {
        method(): void {
            if (true) {
                for (let i = 0; i < 5; i++) {
                    println(i);
                }
            }
        }
    }
}
`;
      console.log("about to test deeply nested structure formatting");
  expect(formatDoofCode(input)).toBe(expected);
      console.log("tested deeply nested structure formatting");
    });
  });

  describe('Line Breaking', () => {
    it('should break long arrays', () => {
      const input = `let arr=[verylongvariablename1,verylongvariablename2,verylongvariablename3,verylongvariablename4];`;
      const options = { maxLineLength: 50, breakLongArrays: true };
  const result = formatDoofCode(input, options);
      
      // Should break the array across multiple lines
      expect(result).toContain('[\n');
      expect(result).toContain('\n]');
    });

    it('should break long object expressions', () => {
      const input = `let obj=Point{verylongfieldname1:value1,verylongfieldname2:value2,verylongfieldname3:value3};`;
      const options = { maxLineLength: 50, breakLongObjects: true };
  const result = formatDoofCode(input, options);
      
      // Should break the object across multiple lines
      expect(result).toContain('{\n');
      expect(result).toContain('\n}');
    });

    it('should break long function parameters', () => {
      const input = `function longFunction(verylongparameter1:int,verylongparameter2:string,verylongparameter3:bool):void{}`;
      const options = { maxLineLength: 50, breakLongFunctionParameters: true };
  const result = formatDoofCode(input, options);
      
      // Should break the parameters across multiple lines
      expect(result).toContain('(\n');
      expect(result).toContain('\n)');
    });
  });

  describe('Real-world Examples', () => {
    it('should format a complete program', () => {
      const input = `import{println}from"./io";enum Status{ACTIVE,INACTIVE}class User{id:int;name:string;status:Status=.ACTIVE;isActive():bool{return this.status==.ACTIVE;}}function main():int{let user=User{id:1,name:"Alice"};if(user.isActive()){println(\`User \${user.name} is active\`);}return 0;}`;
      
      const expected = `import { println } from "./io";

enum Status {
    ACTIVE,
    INACTIVE
}

class User {
    id: int;
    name: string;
    status: Status = .ACTIVE;

    isActive(): bool {
        return this.status == .ACTIVE;
    }
}

function main(): int {
    let user = User { id: 1, name: "Alice" };
    if (user.isActive()) {
        println(\`User \${user.name} is active\`);
    }
    return 0;
}
`;
      
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should handle extern class declarations', () => {
      const input = `extern class AudioEngine{static function initialize():AudioEngine;function playSound(filename:string):void;}`;
      const expected = `extern class AudioEngine {
    static function initialize(): AudioEngine;
    function playSound(filename: string): void;
}
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should format complex expressions with proper precedence', () => {
      const input = `let result=(a+b)*c/(d-e)?f:g??h;`;
      const expected = `let result = (a + b) * c / (d - e) ? f : g ?? h;
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty program', () => {
  expect(formatDoofCode('')).toBe('\n');
    });

    it('should handle program with only comments', () => {
      const input = `// This is a comment\n/* Multi-line\n   comment */`;
      // Note: The current formatter doesn't handle comments, but shouldn't crash
  const result = formatDoofCode(input);
      expect(result).toBeDefined();
    });

    it('should preserve string literal content', () => {
      const input = `let str="  spaces  and\\ttabs\\n";`;
      const expected = `let str = "  spaces  and\\ttabs\\n";
`;
  expect(formatDoofCode(input)).toBe(expected);
    });

    it('should handle single-expression programs', () => {
      const input = `println("hello");`;
      const expected = `println("hello");
`;
  expect(formatDoofCode(input)).toBe(expected);
    });
  });

  describe('Formatter Class Direct Usage', () => {
    it('should allow custom formatter options', () => {
      const formatter = new Formatter({
        indentSize: 8,
        maxLineLength: 120,
        insertSpaceBeforeBlockBrace: false,
        insertSpaceAfterComma: false
      });
      
      expect(formatter).toBeDefined();
      // The actual formatting behavior is tested in other test cases
    });

    it('should use default options when none provided', () => {
      const formatter = new Formatter();
      expect(formatter).toBeDefined();
    });
  });
});