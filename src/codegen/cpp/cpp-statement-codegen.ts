// C++ statement code generator for doof

import {
  Statement, Expression, Type, VariableDeclaration, IfStatement, WhileStatement,
  ForStatement, ForOfStatement, SwitchStatement, ReturnStatement, BlockStatement,
  ExpressionStatement, SwitchCase, RangeExpression, BinaryExpression, MemberExpression,
  Identifier, Literal, LambdaExpression, FunctionTypeNode, PrimitiveTypeNode,
  Parameter, ClassDeclaration, FieldDeclaration, ValidationContext, MarkdownHeader,
  MarkdownTable
} from '../../types';
import { CppGenerator } from '../cppgen';

export function generateVariableDeclaration(
  generator: CppGenerator,
  varDecl: VariableDeclaration, 
  isGlobal: boolean = false
): string {
  let output = '';

  if (isGlobal) {
    output += generator.indent();
  }

  // Handle concise lambda form
  if (varDecl.isConciseLambda && varDecl.lambdaParameters && varDecl.initializer?.kind === 'lambda') {
    const lambda = varDecl.initializer as LambdaExpression;

    // Infer function type from lambda
    const paramTypes = varDecl.lambdaParameters.map(p => ({ name: p.name.name, type: p.type }));
    const returnType = lambda.returnType || { kind: 'primitive', type: 'void' } as PrimitiveTypeNode;

    const functionType: FunctionTypeNode = {
      kind: 'function',
      parameters: paramTypes,
      returnType,
      isConciseForm: true
    };

    // Track variable type for later identifier resolution
    generator.variableTypes.set(varDecl.identifier.name, functionType);

    // Generate as auto with lambda assignment
    output += `auto ${varDecl.identifier.name} = ${generator.generateExpression(lambda, functionType)}`;
  } else {
    // Regular variable declaration
    const varType = generator.getVariableType(varDecl);
    // Track variable type for later identifier resolution
    generator.variableTypes.set(varDecl.identifier.name, varType);

    const wrapInCaptured = generator.shouldWrapCapturedMutable(varDecl);
    const typeName = wrapInCaptured
      ? generator.renderCapturedType(varType)
      : generator.generateType(varType);

    output += `${typeName} ${varDecl.identifier.name}`;

    if (varDecl.initializer) {
      // Pass the variable's type as target type for reverse type inference
      // Set isAssignmentRhs to true to enable type casting for variable initialization
      const initializerCode = generator.generateExpressionWithContext(varDecl.initializer, {
        targetType: varType,
        isAssignmentRhs: true
      });

      if (wrapInCaptured) {
        output += ` { ${initializerCode} }`;
      } else {
        output += ` = ${initializerCode}`;
      }
    }
  }

  output += ';\n';

  return output;
}

export function generateBlockStatement(
  generator: CppGenerator,
  block: BlockStatement
): string {
  let output = '{\n';
  generator.increaseIndent();

  for (const stmt of block.body) {
    if (stmt.kind === 'blank') {
      output += '\n';
      continue;
    }
    output += generateStatement(generator, stmt);
  }

  generator.decreaseIndent();
  output += generator.indent() + '}\n';

  return output;
}

