// Declaration and import/export parsing for the self-hosted parser.

import type { Parser } from "./parser"
import { Token, TokenType } from "./lexer"
import {
  Block, NamedType, Parameter, ClassField,
  InterfaceField, EnumVariant, ExportSpecifier, AstLocation,
  Identifier, ConstDeclaration, ReadonlyDeclaration, LetDeclaration,
  FunctionDeclaration, ImportDeclaration, NamespaceImport, NamedImport,
  TypeAliasDeclaration, ClassDeclaration, InterfaceDeclaration, EnumDeclaration,
  ExportList, MockImportDirective, MockImportMapping, YieldBlockExpression,
} from "./ast"
import type { Statement, Expression, TypeAnnotation, ImportSpecifier } from "./ast"

class ParsedTypeParameters {
  names: string[]
  constraints: string[]
}

export function parseExport(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Export)
  if parser.check(TokenType.Import) {
    parser.advance()
    if parser.check(TokenType.Class) { return parseNativeClass(parser, true, start) }
    isolated_ := parser.match(TokenType.Isolated)
    if parser.check(TokenType.Function) { return parseNativeFunction(parser, true, isolated_, start) }
    parser.fail("Expected class or function after export import")
  }
  if parser.check(TokenType.Const) { return parseConst(parser, true) }
  if parser.check(TokenType.Readonly) { return parseReadonly(parser, true) }
  if parser.check(TokenType.Function) { return parseFunction(parser, true, false, false, false) }
  if parser.check(TokenType.Isolated) && parser.peek(1).kind == TokenType.Function {
    parser.advance()
    return parseFunction(parser, true, false, true, false)
  }
  if parser.check(TokenType.Class) || parser.check(TokenType.Struct) { return parseClass(parser, true, false) }
  if parser.check(TokenType.Interface) { return parseInterface(parser, true) }
  if parser.check(TokenType.Enum) { return parseEnum(parser, true) }
  if parser.check(TokenType.Type) { return parseTypeAlias(parser, true) }
  if parser.check(TokenType.Identifier) || parser.check(TokenType.LeftBrace) {
    parser.expect(TokenType.LeftBrace)
    let specifiers: ExportSpecifier[] = []
    while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
      itemStart := parser.location()
      name := parser.text(parser.expect(TokenType.Identifier))
      let alias: string | null = null
      if parser.match(TokenType.As) { alias = parser.text(parser.expect(TokenType.Identifier)) }
      specifiers.push(ExportSpecifier { name, alias, span: parser.span(itemStart) })
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.RightBrace)
    let sourceValue: string | null = null
    if parser.match(TokenType.From) { sourceValue = parser.text(parser.expect(TokenType.StringLiteral)) }
    parser.consumeSemicolon()
    return ExportList { kind: "export-list", specifiers, source: sourceValue, span: parser.span(start) }
  }
  parser.fail("Expected a declaration or export list after export")
  return ExportList { kind: "export-list", specifiers: [], source: null, span: parser.span(start) }
}

export function parseConst(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Const)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return ConstDeclaration { kind: "const-declaration", name, description, type_: typeValue, value, exported, span: parser.span(start) }
}

export function parseReadonly(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Readonly)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return ReadonlyDeclaration { kind: "readonly-declaration", name, description, type_: typeValue, value, exported, span: parser.span(start) }
}

export function parseLet(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Let)
  if parser.check(TokenType.LeftBracket) && parser.looksLikePattern(TokenType.Equal) {
    return parser.parseDestructuring("array", "let", TokenType.Equal)
  }
  if parser.check(TokenType.LeftParen) && parser.looksLikePattern(TokenType.Equal) {
    return parser.parseDestructuring("positional", "let", TokenType.Equal)
  }
  if parser.check(TokenType.LeftBrace) && parser.looksLikePattern(TokenType.Equal) {
    return parser.parseDestructuring("named", "let", TokenType.Equal)
  }
  name := parser.text(parser.expect(TokenType.Identifier))
  typeValue := parser.parseOptionalType()
  value := parseInitializer(parser)
  parser.consumeSemicolon()
  return LetDeclaration { kind: "let-declaration", name, type_: typeValue, value, span: parser.span(start) }
}

function parseInitializer(parser: Parser): Expression {
  if parser.match(TokenType.Equal) { return parser.parseExpression() }
  if parser.match(TokenType.LeftArrow) {
    start := parser.location()
    if !parser.check(TokenType.LeftBrace) { parser.fail("Expected block after '<-'") }
    body := parser.parseBlock()
    return YieldBlockExpression { body, span: parser.span(start) }
  }
  parser.fail("Expected '=' or '<-' in declaration")
  return Identifier { kind: "identifier", name: "<error>", span: parser.locationSpan() }
}

