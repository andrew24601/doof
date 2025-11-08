// JavaScript expression code generation functions for doof

import { isStringType } from '../../type-utils';
import {
    Expression, Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression, CallExpression,
    MemberExpression, IndexExpression, ArrayExpression, ObjectExpression, PositionalObjectExpression, TupleExpression, SetExpression,
    LambdaExpression, RangeExpression, TrailingLambdaExpression,
    TypeGuardExpression, InterpolatedString, PrimitiveTypeNode, BlockStatement, Type,
    ValidationContext, MethodDeclaration, ClassDeclaration, Parameter,
    NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression,
    EnumShorthandMemberExpression
} from '../../types';
import { generateJsTypeConversionCall } from './expressions/js-type-conversion-generators';

// Forward declaration for JsGenerator type
export interface JsGeneratorInterface {
    generateExpression(expr: Expression): string;
    generateStatement(stmt: any): string;
    generateParameter(param: Parameter): string;
    encodeJsFieldName(fieldName: string): string;
    getJsFieldName(field: { name: { name: string } }): string;
    indent(): string;
    indentLevel: number;
    currentClass?: ClassDeclaration;
    currentMethod?: MethodDeclaration;
    validationContext?: ValidationContext;
    globalContext?: any;
}

export function generateExpression(generator: JsGeneratorInterface, expr: Expression): string {
    switch (expr.kind) {
        case 'literal':
            return generateLiteral(generator, expr as Literal);
        case 'identifier':
            return generateIdentifier(generator, expr as Identifier);
        case 'binary':
            return generateBinaryExpression(generator, expr as BinaryExpression);
        case 'unary':
            return generateUnaryExpression(generator, expr as UnaryExpression);
        case 'conditional':
            return generateConditionalExpression(generator, expr as ConditionalExpression);
        case 'call':
            return generateCallExpression(generator, expr as CallExpression);
        case 'member':
            return generateMemberExpression(generator, expr as MemberExpression);
        case 'index':
            return generateIndexExpression(generator, expr as IndexExpression);
        case 'array':
            return generateArrayExpression(generator, expr as ArrayExpression);
        case 'object':
            return generateObjectExpression(generator, expr as ObjectExpression);
        case 'positionalObject':
            return generatePositionalObjectExpression(generator, expr as PositionalObjectExpression);
        case 'tuple':
            return generateTupleExpression(generator, expr as TupleExpression);
        case 'set':
            return generateSetExpression(generator, expr as SetExpression);
        case 'lambda':
            return generateLambdaExpression(generator, expr as LambdaExpression);
        case 'interpolated-string':
            return generateInterpolatedString(generator, expr as InterpolatedString);
        case 'trailingLambda':
            return generateTrailingLambdaExpression(generator, expr as TrailingLambdaExpression);
        case 'typeGuard':
            return generateTypeGuardExpression(generator, expr as TypeGuardExpression);
        case 'range':
            return generateRangeExpression(generator, expr as RangeExpression);
        case 'nullCoalesce':
            return generateNullCoalesceExpression(generator, expr as NullCoalesceExpression);
        case 'optionalChain':
            return generateOptionalChainExpression(generator, expr as OptionalChainExpression);
        case 'nonNullAssertion':
            return generateNonNullAssertionExpression(generator, expr as NonNullAssertionExpression);
        case 'enumShorthand':
            return generateEnumShorthandExpression(expr as EnumShorthandMemberExpression);
        case 'xmlCall': {
            const xml: any = expr;
            if (xml.normalizedCall) {
                // normalizedCall may be an object literal (class construction) or a call
                return generateExpression(generator as any, xml.normalizedCall as Expression);
            }
            throw new Error('XmlCall expression missing normalizedCall during JS codegen');
        }
        default:
            throw new Error(`Unsupported expression kind: ${(expr as any).kind}`);
    }
}