export function generateStatement(
  generator: CppGenerator,
  stmt: Statement
): string {
  // Optionally prefix with a #line directive for better source mapping
  const linePrefix = generator.maybeEmitLineDirective(stmt as any);
  switch (stmt.kind) {
    case 'blank':
      return linePrefix + '\n';
    case 'variable':
      return linePrefix + generator.indent() + generateVariableDeclaration(generator, stmt as VariableDeclaration);
    case 'typeAlias':
      return linePrefix + ''; // Type aliases don't generate code in function bodies
    case 'if':
      return linePrefix + generateIfStatement(generator, stmt as IfStatement);
    case 'while':
      return linePrefix + generateWhileStatement(generator, stmt as WhileStatement);
    case 'for':
      return linePrefix + generateForStatement(generator, stmt as ForStatement);
    case 'forOf':
      return linePrefix + generateForOfStatement(generator, stmt as ForOfStatement);
    case 'switch':
      return linePrefix + generateSwitchStatement(generator, stmt as SwitchStatement);
    case 'return':
      return linePrefix + generateReturnStatement(generator, stmt as ReturnStatement);
    case 'break':
      return linePrefix + generator.indent() + 'break;\n';
    case 'continue':
      return linePrefix + generator.indent() + 'continue;\n';
    case 'block':
      return linePrefix + generator.indent() + generateBlockStatement(generator, stmt as BlockStatement);
    case 'expression':
      const exprStmt = stmt as ExpressionStatement;

      // Skip assignments to const/readonly fields in constructors if they're in the initialization list
      if (exprStmt.expression.kind === 'binary') {
        const binaryExpr = exprStmt.expression as BinaryExpression;
        if (binaryExpr.operator === '=' && binaryExpr.left.kind === 'member') {
          const memberExpr = binaryExpr.left as MemberExpression;
          if (memberExpr.object.kind === 'identifier' && (memberExpr.object as Identifier).name === 'this') {
            const fieldName = memberExpr.property.kind === 'identifier'
              ? (memberExpr.property as Identifier).name
              : String((memberExpr.property as Literal).value);

            // Check if this is a const/readonly field
            if (generator.currentClass) {
              const field = generator.currentClass.fields.find((f: FieldDeclaration) => f.name.name === fieldName);
              if (field && (field.isConst || field.isReadonly)) {
                // Skip this assignment since it should be in the initialization list
                return '';
              }
            }
          }
        }
      }

      return linePrefix + generator.indent() + generator.generateExpression(exprStmt.expression) + ';\n';
    case 'markdownHeader': {
        const header = stmt as MarkdownHeader;
        const level = Math.max(1, Math.min(header.level, 6));
        const prefix = '#'.repeat(level);
        const text = header.text.trim();
        const suffix = text.length > 0 ? ` ${text}` : '';
        return linePrefix + generator.indent() + `// ${prefix}${suffix}\n`;
      }
    case 'markdownTable': {
        const table = stmt as MarkdownTable;
        if (table.headers.length === 0 && table.rows.length === 0) {
          return '';
        }

        const indent = generator.indent();
        const lines: string[] = [];
        const formatRow = (cells: string[]) => `${indent}// | ${cells.join(' | ')} |`;

        if (table.headers.length > 0) {
          lines.push(formatRow(table.headers));
        }

        if (table.alignments && table.alignments.length === table.headers.length && table.headers.length > 0) {
          const alignmentRow = table.alignments.map(alignment => {
            switch (alignment) {
              case 'center':
                return ':---:';
              case 'right':
                return '---:';
              default:
                return ':---';
            }
          });
          lines.push(formatRow(alignmentRow));
        }

        for (const row of table.rows) {
          lines.push(formatRow(row));
        }

        if (lines.length === 0) {
          return '';
        }

        return linePrefix + lines.join('\n') + '\n';
      }
    default:
      return linePrefix + generator.indent() + `// TODO: ${stmt.kind}\n`;
  }
}

