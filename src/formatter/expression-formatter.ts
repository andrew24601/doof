import {
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  ConditionalExpression,
  EnumShorthandMemberExpression,
  Expression,
  Identifier,
  IndexExpression,
  InterpolatedString,
  LambdaExpression,
  Literal,
  MemberExpression,
  NullCoalesceExpression,
  ObjectExpression,
  ObjectProperty,
  OptionalChainExpression,
  Parameter,
  NonNullAssertionExpression,
  PositionalObjectExpression,
  RangeExpression,
  SetExpression,
  TrailingLambdaExpression,
  TupleExpression,
  TypeGuardExpression,
  UnaryExpression,
} from '../types';
import { FormatterOptions } from './options';
import { Printer } from './printer';
import { TypeFormatter } from './type-formatter';
import type { StatementFormatter } from './statement-formatter';

export class ExpressionFormatter {
  private statementFormatter?: StatementFormatter;

  constructor(
    private readonly printer: Printer,
    private readonly options: FormatterOptions,
    private readonly typeFormatter: TypeFormatter,
  ) {}

  setStatementFormatter(formatter: StatementFormatter): void {
    this.statementFormatter = formatter;
  }

  formatExpression(expr: Expression): void {
    switch (expr.kind) {
      case 'literal':
        this.formatLiteral(expr as Literal);
        break;
      case 'interpolated-string':
        this.formatInterpolatedString(expr as InterpolatedString);
        break;
      case 'identifier':
        this.printer.write((expr as Identifier).name);
        break;
      case 'binary':
        this.formatBinaryExpression(expr as BinaryExpression);
        break;
      case 'unary':
        this.formatUnaryExpression(expr as UnaryExpression);
        break;
      case 'conditional':
        this.formatConditionalExpression(expr as ConditionalExpression);
        break;
      case 'call':
        this.formatCallExpression(expr as CallExpression);
        break;
      case 'member':
        this.formatMemberExpression(expr as MemberExpression);
        break;
      case 'index':
        this.formatIndexExpression(expr as IndexExpression);
        break;
      case 'array':
        this.formatArrayExpression(expr as ArrayExpression);
        break;
      case 'object':
        this.formatObjectExpression(expr as ObjectExpression);
        break;
      case 'positionalObject':
        this.formatPositionalObjectExpression(expr as PositionalObjectExpression);
        break;
      case 'tuple':
        this.formatTupleExpression(expr as TupleExpression);
        break;
      case 'set':
        this.formatSetExpression(expr as SetExpression);
        break;
      case 'lambda':
        this.formatLambdaExpression(expr as LambdaExpression);
        break;
      case 'trailingLambda':
        this.formatTrailingLambdaExpression(expr as TrailingLambdaExpression);
        break;
      case 'typeGuard':
        this.formatTypeGuardExpression(expr as TypeGuardExpression);
        break;
      case 'enumShorthand':
        this.formatEnumShorthandMemberExpression(expr as EnumShorthandMemberExpression);
        break;
      case 'range':
        this.formatRangeExpression(expr as RangeExpression);
        break;
      case 'nullCoalesce':
        this.formatNullCoalesceExpression(expr as NullCoalesceExpression);
        break;
      case 'optionalChain':
        this.formatOptionalChainExpression(expr as OptionalChainExpression);
        break;
      case 'nonNullAssertion':
        this.formatNonNullAssertionExpression(expr as NonNullAssertionExpression);
        break;
      default:
        this.printer.write(`/* Unknown expression: ${(expr as any).kind} */`);
    }
  }

  formatParameterList(parameters: Parameter[]): void {
    const formatter = this.requireStatementFormatter();
    formatter.formatParameterList(parameters);
  }

  shouldBreakArguments(args: readonly Expression[] | readonly ObjectProperty[]): boolean {
    if (args.length === 0) {
      return false;
    }

    for (const arg of args) {
      if ((arg as Expression).kind === 'object') {
        const obj = arg as ObjectExpression;
        if (obj.properties && obj.properties.length > 2) {
          return true;
        }
      }
    }

    let estimatedLength = this.printer.getCurrentLineLength();
    for (let i = 0; i < args.length; i++) {
      if (i > 0) {
        estimatedLength += 2;
      }
      estimatedLength += this.estimateExpressionLikeLength(args[i]);
    }

    return estimatedLength > this.options.maxLineLength;
  }

  estimateExpressionLength(expr: Expression): number {
    return this.estimateExpressionLikeLength(expr);
  }

