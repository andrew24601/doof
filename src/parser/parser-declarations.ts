import {
    Statement, Type, VariableDeclaration, FunctionDeclaration, ClassDeclaration, ExternClassDeclaration,
    EnumDeclaration, TypeAliasDeclaration, InterfaceDeclaration, InterfaceMember, InterfaceProperty, InterfaceMethod, InterfaceTypeReference,
    FieldDeclaration, MethodDeclaration, Parameter, TypeParameter,
    ConstructorDeclaration,
    EnumMember, LambdaExpression, BlockStatement, Expression, Identifier, Literal,
    FunctionTypeNode, ParseError,
    DestructuringVariableDeclaration
} from '../types';
import { Token, TokenType } from './lexer';
import { Parser } from './parser';
import { createPrimitiveType, parseType } from './parser-types';
import { createIdentifier, createLiteral, parseExpression, parseInterpolatedString } from './parser-expression';
import { parseParameterList } from './parser-parameters';
import { isObjectPatternStart, isTuplePatternStart, parseObjectPattern, parseTuplePattern } from './parser-patterns';

interface ModifierFlags {
    isPublic: boolean;
    isStatic: boolean;
    isConst: boolean;
    isReadonly: boolean;
    isAsync: boolean;
}

type FieldOrMethodParseResult = {
    field?: FieldDeclaration;
    method?: MethodDeclaration;
};

/**
 * Parse modifiers (private, static, const, readonly) and return flags object.
 * Validates mutual exclusivity constraints and duplicate modifiers.
 */
export function parseModifiers(parser: Parser, allowedModifiers?: Set<string>): ModifierFlags {
    const flags: ModifierFlags = {
        isPublic: true, // Default to public in doof
        isStatic: false,
        isConst: false,
        isReadonly: false,
        isAsync: false
    };

    while (parser.check(TokenType.PRIVATE) || parser.check(TokenType.STATIC) ||
        parser.check(TokenType.CONST) || parser.check(TokenType.READONLY) || parser.check(TokenType.ASYNC)) {

        if (parser.match(TokenType.PRIVATE)) {
            if (allowedModifiers && !allowedModifiers.has('private')) {
                throw new ParseError("'private' modifier not allowed in this context", parser.getLocation());
            }
            flags.isPublic = false;
        } else if (parser.match(TokenType.STATIC)) {
            if (allowedModifiers && !allowedModifiers.has('static')) {
                throw new ParseError("'static' modifier not allowed in this context", parser.getLocation());
            }
            if (flags.isStatic) {
                throw new ParseError("'static' modifier already specified", parser.getLocation());
            }
            flags.isStatic = true;
        } else if (parser.match(TokenType.CONST)) {
            if (allowedModifiers && !allowedModifiers.has('const')) {
                throw new ParseError("'const' modifier not allowed in this context", parser.getLocation());
            }
            if (flags.isReadonly) {
                throw new ParseError("Field cannot be both 'const' and 'readonly'", parser.getLocation());
            }
            if (flags.isConst) {
                throw new ParseError("'const' modifier already specified", parser.getLocation());
            }
            flags.isConst = true;
        } else if (parser.match(TokenType.READONLY)) {
            if (allowedModifiers && !allowedModifiers.has('readonly')) {
                throw new ParseError("'readonly' modifier not allowed in this context", parser.getLocation());
            }
            if (flags.isConst) {
                throw new ParseError("Field cannot be both 'const' and 'readonly'", parser.getLocation());
            }
            if (flags.isReadonly) {
                throw new ParseError("'readonly' modifier already specified", parser.getLocation());
            }
            flags.isReadonly = true;
        } else if (parser.match(TokenType.ASYNC)) {
            if (allowedModifiers && !allowedModifiers.has('async')) {
                throw new ParseError("'async' modifier not allowed in this context", parser.getLocation());
            }
            if (flags.isAsync) {
                throw new ParseError("'async' modifier already specified", parser.getLocation());
            }
            flags.isAsync = true;
        }
    }

    return flags;
}

