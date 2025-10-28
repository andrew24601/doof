import { ASTNode, Statement, Expression, VariableDeclaration, BinaryExpression, IfStatement, WhileStatement, BlockStatement, Identifier, ReturnStatement, ExpressionStatement, CallExpression, MemberExpression, UnaryExpression, TypeGuardExpression } from '../types';

/**
 * Tracks which variables are definitely assigned at each program point
 */
export class DefiniteAssignmentAnalyzer {
  private assignmentStates: Map<string, Set<string>> = new Map();
  private currentScope: string = 'global';
  private scopeCounter: number = 0;

  /**
   * Analyzes a function or block for definite assignment
   */
  public analyzeBlock(statements: Statement[], parentScope?: string): Map<string, Set<string>> {
    const previousScope = this.currentScope;
    if (parentScope) {
      this.currentScope = parentScope;
    } else {
      this.currentScope = `scope_${this.scopeCounter++}`;
    }

    // Initialize assignment state for this scope
    const assignedVars = new Set<string>();
    this.assignmentStates.set(this.currentScope, assignedVars);

    // Analyze each statement
    for (const statement of statements) {
      this.analyzeStatement(statement, assignedVars);
    }

    this.currentScope = previousScope;
    return this.assignmentStates;
  }

  /**
   * Checks if a variable is definitely assigned at this point
   */
  public isDefinitelyAssigned(variableName: string, scope?: string): boolean {
    const scopeToCheck = scope || this.currentScope;
    const assignedVars = this.assignmentStates.get(scopeToCheck);
    return assignedVars?.has(variableName) ?? false;
  }

  /**
   * Marks a variable as definitely assigned
   */
  public markAssigned(variableName: string, scope?: string): void {
    const scopeToCheck = scope || this.currentScope;
    let assignedVars = this.assignmentStates.get(scopeToCheck);
    if (!assignedVars) {
      assignedVars = new Set<string>();
      this.assignmentStates.set(scopeToCheck, assignedVars);
    }
    assignedVars.add(variableName);
  }

  /**
   * Analyzes a statement for assignments
   */
  private analyzeStatement(statement: Statement, assignedVars: Set<string>): void {
    switch (statement.kind) {
      case 'variable':
        this.analyzeVariableDeclaration(statement as VariableDeclaration, assignedVars);
        break;
      case 'expression':
        this.analyzeExpression(statement.expression, assignedVars);
        break;
      case 'if':
        this.analyzeIfStatement(statement as IfStatement, assignedVars);
        break;
      case 'while':
        this.analyzeWhileStatement(statement as WhileStatement, assignedVars);
        break;
      case 'block':
        this.analyzeBlockStatement(statement as BlockStatement, assignedVars);
        break;
      case 'return':
        if (statement.argument) {
          this.analyzeExpression(statement.argument, assignedVars);
        }
        break;
    }
  }

  /**
   * Analyzes variable declarations
   */
  private analyzeVariableDeclaration(decl: VariableDeclaration, assignedVars: Set<string>): void {
    // If the variable has an initializer, it's definitely assigned
    if (decl.initializer) {
      this.analyzeExpression(decl.initializer, assignedVars);
      assignedVars.add(decl.identifier.name);
    }
    // If no initializer, the variable is declared but not assigned
  }

  /**
   * Analyzes expressions for assignments
   */
  private analyzeExpression(expr: Expression, assignedVars: Set<string>): void {
    switch (expr.kind) {
      case 'binary':
        this.analyzeBinaryExpression(expr as BinaryExpression, assignedVars);
        break;
      case 'call':
        // Analyze arguments
        if (expr.arguments) {
          for (const arg of expr.arguments) {
            this.analyzeExpression(arg, assignedVars);
          }
        }
        break;
      case 'member':
        this.analyzeExpression(expr.object, assignedVars);
        break;
      case 'unary':
        this.analyzeExpression(expr.operand, assignedVars);
        break;
      case 'typeGuard':
        // For type guard expressions (x is Type), analyze the expression being guarded
        const typeGuard = expr as TypeGuardExpression;
        this.analyzeExpression(typeGuard.expression, assignedVars);
        break;
      case 'identifier':
        // This is a usage - we'll check this in the validator
        break;
    }
  }

