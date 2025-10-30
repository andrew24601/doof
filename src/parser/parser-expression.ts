import { Expression, ConditionalExpression, NullCoalesceExpression, TypeGuardExpression, RangeExpression, NonNullAssertionExpression, Identifier, CallExpression, Literal, OptionalChainExpression, MemberExpression, ObjectExpression, ObjectProperty, ParseError, IndexExpression, TrailingLambdaExpression, BlockStatement, InterpolatedString, ArrayExpression, EnumShorthandMemberExpression, LambdaExpression, Type, SetExpression, BinaryExpression, UnaryExpression, TupleExpression, SourceLocation } from "../types";
import { TokenType } from "./lexer";
import { Parser } from "./parser";
import { parseParameterList } from "./parser-parameters";
import { parseType, parseTypeArgumentList } from "./parser-types";

// Expression parsing methods (using precedence climbing)
export function parseExpression(parser: Parser): Expression {
    return parseAssignment(parser);
}

function parseAssignment(parser: Parser): Expression {
    const expr = parseConditional(parser);

    if (parser.match(TokenType.ASSIGN, TokenType.PLUS_ASSIGN, TokenType.MINUS_ASSIGN,
        TokenType.MULTIPLY_ASSIGN, TokenType.DIVIDE_ASSIGN, TokenType.MODULO_ASSIGN)) {
        const operatorToken = parser.previous();
        const right = parseAssignment(parser);

        return createBinaryExpression(parser, operatorToken.value, expr, right, operatorToken.location);
    }

    return expr;
}

function parseConditional(parser: Parser): Expression {
    const expr = parseNullCoalesce(parser);

    if (parser.match(TokenType.QUESTION)) {
        const consequent = parseExpression(parser);
        parser.consume(TokenType.COLON, "Expected ':' after consequent in ternary expression");
        const alternate = parseConditional(parser);

        return {
            kind: 'conditional',
            test: expr,
            consequent,
            alternate,
            location: parser.getLocation()
        } as ConditionalExpression;
    }

    return expr;
}

function parseNullCoalesce(parser: Parser): Expression {
    let expr = parseLogicalOr(parser);

    while (parser.match(TokenType.NULL_COALESCE)) {
        const right = parseLogicalOr(parser);
        expr = {
            kind: 'nullCoalesce',
            left: expr,
            right,
            location: parser.getLocation()
        } as NullCoalesceExpression;
    }

    return expr;
}

function parseLogicalOr(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseLogicalAnd(parser),
        [TokenType.OR]
    );
}

function parseLogicalAnd(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseEquality(parser),
        [TokenType.AND]
    );
}

function parseEquality(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseTypeGuard(parser),
        [TokenType.EQUAL, TokenType.NOT_EQUAL]
    );
}

function parseTypeGuard(parser: Parser): Expression {
    let expr = parseComparison(parser);

    while (parser.match(TokenType.IS)) {
        const type = parseType(parser);
        expr = {
            kind: 'typeGuard',
            expression: expr,
            type,
            location: parser.getLocation()
        } as TypeGuardExpression;
    }

    return expr;
}

function parseComparison(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseBitwiseOr(parser),
        [TokenType.GREATER_THAN, TokenType.GREATER_EQUAL, TokenType.LESS_THAN, TokenType.LESS_EQUAL]
    );
}

function parseBitwiseOr(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseBitwiseXor(parser),
        [TokenType.BITWISE_OR]
    );
}

function parseBitwiseXor(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseBitwiseAnd(parser),
        [TokenType.BITWISE_XOR]
    );
}

function parseBitwiseAnd(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseShift(parser),
        [TokenType.BITWISE_AND]
    );
}

function parseShift(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseAddition(parser),
        [TokenType.LEFT_SHIFT, TokenType.RIGHT_SHIFT]
    );
}

function parseAddition(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseRange(parser),
        [TokenType.PLUS, TokenType.MINUS]
    );
}

function parseRange(parser: Parser): Expression {
    let expr = parseMultiplication(parser);

    if (parser.match(TokenType.RANGE_INCLUSIVE, TokenType.RANGE_EXCLUSIVE)) {
        const inclusive = parser.previous().type === TokenType.RANGE_INCLUSIVE;
        const end = parseMultiplication(parser);

        return {
            kind: 'range',
            start: expr,
            end,
            inclusive,
            location: parser.getLocation()
        } as RangeExpression;
    }

    return expr;
}

function parseMultiplication(parser: Parser): Expression {
    return parseBinaryExpression(parser,
        () => parseUnary(parser),
        [TokenType.MULTIPLY, TokenType.DIVIDE, TokenType.MODULO]
    );
}

function parseBinaryExpression(
    parser: Parser,
    parseNext: () => Expression,
    operators: TokenType[]
): Expression {
    let expr = parseNext();

    while (parser.match(...operators)) {
        const operatorToken = parser.previous();
        const right = parseNext();
        expr = createBinaryExpression(parser, operatorToken.value, expr, right, operatorToken.location);
    }

    return expr;
}