export function parseVariableDeclaration(parser: Parser): VariableDeclaration | DestructuringVariableDeclaration {
    const previousType = parser.previous().type;
    const isConst = previousType === TokenType.CONST;
    const isReadonly = previousType === TokenType.READONLY;

    // Destructuring declaration form: const/let {x, y} = expr; or const/let (x, y) = expr;
    if (isObjectPatternStart(parser) || isTuplePatternStart(parser)) {
        const pattern = isObjectPatternStart(parser) ? parseObjectPattern(parser) : parseTuplePattern(parser);
        // Optional overall type annotation after pattern is not supported in MVP.
        if (parser.match(TokenType.COLON)) {
            // Parse and discard the type to provide a helpful error now (MVP limitation)
            parseType(parser);
            throw new ParseError("Type annotation on destructuring pattern is not supported in MVP", pattern.location);
        }
        parser.consume(TokenType.ASSIGN, "Expected '=' after destructuring pattern");
        const initializer = parseExpression(parser);
        parser.consume(TokenType.SEMICOLON, "Expected ';' after declaration");
        return {
            kind: 'destructuringVariable',
            isConst,
            pattern,
            initializer,
            location: pattern.location
        };
    }

    const name = parser.consume(TokenType.IDENTIFIER, "Expected variable name");

    // Check for concise lambda form: const name(params) => body
    if (parser.check(TokenType.LEFT_PAREN)) {
        // Concise lambda form
        parser.advance(); // consume '('
        const parameters = parseParameterList(parser);
        parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after lambda parameters");

        let returnType: Type | undefined;
        if (parser.match(TokenType.COLON)) {
            returnType = parseType(parser);
        }

        parser.consume(TokenType.ARROW, "Expected '=>' after lambda parameters");

        let body: Expression | BlockStatement;
        if (parser.check(TokenType.LEFT_BRACE)) {
            body = parser.withFunctionScope(() => parser.parseBlockStatement());
        } else {
            body = parseExpression(parser);
        }

        // Create lambda expression as initializer
        const lambdaExpr: LambdaExpression = {
            kind: 'lambda',
            parameters,
            body,
            returnType,
            location: parser.getLocation()
        };

        parser.consume(TokenType.SEMICOLON, "Expected ';' after lambda declaration");

        let trailingComment: string | undefined;
        if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
            trailingComment = parser.advance().value;
        }

        return {
            kind: 'variable',
            isConst,
            isReadonly,
            identifier: { kind: 'identifier', name: name.value, location: name.location },
            type: undefined, // Type will be inferred from lambda
            initializer: lambdaExpr,
            isConciseLambda: true,
            lambdaParameters: parameters,
            trailingComment,
            location: name.location
        };
    } else {
        // Regular variable declaration
        let type: Type | undefined;
        if (parser.match(TokenType.COLON)) {
            type = parseType(parser);
        }

        let initializer: Expression | undefined;
        if (parser.match(TokenType.ASSIGN)) {
            // Check for tagged template: identifier immediately followed by ` or "
            if (parser.check(TokenType.IDENTIFIER)) {
                const identifierToken = parser.peek(); // Current identifier token
                const nextToken = parser.peek(1);       // Token after identifier

                let isAdjacent = false;
                if (nextToken.type === TokenType.INTERPOLATION_START) {
                    // Special case: template starts with ${} - lexer misses the opening `
                    // Check if identifier ends where the template should start (accounting for missing `)
                    const expectedTemplateStart = identifierToken.location.end.column;
                    const actualInterpolationStart = nextToken.location.start.column;
                    // The ` should be at expectedTemplateStart, then ${ at expectedTemplateStart + 3
                    isAdjacent = (actualInterpolationStart === expectedTemplateStart + 3);
                } else {
                    isAdjacent = parser.isAdjacent(identifierToken.location, nextToken.location);
                }

                if ((nextToken.type === TokenType.TEMPLATE_STRING || nextToken.type === TokenType.STRING || nextToken.type === TokenType.INTERPOLATION_START) &&
                    isAdjacent) {
                    // This is a tagged template - parse it manually
                    parser.advance(); // consume identifier
                    const identifier = createIdentifier(parser, identifierToken.value, identifierToken.location);
                    const taggedTemplate = parseInterpolatedString(parser);

                    if (taggedTemplate.kind === 'interpolated-string') {
                        (taggedTemplate as any).tagIdentifier = identifier;
                        initializer = taggedTemplate;
                    } else {
                        // Simple string literal - convert to interpolated string with tag
                        const literal = taggedTemplate as Literal;
                        const wasTemplate = (literal as any).isTemplate || false;
                        initializer = {
                            kind: 'interpolated-string',
                            parts: [literal.value as string],
                            isTemplate: wasTemplate,
                            tagIdentifier: identifier,
                            location: parser.getLocation()
                        } as any;
                    }
                } else {
                    initializer = parseExpression(parser);
                }
            } else {
                initializer = parseExpression(parser);
            }
        }

        parser.consume(TokenType.SEMICOLON, "Expected ';' after variable declaration");

        let trailingComment: string | undefined;
        if (parser.check(TokenType.LINE_COMMENT) && (parser.isAdjacent(parser.previous().location, parser.peek().location) || parser.isSameLine(parser.previous().location, parser.peek().location))) {
            trailingComment = parser.advance().value;
        }

        return {
            kind: 'variable',
            isConst,
            isReadonly,
            identifier: { kind: 'identifier', name: name.value, location: name.location },
            type,
            initializer,
            trailingComment,
            location: name.location
        };
    }
}

