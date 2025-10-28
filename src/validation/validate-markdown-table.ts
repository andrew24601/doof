import {
  ActionConclusionColumn,
  BlockStatement,
  BooleanConditionColumn,
  ComparisonConditionColumn,
  DeclarationConclusionColumn,
  Expression,
  ExpressionStatement,
  Identifier,
  Literal,
  MarkdownTable,
  RangeExpression,
  SourceLocation,
  Statement,
  TableColumn,
  TableRow,
  TableRowCell
} from '../types';
import { Validator } from './validator';

interface ColumnContext {
  column: TableColumn;
  index: number;
}

interface RowBuildResult {
  condition: Expression;
  body: Statement;
}

export function validateAndDesugarMarkdownTable(table: MarkdownTable, validator: Validator): BlockStatement {
  const block: BlockStatement = {
    kind: 'block',
    body: [],
    location: table.location
  };

  const columns = table.columns ?? [];
  if (columns.length === 0) {
    validator.addError('Markdown table must declare at least one column', table.location);
    return block;
  }

  const hasConclusion = columns.some(column => column.kind === 'conclusionAction' || column.kind === 'conclusionDeclaration');
  if (!hasConclusion) {
    validator.addError('Markdown table must include at least one conclusion column that starts with "="', table.location);
    return block;
  }

  const declarationNames = new Set<string>();
  for (const column of columns) {
    if (column.kind === 'conclusionDeclaration') {
      const declarationColumn = column as DeclarationConclusionColumn;
      const name = declarationColumn.target.name;
      if (declarationNames.has(name)) {
        validator.addError(`Duplicate declaration column for '${name}'`, declarationColumn.location);
      } else {
        declarationNames.add(name);
      }
    }
  }

  const columnContexts: ColumnContext[] = columns.map((column, index) => ({ column, index }));
  const structuredRows = table.structuredRows ?? [];

  const rowResults: RowBuildResult[] = [];

  for (const row of structuredRows) {
    const buildResult = buildRow(columnContexts, row, validator);
    if (buildResult) {
      rowResults.push(buildResult);
    }
  }

  if (rowResults.length === 0) {
    return block;
  }

  let currentBranch: Statement | undefined;
  for (let idx = rowResults.length - 1; idx >= 0; idx--) {
    const result = rowResults[idx];
    const ifStatement = {
      kind: 'if' as const,
      condition: result.condition,
      thenStatement: result.body,
      elseStatement: currentBranch,
      location: result.body.location
    };
    currentBranch = ifStatement;
  }

  if (currentBranch) {
    block.body.push(currentBranch);
  }

  return block;
}

function buildRow(columnContexts: ColumnContext[], row: TableRow, validator: Validator): RowBuildResult | null {
  const conditionPieces: Expression[] = [];
  const branchStatements: Statement[] = [];

  for (const context of columnContexts) {
    const cell = row.cells[context.index] ?? null;
    switch (context.column.kind) {
      case 'conditionBoolean': {
        const condition = buildBooleanCondition(cell, row.location);
        conditionPieces.push(condition);
        break;
      }
      case 'conditionComparison': {
        const comparisonCondition = buildComparisonCondition(context.column as ComparisonConditionColumn, cell, validator, row.location);
        conditionPieces.push(comparisonCondition);
        break;
      }
      case 'conclusionDeclaration': {
        const assignment = buildDeclarationAssignment(context.column as DeclarationConclusionColumn, cell, validator);
        if (assignment) {
          branchStatements.push(assignment);
        }
        break;
      }
      case 'conclusionAction': {
        const actionStatements = buildActionStatements(cell);
        branchStatements.push(...actionStatements);
        break;
      }
      default:
        break;
    }
  }

  const condition = combineWithAnd(conditionPieces, row.location);
  const body: Statement = {
    kind: 'block',
    body: branchStatements,
    location: row.location
  };

  return { condition, body };
}

function buildBooleanCondition(cell: TableRowCell | null, fallbackLocation: SourceLocation): Expression {
  if (!cell || !cell.content) {
    return createBooleanLiteral(true, fallbackLocation);
  }

  const expression = cell.content as Expression | null;
  if (!expression) {
    return createBooleanLiteral(true, cell.location);
  }
  return cloneExpression(expression);
}