function parseUnary(parser: Parser): Expression {
    if (parser.match(TokenType.MINUS, TokenType.PLUS, TokenType.BITWISE_NOT)) {
        const operator = parser.previous().value;

        // Special case: collapse unary minus with numeric literal into a single negative literal
        if (operator === '-' && parser.check(TokenType.NUMBER)) {
            const operatorLocation = parser.previous().location;
            const numberToken = parser.advance();
            const positiveValue = parseFloat(numberToken.value);
            const negativeValue = -positiveValue;
            const originalText = `-${numberToken.value}`;

            return createLiteral(parser, negativeValue, 'number', originalText, operatorLocation);
        }

        // Special case: collapse unary plus with numeric literal into a single literal
        if (operator === '+' && parser.check(TokenType.NUMBER)) {
            const operatorLocation = parser.previous().location;
            const numberToken = parser.advance();
            const value = parseFloat(numberToken.value);
            const originalText = `+${numberToken.value}`;

            return createLiteral(parser, value, 'number', originalText, operatorLocation);
        }

        const operatorToken = parser.previous();
        const operand = parseUnary(parser);
        return createUnaryExpression(parser, operator, operand, operatorToken.location);
    }

    // Handle prefix logical NOT
    if (parser.match(TokenType.NOT)) {
        const operatorToken = parser.previous();
        const operand = parseUnary(parser);
        return createUnaryExpression(parser, operatorToken.value, operand, operatorToken.location);
    }

    return parsePostfix(parser);
}

function parsePostfix(parser: Parser): Expression {
    let expr = parseCall(parser);

    while (parser.match(TokenType.INCREMENT, TokenType.DECREMENT)) {
        const operatorToken = parser.previous();
        expr = createUnaryExpression(parser, operatorToken.value + '_post', expr, operatorToken.location);
    }

    return expr;
}

function parseCall(parser: Parser): Expression {
    let expr = parsePrimary(parser);

    while (true) {
        const typeArguments = tryParseCallTypeArguments(parser, expr);

        if (typeArguments) {
            if (parser.match(TokenType.LEFT_PAREN)) {
                expr = parseCallExpression(parser, expr, typeArguments);
                continue;
            }

            if (expr.kind === 'identifier' && parser.check(TokenType.LEFT_BRACE)) {
                expr = parseObjectLiteralWithClass(parser, expr as Identifier, typeArguments);
                continue;
            }

            if (parser.check(TokenType.LEFT_BRACE) && expr.kind === 'member') {
                expr = parseNamedArgumentCall(parser, expr, typeArguments);
                continue;
            }

            throw new ParseError("Expected '(' or '{' after generic type arguments", parser.getLocation());
        }

        if (parser.match(TokenType.LEFT_PAREN)) {
            expr = parseCallExpression(parser, expr);
        } else if (parser.check(TokenType.LEFT_BRACE) && expr.kind === 'member') {
            expr = parseNamedArgumentCall(parser, expr);
        } else if (parser.match(TokenType.OPTIONAL_CHAIN)) {
            expr = parseOptionalChaining(parser, expr);
        } else if (parser.match(TokenType.DOT)) {
            expr = parseMemberAccess(parser, expr);
        } else if (expr.kind === 'identifier' && parser.check(TokenType.LEFT_BRACE)) {
            expr = parseObjectLiteralWithClass(parser, expr as Identifier);
        } else if (parser.match(TokenType.LEFT_BRACKET)) {
            expr = parseIndexAccess(parser, expr);
        } else if (parser.match(TokenType.NOT)) {
            // Handle non-null assertion operator (!)
            expr = {
                kind: 'nonNullAssertion',
                operand: expr,
                location: parser.getLocation()
            } as NonNullAssertionExpression;
        } else {
            break;
        }
    }

    // Check for trailing lambda after call expression
    if (isCallExpression(expr) && parser.check(TokenType.ARROW)) {
        return parseTrailingLambda(parser, expr as CallExpression);
    }

    // Check for trailing lambda with omitted parentheses (single lambda parameter)
    // Only for member expressions like obj.method, not standalone identifiers
    if (isMemberExpression(expr) && parser.check(TokenType.ARROW)) {
        return parseTrailingLambdaWithOmittedParens(parser, expr);
    }

    return expr;
}

