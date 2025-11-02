import { Parser } from './parser';
import { TokenType } from './lexer';
import { DestructuringAssignment, DestructuringVariableDeclaration, Identifier, ObjectPattern, TuplePattern, ParseError } from '../types';

// Lookahead helpers
export function isObjectPatternStart(parser: Parser): boolean {
  if (!parser.check(TokenType.LEFT_BRACE)) return false;
  const snapshot = parser.saveState();
  try {
    parser.advance(); // consume '{'
    let first = true;
    while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
      if (!parser.check(TokenType.IDENTIFIER)) return false;
      parser.advance();
      first = false;
      if (parser.check(TokenType.COMMA)) {
        parser.advance();
        continue;
      } else if (parser.check(TokenType.RIGHT_BRACE)) {
        break;
      } else {
        return false;
      }
    }
    return !first; // must have at least one name
  } finally {
    parser.restoreState(snapshot);
  }
}

export function isTuplePatternStart(parser: Parser): boolean {
  if (!parser.check(TokenType.LEFT_PAREN)) return false;
  const snapshot = parser.saveState();
  try {
    parser.advance(); // '('
    let count = 0;
    while (!parser.check(TokenType.RIGHT_PAREN) && !parser.isAtEnd()) {
      if (!parser.check(TokenType.IDENTIFIER)) return false;
      parser.advance();
      count++;
      if (parser.check(TokenType.COMMA)) {
        parser.advance();
      } else if (parser.check(TokenType.RIGHT_PAREN)) {
        break;
      } else {
        return false;
      }
    }
    // Require at least two identifiers to distinguish from (x) grouping
    return count >= 2;
  } finally {
    parser.restoreState(snapshot);
  }
}

export function parseObjectPattern(parser: Parser): ObjectPattern {
  const names: Identifier[] = [];
  parser.consume(TokenType.LEFT_BRACE, "Expected '{' to start object pattern");
  do {
    const nameTok = parser.consume(TokenType.IDENTIFIER, 'Expected identifier in object pattern');
    names.push({ kind: 'identifier', name: nameTok.value, location: nameTok.location });
  } while (parser.match(TokenType.COMMA));
  parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after object pattern");
  return {
    kind: 'objectPattern',
    names,
    location: parser.getLocation()
  };
}

export function parseTuplePattern(parser: Parser): TuplePattern {
  const names: Identifier[] = [];
  parser.consume(TokenType.LEFT_PAREN, "Expected '(' to start tuple pattern");
  let count = 0;
  do {
    const nameTok = parser.consume(TokenType.IDENTIFIER, 'Expected identifier in tuple pattern');
    names.push({ kind: 'identifier', name: nameTok.value, location: nameTok.location });
    count++;
  } while (parser.match(TokenType.COMMA));
  parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after tuple pattern");
  if (count < 2) {
    // Consumption happened; report a clear error
    throw new ParseError("Tuple pattern must contain at least two identifiers (use a normal declaration for a single variable)", parser.getLocation());
  }
  return {
    kind: 'tuplePattern',
    names,
    location: parser.getLocation()
  };
}