function parseTypeParameterList(parser: Parser): TypeParameter[] {
    const parameters: TypeParameter[] = [];
    do {
        const nameToken = parser.consume(TokenType.IDENTIFIER, "Expected type parameter name");
        parameters.push({
            name: nameToken.value,
            location: nameToken.location
        });
    } while (parser.match(TokenType.COMMA));

    parser.consume(TokenType.GREATER_THAN, "Expected '>' after type parameter list");
    return parameters;
}

export function parseFunctionDeclaration(parser: Parser, isAsync: boolean = false): Statement {
    // 'function' token already consumed by match() in parseStatement()
    const name = parser.consume(TokenType.IDENTIFIER, "Expected function name");

    let typeParameters: TypeParameter[] | undefined;
    if (parser.match(TokenType.LESS_THAN)) {
        typeParameters = parseTypeParameterList(parser);
    }

    parser.consume(TokenType.LEFT_PAREN, "Expected '(' after function name");
    const parameters = parseParameterList(parser);
    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after parameters");
    let returnType: Type;
    if (parser.match(TokenType.COLON)) {
        returnType = parseType(parser);
    } else {
        returnType = createPrimitiveType('void');
    }
    const isNestedFunction = parser.isInsideFunctionScope();

    if (isNestedFunction && typeParameters && typeParameters.length > 0) {
        throw new ParseError("Nested generic functions are not supported", name.location);
    }
    const body = parser.withFunctionScope(() => parser.parseBlockStatement());

    const functionDecl: FunctionDeclaration = {
        kind: 'function',
        name: { kind: 'identifier', name: name.value, location: parser.getLocation() },
        parameters,
        returnType,
        body,
        location: name.location,
        typeParameters,
        isAsync
    };

    if (isNestedFunction) {
        return convertFunctionToLambdaVariable(functionDecl);
    }

    return functionDecl;
}

export function parseClassDeclaration(parser: Parser, isReadonly: boolean = false): ClassDeclaration {
    // 'class' token already consumed by match() in parseStatement()
    const name = parser.consume(TokenType.IDENTIFIER, "Expected class name");

    let typeParameters: TypeParameter[] | undefined;
    if (parser.match(TokenType.LESS_THAN)) {
        typeParameters = parseTypeParameterList(parser);
    }
    parser.consume(TokenType.LEFT_BRACE, "Expected '{' after class name");

    const { fields, methods, nestedClasses } = parseClassLikeBody(parser);
    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after class body");

    return {
        kind: 'class',
        name: { kind: 'identifier', name: name.value, location: parser.getLocation() },
        isReadonly,
        fields,
        methods,
        nestedClasses: nestedClasses.length > 0 ? nestedClasses : undefined,
        location: name.location,
        typeParameters
    };
}

export function parseInterfaceDeclaration(parser: Parser): InterfaceDeclaration {
    const nameToken = parser.consume(TokenType.IDENTIFIER, "Expected interface name");

    const extendsList: InterfaceTypeReference[] = [];
    if (parser.match(TokenType.EXTENDS)) {
        do {
            const baseName = parser.consume(TokenType.IDENTIFIER, "Expected interface name after 'extends'");
            const reference: InterfaceTypeReference = {
                name: baseName.value,
                typeArguments: undefined,
                location: baseName.location
            };
            extendsList.push(reference);
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.LEFT_BRACE, "Expected '{' after interface declaration");

    const members: InterfaceMember[] = [];
    while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        while (parser.checkRaw(TokenType.NEWLINE)) {
            parser.advanceRaw();
        }
        if (parser.check(TokenType.LINE_COMMENT)) {
            parser.advance();
            continue;
        }
        if (parser.check(TokenType.RIGHT_BRACE)) {
            break;
        }

        members.push(parseInterfaceMember(parser));
    }

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after interface body");

    return {
        kind: 'interface',
        name: { kind: 'identifier', name: nameToken.value, location: nameToken.location },
        extends: extendsList.length > 0 ? extendsList : undefined,
        members,
        location: nameToken.location
    };
}