export function generateIdentifier(generator: JsGeneratorInterface, identifier: Identifier): string {
    const name = identifier.name;
    const scopeInfo = identifier.scopeInfo;
    const member = identifier.resolvedMember || (scopeInfo?.isClassMember ? {
        className: scopeInfo.declaringClass,
        memberName: name,
        kind: scopeInfo.scopeKind === 'method' ? 'method' : 'field'
    } : undefined);

    if (member) {
        const className = member.className || generator.currentClass?.name.name;
        if (!className) {
            throw new Error(`Missing class metadata for member '${member.memberName}'`);
        }

        const encodedName = generator.encodeJsFieldName(member.memberName);

        let isStatic: boolean | undefined = scopeInfo?.isStaticMember;
        if (isStatic === undefined && generator.validationContext?.classes.has(className)) {
            const classDecl = generator.validationContext.classes.get(className)!;
            if (member.kind === 'field') {
                const fieldDecl = classDecl.fields.find(f => f.name.name === member.memberName);
                if (fieldDecl) {
                    isStatic = fieldDecl.isStatic;
                }
            } else if (member.kind === 'method') {
                const methodDecl = classDecl.methods.find(m => m.name.name === member.memberName);
                if (methodDecl) {
                    isStatic = methodDecl.isStatic;
                }
            }
        }

        if (member.kind === 'method') {
            if (isStatic === undefined) {
                throw new Error(`Unable to determine if method '${className}.${member.memberName}' is static`);
            }
            if (isStatic) {
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(encodedName)) {
                    return `${className}.${encodedName}`;
                }
                return `${className}["${encodedName}"]`;
            }
            return `this.${encodedName}`;
        }

        if (member.kind === 'field') {
            if (isStatic === undefined) {
                throw new Error(`Unable to determine if field '${className}.${member.memberName}' is static`);
            }

            if (isStatic) {
                if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(encodedName)) {
                    return `${className}.${encodedName}`;
                }
                return `${className}["${encodedName}"]`;
            }

            return `this.${encodedName}`;
        }

        throw new Error(`Unsupported member kind '${member.kind}' for identifier '${identifier.name}'`);
    }

    if (scopeInfo?.needsThisPrefix) {
        return `this.${generator.encodeJsFieldName(name)}`;
    }

    if (scopeInfo?.isParameter || scopeInfo?.isLocalVariable || scopeInfo?.isImported || scopeInfo?.isGlobalFunction) {
        return name;
    }

    if (generator.currentClass && generator.currentMethod) {
        const className = generator.currentClass.name.name;
        const methodName = generator.currentMethod.name.name;
        const isParameter = generator.currentMethod.parameters.some(p => p.name.name === name);

        if (!isParameter) {
            const matchesField = generator.currentClass.fields.some(f => f.name.name === name);
            const matchesMethod = generator.currentClass.methods.some(m => m.name.name === name);

            if (matchesField || matchesMethod) {
                const memberKind = matchesField ? 'field' : 'method';
                throw new Error(
                    `Missing scope metadata for ${memberKind} '${className}.${name}' while generating identifier inside '${className}.${methodName}'`
                );
            }
        }
    }

    return name;
}

export function generateLiteral(generator: JsGeneratorInterface, literal: Literal): string {
    switch (literal.literalType) {
        case 'string':
            return JSON.stringify(literal.value);
        case 'number':
            return literal.value?.toString() || '0';
        case 'boolean':
            return literal.value?.toString() || 'false';
        case 'null':
            return 'null';
        case 'char':
            return JSON.stringify(literal.value);
        default:
            return literal.value?.toString() || 'null';
    }
}

/**
 * Generates JavaScript code for string concatenation
 */
export function generateStringConcatenation(generator: JsGeneratorInterface, expr: BinaryExpression): string {
    const processOperand = (operand: Expression): string => {
        // Check if operand is a class instance - if so, use JSON.stringify
        const operandType = operand.inferredType;
        if (operandType && operandType.kind === 'class') {
            const innerCode = generator.generateExpression(operand);
            return `JSON.stringify(${innerCode})`;
        }
        
        // If operand is a numeric binary operation that should be evaluated first,
        // we need to wrap it in parentheses and possibly String() for clarity
        if (operand.kind === 'binary' && operand.operator === '+' &&
            !isStringType(operand.inferredType!)) {
            const innerCode = generator.generateExpression(operand);
            // Only use String() when we have numeric operations followed by string concatenation
            // This matches the test expectation for "1 + 2 + ' items'" -> "String((1 + 2)) + ' items'"
            // Note: generateExpression already adds parentheses for binary expressions
            return `String(${innerCode})`;
        }

        // For all other cases, rely on JavaScript's implicit conversion
        return generator.generateExpression(operand);
    };

    // Handle left operand - if it's also a string concatenation, expand it
    let leftCode: string;
    if (expr.left.kind === 'binary' && expr.left.operator === '+' && isStringType(expr.left.inferredType!)) {
        leftCode = generateStringConcatenation(generator, expr.left);
    } else {
        leftCode = processOperand(expr.left);
    }

    const rightCode = processOperand(expr.right);

    return `(${leftCode} + ${rightCode})`;
}