export function parseFunction(parser: Parser, exported: bool, static_: bool, isolated_: bool, private_: bool): FunctionDeclaration {
  start := parser.location()
  parser.expect(TokenType.Function)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  returnType := parser.parseOptionalType()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return makeFunctionExpression(parser, name, description, typeParams, parsedTypeParams.constraints, params, returnType, body, exported, static_, isolated_, private_, start)
  }
  body := parser.parseBlock()
  return makeFunctionBlock(parser, name, description, typeParams, parsedTypeParams.constraints, params, returnType, body, exported, static_, isolated_, private_, start)
}

function parseMethod(parser: Parser, static_: bool, private_: bool): FunctionDeclaration {
  start := parser.location()
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  returnType := parser.parseOptionalType()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return makeFunctionExpression(parser, name, description, typeParams, parsedTypeParams.constraints, params, returnType, body, false, static_, false, private_, start)
  }
  body := parser.parseBlock()
  return makeFunctionBlock(parser, name, description, typeParams, parsedTypeParams.constraints, params, returnType, body, false, static_, false, private_, start)
}

function makeFunctionExpression(parser: Parser, name: string, description: string, typeParams: string[], typeParamConstraints: string[], params: Parameter[], returnType: TypeAnnotation | null, body: Expression, exported: bool, static_: bool, isolated_: bool, private_: bool, start: AstLocation): FunctionDeclaration {
  return FunctionDeclaration {
    kind: "function-declaration", name, description, typeParams, typeParamConstraints, params, returnType, body: body,
    exported, static_, isolated_, private_, bodyless: false, span: parser.span(start),
  }
}

function makeFunctionBlock(parser: Parser, name: string, description: string, typeParams: string[], typeParamConstraints: string[], params: Parameter[], returnType: TypeAnnotation | null, body: Block, exported: bool, static_: bool, isolated_: bool, private_: bool, start: AstLocation): FunctionDeclaration {
  return FunctionDeclaration {
    kind: "function-declaration", name, description, typeParams, typeParamConstraints, params, returnType, body: body,
    exported, static_, isolated_, private_, bodyless: false, span: parser.span(start),
  }
}

function parseExpressionBody(parser: Parser): Expression {
  parser.expect(TokenType.Arrow)
  value := parser.parseExpression()
  parser.consumeSemicolon()
  return value
}

function parseTypeParameters(parser: Parser): ParsedTypeParameters {
  names: string[] := []
  constraints: string[] := []
  if !parser.match(TokenType.Less) { return ParsedTypeParameters { names, constraints } }
  while !parser.check(TokenType.Greater) && !parser.atEnd() {
    names.push(parser.text(parser.expect(TokenType.Identifier)))
    let constraintName = ""
    if parser.match(TokenType.Colon) {
      case parser.parseTypeAnnotation() {
        constraint: NamedType -> { if constraint.typeArgs.length == 0 { constraintName = constraint.name } }
        _ -> { }
      }
    }
    constraints.push(constraintName)
    if !parser.match(TokenType.Comma) { break }
  }
  parser.expect(TokenType.Greater)
  return ParsedTypeParameters { names, constraints }
}

function parseParameters(parser: Parser): Parameter[] {
  params: Parameter[] := []
  while !parser.check(TokenType.RightParen) && !parser.atEnd() {
    start := parser.location()
    name := parser.text(parser.expect(TokenType.Identifier))
    description := parseDescription(parser)
    typeValue := parser.parseOptionalType()
    let defaultValue: Expression | null = null
    if parser.match(TokenType.Equal) { defaultValue = parser.parseExpression() }
    params.push(Parameter { name, description, type_: typeValue, defaultValue, span: parser.span(start) })
    if !parser.match(TokenType.Comma) { break }
  }
  return params
}

