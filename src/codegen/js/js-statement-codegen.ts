// JavaScript statement code generation functions for doof

import {
  Statement, Expression, ClassDeclaration, EnumDeclaration, FunctionDeclaration,
  VariableDeclaration, Parameter, MethodDeclaration,
  IfStatement, WhileStatement, ForStatement, ForOfStatement, SwitchStatement,
  BlockStatement, ReturnStatement, ExportDeclaration, ExpressionStatement,
  ObjectExpression, Identifier, Literal, RangeExpression, PrimitiveTypeNode, ValidationContext,
  MarkdownHeader, MarkdownTable
} from '../../types';

export interface JsStatementGeneratorInterface {
  indentLevel: number;
  currentClass?: ClassDeclaration;
  currentMethod?: MethodDeclaration;
  validationContext?: ValidationContext;
  generateExpression(expr: Expression): string;
  generateParameter(param: Parameter): string;
  getJsFieldName(field: { name: { name: string } }): string;
  encodeJsFieldName(fieldName: string): string;
  indent(): string;
}

export function generateStatement(generator: JsStatementGeneratorInterface, stmt: Statement | Expression): string {
  switch (stmt.kind) {
    case 'blank':
      return '';
    case 'externClass':
      // Extern classes are provided by host environment; no emitted definition in JS.
      return '';
    case 'class':
      return generateClassDeclaration(generator, stmt as ClassDeclaration);
    case 'enum':
      return generateEnumDeclaration(generator, stmt as EnumDeclaration);
    case 'function':
      return generateFunctionDeclaration(generator, stmt as FunctionDeclaration);
    case 'variable':
      return generateVariableDeclaration(generator, stmt as VariableDeclaration);
    case 'export':
      const exportDecl = stmt as ExportDeclaration;
      return generateExportDeclaration(generator, exportDecl);
    case 'typeAlias':
      return '';
    case 'import':
      // Import declarations are emitted separately using validation metadata
      return '';
    case 'expression':
      const exprStmt = stmt as ExpressionStatement;
      return generator.generateExpression(exprStmt.expression) + ';';
    case 'if':
      return generateIfStatement(generator, stmt as IfStatement);
    case 'while':
      return generateWhileStatement(generator, stmt as WhileStatement);
    case 'for':
      return generateForStatement(generator, stmt as ForStatement);
    case 'forOf':
      return generateForOfStatement(generator, stmt as ForOfStatement);
    case 'switch':
      return generateSwitchStatement(generator, stmt as SwitchStatement);
    case 'block':
      return generateBlockStatement(generator, stmt as BlockStatement);
    case 'return':
      return generateReturnStatement(generator, stmt as ReturnStatement);
    case 'break':
      return generator.indent() + 'break;';
    case 'continue':
      return generator.indent() + 'continue;';
    case 'markdownHeader': {
      const header = stmt as MarkdownHeader;
      const level = Math.max(1, Math.min(header.level, 6));
      const prefix = '#'.repeat(level);
      const text = header.text.trim();
      const suffix = text.length > 0 ? ` ${text}` : '';
      return generator.indent() + `// ${prefix}${suffix}`;
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

      return lines.join('\n');
    }
    default:
      throw new Error(`Unsupported statement kind: ${(stmt as any).kind}`);
  }
}