function parseInterfaceMember(parser: Parser): InterfaceMember {
    const isReadonly = parser.match(TokenType.READONLY);
    const nameToken = parser.consume(TokenType.IDENTIFIER, "Expected member name");
    const optional = parser.match(TokenType.QUESTION);

    if (parser.match(TokenType.COLON)) {
        const type = parseType(parser);
        parser.consume(TokenType.SEMICOLON, "Expected ';' after property declaration");
        const property: InterfaceProperty = {
            kind: 'interfaceProperty',
            name: { kind: 'identifier', name: nameToken.value, location: nameToken.location },
            type,
            optional,
            readonly: isReadonly,
            location: nameToken.location
        };
        return property;
    }

    parser.consume(TokenType.LEFT_PAREN, "Expected '(' after method name");
    const parameters = parseParameterList(parser);
    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after method parameters");

    let returnType: Type;
    if (parser.match(TokenType.COLON)) {
        returnType = parseType(parser);
    } else {
        returnType = createPrimitiveType('void');
    }

    parser.consume(TokenType.SEMICOLON, "Expected ';' after method signature");

    const method: InterfaceMethod = {
        kind: 'interfaceMethod',
        name: { kind: 'identifier', name: nameToken.value, location: nameToken.location },
        parameters,
        returnType,
        optional,
        location: nameToken.location
    };
    return method;
}

function convertFunctionToLambdaVariable(fn: FunctionDeclaration): VariableDeclaration {
    const lambda: LambdaExpression = {
        kind: 'lambda',
        parameters: fn.parameters,
        body: fn.body,
        returnType: fn.returnType,
        location: fn.location
    };

    return {
        kind: 'variable',
        isConst: true,
        identifier: fn.name,
        initializer: lambda,
        location: fn.location
    } as VariableDeclaration;
}

export function parseExternDeclaration(parser: Parser): ExternClassDeclaration {
    // 'extern' token already consumed by match() in parseStatement()
    parser.consume(TokenType.CLASS, "Expected 'class' after 'extern'");
    const name = parser.consume(TokenType.IDENTIFIER, "Expected class name");

    let jsModule: string | undefined;
    if (parser.match(TokenType.FROM)) {
        const moduleToken = parser.advance();
        if (moduleToken.type === TokenType.STRING || moduleToken.type === TokenType.TEMPLATE_STRING) {
             jsModule = moduleToken.value;
        } else {
             throw new ParseError("Expected string literal for module path", parser.getLocation());
        }
    }

    parser.consume(TokenType.LEFT_BRACE, "Expected '{' after class name");

    const { fields, methods } = parseExternClassBody(parser);
    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after class body");

    return {
        kind: 'externClass',
        name: { kind: 'identifier', name: name.value, location: name.location },
        fields,
        methods,
        jsModule,
        location: name.location
    };
}