  private formatLiteral(expr: Literal): void {
    switch (expr.literalType) {
      case 'string':
        if (expr.isTemplate) {
          this.printer.write('`');
          this.printer.write(String(expr.value));
          this.printer.write('`');
        } else {
          this.printer.write('"');
          this.printer.write(this.escapeStringLiteral(String(expr.value), '"'));
          this.printer.write('"');
        }
        break;
      case 'char':
        this.printer.write("'");
        this.printer.write(this.escapeStringLiteral(String(expr.value), "'"));
        this.printer.write("'");
        break;
      case 'null':
        this.printer.write('null');
        break;
      default:
        this.printer.write(String(expr.value));
        break;
    }
  }

  private escapeStringLiteral(value: string, quote: '"' | "'"): string {
    let result = '';
    for (const char of value) {
      switch (char) {
        case '\\':
          result += '\\\\';
          break;
        case '\n':
          result += '\\n';
          break;
        case '\r':
          result += '\\r';
          break;
        case '\t':
          result += '\\t';
          break;
        case '\b':
          result += '\\b';
          break;
        case '\f':
          result += '\\f';
          break;
        case '\v':
          result += '\\v';
          break;
        case '\0':
          result += '\\0';
          break;
        default: {
          if (char === quote) {
            result += `\\${quote}`;
            break;
          }
          const code = char.charCodeAt(0);
          if (code < 32 || code === 127) {
            result += `\\u${code.toString(16).padStart(4, '0')}`;
          } else {
            result += char;
          }
        }
      }
    }
    return result;
  }

  private formatInterpolatedString(expr: InterpolatedString): void {
    const quote = expr.isTemplate ? '`' : '"';
    this.printer.write(quote);
    for (const part of expr.parts) {
      if (typeof part === 'string') {
        this.printer.write(part);
      } else {
        this.printer.write('${');
        this.formatExpression(part);
        this.printer.write('}');
      }
    }
    this.printer.write(quote);
  }

  private formatBinaryExpression(expr: BinaryExpression): void {
    const leftNeedsParens = this.needsBinaryParentheses(expr.left, expr.operator, 'left');
    const rightNeedsParens = this.needsBinaryParentheses(expr.right, expr.operator, 'right');

    if (leftNeedsParens) {
      this.printer.write('(');
    }
    this.formatExpression(expr.left);
    if (leftNeedsParens) {
      this.printer.write(')');
    }

    if (this.options.insertSpaceAroundBinaryOperators) {
      this.printer.write(' ');
    }
    this.printer.write(expr.operator);
    if (this.options.insertSpaceAroundBinaryOperators) {
      this.printer.write(' ');
    }

    if (rightNeedsParens) {
      this.printer.write('(');
    }
    this.formatExpression(expr.right);
    if (rightNeedsParens) {
      this.printer.write(')');
    }
  }

  private needsBinaryParentheses(
    operand: Expression,
    parentOperator: string,
    position: 'left' | 'right',
  ): boolean {
    if (operand.kind !== 'binary') {
      return false;
    }

    const childOperator = (operand as BinaryExpression).operator;
    const parentPrecedence = this.getBinaryPrecedence(parentOperator);
    const childPrecedence = this.getBinaryPrecedence(childOperator);

    if (childPrecedence < parentPrecedence) {
      return true;
    }

    if (childPrecedence > parentPrecedence) {
      return false;
    }

    if (position === 'left') {
      if (this.isRightAssociativeOperator(parentOperator)) {
        return true;
      }
      if (parentOperator === childOperator && this.isAssociativeOperator(parentOperator)) {
        return false;
      }
      return false;
    }

    if (this.isRightAssociativeOperator(parentOperator)) {
      return false;
    }

    if (parentOperator === childOperator && this.isAssociativeOperator(parentOperator)) {
      return false;
    }

    return true;
  }

  private getBinaryPrecedence(operator: string): number {
    switch (operator) {
      case '**':
        return 11;
      case '*':
      case '/':
      case '%':
        return 10;
      case '+':
      case '-':
        return 9;
      case '<<':
      case '>>':
      case '>>>':
        return 8;
      case '<':
      case '<=':
      case '>':
      case '>=':
        return 7;
      case '==':
      case '!=':
      case '===':
      case '!==':
        return 6;
      case '&':
        return 5;
      case '^':
        return 4;
      case '|':
        return 3;
      case '&&':
        return 2;
      case '||':
        return 1;
      case '??':
        return 0;
      default:
        return -1;
    }
  }

  private isAssociativeOperator(operator: string): boolean {
    return operator === '+' || operator === '*' || operator === '&&' || operator === '||';
  }