export function generateBinaryExpression(generator: JsGeneratorInterface, expr: BinaryExpression): string {
    // Handle string concatenation if flagged during validation
    if (expr.operator === '+' && isStringType(expr.inferredType!)) {
        return generateStringConcatenation(generator, expr);
    }

    const left = generator.generateExpression(expr.left);
    const right = generator.generateExpression(expr.right);

    // Handle assignment operators without extra parentheses
    if (expr.operator === '=') {
        // Special handling for map assignments: map[key] = value -> map.set(key, value)
        if (expr.left.kind === 'index') {
            const indexExpr = expr.left as IndexExpression;
            if (indexExpr.object.inferredType?.kind === 'map') {
                const object = generator.generateExpression(indexExpr.object);
                const key = generator.generateExpression(indexExpr.index);
                return `${object}.set(${key}, ${right})`;
            }
        }
        return `${left} = ${right}`;
    }

    // Handle special operators
    switch (expr.operator) {
        case '**':
            return `Math.pow(${left}, ${right})`;
        case '??':
            return `(${left} ?? ${right})`;
        default:
            return `(${left} ${expr.operator} ${right})`;
    }
}

export function generateUnaryExpression(generator: JsGeneratorInterface, expr: UnaryExpression): string {
    const operand = generator.generateExpression(expr.operand);

    // Handle postfix operators
    if (expr.operator === '++_post' || expr.operator === '--_post') {
        const op = expr.operator.replace('_post', '');
        return `${operand}${op}`;
    }

    // Handle prefix operators
    return `${expr.operator}${operand}`;
}

export function generateConditionalExpression(generator: JsGeneratorInterface, expr: ConditionalExpression): string {
    const test = generator.generateExpression(expr.test);
    const consequent = generator.generateExpression(expr.consequent);
    const alternate = generator.generateExpression(expr.alternate);
    return `(${test} ? ${consequent} : ${alternate})`;
}

export function generateCallExpression(generator: JsGeneratorInterface, expr: CallExpression): string {
    // Check for type conversion functions first
    if (expr.typeConversionInfo || expr.enumConversionInfo) {
        return generateJsTypeConversionCall(generator, expr);
    }

    const dispatchInfo = expr.callInfo ?? expr.callInfoSnapshot;

    if (dispatchInfo) {
        switch (dispatchInfo.kind) {
            case 'intrinsic':
                // Handle intrinsic function calls (println, print, panic, etc.)
                if (expr.callee.kind === 'identifier') {
                    const funcName = dispatchInfo.targetName!;
                    return generateJsIntrinsicFunctionCall(generator, funcName, expr.arguments);
                } else if (expr.callee.kind === 'member' && expr.intrinsicInfo) {
                    // Handle intrinsic method calls like StringBuilder.append()
                    const memberExpr = expr.callee as MemberExpression;
                    const objectExpr = generator.generateExpression(memberExpr.object);
                    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                    
                    // Use the target name for JS method calls
                    const methodName = dispatchInfo.targetName!;
                    return `${objectExpr}.${methodName}(${args})`;
                }
                break;

            case 'staticMethod':
                {
                    // Static method call: Counter.getCount()
                    const className = dispatchInfo.className!;
                    const methodName = dispatchInfo.targetName!;
                    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                    return `${className}.${methodName}(${args})`;
                }

            case 'instanceMethod':
                if (dispatchInfo.methodType === 'class') {
                    // Instance method call: counter1.getId()
                    const memberExpr = expr.callee as MemberExpression;
                    const object = generator.generateExpression(memberExpr.object);
                    const methodName = dispatchInfo.targetName!;
                    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                    return `${object}.${methodName}(${args})`;
                }
                break;

            case 'unionMethod':
                {
                    const memberExpr = expr.callee as MemberExpression;
                    const object = generator.generateExpression(memberExpr.object);
                    const methodName = dispatchInfo.targetName!;
                    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                    return `${object}.${methodName}(${args})`;
                }

            case 'collectionMethod':
                {
                    // Collection method call: map.get(key), array.push(item), etc.
                    const collectionMemberExpr = expr.callee as MemberExpression;
                    const object = generator.generateExpression(collectionMemberExpr.object);
                    const methodName = dispatchInfo.targetName!;
                    const argExpressions = expr.arguments.map(arg => generator.generateExpression(arg));

                    if (methodName === 'reduce') {
                        if (argExpressions.length !== 2) {
                            throw new Error(`Array.reduce() requires exactly 2 arguments (initial value, reducer function), got ${argExpressions.length}`);
                        }
                        const [initialValueExpr, reducerExpr] = argExpressions;
                        return `${object}.reduce(${reducerExpr}, ${initialValueExpr})`;
                    }

                    // JS collections map directly to native JS methods
                    const args = argExpressions.join(', ');
                    return `${object}.${methodName}(${args})`;
                }

            case 'function':
                {
                    // User-defined function call
                    if (expr.callee.kind === 'identifier') {
                        const funcName = dispatchInfo.targetName!;
                        const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                        return `${funcName}(${args})`;
                    }
                    break;
                }

            case 'constructor':
                // Constructor calls should be converted to positional object expressions during validation
                throw new Error("Constructor calls should be converted to positional object expressions during validation");

            case 'lambda':
                {
                    // Lambda invocation - generate the callee expression and call it
                    const calleeExpr = generator.generateExpression(expr.callee);
                    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
                    return `${calleeExpr}(${args})`;
                }
        }
    }

    const calleeType = expr.callee.inferredType;
    if (calleeType?.kind === 'function' || expr.callee.kind === 'lambda' || expr.callee.kind === 'trailingLambda') {
        const calleeExpr = generator.generateExpression(expr.callee);
        const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
        return `${calleeExpr}(${args})`;
    }

    const location = expr.location?.start
        ? `${expr.location.start.line}:${expr.location.start.column}`
        : 'unknown location';
    throw new Error(`Missing call dispatch metadata for call expression at ${location}`);
}