export function generateIfStatement(
  context: CppGenerator,
  ifStmt: IfStatement
): string {
  let output = context.indent() + `if (${context.generateExpression(ifStmt.condition)}) `;

  // Find type narrowing information from validation by matching location and branch type
  const line = ifStmt.location?.start?.line || 0;
  const col = ifStmt.location?.start?.column || 0;
  
  let thenNarrowing: any = undefined;
  let elseNarrowing: any = undefined;
  
  if (context.validationContext?.codeGenHints.typeNarrowing) {
    for (const [key, hint] of context.validationContext.codeGenHints.typeNarrowing.entries()) {
      // Match keys that start with this if statement's location
      if (key.startsWith(`if_${line}_${col}_`) && key.endsWith('_then')) {
        thenNarrowing = hint;
      } else if (key.startsWith(`if_${line}_${col}_`) && key.endsWith('_else')) {
        elseNarrowing = hint;
      }
    }
  }

  if (thenNarrowing) {
    // Apply type narrowing for the then-branch
    const narrowingMap = new Map<string, Type>();
    narrowingMap.set(thenNarrowing.variableName, thenNarrowing.narrowedType);

    output += context.withTypeNarrowing(narrowingMap, () => {
      return wrapInBlock(context, ifStmt.thenStatement);
    });

    if (ifStmt.elseStatement) {
      output += context.indent() + 'else ';
      if (ifStmt.elseStatement.kind === 'if') {
        // Chain else-if without extra indentation
        if (elseNarrowing) {
          const elseNarrowingMap = new Map<string, Type>();
          elseNarrowingMap.set(elseNarrowing.variableName, elseNarrowing.narrowedType);
          output += context.withTypeNarrowing(elseNarrowingMap, () => {
            return generateIfStatement(context, ifStmt.elseStatement as IfStatement).substring(context.indent().length);
          });
        } else {
          output += generateIfStatement(context, ifStmt.elseStatement as IfStatement).substring(context.indent().length);
        }
      } else {
        // Apply type narrowing for the else-branch
        if (elseNarrowing) {
          const elseNarrowingMap = new Map<string, Type>();
          elseNarrowingMap.set(elseNarrowing.variableName, elseNarrowing.narrowedType);
          output += context.withTypeNarrowing(elseNarrowingMap, () => {
            return wrapInBlock(context, ifStmt.elseStatement!);
          });
        } else {
          output += wrapInBlock(context, ifStmt.elseStatement);
        }
      }
    }
  } else {
    // No type narrowing, generate normally
    output += wrapInBlock(context, ifStmt.thenStatement);

    if (ifStmt.elseStatement) {
      output += context.indent() + 'else ';

      if (ifStmt.elseStatement.kind === 'if') {
        // Chain else-if without extra indentation
        output += generateIfStatement(context, ifStmt.elseStatement as IfStatement).substring(context.indent().length);
      } else {
        output += wrapInBlock(context, ifStmt.elseStatement);
      }
    }
  }

  return output;
}

export function generateWhileStatement(
  context: CppGenerator,
  whileStmt: WhileStatement
): string {
  let output = context.indent() + `while (${context.generateExpression(whileStmt.condition)}) `;
  output += wrapInBlock(context, whileStmt.body);
  return output;
}

export function generateForStatement(
  context: CppGenerator,
  forStmt: ForStatement
): string {
  let output = context.indent() + 'for (';

  if (forStmt.init) {
    if (forStmt.init.kind === 'variable') {
      const varDecl = forStmt.init as VariableDeclaration;
      const varType = context.getVariableType(varDecl);
      // Track variable type for later identifier resolution
      context.variableTypes.set(varDecl.identifier.name, varType);

      output += `${context.generateType(varType)} ${varDecl.identifier.name}`;
      if (varDecl.initializer) {
        output += ` = ${context.generateExpression(varDecl.initializer)}`;
      }
    } else {
      output += context.generateExpression(forStmt.init as Expression);
    }
  }

  output += '; ';

  if (forStmt.condition) {
    output += context.generateExpression(forStmt.condition);
  }

  output += '; ';

  if (forStmt.update) {
    output += context.generateExpression(forStmt.update);
  }

  output += ') ';
  output += wrapInBlock(context, forStmt.body);

  return output;
}