  private isRightAssociativeOperator(operator: string): boolean {
    return operator === '**';
  }

  private formatUnaryExpression(expr: UnaryExpression): void {
    if (expr.operator === '++_post') {
      this.formatExpression(expr.operand);
      this.printer.write('++');
      return;
    }

    if (expr.operator === '--_post') {
      this.formatExpression(expr.operand);
      this.printer.write('--');
      return;
    }

    this.printer.write(expr.operator);
    this.formatExpression(expr.operand);
  }

  private formatConditionalExpression(expr: ConditionalExpression): void {
    this.formatExpression(expr.test);
    this.printer.write(' ? ');
    this.formatExpression(expr.consequent);
    this.printer.write(' : ');
    this.formatExpression(expr.alternate);
  }

  private formatCallExpression(expr: CallExpression): void {
    this.formatExpression(expr.callee);

    if (expr.namedArguments) {
      this.formatNamedArguments(expr.namedArguments);
      return;
    }

    this.printer.write('(');
    if (
      expr.arguments.length > 0 &&
      this.options.breakLongFunctionParameters &&
      this.shouldBreakArguments(expr.arguments)
    ) {
      this.printer.writeLine();
      this.printer.increaseIndent();
      for (let i = 0; i < expr.arguments.length; i++) {
        this.printer.writeIndent();
        this.formatExpression(expr.arguments[i]);
        if (i < expr.arguments.length - 1) {
          this.printer.write(',');
        }
        this.printer.writeLine();
      }
      this.printer.decreaseIndent();
      this.printer.writeIndent();
    } else {
      for (let i = 0; i < expr.arguments.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        this.formatExpression(expr.arguments[i]);
      }
    }
    this.printer.write(')');
  }

  private formatNamedArguments(args: ObjectProperty[]): void {
    this.printer.write(' {');
    if (args.length === 0) {
      this.printer.write('}');
      return;
    }

    if (this.options.breakLongObjects && this.shouldBreakArguments(args)) {
      this.printer.writeLine();
      this.printer.increaseIndent();
      for (let i = 0; i < args.length; i++) {
        this.printer.writeIndent();
        this.formatObjectProperty(args[i]);
        if (i < args.length - 1) {
          this.printer.write(',');
        }
        this.printer.writeLine();
      }
      this.printer.decreaseIndent();
      this.printer.writeIndent();
    } else {
      if (this.options.insertSpaceAfterComma) {
        this.printer.write(' ');
      }
      for (let i = 0; i < args.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        this.formatObjectProperty(args[i]);
      }
      if (this.options.insertSpaceAfterComma) {
        this.printer.write(' ');
      }
    }
    this.printer.write('}');
  }

  private formatMemberExpression(expr: MemberExpression): void {
    this.formatExpression(expr.object);
    if (expr.computed) {
      this.printer.write('[');
      if (expr.property.kind === 'literal') {
        this.formatLiteral(expr.property as Literal);
      } else {
        this.formatExpression(expr.property);
      }
      this.printer.write(']');
    } else {
      this.printer.write('.');
      this.printer.write((expr.property as Identifier).name);
    }
  }

  private formatIndexExpression(expr: IndexExpression): void {
    this.formatExpression(expr.object);
    this.printer.write('[');
    this.formatExpression(expr.index);
    this.printer.write(']');
  }

  private formatArrayExpression(expr: ArrayExpression): void {
    this.printer.write('[');
    if (expr.elements.length > 0) {
      if (this.options.breakLongArrays && this.shouldBreakArguments(expr.elements)) {
        this.printer.writeLine();
        this.printer.increaseIndent();
        for (let i = 0; i < expr.elements.length; i++) {
          this.printer.writeIndent();
          this.formatExpression(expr.elements[i]);
          if (i < expr.elements.length - 1) {
            this.printer.write(',');
          }
          this.printer.writeLine();
        }
        this.printer.decreaseIndent();
        this.printer.writeIndent();
      } else {
        for (let i = 0; i < expr.elements.length; i++) {
          if (i > 0) {
            this.printer.write(', ');
          }
          this.formatExpression(expr.elements[i]);
        }
      }
    }
    this.printer.write(']');
  }

