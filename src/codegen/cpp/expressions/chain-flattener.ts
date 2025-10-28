import {
    Expression, OptionalChainExpression, CallExpression, Identifier, Literal, Type, UnionTypeNode
} from "../../../types";
import { generateExpression } from "../cpp-expression-codegen";
import { CppGenerator } from "../../cppgen";

export interface ChainOperation {
    type: 'property' | 'method';
    name: string;
    node: OptionalChainExpression;
    arguments?: Expression[];
}

export interface FlattenedChain {
    baseObject: Expression;
    operations: ChainOperation[];
}

let chainScopeCounter = 0;

function nextChainScopeId(): string {
    const id = chainScopeCounter;
    chainScopeCounter += 1;
    return id.toString(36);
}

/**
 * Detects if an expression is part of an optional chain that should be flattened
 */
export function shouldFlattenChain(expr: Expression): boolean {
    // If this is a CallExpression with OptionalChainExpression callee, check if it's chained
    if (expr.kind === 'call') {
        const call = expr as CallExpression;
        if (call.callee.kind === 'optionalChain') {
            return true; // Always flatten method calls
        }
    }
    
    // If this is an OptionalChainExpression, check if its object is also a chain
    if (expr.kind === 'optionalChain') {
        const optChain = expr as OptionalChainExpression;
        return isChainableExpression(optChain.object);
    }
    
    return false;
}

/**
 * Checks if an expression can be part of a chain
 */
function isChainableExpression(expr: Expression): boolean {
    return expr.kind === 'optionalChain' || 
           (expr.kind === 'call' && (expr as CallExpression).callee.kind === 'optionalChain');
}

/**
 * Flattens an optional chain expression into a sequence of operations
 */
export function flattenOptionalChain(expr: Expression): FlattenedChain | null {
    const operations: ChainOperation[] = [];
    let current = expr;
    
    // Walk up the chain collecting operations in reverse order
    while (true) {
        if (current.kind === 'call') {
            const call = current as CallExpression;
            if (call.callee.kind === 'optionalChain') {
                const optChain = call.callee as OptionalChainExpression;
                if (!optChain.property) {
                    return null;
                }
                operations.unshift({
                    type: 'method',
                    name: getPropertyName(optChain.property),
                    node: optChain,
                    arguments: call.arguments
                });
                current = optChain.object;
            } else {
                break;
            }
        } else if (current.kind === 'optionalChain') {
            const optChain = current as OptionalChainExpression;
            if (!optChain.property) {
                return null;
            }
            if (optChain.isMethodCall) {
                operations.unshift({
                    type: 'method',
                    name: getPropertyName(optChain.property),
                    node: optChain,
                    arguments: []
                });
            } else {
                operations.unshift({
                    type: 'property',
                    name: getPropertyName(optChain.property),
                    node: optChain
                });
            }
            current = optChain.object;
        } else {
            break;
        }
    }
    
    if (operations.length === 0) {
        return null;
    }
    
    return {
        baseObject: current,
        operations
    };
}

/**
 * Generates efficient C++ code for a flattened chain using lambda pattern
 */
export function generateFlattenedChain(generator: CppGenerator, chain: FlattenedChain): string {
    const baseObj = generateExpression(generator, chain.baseObject);
    const scopeId = nextChainScopeId();
    const tempPrefix = `temp_${scopeId}`;
    const lastOp = chain.operations[chain.operations.length - 1];
    
    if (chain.operations.length === 1) {
        // Single operation - use simple conditional
        const op = chain.operations[0];
        if (op.type === 'property') {
            return `(${baseObj} ? std::make_optional(${baseObj}->${op.name}) : std::nullopt)`;
        } else {
            const args = op.arguments?.map(arg => generateExpression(generator, arg)).join(', ') || '';
            // For method calls that return shared_ptr (like Calculator methods), don't wrap in optional
            return `(${baseObj} ? ${baseObj}->${op.name}(${args}) : nullptr)`;
        }
    }
    
    // Multiple operations - use lambda for efficiency
    let lambdaBody = `    if (!${baseObj}) return std::nullopt;\n`;
    let currentVar = baseObj;
    
    for (let i = 0; i < chain.operations.length; i++) {
        const op = chain.operations[i];
        const isLast = i === chain.operations.length - 1;
        
        if (op.type === 'property') {
            if (isLast) {
                lambdaBody += `    return std::make_optional(${currentVar}->${op.name});\n`;
            } else {
                const nextVar = `${tempPrefix}_${i + 1}`;
                lambdaBody += `    auto ${nextVar} = ${currentVar}->${op.name};\n`;
                lambdaBody += `    if (!${nextVar}) return std::nullopt;\n`;
                currentVar = nextVar;
            }
        } else if (op.type === 'method') {
            const args = op.arguments?.map(arg => generateExpression(generator, arg)).join(', ') || '';
            if (isLast) {
                lambdaBody += `    return ${currentVar}->${op.name}(${args});\n`;
            } else {
                const nextVar = `${tempPrefix}_${i + 1}`;
                lambdaBody += `    auto ${nextVar} = ${currentVar}->${op.name}(${args});\n`;
                lambdaBody += `    if (!${nextVar}) return std::nullopt;\n`;
                currentVar = nextVar;
            }
        }
    }
    
    if (lastOp.type === 'method') {
        return `[&]() {\n${lambdaBody}}()`;
    } else {
        return `[&]() -> std::optional<std::string> {\n${lambdaBody}}()`;
    }
}