export function generateForOfStatement(
  context: CppGenerator,
  forOfStmt: ForOfStatement
): string {
  // Check if the iterable is a range expression
  if (forOfStmt.iterable.kind === 'range') {
    const rangeExpr = forOfStmt.iterable as RangeExpression;
    const varName = forOfStmt.variable.name;
    const startExpr = context.generateExpression(rangeExpr.start);
    const endExpr = context.generateExpression(rangeExpr.end);

    // Generate a traditional for loop for ranges
    const condition = rangeExpr.inclusive
      ? `${varName} <= ${endExpr}`
      : `${varName} < ${endExpr}`;

    let output = context.indent() + `for (int ${varName} = ${startExpr}; ${condition}; ${varName}++) `;
    output += wrapInBlock(context, forOfStmt.body);
    return output;
  } else {
    // Standard range-based for loop for collections
    let iterableExpr = context.generateExpression(forOfStmt.iterable);
    
    // Handle shared_ptr<vector<T>> types
    if (forOfStmt.iterable.inferredType?.kind === 'array') {
      if (forOfStmt.iterable.kind === 'call') {
        // For method calls that return shared_ptr, we need to store the shared_ptr first to avoid dangling references
        // This is particularly important for method calls like map.keys() and map.values()
        const tempVarName = `__iter_temp_${Math.random().toString(36).substr(2, 9)}`;
        let output = context.indent() + `auto ${tempVarName} = ${iterableExpr};\n`;
        output += context.indent() + `for (const auto& ${forOfStmt.variable.name} : *${tempVarName}) `;
        output += wrapInBlock(context, forOfStmt.body);
        return output;
      } else {
        // For simple identifiers that are shared_ptr<vector<T>>, dereference directly
        let output = context.indent() + `for (const auto& ${forOfStmt.variable.name} : *${iterableExpr}) `;
        output += wrapInBlock(context, forOfStmt.body);
        return output;
      }
    }
    
    let output = context.indent() + `for (const auto& ${forOfStmt.variable.name} : ${iterableExpr}) `;
    output += wrapInBlock(context, forOfStmt.body);
    return output;
  }
}

export function generateSwitchStatement(
  context: CppGenerator,
  switchStmt: SwitchStatement
): string {
  let output = context.indent() + `switch (${context.generateExpression(switchStmt.discriminant)}) {\n`;
  context.increaseIndent();

  for (const switchCase of switchStmt.cases) {
    if (switchCase.isDefault) {
      output += context.indent() + 'default:\n';
    } else {
      // Generate all case labels for this case
      for (const test of switchCase.tests) {
        if (test.kind === 'range') {
          output += generateRangeCaseLabels(context, test as RangeExpression);
        } else {
          // Handle all expression types (literals, member access, etc.)
          output += context.indent() + `case ${context.generateExpression(test)}:\n`;
        }
      }
    }

    // Generate case body
    context.increaseIndent();
    for (const statement of switchCase.body) {
      output += generateStatement(context, statement);
    }

    // Add break if not already present
    const lastStmt = switchCase.body[switchCase.body.length - 1];
    if (!lastStmt || (lastStmt.kind !== 'break' && lastStmt.kind !== 'return')) {
      output += context.indent() + 'break;\n';
    }

    context.decreaseIndent();
  }

  context.decreaseIndent();
  output += context.indent() + '}\n';

  return output;
}

export function generateReturnStatement(
  context: CppGenerator,
  returnStmt: ReturnStatement
): string {
  let output = context.indent() + 'return';

  if (returnStmt.argument) {
    // Use the current function's return type as target type for reverse type inference
    const targetType = context.currentFunctionReturnType;
    output += ` ${context.generateExpressionWithContext(returnStmt.argument, {
      targetType,
      
      isReturnContext: true
    })}`;
  }

  output += ';\n';

  return output;
}

// Helper functions

export function wrapInBlock(
  context: CppGenerator,
  stmt: Statement
): string {
  if (stmt.kind === 'block') {
    return generateBlockStatement(context, stmt as BlockStatement);
  } else {
    let output = '{\n';
    context.increaseIndent();
    output += generateStatement(context, stmt);
    context.decreaseIndent();
    output += context.indent() + '}\n';
    return output;
  }
}

function generateRangeCaseLabels(
  context: CppGenerator,
  rangeExpr: RangeExpression
): string {
  let output = '';
  if (rangeExpr.start.kind === 'literal' && rangeExpr.end.kind === 'literal') {
    const start = rangeExpr.start as Literal;
    const end = rangeExpr.end as Literal;

    if (typeof start.value === 'number' && typeof end.value === 'number') {
      const startNum = start.value;
      const endNum = rangeExpr.inclusive ? end.value : end.value - 1;

      for (let i = startNum; i <= endNum; i++) {
        output += context.indent() + `case ${i}:\n`;
      }
    }
  }
  return output;
}
