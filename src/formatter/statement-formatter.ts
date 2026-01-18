import {
  BlockStatement,
  BlankStatement,
  BreakStatement,
  ClassDeclaration,
  ContinueStatement,
  EnumDeclaration,
  EnumMember,
  ExternClassDeclaration,
  ExportDeclaration,
  Expression,
  ExpressionStatement,
  FieldDeclaration,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  IfStatement,
  ImportDeclaration,
  ImportSpecifier,
  MethodDeclaration,
  Parameter,
  Program,
  ReturnStatement,
  Statement,
  SwitchCase,
  SwitchStatement,
  Type,
  TypeAliasDeclaration,
  VariableDeclaration,
  WhileStatement,
  MarkdownHeader,
  MarkdownTable,
} from '../types';
import { FormatterOptions } from './options';
import { Printer } from './printer';
import { TypeFormatter } from './type-formatter';
import { ExpressionFormatter } from './expression-formatter';

const DECLARATION_KINDS: ReadonlySet<Statement['kind']> = new Set([
  'function',
  'class',
  'externClass',
  'enum',
  'typeAlias',
]);

export class StatementFormatter {
  private expressionFormatter?: ExpressionFormatter;

  constructor(
    private readonly printer: Printer,
    private readonly options: FormatterOptions,
    private readonly typeFormatter: TypeFormatter,
  ) {}

  setExpressionFormatter(formatter: ExpressionFormatter): void {
    this.expressionFormatter = formatter;
  }

  formatProgram(program: Program): void {
    let previousWasImport = false;
    let previousWasExport = false;
    let previousWasBlank = true;
    let previousKind: Statement['kind'] | null = null;
    let hasWrittenStatement = false;

    let index = 0;
    while (index < program.body.length) {
      const stmt = program.body[index];

      if (stmt.kind === 'blank') {
        const blankStmt = stmt as BlankStatement;
        if (blankStmt.trailingComment) {
          this.printer.writeIndent();
          this.formatBlankStatement(blankStmt);
          this.printer.writeLine();
          previousWasBlank = false;
          hasWrittenStatement = true;
        } else if (!previousWasBlank && hasWrittenStatement) {
          this.printer.writeLine();
          previousWasBlank = true;
        } else {
          previousWasBlank = true;
        }

        previousWasImport = false;
        previousWasExport = false;
        index += 1;
        continue;
      }

      const isImport = stmt.kind === 'import';
      const isExport = stmt.kind === 'export';
      const isDeclaration = DECLARATION_KINDS.has(stmt.kind);

      if (hasWrittenStatement && !previousWasBlank) {
        const previousIsDeclaration = previousKind ? DECLARATION_KINDS.has(previousKind) : false;
        const needsExtraSpace =
          (previousWasImport && !isImport) ||
          (previousWasExport && !isExport && !isImport) ||
          (isDeclaration && previousIsDeclaration && previousKind !== stmt.kind);

        if (needsExtraSpace) {
          this.printer.writeLine();
        }
      }

      const statementWithComment = stmt as Statement & { trailingComment?: string };
      const originalComment = statementWithComment.trailingComment;
      let combinedTrailing: string | undefined;
      let lookahead = index + 1;

      while (lookahead < program.body.length) {
        const candidate = program.body[lookahead];
        if (candidate.kind !== 'blank') {
          break;
        }

        const blankCandidate = candidate as BlankStatement;
        if (!blankCandidate.trailingComment) {
          break;
        }

        if (!this.isTrailingCommentForStatement(stmt, blankCandidate)) {
          break;
        }

        combinedTrailing = combinedTrailing !== undefined
          ? combinedTrailing + blankCandidate.trailingComment
          : blankCandidate.trailingComment;
        lookahead += 1;
      }

      if (combinedTrailing !== undefined) {
        statementWithComment.trailingComment = originalComment
          ? `${originalComment}${combinedTrailing}`
          : combinedTrailing;
      }

      this.printer.writeIndent();
      this.formatStatement(stmt);
      this.printer.writeLine();

      if (combinedTrailing !== undefined) {
        statementWithComment.trailingComment = originalComment;
      }

      hasWrittenStatement = true;
      previousWasBlank = false;
      previousWasImport = isImport;
      previousWasExport = isExport;
      previousKind = stmt.kind;
      index = lookahead;
    }
  }

  formatStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case 'blank':
        this.formatBlankStatement(stmt as BlankStatement);
        break;
      case 'block':
        this.formatBlockStatement(stmt as BlockStatement);
        break;
      case 'expression':
        this.formatExpressionStatement(stmt as ExpressionStatement);
        break;
      case 'variable':
        this.formatVariableDeclaration(stmt as VariableDeclaration);
        break;
      case 'function':
        this.formatFunctionDeclaration(stmt as FunctionDeclaration);
        break;
      case 'class':
        this.formatClassDeclaration(stmt as ClassDeclaration);
        break;
      case 'externClass':
        this.formatExternClassDeclaration(stmt as ExternClassDeclaration);
        break;
      case 'enum':
        this.formatEnumDeclaration(stmt as EnumDeclaration);
        break;
      case 'typeAlias':
        this.formatTypeAliasDeclaration(stmt as TypeAliasDeclaration);
        break;
      case 'if':
        this.formatIfStatement(stmt as IfStatement);
        break;
      case 'while':
        this.formatWhileStatement(stmt as WhileStatement);
        break;
      case 'for':
        this.formatForStatement(stmt as ForStatement);
        break;
      case 'forOf':
        this.formatForOfStatement(stmt as ForOfStatement);
        break;
      case 'switch':
        this.formatSwitchStatement(stmt as SwitchStatement);
        break;
      case 'return':
        this.formatReturnStatement(stmt as ReturnStatement);
        break;
      case 'break':
        this.printer.write('break;');
        this.writeTrailingComment(stmt as BreakStatement);
        break;
      case 'continue':
        this.printer.write('continue;');
        this.writeTrailingComment(stmt as ContinueStatement);
        break;
      case 'markdownHeader':
        this.formatMarkdownHeader(stmt as MarkdownHeader);
        break;
      case 'markdownTable':
        this.formatMarkdownTable(stmt as MarkdownTable);
        break;
      case 'import':
        this.formatImportDeclaration(stmt as ImportDeclaration);
        break;
      case 'export':
        this.formatStatement((stmt as ExportDeclaration).declaration);
        break;
      default:
        this.printer.write(`/* Unknown statement: ${(stmt as any).kind} */`);
        break;
    }
  }

  formatBlockStatement(stmt: BlockStatement, omitBraces = false): void {
    if (!omitBraces) {
      this.printer.write('{');
      this.printer.writeLine();
      this.printer.increaseIndent();
    }

    let previousWasEmptyLine = true;
    let index = 0;
    while (index < stmt.body.length) {
      const bodyStmt = stmt.body[index];

      if (bodyStmt.kind === 'blank') {
        const blankStmt = bodyStmt as BlankStatement;
        if (blankStmt.trailingComment) {
          this.printer.writeIndent();
          this.formatBlankStatement(blankStmt);
          this.printer.writeLine();
          previousWasEmptyLine = false;
        } else if (!previousWasEmptyLine) {
          this.printer.writeLine();
          previousWasEmptyLine = true;
        } else {
          previousWasEmptyLine = true;
        }

        index += 1;
        continue;
      }

      const statementWithComment = bodyStmt as Statement & { trailingComment?: string };
      const originalComment = statementWithComment.trailingComment;
      let combinedTrailing: string | undefined;
      let lookahead = index + 1;

      while (lookahead < stmt.body.length) {
        const candidate = stmt.body[lookahead];
        if (candidate.kind !== 'blank') {
          break;
        }

        const blankCandidate = candidate as BlankStatement;
        if (!blankCandidate.trailingComment) {
          break;
        }

        if (!this.isTrailingCommentForStatement(bodyStmt, blankCandidate)) {
          break;
        }

        combinedTrailing = combinedTrailing !== undefined
          ? combinedTrailing + blankCandidate.trailingComment
          : blankCandidate.trailingComment;
        lookahead += 1;
      }

      if (combinedTrailing !== undefined) {
        statementWithComment.trailingComment = originalComment
          ? `${originalComment}${combinedTrailing}`
          : combinedTrailing;
      }

      this.printer.writeIndent();
      this.formatStatement(bodyStmt);
      this.printer.writeLine();

      if (combinedTrailing !== undefined) {
        statementWithComment.trailingComment = originalComment;
      }

      previousWasEmptyLine = false;
      index = lookahead;
    }

    if (!omitBraces) {
      this.printer.decreaseIndent();
      this.printer.writeIndent();
      this.printer.write('}');
    }
  }

  private formatBlankStatement(stmt: BlankStatement): void {
    if (stmt.trailingComment) {
      this.printer.write('//');
      this.printer.write(stmt.trailingComment);
    }
  }

  private formatMarkdownHeader(stmt: MarkdownHeader): void {
    const level = Math.max(1, Math.min(stmt.level, 6));
    const prefix = '#'.repeat(level);
    const text = stmt.text.trim();
    const suffix = text.length > 0 ? ` ${text}` : '';
    this.printer.write(`// ${prefix}${suffix}`);
  }

  private formatMarkdownTable(stmt: MarkdownTable): void {
    if (stmt.headers.length === 0 && stmt.rows.length === 0) {
      this.printer.write('// | |');
      return;
    }

    const lines: string[] = [];
    const formatRow = (cells: string[]) => `// | ${cells.join(' | ')} |`;

    if (stmt.headers.length > 0) {
      lines.push(formatRow(stmt.headers));
    }

    if (stmt.alignments && stmt.alignments.length === stmt.headers.length && stmt.headers.length > 0) {
      const alignmentRow = stmt.alignments.map(alignment => {
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

    for (const row of stmt.rows) {
      lines.push(formatRow(row));
    }

    if (lines.length === 0) {
      lines.push('// | |');
    }

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        this.printer.writeLine();
        this.printer.writeIndent();
      }
      this.printer.write(lines[i]);
    }
  }

  private formatExpressionStatement(stmt: ExpressionStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();
    expressionFormatter.formatExpression(stmt.expression);
    this.printer.write(';');
    this.writeTrailingComment(stmt);
  }

  private formatVariableDeclaration(stmt: VariableDeclaration): void {
    const expressionFormatter = this.requireExpressionFormatter();

    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write(stmt.isConst ? 'const ' : 'let ');

    if (stmt.isConciseLambda && stmt.lambdaParameters) {
      this.printer.write(stmt.identifier.name);
      this.printer.write('(');
      this.formatParameterList(stmt.lambdaParameters);
      this.printer.write(')');
      if (stmt.type) {
        this.printer.write(': ');
        this.typeFormatter.formatType(stmt.type);
      }
      if (stmt.initializer) {
        this.printer.write(' => ');
        expressionFormatter.formatExpression(stmt.initializer);
      }
    } else {
      this.printer.write(stmt.identifier.name);
      if (stmt.type) {
        this.printer.write(': ');
        this.typeFormatter.formatType(stmt.type);
      }
      if (stmt.initializer) {
        this.printer.write(' = ');
        expressionFormatter.formatExpression(stmt.initializer);
      }
    }

    this.printer.write(';');
    this.writeTrailingComment(stmt);
  }

  private formatFunctionDeclaration(stmt: FunctionDeclaration): void {
    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write('function ');
    this.printer.write(stmt.name.name);
    this.printer.write('(');
    this.formatParameterList(stmt.parameters);
    this.printer.write(')');
    this.printer.write(': ');
    this.typeFormatter.formatType(stmt.returnType);

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');
    this.printer.writeLine();
    this.printer.increaseIndent();

    for (const bodyStmt of stmt.body.body) {
      this.printer.writeIndent();
      this.formatStatement(bodyStmt);
      this.printer.writeLine();
    }

    this.printer.decreaseIndent();
    this.printer.writeIndent();
    this.printer.write('}');
  }

  private formatClassDeclaration(stmt: ClassDeclaration): void {
    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write('class ');
    this.printer.write(stmt.name.name);

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');
    this.printer.writeLine();
    this.printer.increaseIndent();

    const fields = stmt.fields;
    const nestedClasses = stmt.nestedClasses ?? [];
    const methods = stmt.methods;

    let wroteSection = false;

    if (fields.length > 0) {
      for (const field of fields) {
        this.printer.writeIndent();
        this.formatFieldDeclaration(field);
        this.printer.writeLine();
      }
      wroteSection = true;
    }

    if (nestedClasses.length > 0) {
      if (wroteSection) {
        this.printer.writeLine();
      }

      for (let i = 0; i < nestedClasses.length; i++) {
        this.printer.writeIndent();
        this.formatClassDeclaration(nestedClasses[i]);
        this.printer.writeLine();
        if (i < nestedClasses.length - 1) {
          this.printer.writeLine();
        }
      }

      wroteSection = true;
    }

    if (methods.length > 0) {
      if (wroteSection) {
        this.printer.writeLine();
      }

      for (let i = 0; i < methods.length; i++) {
        this.printer.writeIndent();
        this.formatMethodDeclaration(methods[i]);
        this.printer.writeLine();
        if (i < methods.length - 1) {
          this.printer.writeLine();
        }
      }
    }

    this.printer.decreaseIndent();
    this.printer.writeIndent();
    this.printer.write('}');
  }

  private formatExternClassDeclaration(stmt: ExternClassDeclaration): void {
    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write('extern class ');
    this.printer.write(stmt.name.name);

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');
    this.printer.writeLine();
    this.printer.increaseIndent();

    for (const field of stmt.fields) {
      this.printer.writeIndent();
      this.formatFieldDeclaration(field);
      this.printer.writeLine();
    }

    if (stmt.fields.length > 0 && stmt.methods.length > 0) {
      this.printer.writeLine();
    }

    for (let i = 0; i < stmt.methods.length; i++) {
      this.printer.writeIndent();
      this.formatMethodDeclaration(stmt.methods[i]);
      this.printer.writeLine();
    }

    this.printer.decreaseIndent();
    this.printer.writeIndent();
    this.printer.write('}');
  }

  private formatFieldDeclaration(field: FieldDeclaration): void {
    const expressionFormatter = this.requireExpressionFormatter();

    if (field.isStatic) {
      this.printer.write('static ');
    }
    if (!field.isPublic) {
      this.printer.write('private ');
    }
    if (field.isConst) {
      this.printer.write('const ');
    }
    if (field.isReadonly) {
      this.printer.write('readonly ');
    }

    if (field.isConciseCallable) {
      this.printer.write(field.name.name);
      this.printer.write('(');
      this.printer.write(')');
      if (field.type) {
        this.printer.write(': ');
        this.typeFormatter.formatType(field.type);
      }
    } else {
      this.printer.write(field.name.name);
      this.printer.write(': ');
      this.typeFormatter.formatType(field.type);

      if (field.defaultValue) {
        this.printer.write(' = ');
        expressionFormatter.formatExpression(field.defaultValue);
      }
    }

    this.printer.write(';');
  }

  private formatMethodDeclaration(method: MethodDeclaration): void {
    if (method.isExtern) {
      this.formatExternMethodDeclaration(method);
      return;
    }

    if (method.isStatic) {
      this.printer.write('static ');
    }
    if (!method.isPublic) {
      this.printer.write('private ');
    }

    this.printer.write(method.name.name);
    this.printer.write('(');
    this.formatParameterList(method.parameters);
    this.printer.write(')');
    this.printer.write(': ');
    this.typeFormatter.formatType(method.returnType);

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');
    this.printer.writeLine();
    this.printer.increaseIndent();

    for (const bodyStmt of method.body.body) {
      this.printer.writeIndent();
      this.formatStatement(bodyStmt);
      this.printer.writeLine();
    }

    this.printer.decreaseIndent();
    this.printer.writeIndent();
    this.printer.write('}');
  }

  private formatExternMethodDeclaration(method: MethodDeclaration): void {
    if (method.isStatic) {
      this.printer.write('static ');
    }
    if (!method.isPublic) {
      this.printer.write('private ');
    }

    this.printer.write(method.name.name);
    this.printer.write('(');
    this.formatParameterList(method.parameters);
    this.printer.write(')');
    this.printer.write(': ');
    this.typeFormatter.formatType(method.returnType);
    this.printer.write(';');
  }

  private formatEnumDeclaration(stmt: EnumDeclaration): void {
    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write('enum ');
    this.printer.write(stmt.name.name);

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');

    if (stmt.members.length > 0) {
      this.printer.writeLine();
      this.printer.increaseIndent();

      for (let i = 0; i < stmt.members.length; i++) {
        this.printer.writeIndent();
        this.formatEnumMember(stmt.members[i]);
        if (i < stmt.members.length - 1) {
          this.printer.write(',');
        }
        this.printer.writeLine();
      }

      this.printer.decreaseIndent();
      this.printer.writeIndent();
    }

    this.printer.write('}');
  }

  private formatEnumMember(member: EnumMember): void {
    this.printer.write(member.name.name);
    if (member.value) {
      this.printer.write(' = ');
      this.requireExpressionFormatter().formatExpression(member.value);
    }
  }

  private formatTypeAliasDeclaration(stmt: TypeAliasDeclaration): void {
    if (stmt.isExport) {
      this.printer.write('export ');
    }

    this.printer.write('type ');
    this.printer.write(stmt.name.name);

    // Format type parameters if present: type Alias<T, U> = ...
    if (stmt.typeParameters && stmt.typeParameters.length > 0) {
      this.printer.write('<');
      for (let i = 0; i < stmt.typeParameters.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        this.printer.write(stmt.typeParameters[i].name);
      }
      this.printer.write('>');
    }

    this.printer.write(' = ');
    this.typeFormatter.formatType(stmt.type);
    this.printer.write(';');
  }

  private formatIfStatement(stmt: IfStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('if');
    if (this.options.insertSpaceAfterKeywords) {
      this.printer.write(' ');
    }
    this.printer.write('(');
    expressionFormatter.formatExpression(stmt.condition);
    this.printer.write(')');

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    if (stmt.thenStatement.kind === 'block') {
      this.formatBlockStatement(stmt.thenStatement as BlockStatement);
    } else {
      this.printer.write('{');
      this.printer.writeLine();
      this.printer.increaseIndent();
      this.printer.writeIndent();
      this.formatStatement(stmt.thenStatement);
      this.printer.writeLine();
      this.printer.decreaseIndent();
      this.printer.writeIndent();
      this.printer.write('}');
    }

    if (stmt.elseStatement) {
      this.printer.write(' else');
      if (stmt.elseStatement.kind === 'if') {
        this.printer.write(' ');
        this.formatIfStatement(stmt.elseStatement as IfStatement);
      } else {
        if (this.options.insertSpaceBeforeBlockBrace) {
          this.printer.write(' ');
        }
        if (stmt.elseStatement.kind === 'block') {
          this.formatBlockStatement(stmt.elseStatement as BlockStatement);
        } else {
          this.printer.write('{');
          this.printer.writeLine();
          this.printer.increaseIndent();
          this.printer.writeIndent();
          this.formatStatement(stmt.elseStatement);
          this.printer.writeLine();
          this.printer.decreaseIndent();
          this.printer.writeIndent();
          this.printer.write('}');
        }
      }
    }
  }

  private formatWhileStatement(stmt: WhileStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('while');
    if (this.options.insertSpaceAfterKeywords) {
      this.printer.write(' ');
    }
    this.printer.write('(');
    expressionFormatter.formatExpression(stmt.condition);
    this.printer.write(')');

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    if (stmt.body.kind === 'block') {
      this.formatBlockStatement(stmt.body as BlockStatement);
    } else {
      this.printer.write('{');
      this.printer.writeLine();
      this.printer.increaseIndent();
      this.printer.writeIndent();
      this.formatStatement(stmt.body);
      this.printer.writeLine();
      this.printer.decreaseIndent();
      this.printer.writeIndent();
      this.printer.write('}');
    }
  }

  private formatForStatement(stmt: ForStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('for');
    if (this.options.insertSpaceAfterKeywords) {
      this.printer.write(' ');
    }
    this.printer.write('(');

    if (stmt.init) {
      if (stmt.init.kind === 'variable') {
        const varDecl = stmt.init as VariableDeclaration;
        this.printer.write(varDecl.isConst ? 'const ' : 'let ');
        this.printer.write(varDecl.identifier.name);
        if (varDecl.type) {
          this.printer.write(': ');
          this.typeFormatter.formatType(varDecl.type);
        }
        if (varDecl.initializer) {
          this.printer.write(' = ');
          expressionFormatter.formatExpression(varDecl.initializer);
        }
      } else {
        expressionFormatter.formatExpression(stmt.init as Expression);
      }
    }
    this.printer.write(';');

    if (this.options.insertSpaceAfterComma) {
      this.printer.write(' ');
    }

    if (stmt.condition) {
      expressionFormatter.formatExpression(stmt.condition);
    }
    this.printer.write(';');

    if (this.options.insertSpaceAfterComma) {
      this.printer.write(' ');
    }

    if (stmt.update) {
      expressionFormatter.formatExpression(stmt.update);
    }

    this.printer.write(')');

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    if (stmt.body.kind === 'block') {
      this.formatBlockStatement(stmt.body as BlockStatement);
    } else {
      this.printer.write('{');
      this.printer.writeLine();
      this.printer.increaseIndent();
      this.printer.writeIndent();
      this.formatStatement(stmt.body);
      this.printer.writeLine();
      this.printer.decreaseIndent();
      this.printer.writeIndent();
      this.printer.write('}');
    }
  }

  private formatForOfStatement(stmt: ForOfStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('for');
    if (this.options.insertSpaceAfterKeywords) {
      this.printer.write(' ');
    }
    this.printer.write('(');
    this.printer.write(stmt.isConst ? 'const ' : 'let ');
    this.printer.write(stmt.variable.name);
    this.printer.write(' of ');
    expressionFormatter.formatExpression(stmt.iterable);
    this.printer.write(')');

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    if (stmt.body.kind === 'block') {
      this.formatBlockStatement(stmt.body as BlockStatement);
    } else {
      this.printer.write('{');
      this.printer.writeLine();
      this.printer.increaseIndent();
      this.printer.writeIndent();
      this.formatStatement(stmt.body);
      this.printer.writeLine();
      this.printer.decreaseIndent();
      this.printer.writeIndent();
      this.printer.write('}');
    }
  }

  private formatSwitchStatement(stmt: SwitchStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('switch');
    if (this.options.insertSpaceAfterKeywords) {
      this.printer.write(' ');
    }
    this.printer.write('(');
    expressionFormatter.formatExpression(stmt.discriminant);
    this.printer.write(')');

    if (this.options.insertSpaceBeforeBlockBrace) {
      this.printer.write(' ');
    }

    this.printer.write('{');
    this.printer.writeLine();
    this.printer.increaseIndent();

    for (const caseStmt of stmt.cases) {
      this.printer.writeIndent();
      this.formatSwitchCase(caseStmt);
    }

    this.printer.decreaseIndent();
    this.printer.writeIndent();
    this.printer.write('}');
  }

  private formatSwitchCase(caseStmt: SwitchCase): void {
    const expressionFormatter = this.requireExpressionFormatter();

    if (caseStmt.isDefault) {
      this.printer.write('default:');
    } else {
      this.printer.write('case ');
      for (let i = 0; i < caseStmt.tests.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        expressionFormatter.formatExpression(caseStmt.tests[i] as Expression);
      }
      this.printer.write(':');
    }

    if (caseStmt.body.length > 0) {
      this.printer.writeLine();
      this.printer.increaseIndent();
      for (let i = 0; i < caseStmt.body.length; i++) {
        this.printer.writeIndent();
        this.formatStatement(caseStmt.body[i]);
        if (i < caseStmt.body.length - 1) {
          this.printer.writeLine();
        }
      }
      this.printer.writeLine();
      this.printer.decreaseIndent();
    } else {
      this.printer.writeLine();
    }
  }

  private formatReturnStatement(stmt: ReturnStatement): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('return');
    if (stmt.argument) {
      this.printer.write(' ');
      expressionFormatter.formatExpression(stmt.argument);
    }
    this.printer.write(';');
    this.writeTrailingComment(stmt);
  }

  private formatImportDeclaration(stmt: ImportDeclaration): void {
    const expressionFormatter = this.requireExpressionFormatter();

    this.printer.write('import { ');
    for (let i = 0; i < stmt.specifiers.length; i++) {
      if (i > 0) {
        this.printer.write(', ');
      }
      this.formatImportSpecifier(stmt.specifiers[i]);
    }
    this.printer.write(' } from ');
    expressionFormatter.formatExpression(stmt.source);
    this.printer.write(';');
  }

  private formatImportSpecifier(spec: ImportSpecifier): void {
    this.printer.write(spec.imported.name);
    if (spec.local && spec.local.name !== spec.imported.name) {
      this.printer.write(' as ');
      this.printer.write(spec.local.name);
    }
  }

  formatParameterList(parameters: Parameter[]): void {
    if (
      this.options.breakLongFunctionParameters &&
      this.shouldBreakParameters(parameters)
    ) {
      this.printer.writeLine();
      this.printer.increaseIndent();
      for (let i = 0; i < parameters.length; i++) {
        this.printer.writeIndent();
        this.formatParameter(parameters[i]);
        if (i < parameters.length - 1) {
          this.printer.write(',');
        }
        this.printer.writeLine();
      }
      this.printer.decreaseIndent();
      this.printer.writeIndent();
    } else {
      for (let i = 0; i < parameters.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        this.formatParameter(parameters[i]);
      }
    }
  }

  private formatParameter(param: Parameter): void {
    const expressionFormatter = this.requireExpressionFormatter();

    if (param.isConciseForm) {
      this.printer.write(param.name.name);
      this.printer.write('(');
      this.typeFormatter.formatType(param.type);
      this.printer.write(')');
    } else {
      this.printer.write(param.name.name);
      this.printer.write(': ');
      this.typeFormatter.formatType(param.type);
    }

    if (param.defaultValue) {
      this.printer.write(' = ');
      expressionFormatter.formatExpression(param.defaultValue);
    }
  }

  private shouldBreakParameters(params: Parameter[]): boolean {
    if (params.length === 0) {
      return false;
    }
    if (params.length > 4) {
      return true;
    }

    const expressionFormatter = this.requireExpressionFormatter();

    let estimatedLength = this.printer.getCurrentLineLength();
    for (let i = 0; i < params.length; i++) {
      if (i > 0) {
        estimatedLength += 2;
      }
      estimatedLength += params[i].name.name.length + 2;
      estimatedLength += this.typeFormatter.estimateTypeLength(params[i].type as Type);
      if (params[i].defaultValue) {
        estimatedLength += 3; // account for ' = '
        estimatedLength += expressionFormatter.estimateExpressionLength(params[i].defaultValue!);
      }
    }

    return estimatedLength > this.options.maxLineLength;
  }

  private getNodeStartLine(node: Statement | BlankStatement): number | undefined {
    const location = node.location;
    if (!location) {
      return undefined;
    }
    return location.start?.line ?? location.end?.line;
  }

  private getNodeEndLine(node: Statement | BlankStatement): number | undefined {
    const location = node.location;
    if (!location) {
      return undefined;
    }
    return location.end?.line ?? location.start?.line;
  }

  private isTrailingCommentForStatement(stmt: Statement, blank: BlankStatement): boolean {
    const stmtLine = this.getNodeEndLine(stmt);
    const blankLine = this.getNodeStartLine(blank);
    if (stmtLine === undefined || blankLine === undefined) {
      return false;
    }

    return blankLine === stmtLine || blankLine === stmtLine + 1;
  }

  private writeTrailingComment(stmt: Statement): void {
    if (stmt.trailingComment) {
      this.printer.write(' //');
      this.printer.write(stmt.trailingComment);
    }
  }

  private requireExpressionFormatter(): ExpressionFormatter {
    if (!this.expressionFormatter) {
      throw new Error('Expression formatter has not been configured for StatementFormatter');
    }
    return this.expressionFormatter;
  }
}