export function generateClassDeclaration(generator: JsStatementGeneratorInterface, classDecl: ClassDeclaration): string {
  generator.currentClass = classDecl;
  let output = generator.indent() + `class ${classDecl.name.name} {\n`;
  generator.indentLevel++;

  // Default constructor with default values for fields
  output += generator.indent() + 'constructor(';
  const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);
  const paramParts: string[] = [];
  for (const field of nonStaticFields) {
    const jsFieldName = generator.getJsFieldName(field);
    let paramStr = jsFieldName;
    if (field.defaultValue) {
      paramStr += ' = ' + generator.generateExpression(field.defaultValue);
    }
    paramParts.push(paramStr);
  }
  output += paramParts.join(', ');
  output += ') {\n';
  generator.indentLevel++;
  for (const field of nonStaticFields) {
    const jsFieldName = generator.getJsFieldName(field);
    output += generator.indent() + `this.${jsFieldName} = ${jsFieldName};\n`;
  }
  generator.indentLevel--;
  output += generator.indent() + '}\n\n';

  // Methods
  for (const method of classDecl.methods) {
    output += generateMethod(generator, method);
    output += '\n';
  }

  // toJSON method
  output += generateToJSONMethod(generator, classDecl);
  output += '\n';

  // fromJSON static method
  output += generateFromJSONMethod(generator, classDecl);
  output += '\n';

  // toString method for console output
  output += generator.indent() + 'toString() {\n';
  generator.indentLevel++;
  output += generator.indent() + 'return JSON.stringify(this);\n';
  generator.indentLevel--;
  output += generator.indent() + '}\n';

  generator.indentLevel--;
  output += generator.indent() + '}\n';

  // Static fields
  for (const field of classDecl.fields) {
    if (field.isStatic) {
      output += `\n${classDecl.name.name}.${field.name.name} = `;
      if (field.defaultValue) {
        output += generator.generateExpression(field.defaultValue);
      } else {
        output += generateDefaultValue(field.type);
      }
      output += ';';
    }
  }

  generator.currentClass = undefined;
  return output;
}

export function generateEnumDeclaration(generator: JsStatementGeneratorInterface, enumDecl: EnumDeclaration): string {
  let output = generator.indent() + `const ${enumDecl.name.name} = {\n`;
  generator.indentLevel++;

  for (let i = 0; i < enumDecl.members.length; i++) {
    const member = enumDecl.members[i];
    const comma = i < enumDecl.members.length - 1 ? ',' : '';
    output += generator.indent() + `${member.name.name}: `;
    if (member.value) {
      output += generator.generateExpression(member.value);
    } else {
      output += i.toString();
    }
    output += comma + '\n';
  }

  generator.indentLevel--;
  output += generator.indent() + '};\n\n';

  // Freeze the enum object
  output += `Object.freeze(${enumDecl.name.name});`;

  return output;
}

export function generateFunctionDeclaration(generator: JsStatementGeneratorInterface, funcDecl: FunctionDeclaration): string {
  let output = generator.indent() + 'function ' + funcDecl.name.name + '(';
  const params = funcDecl.parameters.map(p => generator.generateParameter(p)).join(', ');
  output += params + ') {\n';

  if (funcDecl.body) {
    generator.indentLevel++;
    output += generateStatement(generator, funcDecl.body);
    generator.indentLevel--;
  }

  output += generator.indent() + '}';
  return output;
}

