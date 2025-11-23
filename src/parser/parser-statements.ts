import {
  Statement, Expression, IfStatement, WhileStatement, ForStatement, ForOfStatement,
  SwitchStatement, SwitchCase, ReturnStatement, BreakStatement, ContinueStatement,
  BlockStatement, ExpressionStatement, VariableDeclaration, RangeExpression,
  ParseError, Type, BlankStatement, DestructuringAssignment
} from '../types';
import { TokenType } from './lexer';
import { Parser } from './parser';
import { parseExpression } from './parser-expression';
import { parseType } from './parser-types';
import {
  parseVariableDeclaration, parseFunctionDeclaration, parseClassDeclaration,
  parseExternDeclaration, parseEnumDeclaration, parseTypeAliasDeclaration, parseInterfaceDeclaration
} from './parser-declarations';
import { parseExportDeclaration, parseImportDeclaration } from './parser-imports';
import { parseMarkdownHeader, parseMarkdownTable } from './parser-markdown';
import { isObjectPatternStart, isTuplePatternStart, parseObjectPattern, parseTuplePattern } from './parser-patterns';

export function parseStatement(parser: Parser): Statement | null {
  try {
    while (parser.checkRaw(TokenType.NEWLINE)) {
      parser.advanceRaw();
    }

    if (parser.isAtEnd() || parser.check(TokenType.RIGHT_BRACE)) {
      return null;
    }
    
    // Handle standalone comments (comments not following a statement)
    if (parser.check(TokenType.LINE_COMMENT)) {
      return parseCommentStatement(parser);
    }

    if (parser.check(TokenType.MD_HEADER)) {
      return parseMarkdownHeader(parser);
    }

    if (parser.check(TokenType.MD_TABLE_ROW)) {
      return parseMarkdownTable(parser);
    }
    
    if (parser.match(TokenType.EXPORT)) {
      return parseExportDeclaration(parser);
    }
    if (parser.match(TokenType.IMPORT)) {
      return parseImportDeclaration(parser);
    }
    // Handle readonly class
    if (parser.check(TokenType.READONLY) && parser.peek(1).type === TokenType.CLASS) {
      parser.advance(); // consume readonly
      parser.advance(); // consume class
      return parseClassDeclaration(parser, true);
    }
    if (parser.match(TokenType.LET, TokenType.CONST, TokenType.READONLY)) {
      return parseVariableDeclaration(parser);
    }
    if (parser.match(TokenType.FUNCTION)) {
      return parseFunctionDeclaration(parser);
    }
    if (parser.check(TokenType.ASYNC) && parser.peek(1).type === TokenType.FUNCTION) {
      parser.advance(); // consume async
      parser.advance(); // consume function
      return parseFunctionDeclaration(parser, true);
    }
    if (parser.match(TokenType.CLASS)) {
      return parseClassDeclaration(parser);
    }
    if (parser.match(TokenType.INTERFACE)) {
      return parseInterfaceDeclaration(parser);
    }
    if (parser.match(TokenType.EXTERN)) {
      return parseExternDeclaration(parser);
    }
    if (parser.match(TokenType.ENUM)) {
      return parseEnumDeclaration(parser);
    }
    if (parser.match(TokenType.TYPE)) {
      return parseTypeAliasDeclaration(parser);
    }
    if (parser.match(TokenType.IF)) {
      return parseIfStatement(parser);
    }
    if (parser.match(TokenType.WHILE)) {
      return parseWhileStatement(parser);
    }
    if (parser.match(TokenType.FOR)) {
      return parseForStatement(parser);
    }
    if (parser.match(TokenType.SWITCH)) {
      return parseSwitchStatement(parser);
    }
    if (parser.match(TokenType.RETURN)) {
      return parseReturnStatement(parser);
    }
    if (parser.match(TokenType.BREAK)) {
      parser.consume(TokenType.SEMICOLON, "Expected ';' after 'break'");
      let trailingComment: string | undefined;
      if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
        trailingComment = parser.advance().value;
      }
      return { kind: 'break', trailingComment, location: parser.getLocation() } as Statement;
    }
    if (parser.match(TokenType.CONTINUE)) {
      parser.consume(TokenType.SEMICOLON, "Expected ';' after 'continue'");
      let trailingComment: string | undefined;
      if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
        trailingComment = parser.advance().value;
      }
      return { kind: 'continue', trailingComment, location: parser.getLocation() } as Statement;
    }
    if (parser.check(TokenType.LEFT_BRACE)) {
      return parseBlockStatement(parser);
    }

    // Destructuring assignment at statement start: {x, y} = expr; or (x, y) = expr;
    if (isObjectPatternStart(parser) || isTuplePatternStart(parser)) {
      const pattern = isObjectPatternStart(parser) ? parseObjectPattern(parser) : parseTuplePattern(parser);
      parser.consume(TokenType.ASSIGN, "Expected '=' after destructuring pattern");
      const rhs = parseExpression(parser);
      parser.consume(TokenType.SEMICOLON, "Expected ';' after assignment");
      const destr: DestructuringAssignment = {
        kind: 'destructuringAssign',
        pattern,
        expression: rhs,
        location: pattern.location
      };
      return destr;
    }
    return parseExpressionStatement(parser);
  } catch (error) {
    parser.synchronize();
    if (error instanceof ParseError) {
      parser.errors.push(error);
      return null;
    }
    throw error;
  }
}