  private formatObjectExpression(expr: ObjectExpression): void {
    if (expr.className) {
      this.printer.write(expr.className);
      this.printer.write(' ');
    }

    this.printer.write('{');
    if (expr.properties.length > 0) {
      if (this.options.breakLongObjects && this.shouldBreakArguments(expr.properties)) {
        this.printer.writeLine();
        this.printer.increaseIndent();
        for (let i = 0; i < expr.properties.length; i++) {
          this.printer.writeIndent();
          this.formatObjectProperty(expr.properties[i]);
          if (i < expr.properties.length - 1) {
            this.printer.write(',');
          }
          this.printer.writeLine();
        }
        this.printer.decreaseIndent();
        this.printer.writeIndent();
      } else {
        if (this.options.insertSpaceAfterComma) {
          this.printer.write(' ');
        }
        for (let i = 0; i < expr.properties.length; i++) {
          if (i > 0) {
            this.printer.write(', ');
          }
          this.formatObjectProperty(expr.properties[i]);
        }
        if (this.options.insertSpaceAfterComma) {
          this.printer.write(' ');
        }
      }
    }
    this.printer.write('}');
  }

  private formatPositionalObjectExpression(expr: PositionalObjectExpression): void {
    this.printer.write(expr.className);
    this.printer.write('(');
    for (let i = 0; i < expr.arguments.length; i++) {
      if (i > 0) {
        this.printer.write(', ');
      }
      this.formatExpression(expr.arguments[i]);
    }
    this.printer.write(')');
  }

  private formatTupleExpression(expr: TupleExpression): void {
    this.printer.write('(');
    for (let i = 0; i < expr.elements.length; i++) {
      if (i > 0) {
        this.printer.write(', ');
      }
      this.formatExpression(expr.elements[i]);
    }
    this.printer.write(')');
  }

  private formatSetExpression(expr: SetExpression): void {
    this.printer.write('{');
    if (expr.elements.length > 0) {
      if (this.options.breakLongArrays && this.shouldBreakArguments(expr.elements)) {
        this.printer.writeLine();
        this.printer.increaseIndent();
        for (let i = 0; i < expr.elements.length; i++) {
          this.printer.writeIndent();
          this.formatExpression(expr.elements[i]);
          if (i < expr.elements.length - 1) {
            this.printer.write(',');
          }
          this.printer.writeLine();
        }
        this.printer.decreaseIndent();
        this.printer.writeIndent();
      } else {
        if (this.options.insertSpaceAfterComma) {
          this.printer.write(' ');
        }
        for (let i = 0; i < expr.elements.length; i++) {
          if (i > 0) {
            this.printer.write(', ');
          }
          this.formatExpression(expr.elements[i]);
        }
        if (this.options.insertSpaceAfterComma) {
          this.printer.write(' ');
        }
      }
    }
    this.printer.write('}');
  }

  private formatObjectProperty(prop: ObjectProperty): void {
    switch (prop.key.kind) {
      case 'enumShorthand':
        this.formatEnumShorthandMemberExpression(prop.key as EnumShorthandMemberExpression);
        break;
      case 'member':
        this.formatMemberExpression(prop.key as MemberExpression);
        break;
      case 'literal':
        this.formatLiteral(prop.key as Literal);
        break;
      default:
        this.printer.write((prop.key as Identifier).name);
        break;
    }

    if (!prop.shorthand && prop.value) {
      this.printer.write(': ');
      this.formatExpression(prop.value);
    }
  }

  private formatLambdaExpression(expr: LambdaExpression): void {
    const statementFormatter = this.requireStatementFormatter();

    if (expr.isShortForm) {
      this.printer.write('=> ');
      if (expr.body.kind === 'block') {
        statementFormatter.formatBlockStatement(expr.body, false);
      } else {
        this.formatExpression(expr.body);
      }
      return;
    }

    this.printer.write('(');
    statementFormatter.formatParameterList(expr.parameters);
    this.printer.write(')');
    if (expr.returnType) {
      this.printer.write(': ');
      this.typeFormatter.formatType(expr.returnType);
    }
    this.printer.write(' => ');
    if (expr.body.kind === 'block') {
      statementFormatter.formatBlockStatement(expr.body, false);
    } else {
      this.formatExpression(expr.body);
    }
  }

  private formatTrailingLambdaExpression(expr: TrailingLambdaExpression): void {
    const statementFormatter = this.requireStatementFormatter();

    this.formatExpression(expr.callee);
    this.printer.write('(');
    for (let i = 0; i < expr.arguments.length; i++) {
      if (i > 0) {
        this.printer.write(', ');
      }
      this.formatExpression(expr.arguments[i]);
    }
    this.printer.write(')');
    this.printer.write(' => ');

    if (expr.lambda.body.kind === 'block') {
      statementFormatter.formatBlockStatement(expr.lambda.body, false);
    } else {
      this.formatExpression(expr.lambda.body);
    }
  }

