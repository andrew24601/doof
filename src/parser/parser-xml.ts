import { Parser } from "./parser";
import { TokenType } from "./lexer";
import {
  Expression,
  Identifier,
  MemberExpression,
  XmlAttribute,
  XmlCallExpression,
  Literal,
  InterpolatedString,
  BlockStatement,
  LambdaExpression
} from "../types";
import { createIdentifier, createLiteral, parseExpression, parseInterpolatedString } from "./parser-expression";
import { ParseError } from "../types";

function parseXmlCallee(parser: Parser): Identifier | MemberExpression {
  // Expect IDENTIFIER then zero or more ('.' IDENTIFIER)
  const first = parser.consume(TokenType.IDENTIFIER, "Expected tag name after '<'");
  let callee: Identifier | MemberExpression = createIdentifier(parser, first.value, first.location);

  while (parser.check(TokenType.DOT)) {
    parser.advance();
    const next = parser.consume(TokenType.IDENTIFIER, "Expected identifier after '.' in tag name");
    callee = {
      kind: 'member',
      object: callee,
      property: { kind: 'identifier', name: next.value, location: next.location },
      computed: false,
      location: parser.getLocation()
    } as MemberExpression;
  }

  return callee;
}

function parseAttributeValue(parser: Parser): Expression {
  // Attribute values support:
  // - { expr }
  // - string/template-string literal
  // - number/boolean literal
  // - identifier (simple)
  if (parser.match(TokenType.LEFT_BRACE)) {
    const expr = parseExpression(parser);
    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' to close attribute expression");
    return expr;
  }

  // Strings (including interpolated as a single literal part)
  if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING) || parser.check(TokenType.INTERPOLATION_START)) {
    const str = parseInterpolatedString(parser);
    return str;
  }

  // Number / boolean literals
  if (parser.check(TokenType.NUMBER) || parser.check(TokenType.BOOLEAN) || parser.check(TokenType.NULL) || parser.check(TokenType.CHAR_LITERAL)) {
    const lit = ((): Expression => {
      if (parser.match(TokenType.NUMBER)) {
        const t = parser.previous();
        return createLiteral(parser, parseFloat(t.value), 'number', t.value, t.location);
      }
      if (parser.match(TokenType.BOOLEAN)) {
        const t = parser.previous();
        return createLiteral(parser, t.value === 'true', 'boolean', undefined, t.location);
      }
      if (parser.match(TokenType.NULL)) {
        const t = parser.previous();
        return createLiteral(parser, null, 'null', undefined, t.location);
      }
      if (parser.match(TokenType.CHAR_LITERAL)) {
        const t = parser.previous();
        return createLiteral(parser, t.value, 'char', undefined, t.location);
      }
      throw new ParseError("Unsupported literal in attribute", parser.getLocation());
    })();
    return lit;
  }

  // Simple identifier
  if (parser.match(TokenType.IDENTIFIER)) {
    const t = parser.previous();
    return createIdentifier(parser, t.value, t.location);
  }

  throw new ParseError("Expected attribute value", parser.getLocation());
}