export function parseIfStatement(parser: Parser): IfStatement {
  // Capture location before parsing sub-statements (if token already consumed)
  const startLocation = parser.previous().location;
  
  parser.consume(TokenType.LEFT_PAREN, "Expected '(' after 'if'");
  const condition = parseExpression(parser);
  parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after if condition");
  
  const thenStatement = parseStatement(parser)!;
  let elseStatement: Statement | undefined;
  
  if (parser.match(TokenType.ELSE)) {
    elseStatement = parseStatement(parser)!;
  }
  
  return {
    kind: 'if',
    condition,
    thenStatement,
    elseStatement,
    location: startLocation
  };
}

export function parseWhileStatement(parser: Parser): WhileStatement {
  // 'while' token already consumed by match() in parseStatement()
  parser.consume(TokenType.LEFT_PAREN, "Expected '(' after 'while'");
  const condition = parseExpression(parser);
  parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after while condition");
  const body = parseStatement(parser)!;
  
  return {
    kind: 'while',
    condition,
    body,
    location: parser.getLocation()
  };
}

export function parseForStatement(parser: Parser): ForStatement | ForOfStatement {
  // 'for' token already consumed by match() in parseStatement()
  parser.consume(TokenType.LEFT_PAREN, "Expected '(' after 'for'");
  
  // Check for for-of loop
  if (parser.match(TokenType.CONST, TokenType.LET, TokenType.READONLY)) {
    const previousType = parser.previous().type;
    const isConst = previousType === TokenType.CONST;
    const isReadonly = previousType === TokenType.READONLY;
    // Disallow destructuring in for-of MVP: we expect a single identifier here
    const variable = parser.consume(TokenType.IDENTIFIER, "Expected variable name");
    
    if (parser.match(TokenType.OF)) {
      const iterable = parseExpression(parser);
      parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after for-of");
      const body = parseStatement(parser)!;
      
      return {
        kind: 'forOf',
        variable: { kind: 'identifier', name: variable.value, location: parser.getLocation() },
        iterable,
        body,
        isConst: isConst || isReadonly, // Treat readonly as const for now in for-of
        location: parser.getLocation()
      };
    } else {
      // Regular for loop with variable declaration
      let type: Type | undefined;
      if (parser.match(TokenType.COLON)) {
        type = parseType(parser);
      }
      
      let initializer: Expression | undefined;
      if (parser.match(TokenType.ASSIGN)) {
        initializer = parseExpression(parser);
      }
      
      const init: VariableDeclaration = {
        kind: 'variable',
        isConst,
        isReadonly,
        identifier: { kind: 'identifier', name: variable.value, location: parser.getLocation() },
        type,
        initializer,
        location: parser.getLocation()
      };
      
      parser.consume(TokenType.SEMICOLON, "Expected ';' after for loop initializer");
      
      let condition: Expression | undefined;
      if (!parser.check(TokenType.SEMICOLON)) {
        condition = parseExpression(parser);
      }
      parser.consume(TokenType.SEMICOLON, "Expected ';' after for loop condition");
      
      let update: Expression | undefined;
      if (!parser.check(TokenType.RIGHT_PAREN)) {
        update = parseExpression(parser);
      }
      parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after for clauses");
      
      const body = parseStatement(parser)!;
      
      return {
        kind: 'for',
        init,
        condition,
        update,
        body,
        location: parser.getLocation()
      };
    }
  } else {
    // Regular for loop
    let init: VariableDeclaration | Expression | undefined;
    if (!parser.check(TokenType.SEMICOLON)) {
      if (parser.match(TokenType.LET, TokenType.CONST, TokenType.READONLY)) {
        const decl = parseVariableDeclaration(parser);
        // MVP: Destructuring variable declarations are not supported in 'for' initializer
        if ((decl as any).kind === 'destructuringVariable') {
          throw new ParseError("Destructuring declarations are not supported in 'for' initializers (MVP)", parser.getLocation());
        }
        init = decl as VariableDeclaration;
      } else {
        init = parseExpression(parser);
      }
    }
    
    if (init?.kind !== 'variable') {
      parser.consume(TokenType.SEMICOLON, "Expected ';' after for loop initializer");
    }
    
    let condition: Expression | undefined;
    if (!parser.check(TokenType.SEMICOLON)) {
      condition = parseExpression(parser);
    }
    parser.consume(TokenType.SEMICOLON, "Expected ';' after for loop condition");
    
    let update: Expression | undefined;
    if (!parser.check(TokenType.RIGHT_PAREN)) {
      update = parseExpression(parser);
    }
    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after for clauses");
    
    const body = parseStatement(parser)!;
    
    return {
      kind: 'for',
      init,
      condition,
      update,
      body,
      location: parser.getLocation()
    };
  }
}