/**
 * Generate intrinsic function calls for JS backend
 */
function generateJsIntrinsicFunctionCall(generator: JsGeneratorInterface, funcName: string, args: Expression[]): string {
    if (funcName === 'println') {
        if (args.length === 1) {
            const arg = args[0];
            const argExpr = generator.generateExpression(arg);
            const argType = arg.inferredType;

            // For primitives, print directly to match unit test expectations
            if (argType && argType.kind === 'primitive') {
                return `console.log(${argExpr})`;
            }

            // For enum values, print their member label (string) or map numeric to label if needed
            if (argType && argType.kind === 'enum') {
                // Convert backing value (number or string) to label using enum.__labels reverse map if numeric
                // Detection: if backing value is a number at runtime, map it; else print directly
                const enumName = argType.name;
                return `console.log(${enumName}.__labels.get(${argExpr}) ?? ${argExpr})`;
            }

            // For arrays, maps, sets, classes, or unknown objects, normalize to JSON
            if (argType && (argType.kind === 'array' || argType.kind === 'map' || argType.kind === 'set' || argType.kind === 'class')) {
                return `console.log(JSON.stringify(__doof_toJson(${argExpr})))`;
            }

            // Fallback: print as-is for other types
            return `console.log(${argExpr})`;
        } else {
            const argExprs = args.map(arg => generator.generateExpression(arg)).join(', ');
            return `console.log(${argExprs})`;
        }
    }

    if (funcName === 'panic') {
        if (args.length === 1) {
            const argExpr = generator.generateExpression(args[0]);
            return `(console.error("panic: " + ${argExpr}), process.exit(1))`;
        } else {
            return `(console.error("panic"), process.exit(1))`;
        }
    }

    throw new Error(`Unsupported intrinsic function: ${funcName}`);
}

export function generateMemberExpression(generator: JsGeneratorInterface, expr: MemberExpression): string {
    const object = generator.generateExpression(expr.object);
    const property = expr.property.kind === 'identifier'
        ? (expr.property as Identifier).name
        : (expr.property as Literal).value as string;

    // Handle special cases for built-in objects
    if (expr.object.kind === 'identifier') {
        const objectName = (expr.object as Identifier).name;
        if (objectName === 'console' && property === 'log') {
            return 'console.log';
        }
        if (objectName === 'Math') {
            return `Math.${property}`;
        }
    }

    // For class field access, always use encoded field names for consistency
    const encodedProperty = generator.encodeJsFieldName(property);

    // Use encoded property name for all class field access
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(encodedProperty)) {
        return `${object}.${encodedProperty}`;
    } else {
        return `${object}["${encodedProperty}"]`;
    }
}

