import { describe, it, expect } from 'vitest';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Parser } from '../src/parser/parser.js';
import { Lexer } from '../src/parser/lexer.js';
import { validateProgramForTests } from './helpers/validation';

describe('Extended Enum Shorthand Syntax', () => {
  function parseAndValidate(code: string, allowErrors = false) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    const context = validateProgramForTests(program, { allowErrors });
    return { program, errors: context.errors, context };
  }

  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const context = validateProgramForTests(ast);
    const generator = new CppGenerator();
    return generator.generate(ast, 'test', context);
  }

  describe('Object Field Initialization', () => {
    it('should support enum inferencing in class field', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE,
          PENDING
        }
        
        class Task {
          name: string;
          status = Status.ACTIVE;
        }
        
        function createTask(): Task {
          return Task { 
            name: "Test Task"
          };
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
      
      const result = transpileCode(code);
      expect(result.source).toContain('Status::ACTIVE');
    });

    it('should support enum shorthand in class field default', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE,
          PENDING
        }
        
        class Task {
          name: string;
          status: Status = .ACTIVE;
        }
        
        function createTask(): Task {
          return Task { 
            name: "Test Task"
          };
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
      
      const result = transpileCode(code);
      expect(result.source).toContain('Status::ACTIVE');
    });

    it('should support enum shorthand in object field initialization', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE,
          PENDING
        }
        
        class Task {
          name: string;
          status: Status;
        }
        
        function createTask(): Task {
          return Task { 
            name: "Test Task",
            status: .ACTIVE
          };
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
      
      const result = transpileCode(code);
      expect(result.source).toContain('Status::ACTIVE');
    });

    it('should support mixed enum syntax in object fields', () => {
      const code = `
        enum Priority {
          HIGH,
          MEDIUM,
          LOW
        }
        
        class Config {
          priority: Priority;
          backup_priority: Priority;
        }
        
        function main(): int {
          let config: Config = Config {
            priority: .HIGH,
            backup_priority: Priority.LOW
          };
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
    });

    it('should validate enum shorthand against field type', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE
        }
        
        enum Priority {
          HIGH,
          LOW
        }
        
        class Task {
          status: Status;
        }
        
        function main(): int {
          let task: Task = Task {
            status: .HIGH  // Should error - HIGH is not in Status enum
          };
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors.some(e => e.message.includes('Invalid enum member'))).toBe(true);
    });
  });

  describe('Function Parameter Passing', () => {
    it('should support enum shorthand in function arguments', () => {
      const code = `
        enum Mode {
          READ,
          WRITE,
          APPEND
        }
        
        function openFile(filename: string, mode: Mode): bool {
          return true;
        }
        
        function main(): int {
          let success: bool = openFile("test.txt", .READ);
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
      
      const result = transpileCode(code);
      expect(result.source).toContain('Mode::READ');
    });

    it('should support enum shorthand in method calls', () => {
      const code = `
        enum LogLevel {
          DEBUG,
          INFO,
          WARN,
          ERROR
        }
        
        class Logger {
          log(message: string, level: LogLevel): void {
            // implementation
          }
        }
        
        function main(): int {
          let logger: Logger = Logger {};
          logger.log("Test message", .INFO);
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
    });

    it('should validate enum shorthand against parameter type', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE
        }
        
        enum Priority {
          HIGH,
          LOW
        }
        
        function setStatus(status: Status): void {
          // implementation
        }
        
        function main(): int {
          setStatus(.HIGH);  // Should error - HIGH is not in Status enum
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors.some(e => e.message.includes('Invalid enum member') || e.message.includes('cannot convert'))).toBe(true);
    });

    it('should support multiple enum parameters with shorthand', () => {
      const code = `
        enum Action {
          CREATE,
          UPDATE,
          DELETE
        }
        
        enum Target {
          USER,
          PRODUCT,
          ORDER
        }
        
        function performAction(action: Action, target: Target): bool {
          return true;
        }
        
        function main(): int {
          let result: bool = performAction(.CREATE, .USER);
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Nested Usage', () => {
    it('should support enum shorthand in nested object initialization', () => {
      const code = `
        enum Status {
          ACTIVE,
          INACTIVE
        }
        
        enum Priority {
          HIGH,
          LOW
        }
        
        class Task {
          status: Status;
          priority: Priority;
        }
        
        class Project {
          name: string;
          task: Task;
        }
        
        function main(): int {
          let project: Project = Project {
            name: "Test Project",
            task: Task {
              status: .ACTIVE,
              priority: .HIGH
            }
          };
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toStrictEqual([]);
    });

    it('should support enum shorthand in function calls within object initialization', () => {
      const code = `
        enum Mode {
          DEVELOPMENT,
          PRODUCTION
        }
        
        function getMode(): Mode {
          return .DEVELOPMENT;
        }
        
        function createConfig(mode: Mode): string {
          return "config";
        }
        
        class App {
          config: string;
        }
        
        function main(): int {
          let app: App = App {
            config: createConfig(.PRODUCTION)
          };
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toStrictEqual([]);
    });
  });

  describe('Assignment Operations', () => {
    it('should support enum shorthand in variable assignment', () => {
      const code = `
        enum State {
          IDLE,
          RUNNING,
          STOPPED
        }
        
        function main(): int {
          let currentState: State;
          currentState = .RUNNING;
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
    });

    it('should support enum shorthand in field assignment', () => {
      const code = `
        enum Phase {
          PLANNING,
          EXECUTION,
          REVIEW
        }
        
        class Project {
          phase: Phase;
        }
        
        function main(): int {
          let project: Project = Project { phase: .PLANNING };
          project.phase = .EXECUTION;
          return 0;
        }
      `;
      
  const { errors } = parseAndValidate(code, true);
      expect(errors).toHaveLength(0);
    });
  });
});