  /**
   * Analyzes binary expressions (including assignments)
   */
  private analyzeBinaryExpression(expr: BinaryExpression, assignedVars: Set<string>): void {
    // Check if this is an assignment operator
    if (expr.operator === '=' || expr.operator === '+=' || expr.operator === '-=' || 
        expr.operator === '*=' || expr.operator === '/=' || expr.operator === '%=') {
      
      // For compound assignments (+=, -=, etc.), the left side is used before being assigned
      if (expr.operator !== '=' && expr.left.kind === 'identifier') {
        // This is a read operation first
        this.analyzeExpression(expr.left, assignedVars);
      }
      
      // Analyze the right side
      this.analyzeExpression(expr.right, assignedVars);

      // Mark the left side as assigned if it's an identifier
      if (expr.left.kind === 'identifier') {
        const identifier = expr.left as Identifier;
        assignedVars.add(identifier.name);
      }
    } else {
      // Regular binary expression - analyze both sides
      this.analyzeExpression(expr.left, assignedVars);
      this.analyzeExpression(expr.right, assignedVars);
    }
  }

  /**
   * Analyzes if statements with control flow
   */
  private analyzeIfStatement(stmt: IfStatement, assignedVars: Set<string>): void {
    // Analyze condition
    this.analyzeExpression(stmt.condition, assignedVars);

    // Clone current assignment state
    const beforeIf = new Set(assignedVars);

    // Analyze then branch
    const thenAssigned = new Set(assignedVars);
    this.analyzeStatement(stmt.thenStatement, thenAssigned);

    // Analyze else branch if it exists
    let elseAssigned = new Set(assignedVars);
    if (stmt.elseStatement) {
      this.analyzeStatement(stmt.elseStatement, elseAssigned);
    } else {
      // If no else, we can't guarantee assignment in the else path
      elseAssigned = beforeIf;
    }

    // Variables are definitely assigned if they're assigned in both branches
    const definitelyAssigned = new Set<string>();
    for (const varName of thenAssigned) {
      if (elseAssigned.has(varName)) {
        definitelyAssigned.add(varName);
      }
    }

    // Update the assignment state with definitely assigned variables
    for (const varName of definitelyAssigned) {
      assignedVars.add(varName);
    }
  }

  /**
   * Analyzes while statements
   */
  private analyzeWhileStatement(stmt: WhileStatement, assignedVars: Set<string>): void {
    // Analyze condition
    this.analyzeExpression(stmt.condition, assignedVars);

    // For while loops, we can't guarantee the body executes,
    // so we don't consider assignments in the body as definite
    const bodyAssigned = new Set(assignedVars);
    this.analyzeStatement(stmt.body, bodyAssigned);

    // Don't merge back assignments from the body since the loop might not execute
  }

  /**
   * Analyzes block statements
   */
  private analyzeBlockStatement(stmt: BlockStatement, assignedVars: Set<string>): void {
    for (const statement of stmt.body) {
      this.analyzeStatement(statement, assignedVars);
    }
  }

  /**
   * Gets all variables that are used but not definitely assigned
   */
  public getUnassignedUsages(statements: Statement[]): Array<{variableName: string, location: any}> {
    const unassignedUsages: Array<{variableName: string, location: any}> = [];
    const assignedVars = new Set<string>();

    for (const statement of statements) {
      this.findUnassignedUsages(statement, assignedVars, unassignedUsages);
    }

    return unassignedUsages;
  }