  private formatTypeGuardExpression(expr: TypeGuardExpression): void {
    this.formatExpression(expr.expression);
    this.printer.write(' is ');
    this.typeFormatter.formatType(expr.type);
  }

  private formatEnumShorthandMemberExpression(expr: EnumShorthandMemberExpression): void {
    this.printer.write('.');
    this.printer.write(expr.memberName);
  }

  private formatRangeExpression(expr: RangeExpression): void {
    this.formatExpression(expr.start);
    this.printer.write(expr.inclusive ? '..' : '..<');
    this.formatExpression(expr.end);
  }

  private formatNullCoalesceExpression(expr: NullCoalesceExpression): void {
    this.formatExpression(expr.left);
    this.printer.write(' ?? ');
    this.formatExpression(expr.right);
  }

  private formatOptionalChainExpression(expr: OptionalChainExpression): void {
    this.formatExpression(expr.object);
    this.printer.write('?.');
    if (expr.property) {
      if (expr.computed) {
        this.printer.write('[');
        if (expr.property.kind === 'literal') {
          this.formatLiteral(expr.property as Literal);
        } else {
          this.printer.write((expr.property as Identifier).name);
        }
        this.printer.write(']');
      } else {
        this.printer.write((expr.property as Identifier).name);
      }
    }
  }

  private formatNonNullAssertionExpression(expr: NonNullAssertionExpression): void {
    this.formatExpression(expr.operand);
    this.printer.write('!');
  }

  private estimateExpressionLikeLength(expr: Expression | ObjectProperty): number {
    if (!expr) {
      return 0;
    }

    if ((expr as ObjectProperty).kind === 'property') {
      const prop = expr as ObjectProperty;
      return this.estimatePropertyLength(prop);
    }

    const expression = expr as Expression;
    switch (expression.kind) {
      case 'literal':
        return this.estimateLiteralLength(expression as Literal);
      case 'identifier':
        return (expression as Identifier).name.length;
      case 'binary': {
        const binary = expression as BinaryExpression;
        return (
          this.estimateExpressionLength(binary.left) +
          binary.operator.length +
          2 +
          this.estimateExpressionLength(binary.right)
        );
      }
      case 'call': {
        const call = expression as CallExpression;
        let length = this.estimateExpressionLength(call.callee) + 2;
        if (call.arguments) {
          for (let i = 0; i < call.arguments.length; i++) {
            if (i > 0) {
              length += 2;
            }
            length += this.estimateExpressionLength(call.arguments[i]);
          }
        }
        return length;
      }
      case 'object': {
        const objectExpr = expression as ObjectExpression;
        let length = (objectExpr.className ? objectExpr.className.length + 1 : 0) + 2;
        if (objectExpr.properties && objectExpr.properties.length > 0) {
          for (let i = 0; i < objectExpr.properties.length; i++) {
            if (i > 0) {
              length += 2;
            }
            length += this.estimatePropertyLength(objectExpr.properties[i]);
          }
        }
        return length;
      }
      case 'array': {
        const arrayExpr = expression as ArrayExpression;
        let length = 2;
        if (arrayExpr.elements && arrayExpr.elements.length > 0) {
          for (let i = 0; i < arrayExpr.elements.length; i++) {
            if (i > 0) {
              length += 2;
            }
            length += this.estimateExpressionLength(arrayExpr.elements[i]);
          }
        }
        return length;
      }
      default:
        return 20;
    }
  }

  private estimateLiteralLength(literal: Literal): number {
    if (literal.literalType === 'string') {
      return String(literal.value).length + 2;
    }
    if (literal.literalType === 'char') {
      return 3;
    }
    return String(literal.value).length;
  }

  private estimatePropertyLength(prop: ObjectProperty): number {
    let keyLength = 0;
    switch (prop.key.kind) {
      case 'identifier':
        keyLength = (prop.key as Identifier).name.length;
        break;
      case 'literal':
        keyLength = this.estimateLiteralLength(prop.key as Literal);
        break;
      case 'member':
        keyLength = 5; // rough estimate for member expressions
        break;
      case 'enumShorthand':
        keyLength = (prop.key as EnumShorthandMemberExpression).memberName.length + 1;
        break;
      default:
        keyLength = 5;
        break;
    }

    if (prop.shorthand || !prop.value) {
      return keyLength;
    }

    return keyLength + 2 + this.estimateExpressionLength(prop.value);
  }

  private requireStatementFormatter(): StatementFormatter {
    if (!this.statementFormatter) {
      throw new Error('Statement formatter has not been configured for ExpressionFormatter');
    }
    return this.statementFormatter;
  }
}