export function parseClass(parser: Parser, exported: bool, private_: bool): Statement {
  start := parser.location()
  struct_ := parser.check(TokenType.Struct)
  parser.advance()
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  let implements_: NamedType[] = []
  if parser.match(TokenType.Implements) {
    implements_.push(parseNamedType(parser))
    while parser.match(TokenType.Comma) { implements_.push(parseNamedType(parser)) }
  }
  parser.expect(TokenType.LeftBrace)

  let fields: ClassField[] = []
  let methods: FunctionDeclaration[] = []
  let destructor_: Block | null = null
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    if parser.check(TokenType.Function) {
      methods.push(parseFunction(parser, false, false, false, false))
    } else if parser.check(TokenType.Static) && parser.peek(1).kind == TokenType.Function {
      parser.advance()
      methods.push(parseFunction(parser, false, true, false, false))
    } else if parser.check(TokenType.Private) && parser.peek(1).kind == TokenType.Function {
      parser.advance()
      methods.push(parseFunction(parser, false, false, false, true))
    } else if parser.check(TokenType.Private) {
      parser.advance()
      if parser.check(TokenType.Function) {
        methods.push(parseFunction(parser, false, false, false, true))
      } else if checkAheadMethod(parser, 0) {
        methods.push(parseMethod(parser, false, true))
      } else if parser.check(TokenType.Static) {
        parser.advance()
        if checkAheadMethod(parser, 0) {
          methods.push(parseMethod(parser, true, true))
        } else {
          fields.push(parseClassField(parser, true, true))
        }
      } else {
        fields.push(parseClassField(parser, false, true))
      }
    } else if parser.check(TokenType.Destructor) {
      if destructor_ != null { parser.fail("A class may declare at most one destructor") }
      parser.advance()
      destructor_ = parser.parseBlock()
    } else if parser.check(TokenType.Static) {
      if checkAheadMethod(parser, 1) {
        parser.advance()
        methods.push(parseMethod(parser, true, false))
      } else {
        parser.advance()
        fields.push(parseClassField(parser, true, false))
      }
    } else if checkAheadMethod(parser, 0) {
      methods.push(parseMethod(parser, false, false))
    } else {
      fields.push(parseClassField(parser, false, false))
    }
  }
  parser.expect(TokenType.RightBrace)
  return ClassDeclaration { kind: "class-declaration", name, description, struct_, typeParams, typeParamConstraints: parsedTypeParams.constraints, implements_, fields, methods, destructor_, exported, private_, span: parser.span(start) }
}

function checkAheadMethod(parser: Parser, offset: int): bool {
  if parser.peek(offset).kind != TokenType.Identifier { return false }
  let suffixOffset = offset + 1
  if parser.peek(suffixOffset).kind == TokenType.StringLiteral { suffixOffset += 1 }
  return parser.peek(suffixOffset).kind == TokenType.LeftParen || parser.peek(suffixOffset).kind == TokenType.Less
}

function parseNamedType(parser: Parser): NamedType {
  start := parser.location()
  name := parser.text(parser.expect(TokenType.Identifier))
  let typeArgs: TypeAnnotation[] = []
  if parser.match(TokenType.Less) {
    while !parser.check(TokenType.Greater) && !parser.atEnd() {
      typeArgs.push(parser.parseTypeAnnotation())
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.Greater)
  }
  return NamedType { kind: "named-type", name, typeArgs, span: parser.span(start) }
}

function parseClassField(parser: Parser, static_: bool, private_: bool): ClassField {
  start := parser.location()
  let staticValue = static_
  readonly_ := parser.match(TokenType.Readonly)
  if parser.match(TokenType.Static) { staticValue = true }
  weak_ := parser.match(TokenType.Weak)
  let names: string[] = []
  let descriptions: string[] = []
  names.push(parser.text(parser.expect(TokenType.Identifier)))
  descriptions.push(parseDescription(parser))
  while parser.match(TokenType.Comma) {
    names.push(parser.text(parser.expect(TokenType.Identifier)))
    descriptions.push(parseDescription(parser))
  }
  typeValue := parser.parseOptionalType()
  let defaultValue: Expression | null = null
  if parser.match(TokenType.Equal) { defaultValue = parser.parseExpression() }
  parser.consumeSemicolon()
  return ClassField { kind: "class-field", names, descriptions, type_: typeValue, defaultValue, static_: staticValue, readonly_, weak_, private_, span: parser.span(start) }
}

export function parseInterface(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Interface)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  parser.expect(TokenType.LeftBrace)
  let fields: InterfaceField[] = []
  let methods: FunctionDeclaration[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    memberStart := parser.location()
    readonly_ := parser.match(TokenType.Readonly)
    memberName := parser.text(parser.expect(TokenType.Identifier))
    memberDescription := parseDescription(parser)
    if parser.check(TokenType.LeftParen) {
      parser.expect(TokenType.LeftParen)
      params := parseParameters(parser)
      parser.expect(TokenType.RightParen)
      returnType := parser.parseOptionalType()
      parser.consumeSemicolon()
      methods.push(FunctionDeclaration {
        kind: "function-declaration", name: memberName, description: memberDescription, typeParams: [], params,
        returnType, body: Block { kind: "block", statements: [], span: parser.span(memberStart) },
        exported: false, static_: false, isolated_: false, private_: false,
        bodyless: true,
        span: parser.span(memberStart),
      })
    } else {
      parser.expect(TokenType.Colon)
      typeValue := parser.parseTypeAnnotation()
      parser.consumeSemicolon()
      fields.push(InterfaceField { kind: "interface-field", name: memberName, description: memberDescription, type_: typeValue, readonly_, span: parser.span(memberStart) })
    }
  }
  parser.expect(TokenType.RightBrace)
  return InterfaceDeclaration { kind: "interface-declaration", name, description, typeParams, typeParamConstraints: parsedTypeParams.constraints, fields, methods, exported, span: parser.span(start) }
}