export function generateVariableDeclaration(generator: JsStatementGeneratorInterface, varDecl: VariableDeclaration): string {
  const keyword = varDecl.isConst ? 'const' : 'let';
  let output = generator.indent() + `${keyword} ${varDecl.identifier.name}`;
  if (varDecl.initializer) {
    let init = generator.generateExpression(varDecl.initializer);
    
    // Check if we need type conversion
    if (varDecl.type && varDecl.type.kind === 'primitive' && varDecl.initializer.inferredType && varDecl.initializer.inferredType.kind === 'primitive') {
      const targetType = varDecl.type as PrimitiveTypeNode;
      const sourceType = varDecl.initializer.inferredType as PrimitiveTypeNode;
      
      // Apply type conversions for JavaScript
      if (sourceType.type !== targetType.type) {
        init = generateJsTypeConversion(init, sourceType.type, targetType.type);
      }
    }
    
    // Handle object literal syntax for class instantiation
    if (varDecl.initializer.kind === 'object') {
      const objExpr = varDecl.initializer as ObjectExpression;
      if (objExpr.className) {
        const className = objExpr.className;
        const instantiationKey = `${className}_${objExpr.location?.start?.line || 0}_${objExpr.location?.start?.column || 0}`;
        const instantiationInfo = objExpr.instantiationInfo
          ?? generator.validationContext?.codeGenHints?.objectInstantiations?.get(instantiationKey);

        if (!instantiationInfo) {
          const location = objExpr.location?.start
            ? `${objExpr.location.start.line}:${objExpr.location.start.column}`
            : 'unknown location';
          throw new Error(`Missing instantiation metadata for object literal of '${className}' at ${location}`);
        }

        output += ` = new ${instantiationInfo.targetClass}();\n`;

        for (const prop of objExpr.properties) {
          if (!prop.value) {
            continue;
          }

          let keyName: string | undefined;
          if (prop.key.kind === 'identifier') {
            keyName = (prop.key as Identifier).name;
          } else if (prop.key.kind === 'literal') {
            keyName = String((prop.key as Literal).value ?? '');
          }

          if (!keyName) {
            throw new Error(`Unsupported computed property in class literal for '${className}'`);
          }

          const encodedFieldName = generator.encodeJsFieldName(keyName);
          const value = generator.generateExpression(prop.value);
          output += `${generator.indent()}${varDecl.identifier.name}.${encodedFieldName} = ${value};\n`;
        }

        return output.slice(0, -1);
      }
    }
    
    output += ' = ' + init;
  }
  output += ';';
  return output;
}

export function generateExportDeclaration(generator: JsStatementGeneratorInterface, exportDecl: ExportDeclaration): string {
  const declaration = generateStatement(generator, exportDecl.declaration);
  if (exportDecl.declaration.kind === 'function') {
    const funcDecl = exportDecl.declaration as FunctionDeclaration;
    return declaration + `\nexport { ${funcDecl.name.name} };`;
  } else if (exportDecl.declaration.kind === 'class') {
    const classDecl = exportDecl.declaration as ClassDeclaration;
    return declaration + `\nexport { ${classDecl.name.name} };`;
  } else if (exportDecl.declaration.kind === 'variable') {
    const varDecl = exportDecl.declaration as VariableDeclaration;
    return declaration + `\nexport { ${varDecl.identifier.name} };`;
  }
  return declaration;
}

export function generateMethod(generator: JsStatementGeneratorInterface, method: MethodDeclaration): string {
  generator.currentMethod = method;
  let output = generator.indent();
  if (method.isStatic) {
    output += 'static ';
  }
  output += method.name.name + '(';
  const params = method.parameters.map(p => generator.generateParameter(p)).join(', ');
  output += params + ') {\n';
  
  if (method.body) {
    generator.indentLevel++;
    output += generateStatement(generator, method.body);
    generator.indentLevel--;
  }
  
  output += generator.indent() + '}';
  generator.currentMethod = undefined;
  return output;
}

export function generateToJSONMethod(generator: JsStatementGeneratorInterface, classDecl: ClassDeclaration): string {
  let output = generator.indent() + 'toJSON() {\n';
  generator.indentLevel++;
  output += generator.indent() + 'return {\n';
  generator.indentLevel++;
  
  const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);
  for (let i = 0; i < nonStaticFields.length; i++) {
    const field = nonStaticFields[i];
    const comma = i < nonStaticFields.length - 1 ? ',' : '';
    const jsFieldName = generator.getJsFieldName(field);
    // Use original field name for JSON key; normalize Maps/Sets/classes for consistency
    output += generator.indent() + `"${field.name.name}": __doof_toJson(this.${jsFieldName})${comma}\n`;
  }
  
  generator.indentLevel--;
  output += generator.indent() + '};\n';
  generator.indentLevel--;
  output += generator.indent() + '}';
  return output;
}