export function parseExternClassBody(parser: Parser): {
    fields: FieldDeclaration[];
    methods: MethodDeclaration[];
} {
    const fields: FieldDeclaration[] = [];
    const methods: MethodDeclaration[] = [];

    while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        while (parser.checkRaw(TokenType.NEWLINE)) {
            parser.advanceRaw();
        }
        if (parser.check(TokenType.LINE_COMMENT)) {
            parser.advance();
            continue;
        }
        if (parser.check(TokenType.RIGHT_BRACE)) {
            break;
        }
        // Parse modifiers - extern classes only allow private and static
        const allowedModifiers = new Set(['private', 'static']);
        const modifiers = parseModifiers(parser, allowedModifiers);
    const hasFunctionKeyword = parser.match(TokenType.FUNCTION);

        if (parser.check(TokenType.IDENTIFIER)) {
            // Look ahead to determine if this is a method (has parentheses) or field (has colon)
            const nameToken = parser.advance();
            let hasParameterList = parser.match(TokenType.LEFT_PAREN);

            if (hasFunctionKeyword || hasParameterList) {
                if (!hasParameterList) {
                    parser.consume(TokenType.LEFT_PAREN, "Expected '(' after method name");
                }
                // Method declaration
                
                // Reject constructor methods - explicit constructors are not supported for extern classes either
                if (nameToken.value === 'constructor') {
                    throw new ParseError("Explicit constructor methods are not supported for extern classes. Use object literal initialization instead.", nameToken.location);
                }
                
                const parameters = parseParameterList(parser);
                parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after method parameters");
                let returnType: Type;
                if (parser.match(TokenType.COLON)) {
                    returnType = parseType(parser);
                } else {
                    returnType = createPrimitiveType('void');
                }
                parser.consume(TokenType.SEMICOLON, "Expected ';' after extern method declaration");

                // Create empty body for extern methods (they shouldn't have implementations)
                const emptyBody: BlockStatement = {
                    kind: 'block',
                    body: [],
                    location: parser.getLocation()
                };

                const method: MethodDeclaration = {
                    kind: 'method',
                    name: { kind: 'identifier', name: nameToken.value, location: nameToken.location },
                    parameters,
                    returnType,
                    body: emptyBody,
                    isPublic: modifiers.isPublic,
                    isStatic: modifiers.isStatic,
                    isExtern: true,
                    usesFunctionKeyword: hasFunctionKeyword,
                    location: nameToken.location
                };
                methods.push(method);
            } else if (parser.match(TokenType.COLON)) {
                // Field declaration
                const type = parseType(parser);
                parser.consume(TokenType.SEMICOLON, "Expected ';' after field declaration");

                const field: FieldDeclaration = {
                    kind: 'field',
                    name: { kind: 'identifier', name: nameToken.value, location: nameToken.location },
                    type,
                    isPublic: modifiers.isPublic,
                    isStatic: modifiers.isStatic,
                    isConst: false, // Extern fields cannot be const
                    isReadonly: false, // Extern fields cannot be readonly
                    location: nameToken.location
                };
                fields.push(field);
            } else {
                throw new ParseError("Expected '(' for method or ':' for field", parser.getLocation());
            }
        } else {
            if (hasFunctionKeyword) {
                throw new ParseError("Expected method name after 'function'", parser.getLocation());
            }
            throw new ParseError("Expected field or method declaration", parser.getLocation());
        }
    }

    return { fields, methods };
}

export function parseClassLikeBody(parser: Parser): {
    fields: FieldDeclaration[];
    methods: MethodDeclaration[];
    nestedClasses: ClassDeclaration[];
} {
    const fields: FieldDeclaration[] = [];
    const methods: MethodDeclaration[] = [];
    const nestedClasses: ClassDeclaration[] = [];

    while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        while (parser.checkRaw(TokenType.NEWLINE)) {
            parser.advanceRaw();
        }
        if (parser.check(TokenType.LINE_COMMENT)) {
            parser.advance();
            continue;
        }
        if (parser.check(TokenType.RIGHT_BRACE)) {
            break;
        }
        // Parse modifiers - classes allow all modifiers
        const allowedModifiers = new Set(['private', 'static', 'const', 'readonly', 'async']);
        const modifiers = parseModifiers(parser, allowedModifiers);

        if (parser.match(TokenType.CLASS)) {
            if (!modifiers.isPublic || modifiers.isStatic || modifiers.isConst || modifiers.isReadonly || modifiers.isAsync) {
                throw new ParseError("Modifiers are not supported on nested class declarations", parser.getLocation());
            }

            const nested = parseClassDeclaration(parser);
            nestedClasses.push(nested);
            continue;
        }

        if (parser.check(TokenType.IDENTIFIER) || parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) {
            const { field, method } = parseFieldOrMethod(parser, modifiers);
            if (field) fields.push(field);
            if (method) methods.push(method);
        } else if (parser.check(TokenType.LEFT_BRACKET)) {
            throw new ParseError("computed property name expressions are not supported in class fields", parser.getLocation());
        } else {
            throw new ParseError("Expected field or method declaration", parser.getLocation());
        }
    }

    return { fields, methods, nestedClasses };
}

