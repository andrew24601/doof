import {
  Program,
  Statement,
  BlockStatement,
  FunctionDeclaration,
  VariableDeclaration,
  LambdaExpression,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  SwitchStatement,
  ClassDeclaration,
  MethodDeclaration,
  ConstructorDeclaration,
  SwitchCase
} from '../types';

export function desugarNestedFunctions(program: Program): void {
  program.body = transformStatements(program.body, 0);
}

function transformStatements(statements: Statement[], functionDepth: number): Statement[] {
  return statements.map(stmt => transformStatement(stmt, functionDepth));
}

function transformStatement(statement: Statement, functionDepth: number): Statement {
  switch (statement.kind) {
    case 'function': {
      const fn = statement as FunctionDeclaration;
      fn.body = transformBlock(fn.body, functionDepth + 1);
      if (functionDepth > 0) {
        return convertFunctionToLambdaVariable(fn);
      }
      return fn;
    }
    case 'block': {
      const block = statement as BlockStatement;
      block.body = transformStatements(block.body, functionDepth);
      return block;
    }
    case 'if': {
      const ifStmt = statement as IfStatement;
      ifStmt.thenStatement = transformStatement(ifStmt.thenStatement, functionDepth);
      if (ifStmt.elseStatement) {
        ifStmt.elseStatement = transformStatement(ifStmt.elseStatement, functionDepth);
      }
      return ifStmt;
    }
    case 'while': {
      const whileStmt = statement as WhileStatement;
      whileStmt.body = transformStatement(whileStmt.body, functionDepth);
      return whileStmt;
    }
    case 'for': {
      const forStmt = statement as ForStatement;
      if (forStmt.init && (forStmt.init as Statement).kind) {
        const initStmt = forStmt.init as Statement;
        const transformedInit = transformStatement(initStmt, functionDepth);
        forStmt.init = transformedInit as VariableDeclaration;
      }
      if (forStmt.body) {
        forStmt.body = transformStatement(forStmt.body, functionDepth);
      }
      return forStmt;
    }
    case 'forOf': {
      const forOfStmt = statement as ForOfStatement;
      forOfStmt.body = transformStatement(forOfStmt.body, functionDepth);
      return forOfStmt;
    }
    case 'switch': {
      const switchStmt = statement as SwitchStatement;
      switchStmt.cases = switchStmt.cases.map(switchCase => transformSwitchCase(switchCase, functionDepth));
      return switchStmt;
    }
    case 'class': {
      const classDecl = statement as ClassDeclaration;
      classDecl.methods = classDecl.methods.map(method => transformMethod(method, functionDepth + 1));
      if (classDecl.constructor) {
        classDecl.constructor = transformConstructor(classDecl.constructor, functionDepth + 1);
      }
      if (classDecl.nestedClasses) {
        classDecl.nestedClasses = classDecl.nestedClasses.map(nested => transformStatement(nested, functionDepth) as ClassDeclaration);
      }
      return classDecl;
    }
    case 'export': {
      const exportDecl = statement as any;
      exportDecl.declaration = transformStatement(exportDecl.declaration, functionDepth);
      return exportDecl;
    }
    default:
      return statement;
  }
}

function transformSwitchCase(switchCase: SwitchCase, functionDepth: number): SwitchCase {
  switchCase.body = transformStatements(switchCase.body, functionDepth);
  return switchCase;
}

function transformBlock(block: BlockStatement, functionDepth: number): BlockStatement {
  block.body = transformStatements(block.body, functionDepth);
  return block;
}

function transformMethod(method: MethodDeclaration, functionDepth: number): MethodDeclaration {
  if (!method.isExtern) {
    method.body = transformBlock(method.body, functionDepth);
  }
  return method;
}

function transformConstructor(ctor: ConstructorDeclaration, functionDepth: number): ConstructorDeclaration {
  ctor.body = transformBlock(ctor.body, functionDepth);
  return ctor;
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
