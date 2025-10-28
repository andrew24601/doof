// Parser for doof language

import { Token, TokenType } from './lexer';
import {
  ASTNode, Program, Statement, Expression, Type, PrimitiveType,
  VariableDeclaration, FunctionDeclaration, ClassDeclaration, ExternClassDeclaration,
  EnumDeclaration, TypeAliasDeclaration, IfStatement, WhileStatement, ForStatement, ForOfStatement,
  SwitchStatement, SwitchCase, ReturnStatement,
  BreakStatement, ContinueStatement, ImportDeclaration, ExportDeclaration,
  BlockStatement, ExpressionStatement, BlankStatement, Literal, InterpolatedString, Identifier, BinaryExpression,
  UnaryExpression, ConditionalExpression, CallExpression, MemberExpression, IndexExpression, ArrayExpression, ObjectExpression,
  PositionalObjectExpression, SetExpression, ObjectProperty, LambdaExpression, RangeExpression,
  EnumShorthandMemberExpression, TrailingLambdaExpression, TypeGuardExpression, Parameter, FieldDeclaration, MethodDeclaration,
  EnumMember, ImportSpecifier, PrimitiveTypeNode, ArrayTypeNode, MapTypeNode,
  SetTypeNode, ClassTypeNode, FunctionTypeNode, UnionTypeNode, TypeAliasNode, SourceLocation, ParseError,
  NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression
} from '../types';
import { NamespaceMapper, NamespaceMapperOptions } from '../namespace-mapper';
import { createPrimitiveType, parseType } from './parser-types';
import { createIdentifier, createLiteral, parseExpression, parseInterpolatedString } from './parser-expression';
import { parseStatement, parseBlockStatement } from './parser-statements';
import { parseVariableDeclaration, parseFunctionDeclaration, parseClassDeclaration, parseExternDeclaration, parseEnumDeclaration, parseTypeAliasDeclaration } from './parser-declarations';

export interface ParserStateSnapshot {
  current: number;
  lastToken: Token | null;
  lastSignificantToken: Token | null;
}

export class Parser {
  public tokens: Token[];
  public current: number = 0;
  public filename: string;
  private namespaceMapper: NamespaceMapper;
  public errors: ParseError[] = [];
  private lastToken: Token | null = null;
  private lastSignificantToken: Token | null = null;
  private functionDepth = 0;

  constructor(tokens: Token[], filename: string = 'input', namespaceMapperOptions: NamespaceMapperOptions = {}) {
    this.tokens = tokens.filter(t => t.type !== TokenType.WHITESPACE);
    this.current = 0;
    this.filename = filename;
    this.namespaceMapper = new NamespaceMapper(namespaceMapperOptions);
    // Preserve trivia consistently across all tools (formatter, codegen, tests)

    if (this.tokens.length > 0) {
      this.lastToken = this.tokens[0];
      this.lastSignificantToken = this.tokens[0].type === TokenType.NEWLINE ? null : this.tokens[0];
    }
  }

  parse(): Program {
    const body: Statement[] = [];
    this.errors = [];

    while (!this.isAtEnd()) {
      try {
        const startIndex = this.current;
        if (this.checkRaw(TokenType.NEWLINE)) {
          let newlineCount = 0;
          while (this.checkRaw(TokenType.NEWLINE)) {
            this.advanceRaw();
            newlineCount++;
          }

          if (newlineCount > 1) {
            body.push({
              kind: 'blank',
              location: this.getLocation()
            } as BlankStatement);
          }
          continue;
        }

        const stmt = parseStatement(this);
        if (stmt) {
          body.push(stmt);
        } else if (this.current === startIndex && !this.isAtEndRaw()) {
          // Ensure progress even when parseStatement returns null without consuming tokens
          this.advanceRaw();
        }
      } catch (error) {
        if (error instanceof ParseError) {
          this.errors.push(error);
        } else {
          throw error;
        }
      }
    }

    return {
      kind: 'program',
      body,
      filename: this.filename,
      moduleName: this.deriveModuleName(this.filename),
      location: this.getLocation(),
      errors: this.errors
    };
  }

  public parseBlockStatement(): BlockStatement {
    return parseBlockStatement(this);
  }

  public parseParameterList(): Parameter[] {
    const { parseParameterList } = require('./parser-parameters');
    return parseParameterList(this);
  }

  private skipNewlinesFromIndex(index: number): number {
    let currentIndex = index;
    while (currentIndex < this.tokens.length && this.tokens[currentIndex].type === TokenType.NEWLINE) {
      currentIndex++;
    }
    return currentIndex;
  }