function isCallableFieldDeclaration(parser: Parser): boolean {
    // Look ahead to see if this is a callable field (ends with semicolon after params/return type)
    // vs a method (has a block body)

    let lookahead = 1; // Current position is at LEFT_PAREN
    let parenCount = 1;

    // Skip past the parameter list
    while (lookahead < parser.tokens.length && parenCount > 0) {
        const token = parser.peek(lookahead);
        if (token.type === TokenType.LEFT_PAREN) {
            parenCount++;
        } else if (token.type === TokenType.RIGHT_PAREN) {
            parenCount--;
        }
        lookahead++;
    }

    // Now we're past the closing paren, check what comes next
    const nextToken = parser.peek(lookahead);
    const afterNext = parser.peek(lookahead + 1);

    // If we see a colon, skip past the return type
    if (nextToken.type === TokenType.COLON) {
        lookahead++; // skip colon
        // Skip the return type (simplified - just look for next semicolon or brace)
        while (lookahead < parser.tokens.length) {
            const token = parser.peek(lookahead);
            if (token.type === TokenType.SEMICOLON || token.type === TokenType.LEFT_BRACE) {
                break;
            }
            lookahead++;
        }

        const finalToken = parser.peek(lookahead);
        return finalToken.type === TokenType.SEMICOLON;
    } else {
        // No return type specified - check if next token is semicolon (callable field) or brace (method)
        return nextToken.type === TokenType.SEMICOLON;
    }
}

export function parseFieldOrMethod(parser: Parser, modifiers: ModifierFlags): FieldOrMethodParseResult {
    let nameIdentifier: Identifier;
    if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) {
        const nameToken = parser.advance();
        // Convert quoted string to an identifier-like structure for field names
        nameIdentifier = {
            kind: 'identifier',
            name: nameToken.value,
            location: nameToken.location
        };
    } else if (parser.check(TokenType.IDENTIFIER)) {
        const nameToken = parser.advance();
        nameIdentifier = {
            kind: 'identifier',
            name: nameToken.value,
            location: nameToken.location
        };
    } else {
        throw new ParseError("Expected field or method declaration", parser.getLocation());
    }

    if (nameIdentifier.name === 'constructor') {
        throw new ParseError("Explicit constructors are not supported", nameIdentifier.location);
    }

    if (parser.check(TokenType.LEFT_PAREN) && isCallableFieldDeclaration(parser)) {
        // Concise callable field: name(params): returnType; or name(params);
        parser.advance(); // consume '('
        const parameters = parseParameterList(parser);
        parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after callable field parameters");

        let returnType: Type = createPrimitiveType('void'); // Default to void
        if (parser.match(TokenType.COLON)) {
            returnType = parseType(parser);
        }

        parser.consume(TokenType.SEMICOLON, "Expected ';' after callable field declaration");

        // Create function type for the callable field
        const functionType: FunctionTypeNode = {
            kind: 'function',
            parameters: parameters.map(p => ({ name: p.name.name, type: p.type })),
            returnType,
            isConciseForm: true
        };

        const field: FieldDeclaration = {
            kind: 'field',
            name: nameIdentifier,
            type: functionType,
            isPublic: modifiers.isPublic,
            isStatic: modifiers.isStatic,
            isConst: modifiers.isConst,
            isReadonly: modifiers.isReadonly,
            isConciseCallable: true,
            location: nameIdentifier.location
        };
    const result = Object.create(null) as FieldOrMethodParseResult;
    result.field = field;
    return result;
    } else if (parser.match(TokenType.COLON)) {
        // Field declaration with explicit type
        const type = parseType(parser);

        let defaultValue: Expression | undefined;
        if (parser.match(TokenType.ASSIGN)) {
            defaultValue = parseExpression(parser);
        }

        parser.consume(TokenType.SEMICOLON, "Expected ';' after field declaration");

        const field: FieldDeclaration = {
            kind: 'field',
            name: nameIdentifier,
            type,
            defaultValue,
            isPublic: modifiers.isPublic,
            isStatic: modifiers.isStatic,
            isConst: modifiers.isConst,
            isReadonly: modifiers.isReadonly,
            location: nameIdentifier.location
        };
        const result = Object.create(null) as FieldOrMethodParseResult;
        result.field = field;
        return result;
    } else if (parser.match(TokenType.ASSIGN)) {
        // Field without explicit type: name = <value>; (for both const and non-const)
        // Parse initializer and create field with unknown type for later inference
        const defaultValue = parseExpression(parser);
        parser.consume(TokenType.SEMICOLON, "Expected ';' after field declaration");
        const field: FieldDeclaration = {
            kind: 'field',
            name: nameIdentifier,
            // Use unknown type; validator will infer from defaultValue
            type: { kind: 'unknown' } as any,
            defaultValue,
            isPublic: modifiers.isPublic,
            isStatic: modifiers.isStatic,
            isConst: modifiers.isConst,
            isReadonly: modifiers.isReadonly,
            location: nameIdentifier.location
        };
        const result = Object.create(null) as FieldOrMethodParseResult;
        result.field = field;
        return result;
    } else if (parser.match(TokenType.LESS_THAN) || parser.match(TokenType.LEFT_PAREN)) {
        // Method declaration (possibly generic)
        // Reject constructor methods - explicit constructors are not supported
        if (nameIdentifier.name === 'constructor') {
            throw new ParseError("Explicit constructor methods are not supported. Use object literal initialization instead.", nameIdentifier.location);
        }

        // Check if we matched '<' for type parameters
        let typeParameters: TypeParameter[] | undefined;
        if (parser.previous().type === TokenType.LESS_THAN) {
            typeParameters = parseTypeParameterList(parser);
            parser.consume(TokenType.LEFT_PAREN, "Expected '(' after type parameters");
        }
        
        const parameters = parseParameterList(parser);
        parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after method parameters");
        let returnType: Type;
        if (parser.match(TokenType.COLON)) {
            returnType = parseType(parser);
        } else {
            returnType = createPrimitiveType('void');
        }
    const body = parser.withFunctionScope(() => parser.parseBlockStatement());
        const method: MethodDeclaration = {
            kind: 'method',
            name: nameIdentifier,
            parameters,
            returnType,
            body,
            isPublic: modifiers.isPublic,
            isStatic: modifiers.isStatic,
            isAsync: modifiers.isAsync,
            typeParameters,
            location: nameIdentifier.location
        };
        const result = Object.create(null) as FieldOrMethodParseResult;
        result.method = method;
        return result;
    } else {
        throw new ParseError("Expected ':' for field or '(' for method", parser.getLocation());
    }
}