export function parseSwitchStatement(parser: Parser): SwitchStatement {
  // 'switch' token already consumed by match() in parseStatement()
  parser.consume(TokenType.LEFT_PAREN, "Expected '(' after 'switch'");
  const discriminant = parseExpression(parser);
  parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after switch expression");
  parser.consume(TokenType.LEFT_BRACE, "Expected '{' after switch");
  
  const cases: SwitchCase[] = [];
  
  while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
    if (parser.match(TokenType.CASE)) {
      const tests: (Expression | RangeExpression)[] = [];
      
      do {
        if (parser.check(TokenType.NUMBER)) {
          const start = parseExpression(parser);
          if (parser.match(TokenType.RANGE_INCLUSIVE, TokenType.RANGE_EXCLUSIVE)) {
            const inclusive = parser.previous().type === TokenType.RANGE_INCLUSIVE;
            const end = parseExpression(parser);
            tests.push({
              kind: 'range',
              start,
              end,
              inclusive,
              location: parser.getLocation()
            });
          } else {
            tests.push(start);
          }
        } else {
          const expr = parseExpression(parser);
          tests.push(expr);
        }
      } while (parser.match(TokenType.COMMA));
      
      parser.consume(TokenType.COLON, "Expected ':' after case value");
      
      const body: Statement[] = [];
      while (!parser.check(TokenType.CASE) && !parser.check(TokenType.DEFAULT) && !parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        const stmt = parseStatement(parser);
        if (stmt) body.push(stmt);
      }
      
      cases.push({
        kind: 'case',
        tests,
        body,
        isDefault: false,
        location: parser.getLocation()
      });
    } else if (parser.match(TokenType.DEFAULT)) {
      parser.consume(TokenType.COLON, "Expected ':' after 'default'");
      
      const body: Statement[] = [];
      while (!parser.check(TokenType.CASE) && !parser.check(TokenType.DEFAULT) && !parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        const stmt = parseStatement(parser);
        if (stmt) body.push(stmt);
      }
      
      cases.push({
        kind: 'case',
        tests: [],
        body,
        isDefault: true,
        location: parser.getLocation()
      });
    } else {
      throw new ParseError("Expected 'case' or 'default' in switch statement", parser.getLocation());
    }
  }
  
  parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after switch cases");
  
  return {
    kind: 'switch',
    discriminant,
    cases,
    location: parser.getLocation()
  };
}

export function parseReturnStatement(parser: Parser): ReturnStatement {
  // 'return' token already consumed by match() in parseStatement()
  
  let argument: Expression | undefined;
  if (!parser.check(TokenType.SEMICOLON)) {
    argument = parseExpression(parser);
  }
  
  parser.consume(TokenType.SEMICOLON, "Expected ';' after return statement");
  
  let trailingComment: string | undefined;
  if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
    trailingComment = parser.advance().value;
  }
  
  return {
    kind: 'return',
    argument,
    trailingComment,
    location: parser.getLocation()
  };
}

export function parseBlockStatement(parser: Parser): BlockStatement {
  parser.consume(TokenType.LEFT_BRACE, "Expected '{'");
  
  const body: Statement[] = [];
  while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
    const stmt = parseStatement(parser);
    if (stmt) body.push(stmt);
  }
  
  parser.consume(TokenType.RIGHT_BRACE, "Expected '}'");
  
  return {
    kind: 'block',
    body,
    location: parser.getLocation()
  };
}

export function parseExpressionStatement(parser: Parser): ExpressionStatement {
  const expression = parseExpression(parser);
  parser.consume(TokenType.SEMICOLON, "Expected ';' after expression");
  
  let trailingComment: string | undefined;
  if (parser.check(TokenType.LINE_COMMENT) && parser.isAdjacent(parser.previous().location, parser.peek().location)) {
    trailingComment = parser.advance().value;
  }
  
  return {
    kind: 'expression',
    expression,
    trailingComment,
    location: parser.getLocation()
  };
}

export function parseBlankLines(parser: Parser): BlankStatement {
  // Consume all consecutive newlines - they represent one blank line group
  while (parser.checkRaw(TokenType.NEWLINE)) {
    parser.advanceRaw();
  }
  
  return {
    kind: 'blank',
    location: parser.getLocation()
  };
}

export function parseCommentStatement(parser: Parser): BlankStatement {
  const commentToken = parser.advance(); // consume the comment
  
  return {
    kind: 'blank',
    trailingComment: commentToken.value,
    location: parser.getLocation()
  };
}

export function attachTrailingComment(parser: Parser, statement: Statement): Statement {
  // Check if there's a line comment that follows immediately
  if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
    const commentToken = parser.peek();
    // Attach the comment as trailing comment
    statement.trailingComment = parser.advance().value;
  }
  return statement;
}