function parseXmlAttributes(parser: Parser): XmlAttribute[] {
  const attrs: XmlAttribute[] = [];

  while (
    !parser.check(TokenType.GREATER_THAN) &&
    !parser.check(TokenType.SELF_CLOSE)
  ) {
    const nameTok = parser.consume(TokenType.IDENTIFIER, "Expected attribute name");
    const name: Identifier = { kind: 'identifier', name: nameTok.value, location: nameTok.location };

    if (parser.match(TokenType.ARROW)) {
      // Shorthand lambda: name=> expr or name=> { block }
      // Parse body as expression or block
      let lambdaBody: Expression | BlockStatement;
      let isBlock = false;
      if (parser.check(TokenType.LEFT_BRACE)) {
        // Parse block statement as lambda body
        lambdaBody = parser.parseBlockStatement();
        isBlock = true;
      } else {
        lambdaBody = parseExpression(parser);
      }
      const lambdaExpr: LambdaExpression = {
        kind: 'lambda',
        parameters: [], // inferred later based on expected function type
        body: lambdaBody,
        isShortForm: true,
        location: parser.getLocation()
      };
      const attr: XmlAttribute = {
        kind: 'xmlAttribute',
        name,
        value: lambdaExpr,
        isLambdaShorthand: true,
        location: parser.getLocation()
      };
      attrs.push(attr);
      continue;
    }

    parser.consume(TokenType.ASSIGN, "Expected '=' after attribute name");
    const value = parseAttributeValue(parser);
    attrs.push({ kind: 'xmlAttribute', name, value, location: parser.getLocation() });
  }

  return attrs;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parseXmlChildren(parser: Parser, openName: string): Expression[] {
  const children: Expression[] = [];

  // Optional initial newline trimming is handled by collapse rule when converting to literal
  let buffer: string = '';

  const flushBuffer = () => {
    const collapsed = collapseWhitespace(buffer);
    if (collapsed.length > 0) {
      children.push({
        kind: 'literal',
        value: collapsed,
        literalType: 'string',
        location: parser.getLocation()
      } as Literal);
    }
    buffer = '';
  };

  while (!parser.isAtEnd()) {
    // Closing tag: </name>
    if (parser.check(TokenType.LESS_THAN) && parser.peek(1).type === TokenType.DIVIDE) {
      parser.advance(); // '<'
      parser.advance(); // '/'
      const closeName = parser.consume(TokenType.IDENTIFIER, "Expected closing tag name");
      parser.consume(TokenType.GREATER_THAN, "Expected '>' after closing tag name");
      if (closeName.value !== openName) {
        throw new ParseError(`Mismatched closing tag. Expected </${openName}> but got </${closeName.value}>`, parser.getLocation());
      }
      flushBuffer();
      return children;
    }

    // Nested tag
    if (parser.check(TokenType.LESS_THAN) && parser.peek(1).type === TokenType.IDENTIFIER) {
      flushBuffer();
      const nested = parseXmlCall(parser);
      children.push(nested);
      continue;
    }

    // Braced expression child
    if (parser.check(TokenType.LEFT_BRACE)) {
      parser.advance();
      flushBuffer();
      const expr = parseExpression(parser);
      parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after child expression");
      children.push(expr);
      continue;
    }

    // Otherwise treat token as text; accumulate token value
    const tok = parser.advanceRaw();
    // Stop if EOF
    if (tok.type === TokenType.EOF) break;
    // Ignore NEWLINE tokens; we'll collapse later but keep a space placeholder
    if (tok.type === TokenType.NEWLINE) {
      buffer += ' ';
    } else if (tok.type === TokenType.GREATER_THAN || tok.type === TokenType.LESS_THAN) {
      // Put back? Not easily; but LESS_THAN without '/' or identifier shouldn't occur here.
      buffer += ' ';
    } else {
      buffer += tok.value;
      buffer += ' ';
    }
  }

  throw new ParseError(`Unterminated tag <${openName}>`, parser.getLocation());
}

export function parseXmlCall(parser: Parser): XmlCallExpression {
  // We enter with current token being '<'
  parser.consume(TokenType.LESS_THAN, "Expected '<' to start XML call");

  const callee = parseXmlCallee(parser);

  // Attributes until '>' or '/>'
  const attributes = parseXmlAttributes(parser);

  // Self-closing?
  let selfClosing = false;
  if (parser.match(TokenType.SELF_CLOSE)) {
    selfClosing = true;
  } else {
    parser.consume(TokenType.GREATER_THAN, "Expected '>' to close start tag");
  }

  let children: Expression[] | undefined;
  if (!selfClosing) {
    const openName = (callee.kind === 'member')
      ? ((callee.property as any).name as string)
      : (callee as Identifier).name;
    children = parseXmlChildren(parser, openName);
  }

  return {
    kind: 'xmlCall',
    callee,
    attributes,
    children,
    selfClosing,
    location: parser.getLocation()
  };
}
