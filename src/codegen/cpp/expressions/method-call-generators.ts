import {
    Expression, Type, CallExpression, MemberExpression, IndexExpression,
    Identifier, Literal, OptionalChainExpression, ArrayTypeNode, MapTypeNode,
    SetTypeNode, UnionTypeNode, PrimitiveTypeNode
} from "../../../types";
import { detectStaticMethodCall } from "../../shared/static-method-utils";
import { CppGenerator } from "../../cppgen";
import { generateExpression } from "../cpp-expression-codegen";
import { inferTypeFromExpression, isSharedPtrType, getNarrowedType } from "./literal-identifier-generators";
import { generateOptionalChainExpression, generatePrintlnWithInterpolation } from "./utility-special-generators";
import { generateTypeConversionCall } from "./type-conversion-generators";
import { shouldFlattenChain, flattenOptionalChain, generateFlattenedChain } from "./chain-flattener";
import { getExpressionId } from "../../../type-utils";

/**
 * Generates C++ code for call expressions
 */
export function generateCallExpression(generator: CppGenerator, expr: CallExpression, targetType?: Type, context?: { needsSharedPtr?: boolean }): string {
    // Handle type conversion function calls first
    if (expr.typeConversionInfo || expr.enumConversionInfo) {
        return generateTypeConversionCall(generator, expr);
    }

    // Handle optional chaining method calls: user?.getName() or calc?.add(5)
    if (expr.callee.kind === 'optionalChain') {
        // Check if this should be flattened for efficiency
        if (shouldFlattenChain(expr)) {
            const flattened = flattenOptionalChain(expr);
            if (flattened) {
                return generateFlattenedChain(generator, flattened);
            }
        }
        return generateOptionalChainMethodCall(generator, expr.callee as OptionalChainExpression, expr.arguments);
    }

    const dispatchInfo = expr.callInfo ?? expr.callInfoSnapshot;
    if (!dispatchInfo) {
        const calleeDetails = expr.callee.kind === 'identifier'
            ? `identifier '${(expr.callee as Identifier).name}'`
            : expr.callee.kind;
        const location = expr.location?.start
            ? `${expr.location.start.line}:${expr.location.start.column}`
            : 'unknown location';
        throw new Error(`Missing call dispatch metadata for ${calleeDetails} at ${location}`);
    }

    if (!expr.callInfo) {
        expr.callInfo = dispatchInfo;
    }

    switch (dispatchInfo.kind) {
            case 'intrinsic':
                // Handle intrinsic function calls (println, print, panic, etc.)
                if (expr.callee.kind === 'identifier') {
                const funcName = dispatchInfo.targetName!;
                    return generateIntrinsicFunctionCall(generator, funcName, expr.arguments);
                } else if (expr.callee.kind === 'member' && expr.intrinsicInfo) {
                    // Handle intrinsic method calls like StringBuilder.append()
                    const memberExpr = expr.callee as MemberExpression;
                    
                    // Special handling for Math intrinsics - use the cppMapping directly
                    if (expr.intrinsicInfo.namespace === 'Math') {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${expr.intrinsicInfo!.cppMapping}(${args.join(', ')})`);
                    }
                    
                    const objectExpr = generateExpression(generator, memberExpr.object);
                    
                    // Use the C++ mapping from the intrinsic info
                    const methodName = expr.intrinsicInfo.cppMapping;
                    
                    // StringBuilder methods need the object to be dereferenced if it's a shared_ptr
                    const objectType = inferTypeFromExpression(generator, memberExpr.object);
                    if (objectType.kind === 'externClass' && objectType.name === 'StringBuilder') {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${objectExpr}->${methodName}(${args.join(', ')})`);
                    } else {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${objectExpr}.${methodName}(${args.join(', ')})`);
                    }
                }
                break;

            case 'staticMethod':
                {
                    // Static method call: Counter.getCount()
                    const className = dispatchInfo.className!;
                    const methodName = dispatchInfo.targetName!;
                    
                    // Special handling for Math static methods
                    if (className === 'Math') {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `std::${methodName}(${args.join(', ')})`);
                    }
                    
                    return generateCallWithEvaluationOrder(generator, expr,
                        (args) => `${className}::${methodName}(${args.join(', ')})`);
                }

            case 'instanceMethod':
            if (dispatchInfo.methodType === 'class') {
                    // Instance method call: counter1.getId()
                    const memberExpr = expr.callee as MemberExpression;
                    
                    // Special handling for Math instance methods (which are actually static)
                const className = dispatchInfo.className!;
                    if (className === 'Math') {
                    const methodName = dispatchInfo.targetName!;
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `std::${methodName}(${args.join(', ')})`);
                    }
                    
                    const object = generateExpression(generator, memberExpr.object);
                const methodName = dispatchInfo.targetName!;

                    // Handle shared_ptr access
                    if (isSharedPtrType(memberExpr.object)) {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${object}->${methodName}(${args.join(', ')})`);
                    } else {
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${object}.${methodName}(${args.join(', ')})`);
                    }
                }
                break;

            case 'unionMethod':
                {
                    const memberExpr = expr.callee as MemberExpression;
                    const object = generateExpression(generator, memberExpr.object);
                    const methodName = dispatchInfo.targetName!;
                    const unionType = (dispatchInfo.unionType || dispatchInfo.objectType) as UnionTypeNode | undefined;

                    if (!unionType || unionType.kind !== 'union') {
                        throw new Error('Union method call is missing union type metadata');
                    }

                    return generateCallWithEvaluationOrder(generator, expr,
                        (args) => generateUnionMethodCall(object, methodName, args, unionType));
                }

            case 'collectionMethod':
                {
                    // Collection method call: map.get(key), array.push(item), etc.
                    const collectionMemberExpr = expr.callee as MemberExpression;
                    const object = generateExpression(generator, collectionMemberExpr.object);
                    const methodName = dispatchInfo.targetName!;
                    const objectType = dispatchInfo.objectType!;
                    const args = generateCollectionMethodArguments(generator, expr, objectType);

                    switch (dispatchInfo.methodType) {
                        case 'map':
                            return generateMapMethodCall(object, methodName, args, objectType as MapTypeNode);
                        case 'set':
                            return generateSetMethodCall(object, methodName, args, objectType as SetTypeNode);
                        case 'array':
                            return generateArrayMethodCall(generator, object, methodName, args, objectType as ArrayTypeNode);
                        case 'string':
                            return generateStringMethodCall(object, methodName, args);
                    }
                    break;
                }

            case 'function':
                {
                    // User-defined function call
                    if (expr.callee.kind === 'identifier') {
                        const identifier = expr.callee as Identifier;
                        const funcName = dispatchInfo.targetName!;
                        
                        // Check if this is actually a member method call (implicit this)
                        if (identifier.resolvedMember && identifier.resolvedMember.kind === 'method') {
                            return generateCallWithEvaluationOrder(generator, expr, 
                                (args) => `this->${funcName}(${args.join(', ')})`);
                        }
                        
                        // Check if this is an imported function - use qualified name
                        if (generator.validationContext?.imports.has(identifier.name)) {
                            const importInfo = generator.validationContext.imports.get(identifier.name)!;
                            return generateCallWithEvaluationOrder(generator, expr,
                                (args) => `${importInfo.sourceModule}::${importInfo.importedName}(${args.join(', ')})`);
                        }
                        
                        return generateCallWithEvaluationOrder(generator, expr,
                            (args) => `${funcName}(${args.join(', ')})`);
                    }
                    break;
                }

            case 'constructor':
                // Constructor calls should be converted to positional object expressions during validation
                throw new Error("Constructor calls should be converted to positional object expressions during validation");

            case 'lambda':
                {
                    // Lambda invocation - generate the callee expression and call it
                    const calleeExpr = generateExpression(generator, expr.callee);
                    return generateCallWithEvaluationOrder(generator, expr,
                        (args) => `${calleeExpr}(${args.join(', ')})`);
                }
    }

    throw new Error("Unsupported call dispatch kind encountered in C++ generator");
}

/**
 * Generate intrinsic function calls (println, print, panic, etc.)
 */
function generateIntrinsicFunctionCall(generator: CppGenerator, funcName: string, args: Expression[]): string {
    if (funcName === 'println') {
        // Handle println specially
        if (args.length === 0) {
            return 'std::cout << std::endl';
        } else if (args.length === 1) {
            const arg = args[0];
            if (arg.kind === 'interpolated-string') {
                return generatePrintlnWithInterpolation(generator, arg);
            } else {
                const argExpr = generateExpression(generator, arg);
                const argType = inferTypeFromExpression(generator, arg);

                // Special handling for boolean arguments
                if (argType.kind === 'primitive' && (argType as PrimitiveTypeNode).type === 'bool') {
                    return `std::cout << (${argExpr} ? "true" : "false") << std::endl`;
                } else {
                    return `std::cout << ${argExpr} << std::endl`;
                }
            }
        } else {
            // Multiple arguments - join them with space separators, handling booleans
            const argExprs = args.map(arg => {
                const argExpr = generateExpression(generator, arg);
                const argType = inferTypeFromExpression(generator, arg);

                // Special handling for boolean arguments
                if (argType.kind === 'primitive' && (argType as PrimitiveTypeNode).type === 'bool') {
                    return `(${argExpr} ? "true" : "false")`;
                } else {
                    return argExpr;
                }
            });
            return `std::cout << ${argExprs.join(' << " " << ')} << std::endl`;
        }
    }

    if (funcName === 'panic') {
        // Handle panic function - exit with message
        if (args.length === 1) {
            const arg = args[0];
            const argExpr = generateExpression(generator, arg);
            return `(std::cerr << "panic: " << ${argExpr} << std::endl, std::exit(1), 0)`;
        } else {
            return `(std::cerr << "panic" << std::endl, std::exit(1), 0)`;
        }
    }

    throw new Error(`Unsupported intrinsic function: ${funcName}`);
}

/**
 * Generate arguments for collection method calls with special handling
 */
function generateCollectionMethodArguments(generator: CppGenerator, expr: CallExpression, objectType: Type): string[] {
    return expr.arguments.map((arg, index) => {
        // Special handling for array push operations with 'this'
        if (objectType?.kind === 'array' && expr.callInfo?.targetName === 'push' && index === 0) {
            const arrayType = objectType as ArrayTypeNode;
            const elementType = arrayType.elementType;
            // If element type is a class and argument is 'this', use shared_from_this
            if (elementType.kind === 'class' && arg.kind === 'identifier' &&
                (arg as any).name === 'this' && generator.currentClass &&
                elementType.name === generator.currentClass.name.name) {
                return generateExpression(generator, arg, { needsSharedPtr: true } as any);
            }
        }
        return generateExpression(generator, arg);
    });
}


/**
 * Generates C++ code for member expressions
 */
export function generateMemberExpression(generator: CppGenerator, expr: MemberExpression): string {
    if (expr.computed) {
        // Handle computed member access: obj[key]
        return generateIndexExpression(generator, {
            kind: 'index',
            object: expr.object,
            index: expr.property as Expression
        } as IndexExpression);
    } else {
        // Handle property access: obj.prop
        const propertyName = getMemberPropertyName(expr.property);

        // Handle built-in namespace mappings first, before generating object expression
        if (expr.object.kind === 'identifier') {
            const objectName = (expr.object as Identifier).name;
            if (objectName === 'Math') {
                if (isMathFunction(propertyName)) {
                    return `std::${propertyName}`;
                } else if (isMathConstant(propertyName)) {
                    return getMathConstant(propertyName);
                }
            }
        }

        const object = generateExpression(generator, expr.object);

        // Check for static field access, static method calls, or enum member access
        if (expr.object.kind === 'identifier') {
            const className = (expr.object as Identifier).name;

            // Check for static method call using shared utility
            const staticMethodInfo = detectStaticMethodCall(expr, generator.validationContext);
            if (staticMethodInfo) {
                return `${staticMethodInfo.className}::${staticMethodInfo.methodName}`;
            }

            if (isStaticFieldAccess(generator, className, propertyName)) {
                return `${className}::${propertyName}`;
            }
            // Check if this is an enum member access
            if (isEnumMemberAccess(generator, className, propertyName)) {
                return `${className}::${propertyName}`;
            }
        }

        // Regular member access
        const objectType = expr.object.inferredType;

        // Handle union member access with std::visit
        if (objectType && objectType.kind === 'union') {
            const unionType = objectType as UnionTypeNode;
            const hasNull = unionType.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
            const nonNullTypes = unionType.types.filter(t => !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null'));

            if (hasNull && nonNullTypes.length === 1) {
                const baseType = nonNullTypes[0];

                if (baseType.kind === 'class' || baseType.kind === 'externClass') {
                    // Nullable class unions collapse to shared_ptr<T>; treat as pointer access
                    return `${object}->${propertyName}`;
                }
            }

            // Check if this identifier is narrowed (type guard context)
            if (expr.object.kind === 'identifier') {
                const varName = (expr.object as Identifier).name;
                const narrowedType = getNarrowedType(generator, varName);

                if (narrowedType) {
                    // This is narrowed access - use std::get<Type>(variant)
                    return `std::get<${generator.generateType(narrowedType)}>(${object})->${propertyName}`;
                }
            }

            // Common member access on union - use std::visit
            return `std::visit([](auto&& variant) { return variant->${propertyName}; }, ${object})`;
        }

        // Handle intrinsic properties that should become method calls
        if (objectType) {
            if (propertyName === 'length' || propertyName === 'size') {
                if (objectType.kind === 'array') {
                    // Array length becomes ->size() method call
                    return `${object}->size()`;
                } else if (objectType.kind === 'map') {
                    // Map size becomes ->size() method call (shared_ptr)
                    return `${object}->size()`;
                } else if (objectType.kind === 'set') {
                    // Set size becomes ->size() method call (shared_ptr)
                    return `${object}->size()`;
                } else if (objectType.kind === 'primitive' && (objectType as PrimitiveTypeNode).type === 'string') {
                    // String length becomes .size() method call
                    return `${object}.size()`;
                }
            }
        }

        if (isSharedPtrType(expr.object)) {
            return `${object}->${propertyName}`;
        } else {
            return `${object}.${propertyName}`;
        }
    }
}

/**
 * Generates C++ code for index expressions
 */
export function generateIndexExpression(generator: CppGenerator, expr: IndexExpression): string {
    const object = generateExpression(generator, expr.object);
    const index = generateExpression(generator, expr.index);

    // Check if the object is a dynamic array (shared_ptr<vector>) - use -> instead of .
    let objectType = expr.object.inferredType;
    if (objectType?.kind === 'array') {
        return `${object}->at(${index})`;
    }

    // For maps (shared_ptr<map>), use (*map)[key] to allow assignment to new keys
    if (objectType?.kind === 'map') {
        return `(*${object})[${index}]`;
    }

    // Use std::vector::at() for bounds-checked access instead of unsafe operator[]
    return `${object}.at(${index})`;
}

/**
 * Generates arguments from named or positional call syntax.
 * Handles argument reordering for named arguments to preserve lexical evaluation order.
 */
function generateArgumentsFromNamedOrPositional(generator: CppGenerator, expr: CallExpression): string[] {
    // Check if we have reordering metadata from named arguments
    if (expr.namedArgumentsLexicalOrder && expr.namedArgumentsLexicalOrder.length > 0) {
        // Arguments are out of order and may need temporaries
        // Generate with evaluation order preservation handled by caller
        return expr.arguments.map(arg => generateExpression(generator, arg));
    }

    // If validator lowered named arguments into positional expr.arguments, just use them.
    if (expr.namedArguments && expr.namedArguments.length > 0 && expr.arguments && expr.arguments.length > 0) {
        return expr.arguments.map(arg => generateExpression(generator, arg));
    }

    // Handle regular positional arguments
    if (expr.callee.kind === 'identifier') {
        const funcName = (expr.callee as Identifier).name;
        const funcSignature = generator.functionSignatures.get(funcName);

        if (funcSignature) {
            // Pass parameter types as context for reverse type inference
            return expr.arguments.map((arg, i) => {
                const paramType = funcSignature.parameters[i]?.type;
                return paramType ? generateExpression(generator, arg, { targetType: paramType }) : generateExpression(generator, arg);
            });
        }
    }

    // No signature information available, generate normally
    return expr.arguments.map(arg => generateExpression(generator, arg));
}

// Global counter for unique temporary names to avoid shadowing in nested IIFEs
let evalOrderTempCounter = 0;

/**
 * Generates a call expression with proper evaluation order for reordered named arguments.
 * When arguments need temporaries for correct evaluation order, wraps the call in an IIFE.
 */
function generateCallWithEvaluationOrder(
    generator: CppGenerator,
    expr: CallExpression,
    generateCallCode: (args: string[]) => string
): string {
    const lexicalOrder = expr.namedArgumentsLexicalOrder;
    
    if (!lexicalOrder || lexicalOrder.length === 0) {
        // No reordering needed, generate normally
        const args = generateArgumentsFromNamedOrPositional(generator, expr);
        return generateCallCode(args);
    }
    
    // Check if any arguments actually need temporaries
    const anyNeedsTemp = lexicalOrder.some(arg => arg.needsTemp);
    
    if (!anyNeedsTemp) {
        // All arguments are side-effect-free, no need for IIFE
        const args = expr.arguments.map(arg => generateExpression(generator, arg));
        return generateCallCode(args);
    }
    
    // Generate an IIFE to ensure correct evaluation order
    // Pattern: ([&]() { auto _t0 = expr0; auto _t1 = expr1; return func(_t1, _t0); })()
    
    const tempDecls: string[] = [];
    const tempNames: string[] = new Array(expr.arguments.length).fill('');
    
    // Process arguments in lexical order (as they appear in source)
    for (const arg of lexicalOrder) {
        const tempName = `_arg${evalOrderTempCounter++}`;
        const exprCode = generateExpression(generator, arg.expression);
        
        // Infer the type for the auto declaration
        const argType = arg.expression.inferredType;
        if (argType) {
            const cppType = generator.generateType(argType);
            tempDecls.push(`${cppType} ${tempName} = ${exprCode}`);
        } else {
            tempDecls.push(`auto ${tempName} = ${exprCode}`);
        }
        
        tempNames[arg.paramIndex] = tempName;
    }
    
    // Generate the call with temporaries in positional order
    const callCode = generateCallCode(tempNames);
    
    return `([&]() { ${tempDecls.join('; ')}; return ${callCode}; })()`;
}

// Array method call generators
function generateArrayMethodCall(generator: CppGenerator, object: string, methodName: string, args: string[], arrayType: ArrayTypeNode): string {
    switch (methodName) {
        case 'push':
            // For array.push(element), check if element type is shared_ptr and element is 'this'
            let processedArg = args[0];
            if (args[0] === 'this') {
                const elementType = generator.generateType(arrayType.elementType);
                // Since all classes now inherit from enable_shared_from_this, 
                // if the element type is a shared_ptr, convert 'this' to 'shared_from_this()'
                if (elementType.includes('shared_ptr')) {
                    processedArg = 'shared_from_this()';
                }
            }
            return validateArgsAndGenerate(args, 1, `${object}->push_back(${processedArg})`);
        case 'pop':
            return validateArgsAndGenerate(args, 0, `doof_runtime::array_pop(*${object})`);
        case 'length':
        case 'size':
            return validateArgsAndGenerate(args, 0, `${object}->size()`);
        case 'at':
            return validateArgsAndGenerate(args, 1, `${object}->at(${args[0]})`);
        case 'indexOf':
            return validateArgsAndGenerate(args, 1, `std::distance(${object}->begin(), std::find(${object}->begin(), ${object}->end(), ${args[0]}))`);
        case 'forEach':
            return validateArgsAndGenerate(args, 1, `std::for_each(${object}->begin(), ${object}->end(), [&](const auto& it) { (${args[0]})(it, std::distance(${object}->begin(), std::find(${object}->begin(), ${object}->end(), it))); })`);
        case 'map':
            // Map requires a new vector to be created
            const elementType = arrayType.elementType ? generator.generateType(arrayType.elementType) : 'auto';
            return validateArgsAndGenerate(args, 1, `([&]() { auto result = std::make_shared<std::vector<${elementType}>>(); std::transform(${object}->begin(), ${object}->end(), std::back_inserter(*result), [&](const auto& it) { return (${args[0]})(it, std::distance(${object}->begin(), std::find(${object}->begin(), ${object}->end(), it))); }); return result; })()`);
        case 'filter':
            return validateArgsAndGenerate(args, 1, `([&]() { auto result = std::make_shared<std::vector<${generator.generateType(arrayType.elementType)}>>(); std::copy_if(${object}->begin(), ${object}->end(), std::back_inserter(*result), [&](const auto& it) { return (${args[0]})(it, std::distance(${object}->begin(), std::find(${object}->begin(), ${object}->end(), it))); }); return result; })()`);
        case 'reduce':
            return validateArgsAndGenerate(args, 2, `([&]() { auto accumulator = ${args[0]}; int index = 0; for (const auto& it : *${object}) { accumulator = (${args[1]})(accumulator, it, index, ${object}); ++index; } return accumulator; })()`);
        case 'find':
            return validateArgsAndGenerate(args, 1, `([&]() { auto it = std::find_if(${object}->begin(), ${object}->end(), [&](const auto& element) { return (${args[0]})(element, std::distance(${object}->begin(), &element)); }); return (it != ${object}->end()) ? *it : ${generator.generateDefaultInitializer(arrayType.elementType)}; })()`);
        default:
            throw new Error(`Unsupported array method: ${methodName}`);
    }
}

// String method call generators
function generateStringMethodCall(object: string, methodName: string, args: string[]): string {
    switch (methodName) {
        case 'length':
        case 'size':
            return validateArgsAndGenerate(args, 0, `${object}.length()`);
        case 'charAt':
            return validateArgsAndGenerate(args, 1, `${object}.at(${args[0]})`);
        case 'substring':
            if (args.length === 1) {
                return `${object}.substr(${args[0]})`;
            } else if (args.length === 2) {
                return `${object}.substr(${args[0]}, ${args[1]} - ${args[0]})`;
            } else {
                throw new Error(`substring expects 1 or 2 arguments, got ${args.length}`);
            }
        case 'indexOf':
            return validateArgsAndGenerate(args, 1, `static_cast<int>(${object}.find(${args[0]}))`);
        case 'replace':
            return validateArgsAndGenerate(args, 2, `doof_runtime::string_replace(${object}, ${args[0]}, ${args[1]})`);
        case 'toLowerCase':
            return validateArgsAndGenerate(args, 0, `doof_runtime::string_to_lower(${object})`);
        case 'toUpperCase':
            return validateArgsAndGenerate(args, 0, `doof_runtime::string_to_upper(${object})`);
        case 'split':
            return validateArgsAndGenerate(args, 1, `doof_runtime::string_split(${object}, ${args[0]})`);
        default:
            throw new Error(`Unsupported string method: ${methodName}`);
    }
}

// Set method call generators
function generateSetMethodCall(object: string, methodName: string, args: string[], setType: SetTypeNode): string {
    switch (methodName) {
        case 'add':
            return validateArgsAndGenerate(args, 1, `${object}->insert(${args[0]})`);
        case 'has':
            return validateArgsAndGenerate(args, 1, `(${object}->find(${args[0]}) != ${object}->end())`);
        case 'delete':
            return validateArgsAndGenerate(args, 1, `${object}->erase(${args[0]})`);
        case 'clear':
            return validateArgsAndGenerate(args, 0, `${object}->clear()`);
        case 'size':
            return validateArgsAndGenerate(args, 0, `${object}->size()`);
        default:
            throw new Error(`Unsupported set method: ${methodName}`);
    }
}

// Map method call generators
function generateMapMethodCall(object: string, methodName: string, args: string[], mapType: MapTypeNode): string {
    switch (methodName) {
        case 'set':
            return validateArgsAndGenerate(args, 2, `((*${object})[${args[0]}] = ${args[1]})`);
        case 'get':
            return validateArgsAndGenerate(args, 1, `${object}->at(${args[0]})`);
        case 'has':
            return validateArgsAndGenerate(args, 1, `(${object}->find(${args[0]}) != ${object}->end())`);
        case 'delete':
            return validateArgsAndGenerate(args, 1, `${object}->erase(${args[0]})`);
        case 'clear':
            return validateArgsAndGenerate(args, 0, `${object}->clear()`);
        case 'size':
            return validateArgsAndGenerate(args, 0, `${object}->size()`);
        case 'keys':
            return `doof_runtime::map_keys(*${object})`;
        case 'values':
            return `doof_runtime::map_values(*${object})`;
        default:
            throw new Error(`Unsupported map method: ${methodName}`);
    }
}

// Union method call generators
function generateUnionMethodCall(object: string, methodName: string, args: string[], unionType: UnionTypeNode): string {
    // For union method calls, we need to use std::visit to call the method on the variant
    const argsStr = args.length > 0 ? `, ${args.join(', ')}` : '';
    return `std::visit([](auto&& variant${args.length > 0 ? ', auto&&... args' : ''}) { return variant->${methodName}(${args.length > 0 ? 'args...' : ''}); }, ${object}${argsStr})`;
}

// Utility functions
function getMemberPropertyName(property: Identifier | Literal | undefined): string {
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

function isStaticFieldAccess(generator: CppGenerator, className: string, memberName: string): boolean {
    const classDecl = generator.getClassDeclaration(className);
    if (classDecl) {
        return classDecl.fields.some(f => f.isStatic && f.name.name === memberName);
    }
    return false;
}

function isEnumMemberAccess(generator: CppGenerator, enumName: string, memberName: string): boolean {
    // Check if the enumName is actually an enum in the validation context
    if (generator.validationContext?.enums.has(enumName)) {
        const enumDecl = generator.validationContext.enums.get(enumName)!;
        // Check if memberName is a valid member of this enum
        return enumDecl.members.some(member => member.name.name === memberName);
    }

    // Fallback to heuristic for cases without validation context
    const isEnumLikeIdentifier = /^[A-Z][a-zA-Z]*$/.test(enumName);
    const isEnumLikeMember = /^[A-Z_]+$/.test(memberName);

    return isEnumLikeIdentifier && isEnumLikeMember;
}

function isMathFunction(name: string): boolean {
    // Check if this is a standard C++ math function
    const mathFunctions = [
        'abs', 'sqrt', 'cbrt', 'pow', 'exp', 'log', 'log10', 'log2',
        'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
        'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
        'ceil', 'floor', 'round', 'trunc',
        'fmod', 'remainder', 'fmax', 'fmin'
    ];
    return mathFunctions.includes(name);
}

function isMathConstant(name: string): boolean {
    // Check if this is a standard Math constant
    const mathConstants = ['PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2'];
    return mathConstants.includes(name);
}

function getMathConstant(name: string): string {
    // Map JavaScript Math constants to C++ equivalents
    const constantMap: { [key: string]: string } = {
        'PI': 'M_PI',
        'E': 'M_E',
        'LN2': 'M_LN2',
        'LN10': 'M_LN10',
        'LOG2E': 'M_LOG2E',
        'LOG10E': 'M_LOG10E',
        'SQRT1_2': 'M_SQRT1_2',
        'SQRT2': 'M_SQRT2'
    };
    return constantMap[name] || `M_${name}`;
}

function isPointerLikeType(type: Type | undefined): boolean {
    if (!type) {
        return false;
    }
    if (type.kind === 'class' || type.kind === 'externClass') {
        return true;
    }
    if (type.kind === 'union') {
        const unionType = type as UnionTypeNode;
        return unionType.types.some(member => isPointerLikeType(member));
    }
    return false;
}

/**
 * Generates C++ code for optional chaining method calls with arguments
 */
function generateOptionalChainMethodCall(generator: CppGenerator, optionalChain: OptionalChainExpression, args: Expression[]): string {
    const object = generateExpression(generator, optionalChain.object);
    const methodName = getMemberPropertyName(optionalChain.property);
    const argStrings = args.map(arg => generateExpression(generator, arg));
    const argsStr = argStrings.join(', ');
    const resultType = optionalChain.inferredType;
    const returnsPointer = isPointerLikeType(resultType);

    // Check if the object expression is itself an optional chain result
    const isObjectOptionalResult = optionalChain.object.kind === 'optionalChain';

    if (isObjectOptionalResult) {
        if (returnsPointer) {
            return `(${object}.has_value() ? ${object}.value()->${methodName}(${argsStr}) : nullptr)`;
        }
        return `(${object}.has_value() ? std::make_optional(${object}.value()->${methodName}(${argsStr})) : std::nullopt)`;
    } else {
        if (returnsPointer) {
            return `(${object} ? ${object}->${methodName}(${argsStr}) : nullptr)`;
        }
        return `(${object} ? std::make_optional(${object}->${methodName}(${argsStr})) : std::nullopt)`;
    }
}

function validateArgsAndGenerate(args: string[], expectedCount: number, code: string, setupIncludes?: () => void): string {
    if (args.length !== expectedCount) {
        throw new Error(`Expected ${expectedCount} arguments, got ${args.length}`);
    }
    if (setupIncludes) {
        setupIncludes();
    }
    return code;
}