export function generateIndexExpression(generator: JsGeneratorInterface, expr: IndexExpression): string {
    const object = generator.generateExpression(expr.object);
    const index = generator.generateExpression(expr.index);

    // For map types, use .get() method instead of bracket notation
    if (expr.object.inferredType?.kind === 'map') {
        return `${object}.get(${index})`;
    }

    return `${object}[${index}]`;
}

export function generateArrayExpression(generator: JsGeneratorInterface, expr: ArrayExpression): string {
    const elements = expr.elements.map(el => generator.generateExpression(el)).join(', ');
    return `[${elements}]`;
}

export function generateObjectExpression(generator: JsGeneratorInterface, expr: ObjectExpression): string {
    // Check if this is a set literal based on inferred type
    if (expr.inferredType && expr.inferredType.kind === 'set') {
        const elements = expr.properties.map(prop => prop.value ? generator.generateExpression(prop.value) : '').filter(el => el !== '').join(', ');
        return `new Set([${elements}])`;
    }

    // Check if this is a map literal based on inferred type
    if (expr.inferredType && expr.inferredType.kind === 'map') {
        const entries = expr.properties.map(prop => {
            const keyCode = generateMapLiteralKey(generator, prop.key);
            const valueCode = prop.value
                ? generator.generateExpression(prop.value)
                : generateMapShorthandValue(generator, prop.key);
            return `[${keyCode}, ${valueCode}]`;
        });

        const entriesCode = entries.join(', ');
        return entries.length === 0 ? 'new Map([])' : `new Map([${entriesCode}])`;
    }

    // Check if this is a class instantiation with object literal syntax
    if (expr.className) {
        const className = expr.className;
        const instantiationKey = `${className}_${expr.location?.start?.line || 0}_${expr.location?.start?.column || 0}`;
        const instantiationInfo = expr.instantiationInfo
            ?? generator.validationContext?.codeGenHints?.objectInstantiations?.get(instantiationKey);

        if (!instantiationInfo) {
            const location = expr.location?.start
                ? `${expr.location.start.line}:${expr.location.start.column}`
                : 'unknown location';
            throw new Error(`Missing instantiation metadata for object literal of '${className}' at ${location}`);
        }

        const getDefaultValueForType = (type: Type | undefined): string => {
            if (!type) {
                return 'null';
            }
            if (type.kind === 'primitive') {
                switch (type.type) {
                    case 'string':
                        return '""';
                    case 'int':
                    case 'float':
                    case 'double':
                        return '0';
                    case 'bool':
                        return 'false';
                    default:
                        return 'null';
                }
            }
            return 'null';
        };

        const resolvePropertyValue = (fieldName: string): Expression | undefined => {
            for (const prop of expr.properties) {
                if (prop.key.kind === 'identifier' && (prop.key as Identifier).name === fieldName) {
                    if (prop.value) {
                        return prop.value;
                    }
                    if (prop.shorthand) {
                        return prop.key as Identifier;
                    }
                    return undefined;
                }
                if (prop.key.kind === 'literal') {
                    const literalKey = prop.key as Literal;
                    if (String(literalKey.value) === fieldName) {
                        return prop.value;
                    }
                }
            }
            return undefined;
        };

        const args = instantiationInfo.fieldMappings.map(field => {
            const providedValue = resolvePropertyValue(field.fieldName);
            if (providedValue) {
                return generator.generateExpression(providedValue);
            }
            if (field.defaultValue) {
                return generator.generateExpression(field.defaultValue);
            }
            return getDefaultValueForType(field.type);
        });

        return `new ${instantiationInfo.targetClass}(${args.join(', ')})`;
    }

    // Regular object literal
    let output = '{\n';
    generator.indentLevel++;

    for (let i = 0; i < expr.properties.length; i++) {
        const prop = expr.properties[i];
        const comma = i < expr.properties.length - 1 ? ',' : '';
        output += generator.indent();

        // Handle different key types
        if (prop.key.kind === 'identifier') {
            output += (prop.key as Identifier).name;
        } else if (prop.key.kind === 'literal') {
            output += JSON.stringify((prop.key as Literal).value);
        } else {
            output += generator.generateExpression(prop.key);
        }

        if (prop.value) {
            output += ': ' + generator.generateExpression(prop.value);
        }
        output += comma + '\n';
    }

    generator.indentLevel--;
    output += generator.indent() + '}';
    return output;
}

