import { Parser } from './parser';
import { Lexer, Token, TokenType } from './lexer';
import {
  ActionConclusionColumn,
  BooleanConditionColumn,
  ComparisonConditionColumn,
  DeclarationConclusionColumn,
  Expression,
  Identifier,
  MarkdownHeader,
  MarkdownTable,
  ParseError,
  SourceLocation,
  Statement,
  TableColumn,
  TableRow,
  TableRowCell
} from '../types';
import { createIdentifier, parseExpression } from './parser-expression';

function mergeLocations(start: SourceLocation, end: SourceLocation): SourceLocation {
  return {
    start: start.start,
    end: end.end,
    filename: start.filename ?? end.filename
  };
}

function parseMarkdownHeaderLine(raw: string): { level: number; text: string } {
  let level = 0;
  while (level < raw.length && raw[level] === '#') {
    level++;
  }
  if (level === 0) {
    return { level: 1, text: raw.trim() };
  }
  const clampedLevel = Math.min(level, 6);
  const text = raw.slice(level).trim();
  return {
    level: clampedLevel,
    text
  };
}

interface DetailedTableCell {
  text: string;
  location: SourceLocation;
}

function isAlignmentCell(cell: string): boolean {
  const trimmed = cell.trim();
  if (!/^:?-{1,}:?$/.test(trimmed)) {
    return false;
  }
  return /-/.test(trimmed);
}

function parseAlignment(cell: string): 'left' | 'center' | 'right' {
  const trimmed = cell.trim();
  const startsWithColon = trimmed.startsWith(':');
  const endsWithColon = trimmed.endsWith(':');

  if (startsWithColon && endsWithColon) {
    return 'center';
  }
  if (endsWithColon) {
    return 'right';
  }
  return 'left';
}

function ensureBoundaryPipes(parser: Parser, line: string, location: SourceLocation): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    parser.errors.push(new ParseError('Markdown table rows must start and end with a pipe "|" character', location));
  }
}

function splitTableRowDetailed(line: string, location: SourceLocation, filename?: string): DetailedTableCell[] {
  const cells: DetailedTableCell[] = [];
  if (line.length === 0) {
    return cells;
  }

  const baseLine = location.start.line;
  const baseColumn = location.start.column;

  const hasLeadingPipe = line.startsWith('|');
  const hasTrailingPipe = line.endsWith('|');

  let currentStart = hasLeadingPipe ? 1 : 0;

  const pushCell = (rawStart: number, rawEnd: number) => {
    let trimmedStart = rawStart;
    let trimmedEnd = rawEnd;

    while (trimmedStart < rawEnd && /[\t\s]/.test(line[trimmedStart])) {
      trimmedStart++;
    }
    while (trimmedEnd > trimmedStart && /[\t\s]/.test(line[trimmedEnd - 1])) {
      trimmedEnd--;
    }

    const isEmpty = trimmedStart >= trimmedEnd;
    const text = isEmpty ? '' : line.slice(trimmedStart, trimmedEnd);
    const startColumn = baseColumn + (isEmpty ? rawStart : trimmedStart);
    const endColumn = baseColumn + (isEmpty ? rawStart : trimmedEnd);

    cells.push({
      text,
      location: {
        start: { line: baseLine, column: startColumn },
        end: { line: baseLine, column: endColumn },
        filename: location.filename ?? filename
      }
    });
  };

  for (let index = currentStart; index < line.length; index++) {
    if (line[index] === '|') {
      pushCell(currentStart, index);
      currentStart = index + 1;
    }
  }

  if (!hasTrailingPipe) {
    pushCell(currentStart, line.length);
  }

  return cells;
}

function createEmptyCell(location: SourceLocation, filename?: string): DetailedTableCell {
  return {
    text: '',
    location: {
      start: { line: location.end.line, column: location.end.column },
      end: { line: location.end.line, column: location.end.column },
      filename: location.filename ?? filename
    }
  };
}

function normalizeRowCells(
  cells: DetailedTableCell[],
  expected: number,
  rowLocation: SourceLocation,
  filename?: string
): DetailedTableCell[] {
  if (expected === 0) {
    return cells;
  }

  const normalized: DetailedTableCell[] = cells.slice(0, expected);
  while (normalized.length < expected) {
    normalized.push(createEmptyCell(rowLocation, filename));
  }

  return normalized;
}

function offsetLocation(base: SourceLocation, relative: SourceLocation, filename?: string): SourceLocation {
  const lineOffsetStart = relative.start.line - 1;
  const lineOffsetEnd = relative.end.line - 1;

  const startLine = base.start.line + lineOffsetStart;
  const endLine = base.start.line + lineOffsetEnd;

  const baseColumnOffset = base.start.column - 1;
  const startColumn = (lineOffsetStart === 0 ? baseColumnOffset : 0) + relative.start.column;
  const endColumn = (lineOffsetEnd === 0 ? baseColumnOffset : 0) + relative.end.column;

  return {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn },
    filename: filename ?? base.filename
  };
}

