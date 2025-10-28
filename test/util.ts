import { Lexer, Parser, Validator, CppGenerator } from "../src";

export function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const validationContext = validator.validate(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', validationContext);
    return {
      errors: validationContext.errors,
      source: result.source,
      header: result.header
    };
  }