function buildComparisonCondition(
  column: ComparisonConditionColumn,
  cell: TableRowCell | null,
  validator: Validator,
  fallbackLocation: SourceLocation
): Expression {
  const discriminant = cloneExpression(column.discriminant);

  if (!cell) {
    return createBooleanLiteral(false, fallbackLocation);
  }

  const entries = cell.entries ?? [];
  if (entries.length === 0) {
    return createBooleanLiteral(false, cell.location);
  }

  const tests = entries
    .map(entry => cloneExpression(entry))
    .map(entry => buildComparisonTest(discriminant, entry, cell.location));

  return combineWithOr(tests, cell.location);
}

function buildDeclarationAssignment(
  column: DeclarationConclusionColumn,
  cell: TableRowCell | null,
  validator: Validator
): Statement | null {
  if (!cell || !cell.content) {
    validator.addError(`Declaration column '${column.target.name}' requires a value`, column.location);
    return null;
  }

  const expression = cell.content as Expression | null;
  if (!expression) {
    validator.addError(`Declaration column '${column.target.name}' requires a value`, cell.location);
    return null;
  }

  const targetIdentifier: Identifier = {
    kind: 'identifier',
    name: column.target.name,
    location: column.target.location
  };

  const assignment: Expression = {
    kind: 'binary',
    operator: '=',
    left: targetIdentifier,
    right: cloneExpression(expression),
    location: cell.location
  } as Expression;

  const statement: ExpressionStatement = {
    kind: 'expression',
    expression: assignment,
    location: cell.location
  };

  return statement;
}

function buildActionStatements(cell: TableRowCell | null): Statement[] {
  if (!cell || !Array.isArray(cell.content)) {
    return [];
  }
  return (cell.content as Statement[]).map(stmt => cloneStatement(stmt));
}

function buildComparisonTest(discriminant: Expression, entry: Expression, location: SourceLocation): Expression {
  if (entry.kind === 'range') {
    const rangeEntry = entry as RangeExpression;
    const startComparison = createBinaryExpression('>=', cloneExpression(discriminant), cloneExpression(rangeEntry.start), location);
    const endOperator = rangeEntry.inclusive ? '<=' : '<';
    const endComparison = createBinaryExpression(endOperator, cloneExpression(discriminant), cloneExpression(rangeEntry.end), location);
    return createBinaryExpression('&&', startComparison, endComparison, location);
  }

  return createBinaryExpression('==', cloneExpression(discriminant), cloneExpression(entry), location);
}

function combineWithAnd(expressions: Expression[], fallbackLocation: SourceLocation): Expression {
  if (expressions.length === 0) {
    return createBooleanLiteral(true, fallbackLocation);
  }

  let result = expressions[0];
  for (let i = 1; i < expressions.length; i++) {
    const current = expressions[i];
    result = createBinaryExpression('&&', result, current, mergeLocations(result.location, current.location));
  }
  return result;
}

function combineWithOr(expressions: Expression[], fallbackLocation: SourceLocation): Expression {
  if (expressions.length === 0) {
    return createBooleanLiteral(false, fallbackLocation);
  }

  let result = expressions[0];
  for (let i = 1; i < expressions.length; i++) {
    const current = expressions[i];
    result = createBinaryExpression('||', result, current, mergeLocations(result.location, current.location));
  }
  return result;
}

function createBinaryExpression(operator: string, left: Expression, right: Expression, location: SourceLocation): Expression {
  return {
    kind: 'binary',
    operator,
    left,
    right,
    location
  } as Expression;
}

function createBooleanLiteral(value: boolean, location: SourceLocation): Literal {
  return {
    kind: 'literal',
    value,
    literalType: 'boolean',
    location
  };
}

function mergeLocations(start: SourceLocation, end: SourceLocation): SourceLocation {
  return {
    start: start.start,
    end: end.end,
    filename: start.filename ?? end.filename
  };
}

function cloneExpression<T extends Expression>(expr: T): T {
  return JSON.parse(JSON.stringify(expr));
}

function cloneStatement<T extends Statement>(stmt: T): T {
  return JSON.parse(JSON.stringify(stmt));
}