function createCellParser(parent: Parser, text: string, baseLocation: SourceLocation): Parser | null {
  try {
    const lexer = new Lexer(text, parent.filename);
    const tokens = lexer.tokenize();
    for (const token of tokens) {
      token.location = offsetLocation(baseLocation, token.location, parent.filename);
    }
    return new Parser(tokens, parent.filename);
  } catch (error: any) {
    if (error instanceof ParseError) {
      parent.errors.push(error);
      return null;
    }
    parent.errors.push(new ParseError(error?.message ?? 'Failed to parse table cell', baseLocation));
    return null;
  }
}

interface ExpressionParseResult {
  expression: Expression | null;
  hadError: boolean;
}

function parseSingleExpression(parent: Parser, text: string, location: SourceLocation): ExpressionParseResult {
  if (text.trim() === '') {
    return { expression: null, hadError: false };
  }

  const cellParser = createCellParser(parent, text, location);
  if (!cellParser) {
    return { expression: null, hadError: true };
  }

  try {
    const expr = parseExpression(cellParser);
    if (!cellParser.isAtEnd()) {
      throw new ParseError('Unexpected tokens in table cell expression', cellParser.peek().location);
    }
    parent.errors.push(...cellParser.errors);
    return { expression: expr, hadError: cellParser.errors.length > 0 };
  } catch (error) {
    if (error instanceof ParseError) {
      parent.errors.push(error);
      return { expression: null, hadError: true };
    }
    throw error;
  }
}

interface ComparisonParseResult {
  entries: Expression[];
  hadError: boolean;
}

function parseComparisonEntries(parent: Parser, text: string, location: SourceLocation): ComparisonParseResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { entries: [], hadError: false };
  }

  const cellParser = createCellParser(parent, text, location);
  if (!cellParser) {
    return { entries: [], hadError: true };
  }

  const entries: Expression[] = [];
  let hadError = false;

  try {
    while (!cellParser.isAtEnd()) {
      const expr = parseExpression(cellParser);
      entries.push(expr);

      if (cellParser.match(TokenType.COMMA)) {
        continue;
      }

      if (!cellParser.isAtEnd()) {
        throw new ParseError(`Expected ',' between comparison values`, cellParser.peek().location);
      }
    }
  } catch (error) {
    if (error instanceof ParseError) {
      parent.errors.push(error);
      hadError = true;
    } else {
      throw error;
    }
  }

  parent.errors.push(...cellParser.errors);
  if (cellParser.errors.length > 0) {
    hadError = true;
  }

  return { entries, hadError };
}

interface StatementParseResult {
  statements: Statement[];
  hadError: boolean;
}

function parseActionStatements(parent: Parser, text: string, location: SourceLocation): StatementParseResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { statements: [], hadError: false };
  }

  const cellParser = createCellParser(parent, text, location);
  if (!cellParser) {
    return { statements: [], hadError: true };
  }

  const program = cellParser.parse();
  parent.errors.push(...cellParser.errors);

  const statements = program.body.filter(stmt => stmt.kind !== 'blank');
  return { statements, hadError: cellParser.errors.length > 0 };
}

function isValidIdentifierName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function mergeRowLocation(cells: TableRowCell[], fallback: SourceLocation): SourceLocation {
  const meaningful = cells.filter(cell => cell.rawText !== undefined);
  if (meaningful.length === 0) {
    return fallback;
  }
  const startCell = cells[0];
  const endCell = cells[cells.length - 1];
  return {
    start: { ...startCell.location.start },
    end: { ...endCell.location.end },
    filename: startCell.location.filename ?? endCell.location.filename ?? fallback.filename
  };
}

export function parseMarkdownHeader(parser: Parser): MarkdownHeader {
  const token = parser.advance();
  const { level, text } = parseMarkdownHeaderLine(token.value);

  return {
    kind: 'markdownHeader',
    level,
    text,
    location: token.location
  };
}