export function generateFromJSONMethod(generator: JsStatementGeneratorInterface, classDecl: ClassDeclaration): string {
  let output = generator.indent() + 'static fromJSON(json) {\n';
  generator.indentLevel++;
  output += generator.indent() + 'const obj = typeof json === "string" ? JSON.parse(json) : json;\n';
  output += generator.indent() + `const instance = new ${classDecl.name.name}();\n`;
  const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);
  for (const field of nonStaticFields) {
    const jsFieldName = generator.getJsFieldName(field);
    const desc = generateJsTypeDescriptor(field.type);
    output += generator.indent() + `if (Object.prototype.hasOwnProperty.call(obj, "${field.name.name}")) instance.${jsFieldName} = __doof_fromJson(obj["${field.name.name}"], ${desc});\n`;
  }
  output += generator.indent() + 'return instance;\n';
      
  generator.indentLevel--;
  output += generator.indent() + '}';
  return output;
}

// Helper: emit a small type descriptor for JS runtime reconstruction
function generateJsTypeDescriptor(type: any): string {
  if (!type) return 'null';
  switch (type.kind) {
    case 'primitive': {
      const t = (type as any).type;
      const mapped = t === 'char' ? 'string' : t;
      return `{ k: 'primitive', t: '${mapped}' }`;
    }
    case 'array':
      return `{ k: 'array', el: ${generateJsTypeDescriptor((type as any).elementType)} }`;
    case 'set':
      return `{ k: 'set', el: ${generateJsTypeDescriptor((type as any).elementType)} }`;
    case 'map':
      return `{ k: 'map', key: ${generateJsTypeDescriptor((type as any).keyType)}, val: ${generateJsTypeDescriptor((type as any).valueType)} }`;
    case 'class':
      return `{ k: 'class', ctor: ${(type as any).name} }`;
    case 'externClass':
      return `{ k: 'class', ctor: ${(type as any).name} }`;
    default:
      return 'null';
  }
}

export function generateIfStatement(generator: JsStatementGeneratorInterface, stmt: IfStatement): string {
  let output = generator.indent() + 'if (' + generator.generateExpression(stmt.condition) + ') {\n';
  generator.indentLevel++;
  output += generateStatement(generator, stmt.thenStatement);
  generator.indentLevel--;
  output += generator.indent() + '}';
  
  if (stmt.elseStatement) {
    output += ' else {\n';
    generator.indentLevel++;
    output += generateStatement(generator, stmt.elseStatement);
    generator.indentLevel--;
    output += generator.indent() + '}';
  }
  
  return output;
}

export function generateWhileStatement(generator: JsStatementGeneratorInterface, stmt: WhileStatement): string {
  let output = generator.indent() + 'while (' + generator.generateExpression(stmt.condition) + ') {\n';
  generator.indentLevel++;
  output += generateStatement(generator, stmt.body);
  generator.indentLevel--;
  output += generator.indent() + '}';
  return output;
}

export function generateForStatement(generator: JsStatementGeneratorInterface, stmt: ForStatement): string {
  let output = generator.indent() + 'for (';
  if (stmt.init) {
    output += generateStatement(generator, stmt.init).replace(/;\s*$/, '');
  }
  output += '; ';
  if (stmt.condition) {
    output += generator.generateExpression(stmt.condition);
  }
  output += '; ';
  if (stmt.update) {
    output += generator.generateExpression(stmt.update);
  }
  output += ') {\n';
  generator.indentLevel++;
  output += generateStatement(generator, stmt.body);
  generator.indentLevel--;
  output += generator.indent() + '}';
  return output;
}

