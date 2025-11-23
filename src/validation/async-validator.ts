import { 
    Type, FunctionDeclaration, ValidationContext, ClassDeclaration, 
    Statement, Expression, ASTNode, Identifier, CallExpression 
} from '../types';

export function isImmutable(type: Type, context: ValidationContext): boolean {
    switch (type.kind) {
        case 'primitive':
            return true;
        case 'class': {
            const classDecl = context.classes.get(type.name);
            if (!classDecl) return false;
            return isClassImmutable(classDecl, context);
        }
        case 'externClass':
             // Extern classes are assumed mutable unless we know otherwise.
             return false;
        case 'array':
            return !!type.isReadonly && isImmutable(type.elementType, context);
        case 'map':
            return !!type.isReadonly && isImmutable(type.keyType, context) && isImmutable(type.valueType, context);
        case 'set':
            return !!type.isReadonly && isImmutable(type.elementType, context);
        case 'enum':
            return true;
        case 'union':
            return type.types.every(t => isImmutable(t, context));
        case 'typeAlias':
             const alias = context.typeAliases.get(type.name);
             if (!alias) return false;
             return isImmutable(alias.type, context);
        case 'function':
            return true; // Functions are immutable (code)
        case 'unknown':
            return false;
        default:
            return false;
    }
}

const immutableClassCache = new Map<string, boolean>();

function isClassImmutable(classDecl: ClassDeclaration, context: ValidationContext): boolean {
    if (immutableClassCache.has(classDecl.name.name)) {
        return immutableClassCache.get(classDecl.name.name)!;
    }
    
    // Break recursion by assuming true initially
    immutableClassCache.set(classDecl.name.name, true);
    
    for (const field of classDecl.fields) {
        if (!field.isReadonly && !field.isConst) {
            immutableClassCache.set(classDecl.name.name, false);
            return false;
        }
        if (!isImmutable(field.type, context)) {
            immutableClassCache.set(classDecl.name.name, false);
            return false;
        }
    }
    
    return true;
}

const isolatedFunctionCache = new Map<string, boolean>();

export function isIsolated(func: FunctionDeclaration, context: ValidationContext): boolean {
    if (isolatedFunctionCache.has(func.name.name)) {
        return isolatedFunctionCache.get(func.name.name)!;
    }
    
    // Assume isolated to handle recursion
    isolatedFunctionCache.set(func.name.name, true);
    
    const isSafe = checkBlockIsolation(func.body, context);
    
    isolatedFunctionCache.set(func.name.name, isSafe);
    return isSafe;
}

function checkBlockIsolation(block: Statement, context: ValidationContext): boolean {
    if (block.kind === 'block') {
        for (const stmt of block.body) {
            if (!checkStatementIsolation(stmt, context)) return false;
        }
        return true;
    }
    return checkStatementIsolation(block, context);
}

function checkStatementIsolation(stmt: Statement, context: ValidationContext): boolean {
    switch (stmt.kind) {
        case 'variable':
            if (stmt.initializer && !checkExpressionIsolation(stmt.initializer, context)) return false;
            return true;
        case 'expression':
            return checkExpressionIsolation(stmt.expression, context);
        case 'return':
            if (stmt.argument && !checkExpressionIsolation(stmt.argument, context)) return false;
            return true;
        case 'if':
            if (!checkExpressionIsolation(stmt.condition, context)) return false;
            if (!checkStatementIsolation(stmt.thenStatement, context)) return false;
            if (stmt.elseStatement && !checkStatementIsolation(stmt.elseStatement, context)) return false;
            return true;
        case 'while':
            if (!checkExpressionIsolation(stmt.condition, context)) return false;
            return checkStatementIsolation(stmt.body, context);
        case 'for':
            if (stmt.init && stmt.init.kind === 'variable' && !checkStatementIsolation(stmt.init, context)) return false;
            if (stmt.init && stmt.init.kind !== 'variable' && !checkExpressionIsolation(stmt.init as Expression, context)) return false;
            if (stmt.condition && !checkExpressionIsolation(stmt.condition, context)) return false;
            if (stmt.update && !checkExpressionIsolation(stmt.update, context)) return false;
            return checkStatementIsolation(stmt.body, context);
        case 'block':
            return checkBlockIsolation(stmt, context);
        // TODO: Handle other statements
        default:
            return true;
    }
}

function checkExpressionIsolation(expr: Expression, context: ValidationContext): boolean {
    switch (expr.kind) {
        case 'identifier':
            // Check if identifier refers to a mutable global
            // This is hard without full resolution info attached to AST.
            // We assume that if it's a global variable, it must be const.
            // If we can't verify, we might be conservative.
            
            // For now, we'll assume identifiers are safe unless we know they are mutable globals.
            // In a real implementation, we'd check the symbol table.
            return true; 
            
        case 'call':
            // Check if callee is isolated
            if (expr.callee.kind === 'identifier') {
                const funcName = expr.callee.name;
                const funcDecl = context.functions.get(funcName);
                if (funcDecl) {
                    if (!isIsolated(funcDecl, context)) return false;
                }
            }
            
            for (const arg of expr.arguments) {
                if (!checkExpressionIsolation(arg, context)) return false;
            }
            return true;
            
        case 'binary':
            return checkExpressionIsolation(expr.left, context) && checkExpressionIsolation(expr.right, context);
        case 'unary':
            return checkExpressionIsolation(expr.operand, context);
        case 'member':
            return checkExpressionIsolation(expr.object, context);
        // ... recurse for other expressions
        default:
            return true;
    }
}