  private findIndexSkippingNewlines(startIndex: number, offset: number = 0): number {
    let index = this.skipNewlinesFromIndex(startIndex);
    let remaining = offset;

    while (remaining > 0 && index < this.tokens.length) {
      index = this.skipNewlinesFromIndex(index + 1);
      remaining--;
    }

    if (index >= this.tokens.length) {
      return this.tokens.length - 1;
    }

    return index;
  }

  public match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  public saveState(): ParserStateSnapshot {
    return {
      current: this.current,
      lastToken: this.lastToken,
      lastSignificantToken: this.lastSignificantToken
    };
  }

  public restoreState(snapshot: ParserStateSnapshot): void {
    this.current = snapshot.current;
    this.lastToken = snapshot.lastToken;
    this.lastSignificantToken = snapshot.lastSignificantToken;
  }

  public isAdjacent(loc1: SourceLocation, loc2: SourceLocation): boolean {
    return loc1.end.line === loc2.start.line && loc1.end.column === loc2.start.column;
  }

  public isSameLine(loc1: SourceLocation, loc2: SourceLocation): boolean {
    const endLine = loc1.end?.line ?? loc1.start?.line;
    const startLine = loc2.start?.line ?? loc2.end?.line;
    return endLine !== undefined && startLine !== undefined && endLine === startLine;
  }

  public check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  public checkRaw(type: TokenType): boolean {
    if (this.isAtEndRaw()) return false;
    return this.peekRaw().type === type;
  }

  public checkNext(type: TokenType): boolean {
    const index = this.findIndexSkippingNewlines(this.current, 1);
    if (index >= this.tokens.length) return false;
    return this.tokens[index].type === type;
  }

  public advance(): Token {
    const index = this.findIndexSkippingNewlines(this.current);
    this.current = Math.min(index, this.tokens.length - 1);

    if (this.isAtEndRaw()) {
      const eofToken = this.tokens[this.tokens.length - 1];
      this.lastToken = eofToken;
      if (eofToken.type !== TokenType.NEWLINE) {
        this.lastSignificantToken = eofToken;
      }
      return eofToken;
    }

    const token = this.tokens[this.current];
    this.current++;
    this.lastToken = token;
    if (token.type !== TokenType.NEWLINE) {
      this.lastSignificantToken = token;
    }
    return token;
  }

  public advanceRaw(): Token {
    if (this.isAtEndRaw()) {
      const eofToken = this.tokens[this.tokens.length - 1];
      this.lastToken = eofToken;
      return eofToken;
    }

    const token = this.tokens[this.current];
    this.current++;
    this.lastToken = token;
    if (token.type !== TokenType.NEWLINE) {
      this.lastSignificantToken = token;
    }
    return token;
  }

  public isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private isAtEndRaw(): boolean {
    return this.current >= this.tokens.length || this.tokens[this.current].type === TokenType.EOF;
  }

  public peek(offset: number = 0): Token {
    const index = this.findIndexSkippingNewlines(this.current, offset);
    return this.tokens[index] || this.tokens[this.tokens.length - 1];
  }

  public peekRaw(offset: number = 0): Token {
    return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)];
  }

  public previous(): Token {
    if (this.lastSignificantToken) {
      return this.lastSignificantToken;
    }
    return this.tokens[Math.max(this.current - 1, 0)];
  }

  public previousRaw(): Token {
    if (this.lastToken) {
      return this.lastToken;
    }
    return this.tokens[Math.max(this.current - 1, 0)];
  }

  public consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new ParseError(`${message}. Got '${this.peek().value}'`, this.getLocation());
  }

  public isInsideFunctionScope(): boolean {
    return this.functionDepth > 0;
  }

  public withFunctionScope<T>(callback: () => T): T {
    this.functionDepth++;
    try {
      return callback();
    } finally {
      this.functionDepth--;
    }
  }

  public synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === TokenType.SEMICOLON) return;

      switch (this.peek().type) {
        case TokenType.CLASS:
        case TokenType.FUNCTION:
        case TokenType.LET:
        case TokenType.CONST:
        case TokenType.FOR:
        case TokenType.IF:
        case TokenType.WHILE:
        case TokenType.RETURN:
          return;
      }

      this.advance();
    }
  }

  public getLocation(): SourceLocation {
    const token = this.peek();
    const baseLocation = token?.location || { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
    return {
      ...baseLocation,
      filename: this.filename
    };
  }

  private deriveModuleName(filename: string): string {
    return this.namespaceMapper.mapFileToModuleName(filename);
  }

}
