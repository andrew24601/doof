import {
    Expression, Type, Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression,
    CallExpression, MemberExpression, IndexExpression, ArrayExpression, ObjectExpression,
    PositionalObjectExpression, SetExpression, TupleExpression, LambdaExpression, TrailingLambdaExpression,
    InterpolatedString, TypeGuardExpression,
    EnumShorthandMemberExpression, EnumTypeNode, NullCoalesceExpression, OptionalChainExpression,
    NonNullAssertionExpression, PrimitiveTypeNode, UnionTypeNode, ClassTypeNode, MapTypeNode,
    ArrayTypeNode, SetTypeNode, ExternClassDeclaration, ClassDeclaration, ObjectProperty,
    BlockStatement, VariableDeclaration, ExternClassTypeNode, FunctionTypeNode, Parameter,
    Statement, FieldDeclaration, MethodDeclaration, ValidationContext, FunctionDeclaration,
    RangeExpression
} from "../../types";
import { getExpressionId } from "../../type-utils";
import { CppGenerator } from "../cppgen";

// Import all the expression generator modules
import {
    generateLiteral,
    generateIdentifier,
    generateEnumShorthand,
    inferTypeFromExpression
} from "./expressions/literal-identifier-generators";
import {
    generateBinaryExpression,
    generateUnaryExpression
} from "./expressions/binary-unary-generators";
import {
    generateArrayExpression,
    generateObjectExpression,
    generatePositionalObjectExpression,
    generateSetExpression
} from "./expressions/object-array-generators";
import {
    generateCallExpression,
    generateMemberExpression,
    generateIndexExpression
} from "./expressions/method-call-generators";
import {
    generateLambdaExpression,
    generateTrailingLambdaExpression,
    generateConditionalExpression,
    generateTypeGuardExpression
} from "./expressions/lambda-control-flow-generators";
import {
    generateInterpolatedString,
    generateNullCoalesceExpression,
    generateOptionalChainExpression,
    generateNonNullAssertionExpression,
    generateUniqueVariable
} from "./expressions/utility-special-generators";

export interface ExpressionContext {
    targetType?: Type;
    isReturnContext?: boolean;
    isAssignmentRhs?: boolean;
    needsSharedPtr?: boolean;
    capturedAccessMode?: 'value' | 'storage';
}

export function generateExpression(generator: CppGenerator, expr: Expression, context?: ExpressionContext): string {
    return generateExpressionWithContext(generator, expr, context);
}

