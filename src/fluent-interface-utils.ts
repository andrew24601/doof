// Utility functions for fluent interface detection
// This can be used by both validation and code generation phases

import { ClassDeclaration, Statement, Expression, Identifier, CallExpression, BinaryExpression, UnaryExpression, ConditionalExpression, ArrayExpression, ObjectExpression, PositionalObjectExpression, ExpressionStatement, IfStatement, WhileStatement, ForStatement, ReturnStatement, BlockStatement, MemberExpression } from './types';

export function classUsesThisAsValue(classDecl: ClassDeclaration): boolean {
  // Check all methods (no constructors)
  for (const method of classDecl.methods) {
    if (hasThisAsValue(method.body)) {
      return true;
    }
  }
  
  return false;
}

export function hasThisAsValue(block: BlockStatement): boolean {
  for (const stmt of block.body) {
    if (statementUsesThisAsValue(stmt)) {
      return true;
    }
  }
  return false;
}

export function statementUsesThisAsValue(stmt: Statement): boolean {
  switch (stmt.kind) {
    case 'expression':
      const exprStmt = stmt as ExpressionStatement;
      return expressionUsesThisAsValue(exprStmt.expression);
    
    case 'block':
      return hasThisAsValue(stmt as BlockStatement);
    
    case 'if':
      const ifStmt = stmt as IfStatement;
      return expressionUsesThisAsValue(ifStmt.condition) ||
             statementUsesThisAsValue(ifStmt.thenStatement) ||
             (ifStmt.elseStatement ? statementUsesThisAsValue(ifStmt.elseStatement) : false);
    
    case 'while':
      const whileStmt = stmt as WhileStatement;
      return expressionUsesThisAsValue(whileStmt.condition) ||
             statementUsesThisAsValue(whileStmt.body);
    
    case 'for':
      const forStmt = stmt as ForStatement;
      const initUsesThis = forStmt.init ? 
        (forStmt.init.kind ? expressionUsesThisAsValue(forStmt.init as Expression) : false) 
        : false;
      return initUsesThis ||
             (forStmt.condition ? expressionUsesThisAsValue(forStmt.condition) : false) ||
             (forStmt.update ? expressionUsesThisAsValue(forStmt.update) : false) ||
             statementUsesThisAsValue(forStmt.body);
    
    case 'return':
      const returnStmt = stmt as ReturnStatement;
      return returnStmt.argument ? expressionUsesThisAsValue(returnStmt.argument) : false;
    
    default:
      return false;
  }
}

export function expressionUsesThisAsValue(expr: Expression): boolean {
  switch (expr.kind) {
    case 'identifier':
      // This is the key case: 'this' used as a value
      const identifier = expr as Identifier;
      return identifier.name === 'this';
    
    case 'call':
      const callExpr = expr as CallExpression;
      // Check if 'this' is passed as an argument
      for (const arg of callExpr.arguments) {
        if (expressionUsesThisAsValue(arg)) {
          return true;
        }
      }
      return expressionUsesThisAsValue(callExpr.callee);
    
    case 'member':
      const memberExpr = expr as MemberExpression;
      // Only check property, not object (this.x is member access, not 'this' as value)
      return expressionUsesThisAsValue(memberExpr.property);
    
    case 'binary':
      const binaryExpr = expr as BinaryExpression;
      return expressionUsesThisAsValue(binaryExpr.left) ||
             expressionUsesThisAsValue(binaryExpr.right);
    
    case 'unary':
      const unaryExpr = expr as UnaryExpression;
      return expressionUsesThisAsValue(unaryExpr.operand);
    
    case 'conditional':
      const conditionalExpr = expr as ConditionalExpression;
      return expressionUsesThisAsValue(conditionalExpr.test) ||
             expressionUsesThisAsValue(conditionalExpr.consequent) ||
             expressionUsesThisAsValue(conditionalExpr.alternate);
    
    case 'array':
      const arrayExpr = expr as ArrayExpression;
      return arrayExpr.elements.some((elem: Expression) => expressionUsesThisAsValue(elem));
    
    case 'object':
      const objectExpr = expr as ObjectExpression;
      return objectExpr.properties.some((prop: any) => 
        prop.value ? expressionUsesThisAsValue(prop.value) : false);
    
    case 'positionalObject':
      const posObjectExpr = expr as PositionalObjectExpression;
      return posObjectExpr.arguments.some((arg: Expression) => expressionUsesThisAsValue(arg));
    
    default:
      return false;
  }
}