export function parseEnum(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Enum)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parser.expect(TokenType.LeftBrace)
  let variants: EnumVariant[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    variantStart := parser.location()
    variantName := parser.text(parser.expect(TokenType.Identifier))
    variantDescription := parseDescription(parser)
    let enumValue: Expression | null = null
    if parser.match(TokenType.Equal) { enumValue = parser.parseExpression() }
    variants.push(EnumVariant { kind: "enum-variant", name: variantName, description: variantDescription, value: enumValue, span: parser.span(variantStart) })
    if !parser.match(TokenType.Comma) { parser.consumeSemicolon() }
  }
  parser.expect(TokenType.RightBrace)
  return EnumDeclaration { kind: "enum-declaration", name, description, variants, exported, span: parser.span(start) }
}

export function parseTypeAlias(parser: Parser, exported: bool): Statement {
  start := parser.location()
  parser.expect(TokenType.Type)
  name := parser.text(parser.expect(TokenType.Identifier))
  description := parseDescription(parser)
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  parser.expect(TokenType.Equal)
  typeValue := parser.parseTypeAnnotation()
  parser.consumeSemicolon()
  return TypeAliasDeclaration { kind: "type-alias-declaration", name, description, typeParams, typeParamConstraints: parsedTypeParams.constraints, type_: typeValue, exported, span: parser.span(start) }
}

function parseDescription(parser: Parser): string {
  if !parser.check(TokenType.StringLiteral) { return "" }
  return parser.text(parser.advance())
}

export function parseImport(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Import)
  if parser.check(TokenType.Class) { return parseNativeClass(parser, false, start) }
  isolated_ := parser.match(TokenType.Isolated)
  if parser.check(TokenType.Function) { return parseNativeFunction(parser, false, isolated_, start) }
  if isolated_ { parser.fail("Expected function after import isolated") }
  typeOnly := parser.match(TokenType.Type)
  let specifiers: ImportSpecifier[] = []
  if parser.match(TokenType.Star) {
    parser.match(TokenType.As)
    alias := parser.text(parser.expect(TokenType.Identifier))
    specifiers.push(NamespaceImport { kind: "namespace-import-specifier", alias, span: parser.span(start) })
  } else {
    parser.expect(TokenType.LeftBrace)
    while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
      itemStart := parser.location()
      name := parser.text(parser.expect(TokenType.Identifier))
      let alias: string | null = null
      if parser.match(TokenType.As) { alias = parser.text(parser.expect(TokenType.Identifier)) }
      specifiers.push(NamedImport { kind: "named-import-specifier", name, alias, span: parser.span(itemStart) })
      if !parser.match(TokenType.Comma) { break }
    }
    parser.expect(TokenType.RightBrace)
  }
  parser.expect(TokenType.From)
  sourceValue := parser.text(parser.expect(TokenType.StringLiteral))
  parser.consumeSemicolon()
  return ImportDeclaration { kind: "import-declaration", specifiers, source: sourceValue, typeOnly, span: parser.span(start) }
}

export function parseMockImport(parser: Parser): Statement {
  start := parser.location()
  parser.expect(TokenType.Mock)
  parser.expect(TokenType.Import, "Expected import after mock")
  parser.expect(TokenType.For)
  sourcePattern := parser.text(parser.expect(TokenType.StringLiteral))
  parser.expect(TokenType.LeftBrace)

  let mappings: MockImportMapping[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    mappingStart := parser.location()
    dependency := parser.text(parser.expect(TokenType.StringLiteral))
    parser.expect(TokenType.Arrow, "Expected => in mock import mapping")
    replacement := parser.text(parser.expect(TokenType.StringLiteral))
    mappings.push(MockImportMapping { dependency, replacement, span: parser.span(mappingStart) })
    if !parser.match(TokenType.Comma) { parser.match(TokenType.Semicolon) }
  }

  parser.expect(TokenType.RightBrace)
  parser.consumeSemicolon()
  return MockImportDirective { kind: "mock-import-directive", sourcePattern, mappings, span: parser.span(start) }
}

