import {
    Parameter, Type, Expression, FunctionTypeNode
} from '../types';
import { TokenType } from './lexer';
import { Parser } from './parser';
import { parseType, createPrimitiveType } from './parser-types';
import { parseExpression } from './parser-expression';

export function parseParameterList(parser: Parser): Parameter[] {
    const parameters: Parameter[] = [];

    if (!parser.check(TokenType.RIGHT_PAREN)) {
        do {
            const name = parser.consume(TokenType.IDENTIFIER, "Expected parameter name");

            // Check for concise form: name(type) vs regular form: name: type
            let type: Type;
            let isConciseForm = false;

            if (parser.match(TokenType.LEFT_PAREN)) {
                // Concise form: name(param1: type1, param2: type2): returnType or name(param1: type1, param2: type2)
                isConciseForm = true;

                // Parse parameters for the function type
                const functionParams: { name: string; type: Type }[] = [];

                if (!parser.check(TokenType.RIGHT_PAREN)) {
                    do {
                        const paramName = parser.consume(TokenType.IDENTIFIER, "Expected parameter name");
                        parser.consume(TokenType.COLON, "Expected ':' after parameter name");
                        const paramType = parseType(parser);
                        functionParams.push({ name: paramName.value, type: paramType });
                    } while (parser.match(TokenType.COMMA));
                }

                parser.consume(TokenType.RIGHT_PAREN, "Expected ')' after function parameters");

                // Check for return type
                let returnType: Type = createPrimitiveType('void'); // Default to void
                if (parser.match(TokenType.COLON)) {
                    returnType = parseType(parser);
                }

                const functionType: FunctionTypeNode = {
                    kind: 'function',
                    parameters: functionParams,
                    returnType,
                    isConciseForm: true
                };
                type = functionType;
            } else {
                // Regular form: name: type
                parser.consume(TokenType.COLON, "Expected ':' after parameter name");

                type = parseType(parser);
            }

            let defaultValue: Expression | undefined;
            if (parser.match(TokenType.ASSIGN)) {
                defaultValue = parseExpression(parser);
            }

            parameters.push({
                kind: 'parameter',
                name: { kind: 'identifier', name: name.value, location: parser.getLocation() },
                type,
                defaultValue,
                isConciseForm,
                location: parser.getLocation()
            });
        } while (parser.match(TokenType.COMMA));
    }

    return parameters;
}