export function generatePositionalObjectExpression(generator: JsGeneratorInterface, expr: PositionalObjectExpression): string {
    // Special handling for StringBuilder
    if (expr.className === 'StringBuilder') {
        if (expr.arguments.length === 0) {
            return 'new StringBuilder()';
        } else {
            // StringBuilder with capacity argument
            const capacity = generator.generateExpression(expr.arguments[0]);
            return `new StringBuilder(${capacity})`;
        }
    }

    // For other positional object initialization, we need to know the class structure
    const args = expr.arguments.map(arg => generator.generateExpression(arg)).join(', ');
    return `new ${expr.className}(${args})`;
}

export function generateSetExpression(generator: JsGeneratorInterface, expr: SetExpression): string {
    const elements = expr.elements.map(el => generator.generateExpression(el)).join(', ');
    return `new Set([${elements}])`;
}

function generateMapLiteralKey(generator: JsGeneratorInterface, key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression): string {
    switch (key.kind) {
        case 'identifier':
            return JSON.stringify((key as Identifier).name);
        case 'literal': {
            const literal = key as Literal;
            switch (literal.literalType) {
                case 'string':
                case 'char':
                    return JSON.stringify(String(literal.value ?? ''));
                case 'number':
                    return (literal.value ?? 0).toString();
                case 'boolean':
                    return literal.value ? 'true' : 'false';
                case 'null':
                    return 'null';
                default:
                    return JSON.stringify(literal.value ?? '');
            }
        }
        case 'member':
            return generator.generateExpression(key as MemberExpression);
        case 'enumShorthand': {
            const shorthand = key as EnumShorthandMemberExpression;
            const enumType = shorthand._expectedEnumType;
            if (!enumType) {
                throw new Error(`Enum shorthand .${shorthand.memberName} lacks expected enum type for map key generation`);
            }
            return `${enumType.name}.${shorthand.memberName}`;
        }
        default:
            throw new Error(`Unsupported map key kind: ${(key as any).kind}`);
    }
}

function generateMapShorthandValue(generator: JsGeneratorInterface, key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression): string {
    if (key.kind === 'identifier') {
        return (key as Identifier).name;
    }

    throw new Error('Map literal shorthand requires identifier keys');
}

export function generateLambdaExpression(generator: JsGeneratorInterface, expr: LambdaExpression): string {
    const params = expr.parameters.map(p => p.name.name).join(', ');
    let output = `(${params}) => `;

    if (expr.body.kind === 'block') {
        output += '{\n';
        generator.indentLevel++;
        output += generator.generateStatement(expr.body);
        generator.indentLevel--;
        output += generator.indent() + '}';
    } else {
        output += generator.generateExpression(expr.body as Expression);
    }

    return output;
}

export function generateInterpolatedString(generator: JsGeneratorInterface, expr: InterpolatedString): string {
    let output = '`';
    for (const part of expr.parts) {
        if (typeof part === 'string') {
            // Escape backticks and dollar signs in string literals
            output += part.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        } else {
            output += '${' + generator.generateExpression(part) + '}';
        }
    }
    output += '`';
    return output;
}

export function generateTrailingLambdaExpression(generator: JsGeneratorInterface, expr: TrailingLambdaExpression): string {
    const callee = generator.generateExpression(expr.callee);
    const args = expr.arguments.map(arg => generator.generateExpression(arg));

    // Generate lambda body
    const params = ''; // TrailingLambda doesn't have explicit parameters in this structure
    let lambdaCode = `() => `;

    if (expr.lambda.isBlock) {
        lambdaCode += '{\n';
        generator.indentLevel++;
        lambdaCode += generator.generateStatement(expr.lambda.body as BlockStatement);
        generator.indentLevel--;
        lambdaCode += generator.indent() + '}';
    } else {
        lambdaCode += generator.generateExpression(expr.lambda.body as Expression);
    }

    args.push(lambdaCode);
    return `${callee}(${args.join(', ')})`;
}