export function parseEnumDeclaration(parser: Parser): EnumDeclaration {
    // 'enum' token already consumed by match() in parseStatement
    const name = parser.consume(TokenType.IDENTIFIER, "Expected enum name");

    parser.consume(TokenType.LEFT_BRACE, "Expected '{' after enum name");

    const members: EnumMember[] = [];

    while (!parser.check(TokenType.RIGHT_BRACE) && !parser.isAtEnd()) {
        while (parser.checkRaw(TokenType.NEWLINE)) {
            parser.advanceRaw();
        }

        if (parser.check(TokenType.LINE_COMMENT)) {
            parser.advance();
            continue;
        }

        if (parser.check(TokenType.RIGHT_BRACE)) {
            break;
        }

        const memberName = parser.consume(TokenType.IDENTIFIER, "Expected enum member name");
        let value: Literal | undefined;

        if (parser.match(TokenType.ASSIGN)) {
            const valueToken = parser.advance();
            if (valueToken.type === TokenType.STRING || valueToken.type === TokenType.TEMPLATE_STRING) {
                value = createLiteral(parser, valueToken.value, 'string', undefined, valueToken.location);
            } else if (valueToken.type === TokenType.NUMBER) {
                value = createLiteral(parser, parseFloat(valueToken.value), 'number', valueToken.value, valueToken.location);
            } else {
                throw new ParseError("Expected string or number literal for enum value", parser.getLocation());
            }
        }

        members.push({
            kind: 'enumMember',
            name: { kind: 'identifier', name: memberName.value, location: parser.getLocation() },
            value,
            location: parser.getLocation()
        });

        while (parser.checkRaw(TokenType.NEWLINE)) {
            parser.advanceRaw();
        }

        if (parser.match(TokenType.COMMA)) {
            continue;
        } else {
            break;
        }
    }

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after enum members");

    return {
        kind: 'enum',
        name: { kind: 'identifier', name: name.value, location: parser.getLocation() },
        members,
        location: name.location
    };
}

export function parseTypeAliasDeclaration(parser: Parser): TypeAliasDeclaration {
    // 'type' token already consumed by match() in parseStatement
    const name = parser.consume(TokenType.IDENTIFIER, "Expected type alias name");

    parser.consume(TokenType.ASSIGN, "Expected '=' after type alias name");

    const type = parseType(parser);

    parser.consume(TokenType.SEMICOLON, "Expected ';' after type alias declaration");

    return {
        kind: 'typeAlias',
        name: { kind: 'identifier', name: name.value, location: name.location },
        type,
        location: name.location
    };
}