export function parseMarkdownTable(parser: Parser): MarkdownTable {
  const tokens: Array<{ value: string; location: SourceLocation }> = [];
  do {
    const token = parser.advance();
    tokens.push({ value: token.value, location: token.location });
  } while (parser.check(TokenType.MD_TABLE_ROW));

  const headerToken = tokens[0];
  ensureBoundaryPipes(parser, headerToken.value, headerToken.location);
  const headerCells = splitTableRowDetailed(headerToken.value, headerToken.location, parser.filename);
  if (headerCells.length === 0) {
    parser.errors.push(new ParseError('Markdown table header must contain at least one cell', headerToken.location));
  }

  let alignments: Array<'left' | 'center' | 'right'> | undefined;
  let bodyStartIndex = 1;

  if (tokens.length < 2) {
    parser.errors.push(
      new ParseError('Markdown tables must include a separator row using dashes immediately after the header', headerToken.location)
    );
  } else {
    const separatorToken = tokens[1];
    ensureBoundaryPipes(parser, separatorToken.value, separatorToken.location);
    const alignmentCandidate = splitTableRowDetailed(separatorToken.value, separatorToken.location, parser.filename);
    if (alignmentCandidate.length === headerCells.length && alignmentCandidate.every(cell => isAlignmentCell(cell.text))) {
      alignments = alignmentCandidate.map(cell => parseAlignment(cell.text));
      bodyStartIndex = 2;
    } else {
      parser.errors.push(
        new ParseError('Markdown tables must include a separator row whose cells are composed of dashes (e.g. | --- |)', separatorToken.location)
      );
    }
  }

  const columns: TableColumn[] = headerCells.map(cell => {
    const headerText = cell.text;
    const location = cell.location;

    if (headerText.startsWith('=')) {
      const candidate = headerText.slice(1).trim();
      if (candidate.length === 0) {
        const column: ActionConclusionColumn = {
          kind: 'conclusionAction',
          headerText,
          location
        };
        return column;
      }

      if (!isValidIdentifierName(candidate)) {
        parser.errors.push(new ParseError(`Invalid identifier '${candidate}' in table conclusion header`, location));
        const fallbackColumn: ActionConclusionColumn = {
          kind: 'conclusionAction',
          headerText,
          location
        };
        return fallbackColumn;
      }

      const identifier = createIdentifier(parser, candidate, location);
      const declarationColumn: DeclarationConclusionColumn = {
        kind: 'conclusionDeclaration',
        headerText,
        target: identifier,
        location
      };
      return declarationColumn;
    }

    if (headerText.trim().length === 0) {
      const column: BooleanConditionColumn = {
        kind: 'conditionBoolean',
        headerText,
        location
      };
      return column;
    }

    const condition = parseSingleExpression(parser, headerText, location);
    if (condition.expression) {
      const column: ComparisonConditionColumn = {
        kind: 'conditionComparison',
        headerText,
        discriminant: condition.expression,
        location
      };
      return column;
    }

    const fallbackColumn: BooleanConditionColumn = {
      kind: 'conditionBoolean',
      headerText,
      location
    };
    return fallbackColumn;
  });

  const headers = headerCells.map(cell => cell.text);
  const rows: string[][] = [];
  const structuredRows: TableRow[] = [];
  const expectedColumns = columns.length;

  for (let i = bodyStartIndex; i < tokens.length; i++) {
    const rowToken = tokens[i];
    ensureBoundaryPipes(parser, rowToken.value, rowToken.location);
    const rawCells = splitTableRowDetailed(rowToken.value, rowToken.location, parser.filename);

    if (expectedColumns > 0 && rawCells.length !== expectedColumns) {
      parser.errors.push(
        new ParseError(
          `Markdown table row expected ${expectedColumns} cells but found ${rawCells.length}`,
          rowToken.location
        )
      );
    }

    if (expectedColumns === 0) {
      const rowStrings = rawCells.map(cell => cell.text);
      rows.push(rowStrings);
      structuredRows.push({
        cells: [],
        location: rowToken.location
      });
      continue;
    }

    const normalizedCells = normalizeRowCells(rawCells, expectedColumns, rowToken.location, parser.filename);
    const rowStrings = normalizedCells.map(cell => cell.text);
    rows.push(rowStrings);

    const tableCells: TableRowCell[] = normalizedCells.map((cell, columnIndex) => {
      const column = columns[columnIndex];
      const tableCell: TableRowCell = {
        rawText: cell.text,
        location: cell.location
      };

      switch (column.kind) {
        case 'conditionBoolean': {
          const result = parseSingleExpression(parser, cell.text, cell.location);
          tableCell.content = result.expression;
          break;
        }
        case 'conditionComparison': {
          const result = parseComparisonEntries(parser, cell.text, cell.location);
          tableCell.entries = result.entries;
          break;
        }
        case 'conclusionDeclaration': {
          const result = parseSingleExpression(parser, cell.text, cell.location);
          tableCell.content = result.expression;
          break;
        }
        case 'conclusionAction': {
          const result = parseActionStatements(parser, cell.text, cell.location);
          tableCell.content = result.statements;
          break;
        }
      }

      return tableCell;
    });

    structuredRows.push({
      cells: tableCells,
      location: mergeRowLocation(tableCells, rowToken.location)
    });
  }

  const location = mergeLocations(tokens[0].location, tokens[tokens.length - 1].location);

  return {
    kind: 'markdownTable',
    headers,
    rows,
    columns,
    structuredRows,
    alignments,
    location
  };
}