export function generateTypeGuardExpression(generator: JsGeneratorInterface, expr: TypeGuardExpression): string {
    // Use enhanced metadata from validator if available
    if (generator.validationContext?.codeGenHints?.typeGuards) {
        const guardKey = `${expr.location?.start?.line || 0}_${expr.location?.start?.column || 0}`;
        const guardInfo = generator.validationContext.codeGenHints.typeGuards.get(guardKey);

        if (guardInfo) {
            return guardInfo.jsCondition;
        }
    }

    // Convert "x is Type" to JavaScript type checking for supported categories
    const variable = generator.generateExpression(expr.expression);
    const type = expr.type;

    if (type.kind === 'primitive') {
        const primType = type as PrimitiveTypeNode;
        switch (primType.type) {
            case 'string':
                return `typeof ${variable} === 'string'`;
            case 'int':
            case 'float':
            case 'double':
                return `typeof ${variable} === 'number'`;
            case 'bool':
                return `typeof ${variable} === 'boolean'`;
            default:
                return `typeof ${variable} === '${primType.type}'`;
        }
    } else if (type.kind === 'class') {
        const typeName = type.name;
        return `${variable} instanceof ${typeName}`;
    }

    throw new Error(`Unsupported type guard target '${type.kind}' without code generation hints`);
}

export function generateRangeExpression(generator: JsGeneratorInterface, expr: RangeExpression): string {
    const start = generator.generateExpression(expr.start);
    const end = generator.generateExpression(expr.end);

    // Generate a range as an array
    if (expr.inclusive) {
        return `Array.from({length: ${end} - ${start} + 1}, (_, i) => ${start} + i)`;
    } else {
        return `Array.from({length: ${end} - ${start}}, (_, i) => ${start} + i)`;
    }
}

export function generateNullCoalesceExpression(generator: JsGeneratorInterface, expr: NullCoalesceExpression): string {
    const left = generator.generateExpression(expr.left);
    const right = generator.generateExpression(expr.right);
    return `(${left} ?? ${right})`;
}

// Enum shorthand (.Member) generation: relies on inferred or expected enum type injected by validator
function generateEnumShorthandExpression(expr: EnumShorthandMemberExpression): string {
    const enumType = (expr as any)._expectedEnumType || expr.inferredType;
    if (!enumType || enumType.kind !== 'enum') {
        throw new Error(`Enum shorthand .${expr.memberName} missing enum context`);
    }
    return `${enumType.name}.${expr.memberName}`;
}

export function generateOptionalChainExpression(generator: JsGeneratorInterface, expr: OptionalChainExpression): string {
    const object = generator.generateExpression(expr.object);
    const propertyNode = expr.property;
    
    if (expr.computed) {
        if (!propertyNode) {
            throw new Error('Optional chaining with computed property requires property expression');
        }
        // Handle optional chaining with computed property access: obj?.[key]
        const property = generator.generateExpression(propertyNode as Expression);
        return `${object}?.[${property}]`;
    } else {
        if (!propertyNode) {
            throw new Error('Optional chaining requires property node for non-computed access');
        }
        // Handle optional chaining with member access: obj?.prop
        const propertyName = propertyNode.kind === 'identifier' 
            ? (propertyNode as Identifier).name 
            : (propertyNode as Literal).value as string;
        
        if (expr.isMethodCall) {
            // For method calls, we need to return the method reference that can be called
            return `${object}?.${propertyName}`;
        } else {
            // Regular property access
            return `${object}?.${propertyName}`;
        }
    }
}

export function generateNonNullAssertionExpression(generator: JsGeneratorInterface, expr: NonNullAssertionExpression): string {
    // In JavaScript, we can't really assert non-null at compile time, but we can access the value directly
    // This is essentially a no-op in JS since the type system doesn't exist at runtime
    const operand = generator.generateExpression(expr.operand);
    return operand;
}

export function generateTupleExpression(generator: JsGeneratorInterface, expr: TupleExpression): string {
    // Get the inferred target type
    const targetType = (expr as any)._inferredTargetType || expr.inferredType;
    
    if (!targetType || (targetType.kind !== 'class' && targetType.kind !== 'externClass')) {
        throw new Error('Tuple expression must have a class or extern class target type');
    }
    
    const typeName = (targetType as any).name;
    
    // Generate arguments
    const args = expr.elements.map(arg => generator.generateExpression(arg)).join(', ');
    
    // Generate as a regular constructor call in JavaScript
    return `new ${typeName}(${args})`;
}