export function generateExpressionWithContext(generator: CppGenerator, expr: Expression, context?: ExpressionContext): string {
    let result: string;

    switch (expr.kind) {
        case 'literal':
            result = generateLiteral(generator, expr as Literal, context?.targetType);
            break;
        case 'identifier':
            result = generateIdentifier(generator, expr, context);
            break;
        case 'binary':
            result = generateBinaryExpression(generator, expr as BinaryExpression, context?.targetType);
            break;
        case 'unary':
            result = generateUnaryExpression(generator, expr as UnaryExpression, context?.targetType);
            break;
        case 'conditional':
            result = generateConditionalExpression(generator, expr);
            break;
        case 'call':
            result = generateCallExpression(generator, expr as CallExpression, context?.targetType, context);
            break;
        case 'member':
            result = generateMemberExpression(generator, expr);
            break;
        case 'index':
            result = generateIndexExpression(generator, expr);
            break;
        case 'array':
            result = generateArrayExpression(generator, expr as ArrayExpression);
            break;
        case 'object':
            result = generateObjectExpression(generator, expr, context?.targetType);
            break;
        case 'positionalObject':
            result = generatePositionalObjectExpression(generator, expr);
            break;
        case 'tuple':
            // Tuple expressions are converted to positional object expressions during validation
            // Generate as positional object with inferred target type
            result = generateTupleExpression(generator, expr);
            break;
        case 'set':
            result = generateSetExpression(generator, expr);
            break;
        case 'lambda':
            result = generateLambdaExpression(generator, expr as LambdaExpression);
            break;
        case 'trailingLambda':
            result = generateTrailingLambdaExpression(generator, expr as TrailingLambdaExpression);
            break;
        case 'interpolated-string':
            result = generateInterpolatedString(generator, expr);
            break;
        case 'typeGuard':
            result = generateTypeGuardExpression(generator, expr);
            break;
        case 'enumShorthand':
            const shorthandExpr = expr as EnumShorthandMemberExpression;
            if (shorthandExpr.inferredType && shorthandExpr.inferredType.kind === 'enum') {
                const enumType = shorthandExpr.inferredType as EnumTypeNode;
                result = `${enumType.name}::${shorthandExpr.memberName}`;
                break;
            }
            throw new Error(`Enum shorthand .${shorthandExpr.memberName} cannot be resolved without context`);
        case 'nullCoalesce':
            result = generateNullCoalesceExpression(generator, expr as NullCoalesceExpression);
            break;
        case 'optionalChain':
            result = generateOptionalChainExpression(generator, expr as OptionalChainExpression);
            break;
        case 'nonNullAssertion':
            result = generateNonNullAssertionExpression(generator, expr as NonNullAssertionExpression);
            break;
        case 'range':
            // Range expressions are handled in for-of statements
            throw new Error('Range expressions should not be generated directly');
        case 'xmlCall':
            // Delegate to normalized call synthesized by validator
            const xml: any = expr;
            if (xml.normalizedCall) {
                result = generateCallExpression(generator, xml.normalizedCall as CallExpression, context?.targetType, context);
                break;
            }
            throw new Error('XmlCall expression missing normalizedCall during C++ codegen');
        default:
            // Add type assertion to help TypeScript narrow the type
            const exhaustiveCheck: never = expr;
            throw new Error(`Unsupported expression kind: ${(exhaustiveCheck as any).kind}`);
    }

    // Apply reverse type inference/casting if target type is specified
    if (context?.targetType && context.targetType.kind === 'primitive') {
        const targetPrim = context.targetType as PrimitiveTypeNode;
        const exprType = expr.inferredType ?? context.targetType ?? inferTypeFromExpression(generator, expr);

        if (exprType.kind === 'primitive') {
            const exprPrim = exprType as PrimitiveTypeNode;

            // Apply casting if types don't match and the result doesn't already have casting
            if (targetPrim.type !== exprPrim.type && !result.includes('static_cast')) {
                // Don't cast if types are compatible or if this is a simple return context
                const isCompatible = areTypesCompatible(exprPrim.type, targetPrim.type);

                if (!isCompatible) {
                    // For literals, try to generate idiomatic C++ instead of casting
                    if (expr.kind === 'literal') {
                        const literal = expr as Literal;
                        if (literal.literalType === 'number' && targetPrim.type === 'float') {
                            if (!result.includes('f') && !result.includes('.')) {
                                result = result + '.0f';
                            } else if (!result.includes('f')) {
                                result = result + 'f';
                            }
                        } else if (literal.literalType === 'number' && targetPrim.type === 'double') {
                            if (!result.includes('.')) {
                                result = result + '.0';
                            }
                        } else if (literal.literalType === 'number' && targetPrim.type === 'int') {
                            // For literals going to int from double/float, we need explicit casting
                            result = `static_cast<${targetPrim.type}>(${result})`;
                        } else if (context?.isAssignmentRhs) {
                            // For other literal type mismatches in assignments
                            result = `static_cast<${targetPrim.type}>(${result})`;
                        }
                    } else if (context?.isAssignmentRhs) {
                        // Only cast for explicit assignments where types truly don't match
                        result = `static_cast<${targetPrim.type}>(${result})`;
                    }
                }
            }
        }
    }

    return result;
}

function areTypesCompatible(sourceType: string, targetType: string): boolean {
    // Same types are always compatible
    if (sourceType === targetType) {
        return true;
    }

    // Compatible numeric types that don't need explicit casting in returns
    const compatibleTypes = [
        ['int', 'number'],  // int and number are often used interchangeably
        ['float', 'number'],
        ['double', 'number'],
        ['float', 'double'],  // float can be implicitly converted to double
    ];

    return compatibleTypes.some(([source, target]) =>
        (sourceType === source && targetType === target) ||
        (sourceType === target && targetType === source)
    );
}

function generateTupleExpression(generator: any, expr: TupleExpression): string {
    // Get the inferred target type
    const targetType = (expr as any)._inferredTargetType || expr.inferredType;
    
    if (!targetType || (targetType.kind !== 'class' && targetType.kind !== 'externClass')) {
        throw new Error('Tuple expression must have a class or extern class target type');
    }
    
    const typeName = (targetType as any).name;
    
    // Generate arguments
    const args = expr.elements.map(arg => generateExpression(generator, arg)).join(', ');
    
    // Generate the same code as positional object construction
    return `${typeName}(${args})`;
}