/**
 * Generates a flattened chain with null coalescing built-in to avoid double evaluation
 */
export function generateFlattenedChainWithCoalescing(generator: CppGenerator, chain: FlattenedChain, fallbackValue: string): string {
    const baseObj = generateExpression(generator, chain.baseObject);
    const lastOp = chain.operations[chain.operations.length - 1];
    const scopeId = nextChainScopeId();
    const tempPrefix = `temp_${scopeId}`;
    const resultType = lastOp.node.inferredType;
    const isStringChain = isStringLikeType(resultType) || fallbackValue.startsWith('"');
    
    if (chain.operations.length === 1) {
        // Single operation - use simple conditional with coalescing
        const op = chain.operations[0];
        if (op.type === 'property') {
            // For properties that might be optional, handle appropriately
            if (isStringChain) {
                // String fallback - use value_or 
                return `(${baseObj} ? ${baseObj}->${op.name}.value_or(${fallbackValue}) : ${fallbackValue})`;
            } else {
                // Non-string fallback - direct access
                return `(${baseObj} ? ${baseObj}->${op.name} : ${fallbackValue})`;
            }
        } else {
            const args = op.arguments?.map(arg => generateExpression(generator, arg)).join(', ') || '';
            return `(${baseObj} ? ${baseObj}->${op.name}(${args}) : ${fallbackValue})`;
        }
    }
    
    // Multiple operations - use lambda with built-in coalescing
    const castFallback = isStringChain ? `std::string(${fallbackValue})` : fallbackValue;
    
    let lambdaBody = `    if (!${baseObj}) return ${castFallback};\n`;
    let currentVar = baseObj;
    
    for (let i = 0; i < chain.operations.length; i++) {
        const op = chain.operations[i];
        const isLast = i === chain.operations.length - 1;
        
        if (op.type === 'property') {
            if (isLast) {
                // For final property access, handle based on fallback type
                if (isStringChain) {
                    // String fallback - use value_or with proper casting
                    lambdaBody += `    return ${currentVar}->${op.name}.value_or(std::string(${fallbackValue}));\n`;
                } else {
                    // Non-string fallback - direct access
                    lambdaBody += `    return ${currentVar}->${op.name};\n`;
                }
            } else {
                const nextVar = `${tempPrefix}_${i + 1}`;
                lambdaBody += `    auto ${nextVar} = ${currentVar}->${op.name};\n`;
                lambdaBody += `    if (!${nextVar}) return ${castFallback};\n`;
                currentVar = nextVar;
            }
        } else if (op.type === 'method') {
            const args = op.arguments?.map(arg => generateExpression(generator, arg)).join(', ') || '';
            if (isLast) {
                lambdaBody += `    return ${currentVar}->${op.name}(${args});\n`;
            } else {
                const nextVar = `${tempPrefix}_${i + 1}`;
                lambdaBody += `    auto ${nextVar} = ${currentVar}->${op.name}(${args});\n`;
                lambdaBody += `    if (!${nextVar}) return ${castFallback};\n`;
                currentVar = nextVar;
            }
        }
    }
    
    return `[&]() {\n${lambdaBody}}()`;
}

/**
 * Gets property name from Identifier or Literal
 */
function getPropertyName(property: Identifier | Literal | undefined): string {
    if (!property) {
        throw new Error('Optional chain segment is missing a property name');
    }
    if (property.kind === 'identifier') {
        return property.name;
    } else if (property.kind === 'literal' && property.literalType === 'string') {
        return String(property.value);
    } else {
        throw new Error(`Unsupported property type: ${property.kind}`);
    }
}

function isStringLikeType(type: Type | undefined): boolean {
    if (!type) {
        return false;
    }
    if (type.kind === 'primitive') {
        return type.type === 'string';
    }
    if (type.kind === 'union') {
        const unionType = type as UnionTypeNode;
        return unionType.types.some(member => isStringLikeType(member));
    }
    return false;
}