function parseNativeClass(parser: Parser, exported: bool, start: AstLocation): ClassDeclaration {
  parser.expect(TokenType.Class)
  name := parser.text(parser.expect(TokenType.Identifier))
  let headerPath = ""
  if parser.match(TokenType.From) { headerPath = parser.text(parser.expect(TokenType.StringLiteral)) }
  let cppName = ""
  if parser.match(TokenType.As) { cppName = parseCppQualifiedName(parser) }

  parser.expect(TokenType.LeftBrace)
  let fields: ClassField[] = []
  let methods: FunctionDeclaration[] = []
  while !parser.check(TokenType.RightBrace) && !parser.atEnd() {
    if (parser.check(TokenType.Identifier) && parser.peek(1).kind == TokenType.LeftParen) ||
        (parser.check(TokenType.Static) && parser.peek(1).kind == TokenType.Identifier && parser.peek(2).kind == TokenType.LeftParen) ||
        (parser.check(TokenType.Isolated) && parser.peek(1).kind == TokenType.Identifier && parser.peek(2).kind == TokenType.LeftParen) ||
        (parser.check(TokenType.Isolated) && parser.peek(1).kind == TokenType.Static && parser.peek(2).kind == TokenType.Identifier && parser.peek(3).kind == TokenType.LeftParen) {
      methods.push(parseNativeMethod(parser))
    } else {
      fields.push(parseClassField(parser, false, false))
    }
  }
  parser.expect(TokenType.RightBrace)
  return ClassDeclaration {
    kind: "class-declaration", name, typeParams: [], implements_: [], fields, methods,
    exported, private_: false, native_: true, nativeHeader: headerPath, nativeCppName: cppName,
    span: parser.span(start),
  }
}

function parseNativeMethod(parser: Parser): FunctionDeclaration {
  start := parser.location()
  isolated_ := parser.match(TokenType.Isolated)
  static_ := parser.match(TokenType.Static)
  name := parser.text(parser.expect(TokenType.Identifier))
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  parser.expect(TokenType.Colon)
  returnType := parser.parseTypeAnnotation()
  if parser.check(TokenType.Arrow) {
    body := parseExpressionBody(parser)
    return FunctionDeclaration {
      kind: "function-declaration", name, typeParams: [], params, returnType, body,
      exported: false, static_, isolated_, private_: false, bodyless: false,
      span: parser.span(start),
    }
  }
  if parser.check(TokenType.LeftBrace) {
    body := parser.parseBlock()
    return FunctionDeclaration {
      kind: "function-declaration", name, typeParams: [], params, returnType, body,
      exported: false, static_, isolated_, private_: false, bodyless: false,
      span: parser.span(start),
    }
  }
  parser.consumeSemicolon()
  body := Block { kind: "block", statements: [], span: parser.span(start) }
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams: [], params, returnType, body,
    exported: false, static_, isolated_, private_: false, bodyless: true,
    span: parser.span(start),
  }
}

function parseNativeFunction(parser: Parser, exported: bool, isolated_: bool, start: AstLocation): FunctionDeclaration {
  parser.expect(TokenType.Function)
  name := parser.text(parser.expect(TokenType.Identifier))
  parsedTypeParams := parseTypeParameters(parser)
  typeParams := parsedTypeParams.names
  parser.expect(TokenType.LeftParen)
  params := parseParameters(parser)
  parser.expect(TokenType.RightParen)
  parser.expect(TokenType.Colon)
  returnType := parser.parseTypeAnnotation()
  let headerPath = ""
  if parser.match(TokenType.From) { headerPath = parser.text(parser.expect(TokenType.StringLiteral)) }
  let cppName = ""
  if parser.match(TokenType.As) { cppName = parseCppQualifiedName(parser) }
  parser.consumeSemicolon()
  return FunctionDeclaration {
    kind: "function-declaration", name, typeParams, typeParamConstraints: parsedTypeParams.constraints, params, returnType,
    body: Block { kind: "block", statements: [], span: parser.span(start) },
    exported, static_: false, isolated_, private_: false, bodyless: true,
    native_: true, nativeHeader: headerPath, nativeCppName: cppName, span: parser.span(start),
  }
}

function parseCppQualifiedName(parser: Parser): string {
  let result = parser.text(parser.expect(TokenType.Identifier))
  while parser.match(TokenType.DoubleColon) {
    result = result + "::" + parser.text(parser.expect(TokenType.Identifier))
  }
  return result
}