    /**
   * Recursively finds unassigned variable usages
   */
  private findUnassignedUsages(
    node: ASTNode, 
    assignedVars: Set<string>, 
    unassignedUsages: Array<{variableName: string, location: any}>
  ): void {
    switch (node.kind) {
      case 'variable':
        const decl = node as VariableDeclaration;
        if (decl.initializer) {
          this.findUnassignedUsages(decl.initializer, assignedVars, unassignedUsages);
          assignedVars.add(decl.identifier.name);
        }
        break;

      case 'binary':
        const binary = node as BinaryExpression;
        // Check if this is an assignment
        if (binary.operator === '=' || binary.operator === '+=' || binary.operator === '-=' || 
            binary.operator === '*=' || binary.operator === '/=' || binary.operator === '%=') {
          
          // For compound assignments (+=, -=, etc.), the left side is used before being assigned
          if (binary.operator !== '=' && binary.left.kind === 'identifier') {
            this.findUnassignedUsages(binary.left, assignedVars, unassignedUsages);
          }
          
          this.findUnassignedUsages(binary.right, assignedVars, unassignedUsages);
          if (binary.left.kind === 'identifier') {
            assignedVars.add((binary.left as Identifier).name);
          }
        } else {
          this.findUnassignedUsages(binary.left, assignedVars, unassignedUsages);
          this.findUnassignedUsages(binary.right, assignedVars, unassignedUsages);
        }
        break;

      case 'identifier':
        const id = node as Identifier;
        // Skip 'this' references - they are always available in instance methods
        if (id.name === 'this') {
          break;
        }
        if (!assignedVars.has(id.name)) {
          unassignedUsages.push({
            variableName: id.name,
            location: id.location || { line: 0, column: 0 }
          });
        }
        break;

      case 'if':
        const ifStmt = node as IfStatement;
        this.findUnassignedUsages(ifStmt.condition, assignedVars, unassignedUsages);
        
        // Clone current assignment state for each branch
        const thenAssigned = new Set(assignedVars);
        this.findUnassignedUsages(ifStmt.thenStatement, thenAssigned, unassignedUsages);
        
        let elseAssigned = new Set(assignedVars);
        if (ifStmt.elseStatement) {
          this.findUnassignedUsages(ifStmt.elseStatement, elseAssigned, unassignedUsages);
        }
        // If no else branch, elseAssigned remains the same as before the if
        
        // Variables are definitely assigned after the if only if they're assigned in both branches
        for (const varName of thenAssigned) {
          if (elseAssigned.has(varName)) {
            assignedVars.add(varName);
          }
        }
        break;

      case 'block':
        const block = node as BlockStatement;
        for (const stmt of block.body) {
          this.findUnassignedUsages(stmt, assignedVars, unassignedUsages);
        }
        break;

      case 'expression':
        const exprStmt = node as ExpressionStatement;
        this.findUnassignedUsages(exprStmt.expression, assignedVars, unassignedUsages);
        break;

      case 'call':
        const callExpr = node as CallExpression;
        if (callExpr.arguments) {
          for (const arg of callExpr.arguments) {
            this.findUnassignedUsages(arg, assignedVars, unassignedUsages);
          }
        }
        break;

      case 'member':
        const memberExpr = node as MemberExpression;
        // Only analyze the object if it's not a global/static reference
        // For things like Math.max, Color.Red, we don't want to check the base identifier
        if (memberExpr.object.kind === 'identifier') {
          const objName = (memberExpr.object as Identifier).name;
          // Skip known global objects and potential enum/class names (capitalized)
          if (!this.isGlobalReference(objName)) {
            this.findUnassignedUsages(memberExpr.object, assignedVars, unassignedUsages);
          }
        } else {
          this.findUnassignedUsages(memberExpr.object, assignedVars, unassignedUsages);
        }
        break;

      case 'unary':
        const unaryExpr = node as UnaryExpression;
        this.findUnassignedUsages(unaryExpr.operand, assignedVars, unassignedUsages);
        break;

      case 'return':
        const returnStmt = node as ReturnStatement;
        if (returnStmt.argument) {
          this.findUnassignedUsages(returnStmt.argument, assignedVars, unassignedUsages);
        }
        break;

      case 'typeGuard':
        const typeGuard = node as TypeGuardExpression;
        this.findUnassignedUsages(typeGuard.expression, assignedVars, unassignedUsages);
        break;

      case 'positionalObject':
        // For positional object expressions like Adult { age: 25 }, analyze the arguments
        const posObj = node as any; // Use any since PositionalObjectExpression isn't imported
        if (posObj.arguments) {
          for (const arg of posObj.arguments) {
            this.findUnassignedUsages(arg, assignedVars, unassignedUsages);
          }
        }
        break;
    }
  }

  /**
   * Clears all assignment state
   */
  public reset(): void {
    this.assignmentStates.clear();
    this.currentScope = 'global';
    this.scopeCounter = 0;
  }

  /**
   * Checks if an identifier refers to a global/static reference that doesn't need assignment
   */
  private isGlobalReference(name: string): boolean {
    // Known global objects
    const globalObjects = ['Math', 'Object', 'Array', 'String', 'Number', 'Date', 'console'];
    if (globalObjects.includes(name)) {
      return true;
    }
    
    // Assume capitalized identifiers are enum/class names (static references)
    if (name.length > 0 && name[0] === name[0].toUpperCase()) {
      return true;
    }
    
    return false;
  }
}