function parseCallExpression(parser: Parser, callee: Expression, typeArguments?: Type[]): CallExpression {
    const args: Expression[] = [];

    if (!parser.check(TokenType.RIGHT_PAREN)) {
        do {
            args.push(parseExpression(parser));
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after arguments");
    const callExpression: CallExpression = {
        kind: 'call',
        callee,
        arguments: args,
        location: parser.getLocation()
    };

    if (typeArguments && typeArguments.length > 0) {
        callExpression.typeArguments = typeArguments;
    }

    return callExpression;
}

function parseNamedArgumentCall(parser: Parser, callee: Expression, typeArguments?: Type[]): CallExpression {
    // Named argument call for method: obj.method { arg1: value1, arg2: value2 }
    parser.advance(); // consume '{'
    const namedArgs = parseNamedArguments(parser);
    const callExpression: CallExpression = {
        kind: 'call',
        callee,
        arguments: [],
        namedArguments: namedArgs,
        location: parser.getLocation()
    };

    if (typeArguments && typeArguments.length > 0) {
        callExpression.typeArguments = typeArguments;
    }

    return callExpression;
}

function parseNamedArguments(parser: Parser): ObjectProperty[] {
    const properties: ObjectProperty[] = [];

    if (!parser.check(TokenType.RIGHT_BRACE)) {
        do {
            let key: Identifier | Literal;
            let value: Expression | undefined;
            let shorthand = false;

            if (parser.match(TokenType.IDENTIFIER)) {
                const identifierToken = parser.previous();
                key = { kind: 'identifier', name: identifierToken.value, location: identifierToken.location } as Identifier;

                // Check for shorthand syntax: if next token is not ':', it's shorthand
                if (parser.match(TokenType.COLON)) {
                    value = parseExpression(parser);
                } else {
                    // Shorthand syntax: { x } means { x: x }
                    shorthand = true;
                    value = { kind: 'identifier', name: identifierToken.value, location: identifierToken.location } as Identifier;
                }
            } else {
                throw new ParseError("Expected parameter name in named arguments", parser.getLocation());
            }

            properties.push({
                kind: 'property',
                key,
                value,
                shorthand,
                location: parser.getLocation()
            } as ObjectProperty);
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after named arguments");

    return properties;
}

function parseOptionalChaining(parser: Parser, object: Expression): Expression {
    // Optional chaining: a?.property or a?.method()
    let expr: Expression;

    // Handle direct optional calls like fn?.()
    if (parser.match(TokenType.LEFT_PAREN)) {
        const args: Expression[] = [];

        if (!parser.check(TokenType.RIGHT_PAREN)) {
            do {
                args.push(parseExpression(parser));
            } while (parser.match(TokenType.COMMA));
        }

        parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after arguments");

        const optionalCall: OptionalChainExpression = {
            kind: 'optionalChain',
            object,
            computed: false,
            isMethodCall: true,
            isOptionalCall: true,
            location: parser.getLocation()
        };

        return {
            kind: 'call',
            callee: optionalCall,
            arguments: args,
            location: parser.getLocation()
        } as CallExpression;
    }

    // Check if the next token is a string literal (quoted property access)
    if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) {
        const stringToken = parser.advance();
        expr = {
            kind: 'optionalChain',
            object,
            property: { kind: 'literal', value: stringToken.value, literalType: 'string', location: parser.getLocation() } as Literal,
            computed: false,
            location: parser.getLocation()
        } as OptionalChainExpression;
    } else {
        const name = parser.consume(TokenType.IDENTIFIER, "Expected property name after '?.'");
        expr = {
            kind: 'optionalChain',
            object,
            property: { kind: 'identifier', name: name.value, location: name.location },
            computed: false,
            location: parser.getLocation()
        } as OptionalChainExpression;
    }

    // Check for method call after optional chaining
    if (parser.match(TokenType.LEFT_PAREN)) {
        const args: Expression[] = [];

        if (!parser.check(TokenType.RIGHT_PAREN)) {
            do {
                args.push(parseExpression(parser));
            } while (parser.match(TokenType.COMMA));
        }

        parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after arguments");
        (expr as OptionalChainExpression).isMethodCall = true;
        expr = {
            kind: 'call',
            callee: expr,
            arguments: args,
            location: parser.getLocation()
        } as CallExpression;
    }

    return expr;
}

function parseMemberAccess(parser: Parser, object: Expression): MemberExpression {
    // Check if the next token is a string literal (quoted property access)
    if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) {
        const stringToken = parser.advance();
        return {
            kind: 'member',
            object,
            property: { kind: 'literal', value: stringToken.value, literalType: 'string', location: parser.getLocation() } as Literal,
            computed: false, // Even though it uses a string, it's not computed (not dynamic)
            location: parser.getLocation()
        } as MemberExpression;
    } else {
        const name = parser.consume(TokenType.IDENTIFIER, "Expected property name after '.'");
        return {
            kind: 'member',
            object,
            property: { kind: 'identifier', name: name.value, location: name.location },
            computed: false,
            location: parser.getLocation()
        } as MemberExpression;
    }
}

function parseObjectLiteralWithClass(parser: Parser, identifier: Identifier, typeArguments?: Type[]): ObjectExpression {
    // Object literal with class name: ClassName { ... }
    const className = identifier.name;
    parser.advance(); // consume '{'
    return parseObjectProperties(parser, className, typeArguments);
}

function parseIndexAccess(parser: Parser, object: Expression): IndexExpression {
    const index = parseExpression(parser);
    parser.consume(TokenType.RIGHT_BRACKET, "Expected ']' after index");
    return {
        kind: 'index',
        object,
        index: index,
        location: parser.getLocation()
    } as IndexExpression;
}

function isCallExpression(expr: Expression): boolean {
    return expr.kind === 'call';
}

function isMemberExpression(expr: Expression): boolean {
    // Only allow member expressions (obj.method), not standalone identifiers
    return expr.kind === 'member';
}

function parseTrailingLambda(parser: Parser, callExpr: CallExpression): TrailingLambdaExpression {
    parser.consume(TokenType.ARROW, "Expected '=>' for trailing lambda");

    let body: Expression | BlockStatement;
    let isBlock = false;

    if (parser.check(TokenType.LEFT_BRACE)) {
        // Block form
        body = parser.parseBlockStatement();
        isBlock = true;
    } else {
        // Expression form
        body = parseExpression(parser);
        isBlock = false;
    }

    return {
        kind: 'trailingLambda',
        callee: callExpr.callee,
        arguments: callExpr.arguments,
        lambda: {
            body,
            isBlock
        },
        location: parser.getLocation()
    } as TrailingLambdaExpression;
}

function parseTrailingLambdaWithOmittedParens(parser: Parser, expr: Expression): TrailingLambdaExpression {
    parser.consume(TokenType.ARROW, "Expected '=>' for trailing lambda");

    let body: Expression | BlockStatement;
    let isBlock = false;

    if (parser.check(TokenType.LEFT_BRACE)) {
        // Block form
        body = parser.parseBlockStatement();
        isBlock = true;
    } else {
        // Expression form
        body = parseExpression(parser);
        isBlock = false;
    }

    return {
        kind: 'trailingLambda',
        callee: expr,
        arguments: [], // No arguments since parentheses were omitted
        lambda: {
            body,
            isBlock
        },
        location: parser.getLocation()
    } as TrailingLambdaExpression;
}

function parseLiteral(parser: Parser): Expression | null {
    if (parser.match(TokenType.BOOLEAN)) {
        const token = parser.previous();
        return createLiteral(parser, token.value === 'true', 'boolean', undefined, token.location);
    }

    if (parser.match(TokenType.NULL)) {
        const token = parser.previous();
        return createLiteral(parser, null, 'null', undefined, token.location);
    }

    if (parser.match(TokenType.NUMBER)) {
        const token = parser.previous();
        return createLiteral(parser, parseFloat(token.value), 'number', token.value, token.location);
    }

    if (parser.match(TokenType.CHAR_LITERAL)) {
        const token = parser.previous();
        return createLiteral(parser, token.value, 'char', undefined, token.location);
    }

    // Check for interpolated strings first
    if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING) || parser.check(TokenType.INTERPOLATION_START)) {
        return parseInterpolatedString(parser);
    }

    return null;
}