export function generateForOfStatement(generator: JsStatementGeneratorInterface, stmt: ForOfStatement): string {
  // Check if the iterable is a range expression
  if (stmt.iterable.kind === 'range') {
    const rangeExpr = stmt.iterable as RangeExpression;
    const varName = stmt.variable.name;
    const startExpr = generator.generateExpression(rangeExpr.start);
    const endExpr = generator.generateExpression(rangeExpr.end);
    // For range-based for loops, we must use 'let' since the loop variable is modified
    const varDecl = 'let';
    
    // Generate a traditional for loop for ranges
    const condition = rangeExpr.inclusive 
      ? `${varName} <= ${endExpr}`
      : `${varName} < ${endExpr}`;
    
    let output = generator.indent() + `for (${varDecl} ${varName} = ${startExpr}; ${condition}; ${varName}++) {\n`;
    generator.indentLevel++;
    output += generateStatement(generator, stmt.body);
    generator.indentLevel--;
    output += generator.indent() + '}';
    return output;
  } else {
    // Standard for..of loop for collections
    const varDecl = stmt.isConst ? 'const' : 'let';
    let output = generator.indent() + `for (${varDecl} ${stmt.variable.name} of ${generator.generateExpression(stmt.iterable)}) {\n`;
    generator.indentLevel++;
    output += generateStatement(generator, stmt.body);
    generator.indentLevel--;
    output += generator.indent() + '}';
    return output;
  }
}

export function generateSwitchStatement(generator: JsStatementGeneratorInterface, stmt: SwitchStatement): string {
  let output = generator.indent() + 'switch (' + generator.generateExpression(stmt.discriminant) + ') {\n';
  generator.indentLevel++;
  
  for (const case_ of stmt.cases) {
    if (!case_.isDefault) {
      // Handle multiple test expressions for one case
      for (const test of case_.tests) {
        output += generator.indent() + 'case ' + generator.generateExpression(test) + ':\n';
      }
    } else {
      output += generator.indent() + 'default:\n';
    }
    generator.indentLevel++;
    for (const bodyStmt of case_.body) {
      output += generateStatement(generator, bodyStmt) + '\n';
    }
    
    // Add break statement to prevent fallthrough (Doof switch cases don't fall through)
    // Only skip break if the case body already ends with break/return
    let needsBreak = true;
    if (case_.body.length > 0) {
      const lastStmt = case_.body[case_.body.length - 1];
      if (lastStmt.kind === 'break' || lastStmt.kind === 'return') {
        needsBreak = false;
      }
    }
    
    if (needsBreak) {
      output += generator.indent() + 'break;\n';
    }
    
    generator.indentLevel--;
  }
  
  generator.indentLevel--;
  output += generator.indent() + '}';
  return output;
}

export function generateBlockStatement(generator: JsStatementGeneratorInterface, stmt: BlockStatement): string {
  let output = '';
  for (const innerStmt of stmt.body) {
    output += generateStatement(generator, innerStmt) + '\n';
  }
  return output;
}

export function generateReturnStatement(generator: JsStatementGeneratorInterface, stmt: ReturnStatement): string {
  let output = generator.indent() + 'return';
  if (stmt.argument) {
    output += ' ' + generator.generateExpression(stmt.argument);
  }
  output += ';';
  return output;
}

function generateDefaultValue(type: any): string {
  switch (type.kind) {
    case 'primitive':
      const primType = type;
      switch (primType.type) {
        case 'string': return '""';
        case 'int':
        case 'float': 
        case 'double': return '0';
        case 'bool': return 'false';
        case 'void': return 'undefined';
        default: return 'null';
      }
    case 'array':
      return '[]';
    case 'map':
      return 'new Map()';
    case 'set':
      return 'new Set()';
    default:
      return 'null';
  }
}

/**
 * Generate JavaScript type conversion expressions
 */
function generateJsTypeConversion(value: string, sourceType: string, targetType: string): string {
  // Handle numeric conversions in JavaScript
  if (targetType === 'int' && (sourceType === 'float' || sourceType === 'double')) {
    return `Math.trunc(${value})`;
  } else if (targetType === 'float' && sourceType === 'int') {
    return value; // JavaScript numbers are already floating-point
  } else if (targetType === 'double' && sourceType === 'int') {
    return value; // JavaScript numbers are already floating-point
  } else if (targetType === 'float' && sourceType === 'double') {
    return value; // JavaScript doesn't distinguish float from double
  } else if (targetType === 'double' && sourceType === 'float') {
    return value; // JavaScript doesn't distinguish float from double
  }
  
  // For all other cases, return the value as-is
  return value;
}
