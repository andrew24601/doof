import { Program } from '../types';
import { Lexer } from '../parser/lexer';
import { Parser } from '../parser/parser';
import { FormatterOptions, DEFAULT_FORMATTER_OPTIONS } from './options';
import { Printer } from './printer';
import { TypeFormatter } from './type-formatter';
import { ExpressionFormatter } from './expression-formatter';
import { StatementFormatter } from './statement-formatter';

export { FormatterOptions, DEFAULT_FORMATTER_OPTIONS };

export class Formatter {
  private readonly options: FormatterOptions;
  private readonly printer: Printer;
  private readonly typeFormatter: TypeFormatter;
  private readonly expressionFormatter: ExpressionFormatter;
  private readonly statementFormatter: StatementFormatter;

  constructor(options: Partial<FormatterOptions> = {}) {
    this.options = { ...DEFAULT_FORMATTER_OPTIONS, ...options };
    this.printer = new Printer(this.options.indentSize);
    this.typeFormatter = new TypeFormatter(this.printer);
    this.expressionFormatter = new ExpressionFormatter(this.printer, this.options, this.typeFormatter);
    this.statementFormatter = new StatementFormatter(this.printer, this.options, this.typeFormatter);

    this.expressionFormatter.setStatementFormatter(this.statementFormatter);
    this.statementFormatter.setExpressionFormatter(this.expressionFormatter);
  }

  format(program: Program): string {
    this.printer.reset();
    this.statementFormatter.formatProgram(program);
    return this.printer.getResult({
      trimTrailingWhitespace: this.options.trimTrailingWhitespace,
      insertFinalNewline: this.options.insertFinalNewline,
    });
  }
}

export function formatDoofCode(code: string, options?: Partial<FormatterOptions>): string {
  try {
    const lexer = new Lexer(code);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens, 'formatter-input', {});
    const program = parser.parse();

    if (parser.errors.length > 0) {
      throw new Error(parser.errors.map((e: any) => e.message).join(', '));
    }

    const formatter = new Formatter(options);
    return formatter.format(program);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to format code: ${message}`);
  }
}