export function parseInterpolatedString(parser: Parser): Expression {
    const parts: (string | Expression)[] = [];
    let isTemplate = false;
    const startLocation = parser.getLocation();

    // Check if this is a simple string literal (no interpolation following)
    if ((parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) &&
        !parser.checkNext(TokenType.INTERPOLATION_START)) {
        // Simple string literal
        const token = parser.advance();
        const literal = createLiteral(parser, token.value, 'string', undefined, token.location);
        if (token.type === TokenType.TEMPLATE_STRING) {
            literal.isTemplate = true;
        }
        return literal;
    }

    // Parse interpolated string
    while (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING) || parser.check(TokenType.INTERPOLATION_START)) {
        if (parser.match(TokenType.STRING) || parser.match(TokenType.TEMPLATE_STRING)) {
            const token = parser.previous();
            if (token.type === TokenType.TEMPLATE_STRING) {
                isTemplate = true;
            }
            parts.push(token.value);
        } else if (parser.match(TokenType.INTERPOLATION_START)) {
            // Parse the expression inside interpolation
            const expr = parseExpression(parser);
            parts.push(expr);
            parser.consume(TokenType.INTERPOLATION_END, "Expected '}' after interpolation expression");

            // After interpolation, check for more string parts
            if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING)) {
                // Continue parsing more parts
            }
        } else {
            break;
        }
    }

    if (parts.length === 1 && typeof parts[0] === 'string') {
        // Simple string literal - use the first token's location
        const lit = createLiteral(parser, parts[0], 'string', undefined, startLocation);
        if (isTemplate) {
            lit.isTemplate = true;
        }
        return lit;
    }

    return {
        kind: 'interpolated-string',
        parts,
        isTemplate,
        location: parser.getLocation()
    } as InterpolatedString;
}

