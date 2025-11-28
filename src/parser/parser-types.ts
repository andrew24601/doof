import { ArrayTypeNode, ClassTypeNode, FunctionTypeNode, MapTypeNode, ParseError, PrimitiveType, PrimitiveTypeNode, SetTypeNode, Type, TypeAliasNode, UnionTypeNode } from "../types";
import { TokenType } from "./lexer";
import { Parser } from "./parser";

export function parseType(parser: Parser): Type {
    const baseType = parseBaseType(parser);

    // Check for union types (T | U | V)
    if (parser.match(TokenType.BITWISE_OR)) {
        const types: Type[] = [baseType];

        do {
            // Parse the next base type (without union processing)
            const nextType = parseBaseType(parser);
            types.push(nextType);
        } while (parser.match(TokenType.BITWISE_OR));

        return { kind: 'union', types } as UnionTypeNode;
    }

    return baseType;
}

export function createPrimitiveType(type: PrimitiveType): PrimitiveTypeNode {
    return {
        kind: 'primitive',
        type
    } as PrimitiveTypeNode;
}

function parseBaseType(parser: Parser): Type {
    if (parser.match(TokenType.WEAK)) {
        return parseWeakType(parser);
    }

    // Check for readonly type modifier (for collections: readonly int[], readonly Map<K, V>, readonly Set<T>)
    if (parser.match(TokenType.READONLY)) {
        return parseReadonlyType(parser);
    }

    let baseType: Type;

    if (parser.match(TokenType.INT, TokenType.FLOAT, TokenType.DOUBLE, TokenType.BOOL, TokenType.CHAR, TokenType.STRING_TYPE, TokenType.VOID)) {
        baseType = parsePrimitiveType(parser);
    } else if (parser.match(TokenType.MAP)) {
        baseType = parseMapType(parser);
    } else if (parser.match(TokenType.SET)) {
        baseType = parseSetType(parser);
    } else if (parser.match(TokenType.LEFT_PAREN)) {
        baseType = parseFunctionType(parser);
    } else if (parser.check(TokenType.IDENTIFIER)) {
        baseType = parseIdentifierType(parser);
    } else if (parser.match(TokenType.NULL)) {
        baseType = { kind: 'primitive', type: 'null' } as PrimitiveTypeNode;
    } else {
        throw new ParseError("Expected type", parser.getLocation());
    }

    return parseArrayTypeSuffix(parser, baseType);
}

function parseWeakType(parser: Parser): Type {
    const type = parseBaseType(parser);
    // Allow weak on any type - validator will check if it resolves to a class
    if (type.kind === 'class' || type.kind === 'typeAlias') {
        if (type.kind === 'class') {
            const classType = type as ClassTypeNode;
            return {
                kind: 'class',
                name: classType.name,
                isWeak: true,
                typeArguments: classType.typeArguments
            } as ClassTypeNode;
        } else {
            // For type aliases, mark as weak - validator will resolve and validate
            const typeAliasType = type as TypeAliasNode;
            return {
                kind: 'typeAlias',
                name: typeAliasType.name,
                isWeak: true,
                typeArguments: typeAliasType.typeArguments
            } as TypeAliasNode;
        }
    }
    throw new ParseError("'weak' can only be applied to class types", parser.getLocation());
}

function parseReadonlyType(parser: Parser): Type {
    const type = parseBaseType(parser);
    // Readonly can be applied to arrays, maps, and sets
    if (type.kind === 'array') {
        const arrayType = type as ArrayTypeNode;
        return {
            kind: 'array',
            elementType: arrayType.elementType,
            isReadonly: true
        } as ArrayTypeNode;
    } else if (type.kind === 'map') {
        const mapType = type as MapTypeNode;
        return {
            kind: 'map',
            keyType: mapType.keyType,
            valueType: mapType.valueType,
            isReadonly: true
        } as MapTypeNode;
    } else if (type.kind === 'set') {
        const setType = type as SetTypeNode;
        return {
            kind: 'set',
            elementType: setType.elementType,
            isReadonly: true
        } as SetTypeNode;
    }
    throw new ParseError("'readonly' type modifier can only be applied to array, Map, or Set types", parser.getLocation());
}

function parsePrimitiveType(parser: Parser): PrimitiveTypeNode {
    const primitiveType = parser.previous().value as PrimitiveType;
    return createPrimitiveType(primitiveType);
}

function parseMapType(parser: Parser): MapTypeNode {
    parser.consume(TokenType.LESS_THAN, "Expected '<' after 'Map'");
    const keyType = parseType(parser);
    parser.consume(TokenType.COMMA, "Expected ',' after map key type");
    const valueType = parseType(parser);
    parser.consume(TokenType.GREATER_THAN, "Expected '>' after map value type");
    return { kind: 'map', keyType, valueType } as MapTypeNode;
}

function parseSetType(parser: Parser): SetTypeNode {
    parser.consume(TokenType.LESS_THAN, "Expected '<' after 'Set'");
    const elementType = parseType(parser);
    parser.consume(TokenType.GREATER_THAN, "Expected '>' after set element type");
    return { kind: 'set', elementType } as SetTypeNode;
}

function parseFunctionType(parser: Parser): FunctionTypeNode {
    // Function type
    const parameters: { name: string; type: Type }[] = [];

    if (!parser.check(TokenType.RIGHT_PAREN)) {
        do {
            const name = parser.consume(TokenType.IDENTIFIER, "Expected parameter name");
            parser.consume(TokenType.COLON, "Expected ':' after parameter name");
            const type = parseType(parser);
            parameters.push({ name: name.value, type });
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after function parameters");
    parser.consume(TokenType.COLON, "Expected ':' after function parameters");
    const returnType = parseType(parser);

    return { kind: 'function', parameters, returnType } as FunctionTypeNode;
}

export function parseTypeArgumentList(parser: Parser): Type[] {
    const typeArguments: Type[] = [];
    do {
        typeArguments.push(parseType(parser));
    } while (parser.match(TokenType.COMMA));
    parser.consume(TokenType.GREATER_THAN, "Expected '>' after type arguments");
    return typeArguments;
}

function parseIdentifierType(parser: Parser): TypeAliasNode {
    const nameToken = parser.advance();
    let typeArguments: Type[] | undefined;

    if (parser.match(TokenType.LESS_THAN)) {
        typeArguments = parseTypeArgumentList(parser);
    }

    // This could be a class, struct, enum, or type alias. 
    // We'll create a type alias node and let the validator resolve it.
    return {
        kind: 'typeAlias',
        name: nameToken.value,
        typeArguments
    } as TypeAliasNode;
}

function parseArrayTypeSuffix(parser: Parser, baseType: Type): Type {
    // Check for array type - support multiple dimensions like int[][] 
    // Collect all array dimensions first
    const arrayDimensions: undefined[] = [];
    while (parser.match(TokenType.LEFT_BRACKET)) {
        // Dynamic array: T[]
        parser.consume(TokenType.RIGHT_BRACKET, "Expected ']' after '['");
        arrayDimensions.push(undefined);
    }

    // Build the array type from innermost to outermost
    // For double[][], we want: Array of (Array of double)
    // So we process dimensions in reverse order
    for (let i = arrayDimensions.length - 1; i >= 0; i--) {
        baseType = { kind: 'array', elementType: baseType } as ArrayTypeNode;
    }

    return baseType;
}
