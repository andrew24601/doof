import {
    Statement, ImportDeclaration, ExportDeclaration, ImportSpecifier,
    Literal, ParseError
} from '../types';
import { TokenType } from './lexer';
import { parseStatement } from './parser-statements';
import { Parser } from './parser';

export function parseImportDeclaration(parser: Parser): ImportDeclaration {
    // 'import' token already consumed by match() in parseStatement()
    parser.consume(TokenType.LEFT_BRACE, "Expected '{' after 'import'");

    const specifiers: ImportSpecifier[] = [];

    if (!parser.check(TokenType.RIGHT_BRACE)) {
        do {
            const imported = parser.consume(TokenType.IDENTIFIER, "Expected identifier").value;
            let local: string | undefined;

            if (parser.match(TokenType.IDENTIFIER) && parser.previous().value === 'as') {
                local = parser.consume(TokenType.IDENTIFIER, "Expected identifier after 'as'").value;
            }

            specifiers.push({
                kind: 'importSpecifier',
                imported: { kind: 'identifier', name: imported, location: parser.getLocation() },
                local: local ? { kind: 'identifier', name: local, location: parser.getLocation() } : undefined,
                location: parser.getLocation()
            });
        } while (parser.match(TokenType.COMMA));
    }

    parser.consume(TokenType.RIGHT_BRACE, "Expected '}' after import specifiers");
    parser.consume(TokenType.FROM, "Expected 'from' after import specifiers");

    const source = parser.consume(TokenType.STRING, "Expected string literal after 'from'");
    parser.consume(TokenType.SEMICOLON, "Expected ';' after import declaration");

    return {
        kind: 'import',
        specifiers,
        source: {
            kind: 'literal',
            value: source.value,
            literalType: 'string',
            location: parser.getLocation()
        },
        location: parser.getLocation()
    };
}

export function parseExportDeclaration(parser: Parser): ExportDeclaration {
    // 'export' token already consumed by match() in parseStatement()
    const declaration = parseStatement(parser);
    if (!declaration) {
        throw new ParseError("Expected declaration after 'export'", parser.getLocation());
    }

    if (declaration.kind === "class" || declaration.kind === "externClass" || declaration.kind === "function" || declaration.kind === "enum" || declaration.kind === "typeAlias" || declaration.kind === "variable" || declaration.kind === "interface") {
        declaration.isExport = true;
    } else {
        throw new ParseError("Only class, extern class, function, enum, interface, type alias, or variable declarations can be exported", parser.getLocation());
    }

    return {
        kind: 'export',
        declaration,
        location: parser.getLocation()
    };
}