function parsePrimary(parser: Parser): Expression {
    const literal = parseLiteral(parser);
    if (literal) return literal;

    if (parser.match(TokenType.THIS)) {
        const thisToken = parser.previous();
        return createIdentifier(parser, 'this', thisToken.location);
    }

    // Handle 'new' keyword - only allow in constructor call contexts
    if (parser.match(TokenType.NEW)) {
        // 'new' must be followed by identifier and then ( or {
        if (!parser.check(TokenType.IDENTIFIER)) {
            throw new ParseError("Expected class name after 'new'", parser.getLocation());
        }

        const classNameToken = parser.advance();
        const identifier = createIdentifier(parser, classNameToken.value, classNameToken.location);

        // Verify that 'new' is followed by valid constructor call syntax
        if (!parser.check(TokenType.LEFT_PAREN) && !parser.check(TokenType.LEFT_BRACE)) {
            throw new ParseError("Expected '(' or '{' after class name in 'new' expression", parser.getLocation());
        }

        // Return the identifier - the call parsing will handle the rest
        return identifier;
    }

    if (parser.match(TokenType.IDENTIFIER)) {
        const identifierToken = parser.previous();
        const identifier = createIdentifier(parser, identifierToken.value, identifierToken.location);

        if (parser.check(TokenType.TEMPLATE_STRING) || parser.check(TokenType.STRING) || parser.check(TokenType.INTERPOLATION_START)) {
            const templateToken = parser.peek();
            let isAdjacent = parser.isAdjacent(identifierToken.location, templateToken.location);

            if (!isAdjacent && templateToken.type === TokenType.INTERPOLATION_START) {
                const expectedTemplateStart = identifierToken.location.end.column;
                const actualInterpolationStart = templateToken.location.start.column;
                const sameLine = identifierToken.location.end.line === templateToken.location.start.line;
                // The interpolation token location begins immediately after `${`, so account for those characters
                isAdjacent = sameLine && actualInterpolationStart === expectedTemplateStart + 3;
            }

            if (isAdjacent) {
                const taggedTemplate = parseInterpolatedString(parser);

                if (taggedTemplate.kind === 'interpolated-string') {
                    (taggedTemplate as InterpolatedString).tagIdentifier = identifier;
                    return taggedTemplate;
                }

                const literalTemplate = taggedTemplate as Literal;
                const wasTemplate = literalTemplate.isTemplate ?? false;
                return {
                    kind: 'interpolated-string',
                    parts: [literalTemplate.value as string],
                    isTemplate: wasTemplate,
                    tagIdentifier: identifier,
                    location: parser.getLocation()
                } as InterpolatedString;
            }
        }

        return identifier;
    }

    // Allow type keywords to be used as function names (int(), float(), double(), bool(), string(), char())
    // Also allow collection type constructors Map<...>() and Set<...>() in expression position
    if (parser.match(TokenType.INT, TokenType.FLOAT, TokenType.DOUBLE, TokenType.BOOL, TokenType.STRING_TYPE, TokenType.CHAR, TokenType.MAP, TokenType.SET)) {
        const token = parser.previous();
        return createIdentifier(parser, token.value, token.location);
    }

    if (parser.match(TokenType.LEFT_PAREN)) {
        // Could be grouped expression, lambda, or tuple
        if (checkLambda(parser)) {
            return parseLambda(parser);
        } else if (checkTuple(parser)) {
            return parseTuple(parser);
        } else {
            const expr = parseExpression(parser);
            parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after expression");
            return expr;
        }
    }

    if (parser.match(TokenType.LEFT_BRACKET)) {
        const elements: Expression[] = [];

        if (!parser.check(TokenType.RIGHT_BRACKET)) {
            do {
                elements.push(parseExpression(parser));
            } while (parser.match(TokenType.COMMA));
        }

        parser.consume(TokenType.RIGHT_BRACKET, "Expected ']' after array elements");

        return {
            kind: 'array',
            elements,
            location: parser.getLocation()
        } as ArrayExpression;
    }

    if (parser.match(TokenType.LEFT_BRACE)) {
        // Anonymous object literal: { ... }
        return parseObjectLiteral(parser, true); // true indicates brace was already consumed
    }

    if (parser.match(TokenType.ARROW)) {
        // Short-form lambda
        return parseShortLambda(parser);
    }

    if (parser.match(TokenType.DOT)) {
        // Enum shorthand: .MEMBER
        const dotToken = parser.previous();
        const memberName = parser.consume(TokenType.IDENTIFIER, "Expected enum member name after '.'");
        return {
            kind: 'enumShorthand',
            memberName: memberName.value,
            location: {start: dotToken.location.start, end: memberName.location.end, filename: parser.filename }
        } as EnumShorthandMemberExpression;
    }

    throw new ParseError(`Unexpected token '${parser.peek().value}' at position ${parser.current}`, parser.getLocation());
}

function checkLambda(parser: Parser): boolean {
    // Look ahead to see if this is a lambda expression
    const snapshot = parser.saveState();
    try {
        if (parser.check(TokenType.RIGHT_PAREN)) {
            // Empty parameter list ()
            parser.advance();
            // Check for optional return type: (): Type => or just (): =>
            let isLambda = parser.check(TokenType.ARROW);
            if (!isLambda && parser.check(TokenType.COLON)) {
                // Has return type annotation, skip it
                parser.advance(); // consume ':'
                // Skip the return type - could be complex, so just look for '=>'
                while (!parser.isAtEnd() && !parser.check(TokenType.ARROW) && !parser.checkRaw(TokenType.NEWLINE) && !parser.check(TokenType.EOF)) {
                    parser.advance();
                }
                isLambda = parser.check(TokenType.ARROW);
            }
            parser.restoreState(snapshot);
            return isLambda;
        }

        // Check for parameter list
        if (parser.match(TokenType.IDENTIFIER)) {
            if (parser.match(TokenType.COLON)) {
                // Has type annotation, likely lambda
                parser.restoreState(snapshot);
                return true;
            }
            if (parser.match(TokenType.COMMA) || parser.match(TokenType.RIGHT_PAREN)) {
                // Multiple params or end of params
                const hasArrow = parser.check(TokenType.ARROW);
                parser.restoreState(snapshot);
                return hasArrow;
            }
        }

        parser.restoreState(snapshot);
        return false;
    } catch {
        parser.restoreState(snapshot);
        return false;
    }
}

function checkTuple(parser: Parser): boolean {
    // Look ahead to see if this is a tuple expression
    const snapshot = parser.saveState();
    try {
        // If it's an empty parentheses group, it's not a tuple
        if (parser.check(TokenType.RIGHT_PAREN)) {
            parser.restoreState(snapshot);
            return false;
        }

        // Look for comma-separated expressions followed by )
        // A single expression in parentheses is a grouped expression, not a tuple
        let elementCount = 0;
        let hasComma = false;

        while (!parser.check(TokenType.RIGHT_PAREN) && !parser.isAtEnd()) {
            // Skip over one expression (simplified - just advance until comma or closing paren)
            let parenDepth = 0;
            let bracketDepth = 0;
            let braceDepth = 0;

            while (!parser.isAtEnd()) {
                const currentType = parser.peek().type;
                
                if (currentType === TokenType.LEFT_PAREN) parenDepth++;
                else if (currentType === TokenType.RIGHT_PAREN) {
                    if (parenDepth === 0) break; // Found end of tuple
                    parenDepth--;
                }
                else if (currentType === TokenType.LEFT_BRACKET) bracketDepth++;
                else if (currentType === TokenType.RIGHT_BRACKET) bracketDepth--;
                else if (currentType === TokenType.LEFT_BRACE) braceDepth++;
                else if (currentType === TokenType.RIGHT_BRACE) braceDepth--;
                else if (currentType === TokenType.COMMA && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                    hasComma = true;
                    break; // Found separator
                }
                
                parser.advance();
            }

            elementCount++;

            if (parser.check(TokenType.COMMA)) {
                parser.advance(); // consume comma
                hasComma = true;
            } else {
                break;
            }
        }

        parser.restoreState(snapshot);
        // It's a tuple if we have more than one element OR one element followed by a comma
        return hasComma || elementCount > 1;
    } catch {
        parser.restoreState(snapshot);
        return false;
    }
}

function parseTuple(parser: Parser): TupleExpression {
    // Already consumed '('
    const elements: Expression[] = [];

    if (!parser.check(TokenType.RIGHT_PAREN)) {
        do {
            elements.push(parseExpression(parser));
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after tuple elements");
    
    return {
        kind: 'tuple',
        elements,
        location: parser.getLocation()
    } as TupleExpression;
}

function parseLambda(parser: Parser): LambdaExpression {
    // Already consumed '('
    const parameters = parseParameterList(parser);
    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after lambda parameters");

    let returnType: Type | undefined;
    if (parser.match(TokenType.COLON)) {
        returnType = parseType(parser);
    }

    parser.consume(TokenType.ARROW, "Expected '=>' after lambda parameters");

    let body: Expression | BlockStatement;
    if (parser.check(TokenType.LEFT_BRACE)) {
        body = parser.parseBlockStatement();
    } else {
        body = parseExpression(parser);
    }

    return {
        kind: 'lambda',
        parameters,
        body,
        returnType,
        location: parser.getLocation()
    };
}

function parseShortLambda(parser: Parser): LambdaExpression {
    // Already consumed '=>'
    let body: Expression | BlockStatement;
    if (parser.check(TokenType.LEFT_BRACE)) {
        body = parser.parseBlockStatement();
    } else {
        body = parseExpression(parser);
    }

    return {
        kind: 'lambda',
        parameters: [], // Will be inferred from context
        body,
        isShortForm: true,
        location: parser.getLocation()
    };
}

function parseObjectLiteral(parser: Parser, braceAlreadyConsumed: boolean = false): ObjectExpression | SetExpression {
    let className: string | undefined;

    // Check if this is class construction syntax
    if (parser.check(TokenType.IDENTIFIER) && parser.peek(1).type === TokenType.LEFT_BRACE) {
        className = parser.advance().value;
        parser.advance(); // consume '{'
    } else if (!braceAlreadyConsumed) {
        parser.advance(); // consume '{' that was already matched
    }

    // Handle empty braces - default to object literal
    if (parser.check(TokenType.RIGHT_BRACE)) {
        parser.advance(); // consume '}'
        return {
            kind: 'object',
            properties: [],
            className,
            location: parser.getLocation()
        } as ObjectExpression;
    }

    // Check the first element to determine if this is a set or object literal
    if (isFirstElementSetPattern(parser)) {
        return parseSetLiteral(parser);
    } else {
        return parseObjectProperties(parser, className);
    }
}

function parseSetLiteral(parser: Parser): SetExpression {
    const elements: Expression[] = [];

    do {
        if (parser.check(TokenType.DOT)) {
            elements.push(parseEnumShorthand(parser));
        } else {
            elements.push(parseExpression(parser));
        }
    } while (parser.match(TokenType.COMMA));

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after set elements");

    return {
        kind: 'set',
        elements,
        location: parser.getLocation()
    };
}

function parseObjectProperties(parser: Parser, className?: string, typeArguments?: Type[]): ObjectExpression {
    const properties: ObjectProperty[] = [];

    if (!parser.check(TokenType.RIGHT_BRACE)) {
        do {
            properties.push(parseObjectProperty(parser));
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after object properties");

    const objectExpression: ObjectExpression = {
        kind: 'object',
        properties,
        className,
        location: parser.getLocation()
    };

    if (typeArguments && typeArguments.length > 0) {
        objectExpression.typeArguments = typeArguments;
    }

    return objectExpression;
}

function parseObjectProperty(parser: Parser): ObjectProperty {
    let key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression;
    let value: Expression | undefined;
    let shorthand = false;

    if (parser.match(TokenType.LEFT_BRACKET)) {
        // Computed property
        const computedKey = parseExpression(parser);
        parser.consume(TokenType.RIGHT_BRACKET, "Expected ']' after computed property key");
        parser.consume(TokenType.COLON, "Expected ':' after computed property key");
        value = parseExpression(parser);

        if (computedKey.kind !== 'member') {
            throw new ParseError("computed property name expressions are not supported in object literals", parser.getLocation());
        }
        key = computedKey;
    } else {
        const { key: parsedKey, value: parsedValue, shorthand: isShorthand } = parsePropertyKeyValue(parser);
        key = parsedKey;
        value = parsedValue;
        shorthand = isShorthand;
    }

    let trailingComment: string | undefined;
    if (parser.check(TokenType.LINE_COMMENT)) {
        trailingComment = parser.advance().value;
    }

    return {
        kind: 'property',
        key,
        value,
        shorthand,
        trailingComment,
        location: parser.getLocation()
    };
}

function parsePropertyKeyValue(parser: Parser): {
    key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression;
    value: Expression;
    shorthand: boolean;
} {
    if (parser.match(TokenType.IDENTIFIER)) {
        const identifierToken = parser.previous();

        if (parser.match(TokenType.DOT)) {
            // Enum member access
            const memberName = parser.consume(TokenType.IDENTIFIER, "Expected enum member name after '.'");
            const key = {
                kind: 'member',
                object: { kind: 'identifier', name: identifierToken.value, location: identifierToken.location },
                property: { kind: 'identifier', name: memberName.value, location: memberName.location },
                computed: false,
                location: identifierToken.location
            } as MemberExpression;
            parser.consume(TokenType.COLON, "Expected ':' after enum member");
            return { key, value: parseExpression(parser), shorthand: false };
        } else {
            const key = { kind: 'identifier', name: identifierToken.value, location: identifierToken.location } as Identifier;

            if (parser.match(TokenType.COLON)) {
                return { key, value: parseExpression(parser), shorthand: false };
            } else {
                // Shorthand syntax
                return {
                    key,
                    value: { kind: 'identifier', name: identifierToken.value, location: identifierToken.location } as Identifier,
                    shorthand: true
                };
            }
        }
    } else if (parser.match(TokenType.DOT)) {
        // Enum shorthand
        const memberName = parser.consume(TokenType.IDENTIFIER, "Expected enum member name after '.'");
        const key = {
            kind: 'enumShorthand',
            memberName: memberName.value,
            location: parser.getLocation()
        } as EnumShorthandMemberExpression;
        parser.consume(TokenType.COLON, "Expected ':' after enum member");
        return { key, value: parseExpression(parser), shorthand: false };
    } else {
        // String, number, or boolean literal key
        const key = parseLiteralKey(parser);
        parser.consume(TokenType.COLON, "Expected ':' after literal property name");
        return { key, value: parseExpression(parser), shorthand: false };
    }
}

function parseLiteralKey(parser: Parser): Literal {
    if (parser.match(TokenType.STRING) || parser.match(TokenType.TEMPLATE_STRING)) {
        const token = parser.previous();
        return createLiteral(parser, token.value, 'string', undefined, token.location);
    } else if (parser.match(TokenType.NUMBER)) {
        const token = parser.previous();
        return createLiteral(parser, Number(token.value), 'number', token.value, token.location);
    } else if (parser.match(TokenType.BOOLEAN)) {
        const token = parser.previous();
        return createLiteral(parser, token.value === 'true', 'boolean', undefined, token.location);
    } else {
        throw new ParseError("Expected property name (identifier, string, number, or boolean)", parser.getLocation());
    }
}

function parseEnumShorthand(parser: Parser): EnumShorthandMemberExpression {
    parser.advance(); // consume '.'
    const memberName = parser.consume(TokenType.IDENTIFIER, "Expected enum member name after '.'");
    return {
        kind: 'enumShorthand',
        memberName: memberName.value,
        location: memberName.location
    };
}

function isFirstElementSetPattern(parser: Parser): boolean {
    const snapshot = parser.saveState();

    try {
        // Try to parse the first element and see what follows
        if (parser.check(TokenType.IDENTIFIER)) {
            parser.advance();
            // Check for enum member access (e.g., Color.Red)
            if (parser.check(TokenType.DOT)) {
                parser.advance(); // consume '.'
                if (parser.check(TokenType.IDENTIFIER)) {
                    parser.advance(); // consume member name
                }
                // Enum member - check what follows
                return parser.check(TokenType.COMMA) || parser.check(TokenType.RIGHT_BRACE);
            } else {
                // Regular identifier - check what follows
                if (parser.check(TokenType.COLON)) {
                    // identifier: ... - this is object syntax
                    return false;
                }
                // identifier, ... or identifier} - could be set or object shorthand
                // For now, prefer object interpretation to support shorthand syntax
                return false;
            }
        } else if (parser.check(TokenType.DOT)) {
            // Enum shorthand: .MEMBER
            parser.advance(); // consume '.'
            if (parser.check(TokenType.IDENTIFIER)) {
                parser.advance(); // consume member name
            }
            // If followed by comma or brace, it's a set; if followed by colon, it's an object
            return parser.check(TokenType.COMMA) || parser.check(TokenType.RIGHT_BRACE);
        } else if (parser.check(TokenType.STRING) || parser.check(TokenType.TEMPLATE_STRING) || parser.check(TokenType.NUMBER) || parser.check(TokenType.BOOLEAN)) {
            parser.advance();
            // Literals - if followed by comma or brace, it's a set; if followed by colon, it's an object
            return parser.check(TokenType.COMMA) || parser.check(TokenType.RIGHT_BRACE);
        } else {
            return false; // Unknown pattern, default to object
        }
    } finally {
        // Restore position
        parser.restoreState(snapshot);
    }
}

function createBinaryExpression(parser: Parser, operator: string, left: Expression, right: Expression, location: SourceLocation): BinaryExpression {
    return {
        kind: 'binary',
        operator,
        left,
        right,
        location: location
    };
}

function createUnaryExpression(parser: Parser, operator: string, operand: Expression, location: SourceLocation): UnaryExpression {
    return {
        kind: 'unary',
        operator,
        operand,
        location: location
    };
}

export function createLiteral(parser: Parser, value: any, literalType: 'string' | 'char' | 'number' | 'boolean' | 'null', originalText: string | undefined, location: SourceLocation): Literal {
    return {
        kind: 'literal',
        value,
        literalType,
        originalText,
        location: location
    };
}

export function createIdentifier(parser: Parser, name: string, location: SourceLocation): Identifier {
    return {
        kind: 'identifier',
        name,
        location: location
    };
}

function tryParseCallTypeArguments(parser: Parser, callee: Expression): Type[] | undefined {
    if (!canExpressionAcceptTypeArguments(callee)) {
        return undefined;
    }

    const snapshot = parser.saveState();

    try {
        if (!parser.match(TokenType.LESS_THAN)) {
            parser.restoreState(snapshot);
            return undefined;
        }

        const typeArguments = parseTypeArgumentList(parser);
        const nextTokenType = parser.peek().type;

        const canUseAsNamedCall = nextTokenType === TokenType.LEFT_BRACE && callee.kind === 'member';
        const canUseAsObjectLiteral = nextTokenType === TokenType.LEFT_BRACE && callee.kind === 'identifier';
        if (nextTokenType !== TokenType.LEFT_PAREN && !canUseAsNamedCall && !canUseAsObjectLiteral) {
            parser.restoreState(snapshot);
            return undefined;
        }

        return typeArguments;
    } catch (error) {
        parser.restoreState(snapshot);

        if (error instanceof ParseError) {
            return undefined;
        }

        throw error;
    }
}

function canExpressionAcceptTypeArguments(expr: Expression): boolean {
    switch (expr.kind) {
        case 'identifier':
        case 'member':
        case 'call':
        case 'optionalChain':
        case 'nonNullAssertion':
        case 'index':
            return true;
        default:
            return false;
    }
}
