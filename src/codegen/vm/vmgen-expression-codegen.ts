import { Expression, Literal, Identifier, BinaryExpression, UnaryExpression, ConditionalExpression, CallExpression, MemberExpression, IndexExpression, LambdaExpression, TrailingLambdaExpression, ObjectExpression, PositionalObjectExpression, TupleExpression, SetExpression, TypeGuardExpression, ArrayExpression, InterpolatedString, NullCoalesceExpression, OptionalChainExpression, NonNullAssertionExpression, Type, FieldDeclaration, EnumShorthandMemberExpression, AwaitExpression, AsyncExpression } from "../../types";
import { CompilationContext, getActiveValidationContext } from "../vmgen";
import { generateMapMethodCall, generateSetMethodCall, generateStringMethodCall, generateArrayMethodCall, generateInstanceMethodCall, generateInstanceMethodCallFromRegister, generateStaticMethodCall, generateIntrinsicCall, generateIntrinsicExternCall, generateUserFunctionCall, generateUserFunctionCallWithEvalOrder, generateAsyncCall } from "./vmgen-call-codegen";
import { addConstant, emit, createLabel, setLabel, emitJump, setSourceLocationFromNode } from "./vmgen-emit";
import { generateLiteral } from "./vmgen-literal-codegen";
import { generateBinaryExpression, generateUnaryExpression } from "./vmgen-binary-codegen";
import { generateConditionalExpression } from "./vmgen-conditional-codegen";
import { generateLambdaExpression, generateTrailingLambdaExpression, generateLambdaInvocation, isIdentifierCaptured } from "./vmgen-lambda-codegen";
import { generateObjectExpression, generatePositionalObjectExpression, generateSetExpression, generateArrayExpression, generateInterpolatedString, generateTypeGuardExpression } from "./vmgen-object-codegen";
import { getInstanceFieldIndex } from "./vmgen-class-utils";
import { getExpressionType, isLambdaType, getTypeCategory } from "./vmgen-type-utils";
import { isStringType as isStringTypeShared } from "../shared/type-coercion";
import { isCapturedMutableIdentifier, CAPTURE_WRAPPER_FIELD_INDEX } from "./vmgen-capture-utils";

function vmDebugEnabled(): boolean {
    const flag = process.env.DOOF_DEBUG;
    return flag === '1' || flag === 'true' || flag === 'vm' || flag === 'vmgen';
}
function dbg(...args: any[]) {
    if (vmDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.error('[VMGEN][expr]', ...args);
    }
}

function freeRegisters(registers: number[], context: CompilationContext): void {
    for (const reg of registers) {
        context.registerAllocator.free(reg);
    }
}

function resolveExpressionType(expr: Expression, context: CompilationContext): Type {
    // Special-case 'this' to the current class type to avoid stale inferred generic names
    if (expr.kind === 'identifier' && (expr as Identifier).name === 'this' && context.currentClass) {
        return { kind: 'class', name: context.currentClass.name.name } as any;
    }
    return expr.inferredType ?? getExpressionType(expr, context);
}

function isNullishPrimitive(type: Type): boolean {
    return type.kind === 'primitive' && (type.type === 'null' || type.type === 'void');
}

function resolveNullableType(type?: Type): Type | null {
    if (!type) {
        return null;
    }

    if (type.kind === 'union') {
        for (const candidate of type.types) {
            const resolved = resolveNullableType(candidate);
            if (resolved) {
                return resolved;
            }
        }
        return null;
    }

    return isNullishPrimitive(type) ? null : type;
}

function resolveClassName(type?: Type): string | null {
    const resolved = resolveNullableType(type);
    if (!resolved) {
        return null;
    }

    if (resolved.kind === 'class' || resolved.kind === 'externClass') {
        return resolved.name;
    }

    return null;
}

function describeTypeForError(type?: Type | null): string {
    if (!type) {
        return 'unknown';
    }

    switch (type.kind) {
        case 'class':
        case 'externClass':
            return `${type.kind} '${type.name}'`;
        case 'primitive':
            return `primitive '${type.type}'`;
        case 'union':
            return `union(${type.types.map(inner => describeTypeForError(inner)).join(', ')})`;
        default:
            return type.kind;
    }
}

function emitPropertyAccess(
    propertyName: string,
    targetReg: number,
    objectReg: number,
    objectType: Type,
    context: CompilationContext
): void {
    const resolvedType = resolveNullableType(objectType) ?? objectType;

    if (resolvedType.kind === 'map') {
        if (propertyName !== 'size') {
            throw new Error(`Unknown map property '${propertyName}'. Maps only support 'size'.`);
        }
        emit('SIZE_MAP', targetReg, objectReg, 0, context);
        return;
    }

    if (resolvedType.kind === 'set') {
        if (propertyName !== 'size') {
            throw new Error(`Unknown set property '${propertyName}'. Sets only support 'size'.`);
        }
        emit('SIZE_SET', targetReg, objectReg, 0, context);
        return;
    }

    if (propertyName === 'length') {
        if (resolvedType.kind === 'array') {
            emit('LENGTH_ARRAY', targetReg, objectReg, 0, context);
            return;
        }

        if (resolvedType.kind === 'primitive' && resolvedType.type === 'string') {
            emit('LENGTH_STRING', targetReg, objectReg, 0, context);
            return;
        }

        if (isStringTypeShared(objectType)) {
            emit('LENGTH_STRING', targetReg, objectReg, 0, context);
            return;
        }

        throw new Error(`Property 'length' is not supported on type ${describeTypeForError(resolvedType)}.`);
    }

    if (resolvedType.kind === 'class') {
    const fieldIndex = getInstanceFieldIndex(resolvedType.name, propertyName, context);
        emit('GET_FIELD', targetReg, objectReg, fieldIndex, context);
        return;
    }

    throw new Error(`Unknown property '${propertyName}' for type ${describeTypeForError(resolvedType)}.`);
}

function emitIndexAccess(
    targetReg: number,
    objectReg: number,
    indexReg: number,
    objectType: Type,
    context: CompilationContext
): void {
    const resolvedType = resolveNullableType(objectType) ?? objectType;

    if (resolvedType.kind === 'map') {
        const mapType = resolvedType as any;
        const keyTypeCategory = mapType.keyType ? getTypeCategory(mapType.keyType) : 'string';
        const opcode = keyTypeCategory === 'int' ? 'GET_MAP_INT' : 'GET_MAP';
        emit(opcode, targetReg, objectReg, indexReg, context);
        return;
    }

    if (resolvedType.kind === 'array') {
        emit('GET_ARRAY', targetReg, objectReg, indexReg, context);
        return;
    }

    if (
        (resolvedType.kind === 'primitive' && resolvedType.type === 'string') ||
        isStringTypeShared(objectType)
    ) {
        emit('GET_ARRAY', targetReg, objectReg, indexReg, context);
        return;
    }

    throw new Error(`Index access is not supported on type ${describeTypeForError(resolvedType)}.`);
}

/**
 * Generate expression into a register, optimizing for identifiers already in registers.
 * Returns the register containing the expression result and updates allocatedRegs with any newly allocated registers.
 */
export function generateExpressionOptimal(expr: Expression, allocatedRegs: number[], context: CompilationContext): number {
    // Fast path for identifiers - they might already be in registers
    if (expr.kind === 'identifier') {
        const identifier = expr as Identifier;
        const existingReg = context.registerAllocator.getVariable(identifier.name);
        if (existingReg !== undefined && !isCapturedMutableIdentifier(identifier, context)) {
            // Variable is already in a register, return it directly
            return existingReg;
        }
    }

    // For all other cases, allocate a register and generate the expression
    const targetReg = context.registerAllocator.allocate();
    allocatedRegs.push(targetReg);
    generateExpression(expr, targetReg, context);
    return targetReg;
}

export function generateExpression(expr: Expression, targetReg: number, context: CompilationContext): void {
  // Set source location for debug information
  setSourceLocationFromNode(expr, context);
    switch (expr.kind) {
        case 'literal':
            generateLiteral(expr as Literal, targetReg, context);
            break;
        case 'identifier':
            generateIdentifier(expr as Identifier, targetReg, context);
            break;
        case 'binary':
            generateBinaryExpression(expr as BinaryExpression, targetReg, context);
            break;
        case 'unary':
            generateUnaryExpression(expr as UnaryExpression, targetReg, context);
            break;
        case 'conditional':
            generateConditionalExpression(expr as ConditionalExpression, targetReg, context);
            break;
        case 'call':
            generateCallExpression(expr as CallExpression, targetReg, context);
            break;
        case 'member':
            generateMemberExpression(expr as MemberExpression, targetReg, context);
            break;
        case 'array':
            generateArrayExpression(expr as ArrayExpression, targetReg, context);
            break;
        case 'interpolated-string':
            generateInterpolatedString(expr as InterpolatedString, targetReg, context);
            break;
        case 'index':
            generateIndexExpression(expr as IndexExpression, targetReg, context);
            break;
        case 'lambda':
            generateLambdaExpression(expr as LambdaExpression, targetReg, context);
            break;
        case 'trailingLambda':
            generateTrailingLambdaExpression(expr as TrailingLambdaExpression, targetReg, context);
            break;
        case 'object':
            {
                const o = expr as ObjectExpression;
                dbg('Encounter object expr', { className: o.className, hasInstantiationInfo: !!(o as any).instantiationInfo, location: o.location?.start });
            }
            generateObjectExpression(expr as ObjectExpression, targetReg, context);
            break;
        case 'positionalObject':
            {
                const p = expr as PositionalObjectExpression;
                dbg('Encounter positional object expr', { className: p.className, argCount: p.arguments.length, location: p.location?.start });
            }
            generatePositionalObjectExpression(expr as PositionalObjectExpression, targetReg, context);
            break;
        case 'tuple':
            generateTupleExpression(expr as TupleExpression, targetReg, context);
            break;
        case 'set':
            generateSetExpression(expr as SetExpression, targetReg, context);
            break;
        case 'typeGuard':
            generateTypeGuardExpression(expr as TypeGuardExpression, targetReg, context);
            break;
        case 'nullCoalesce':
            generateNullCoalesceExpression(expr as NullCoalesceExpression, targetReg, context);
            break;
        case 'optionalChain':
            generateOptionalChainExpression(expr as OptionalChainExpression, targetReg, context);
            break;
        case 'nonNullAssertion':
            generateNonNullAssertionExpression(expr as NonNullAssertionExpression, targetReg, context);
            break;
        case 'enumShorthand':
            generateEnumShorthandExpression(expr as EnumShorthandMemberExpression, targetReg, context);
            break;
        case 'await':
            generateAwaitExpression(expr as AwaitExpression, targetReg, context);
            break;
        case 'async':
            generateAsyncExpression(expr as AsyncExpression, targetReg, context);
            break;
        case 'xmlCall':
            // XML calls are normalized during validation. The normalized node may be a CallExpression
            // or, in the case of class construction with named args, an ObjectExpression. Generate generically.
            const xml: any = expr;
            if (xml.normalizedCall) {
                const normalized = xml.normalizedCall as Expression;
                generateExpression(normalized, targetReg, context);
            } else {
                // Fallback: treat as no-op string literal of joined children for minimal resilience
                const parts: string[] = [];
                for (const attr of xml.attributes || []) {
                    if (attr.value && attr.value.kind === 'literal' && (attr.value as any).literalType === 'string') {
                        parts.push((attr.value as any).value);
                    }
                }
                const tempLit: Literal = { kind: 'literal', value: parts.join(' '), literalType: 'string', location: xml.location } as any;
                generateLiteral(tempLit, targetReg, context);
            }
            break;
        default:
            throw new Error("Unsupported expression type");
    }
}

function generateAwaitExpression(expr: AwaitExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];
    const futureReg = generateExpressionOptimal(expr.expression, allocatedRegs, context);
    
    emit('AWAIT', targetReg, futureReg, 0, context);
    
    freeRegisters(allocatedRegs, context);
}

function generateAsyncExpression(expr: AsyncExpression, targetReg: number, context: CompilationContext): void {
    const call = expr.expression;
    
    // We only support async calls to user functions for now
    // Check if it's a simple identifier call
    if (call.callee.kind === 'identifier') {
        const funcName = (call.callee as Identifier).name;
        const funcMetadata = context.functionTable.get(funcName);
        
        if (funcMetadata) {
            generateAsyncCall(funcMetadata, call.arguments, targetReg, context);
            return;
        }
        
        throw new Error(`Async call target '${funcName}' not found or not a user function`);
    }
    
    throw new Error(`Async calls are only supported for direct function calls (e.g. async func())`);
}

export function generateIdentifier(identifier: Identifier, targetReg: number, context: CompilationContext): void {
    const reg = context.registerAllocator.getVariable(identifier.name);
    if (reg !== undefined) {
        if (isCapturedMutableIdentifier(identifier, context)) {
            emit('GET_FIELD', targetReg, reg, CAPTURE_WRAPPER_FIELD_INDEX, context);
        } else if (reg !== targetReg) {
            // If already in correct register, no need to move
            emit('MOVE', targetReg, reg, 0, context);
        }
        return;
    }

    const scopeInfo = identifier.scopeInfo;
    const member = identifier.resolvedMember || (scopeInfo?.isClassMember ? {
        className: scopeInfo.declaringClass,
        memberName: identifier.name,
        kind: scopeInfo.scopeKind === 'method' ? 'method' : 'field'
    } : undefined);

    if (member) {
        const className = member.className || context.currentClass?.name.name;
        if (!className) {
            throw new Error(`Missing class metadata for member '${member.memberName}'`);
        }

        let isStatic: boolean | undefined = scopeInfo?.isStaticMember;
        if (member.kind === 'field' && isStatic === undefined) {
            const validationContext = getActiveValidationContext(context);
            if (!validationContext) {
                throw new Error(`Field metadata for '${className}.${member.memberName}' requires an active validation context`);
            }

            const classDecl = validationContext.classes.get(className);
            if (!classDecl) {
                throw new Error(`Class '${className}' is missing in validation metadata while resolving '${member.memberName}'`);
            }

            const fieldDecl = classDecl.fields.find((field: FieldDeclaration) => field.name.name === member.memberName);
            if (fieldDecl) {
                isStatic = fieldDecl.isStatic;
            }
        }

        if (isStatic === undefined && member.kind === 'field') {
            throw new Error(`Unable to determine if field '${className}.${member.memberName}' is static`);
        }

        if (isStatic) {
            const globalFieldName = `${className}.${member.memberName}`;
            const globalSlot = context.globalSymbolTable.get(globalFieldName);
            if (globalSlot === undefined) {
                throw new Error(`Static field ${globalFieldName} not found in VM global table`);
            }
            const high = Math.floor(globalSlot / 256);
            const low = globalSlot % 256;
            emit('GET_GLOBAL', targetReg, high, low, context);
            return;
        }

        if (member.kind === 'field') {
            const thisReg = context.registerAllocator.getVariable('this');
            if (thisReg === undefined) {
                throw new Error(`Instance field '${member.memberName}' accessed outside of instance method`);
            }

            const fieldIndex = getInstanceFieldIndex(className, member.memberName, context);
            emit('GET_FIELD', targetReg, thisReg, fieldIndex, context);
            return;
        }
    }

    const activeClass = context.currentClass;
    if (activeClass) {
        const fieldDecl = activeClass.fields.find(f => f.name.name === identifier.name);
        if (fieldDecl) {
            const className = activeClass.name.name;
            if (fieldDecl.isStatic) {
                const globalFieldName = `${className}.${identifier.name}`;
                const globalSlot = context.globalSymbolTable.get(globalFieldName);
                if (globalSlot === undefined) {
                    throw new Error(`Static field ${globalFieldName} not found in VM global table`);
                }
                const high = Math.floor(globalSlot / 256);
                const low = globalSlot % 256;
                emit('GET_GLOBAL', targetReg, high, low, context);
                return;
            }

            const thisReg = context.registerAllocator.getVariable('this');
            if (thisReg === undefined) {
                throw new Error(`Instance field '${identifier.name}' accessed outside of instance method`);
            }

            const fieldIndex = getInstanceFieldIndex(className, identifier.name, context);
            emit('GET_FIELD', targetReg, thisReg, fieldIndex, context);
            return;
        }
    }

    if (scopeInfo?.needsThisPrefix) {
        const className = scopeInfo.declaringClass || context.currentClass?.name.name;
        if (!className) {
            throw new Error(`Unable to resolve declaring class for '${identifier.name}'`);
        }
        const thisReg = context.registerAllocator.getVariable('this');
        if (thisReg === undefined) {
            throw new Error(`Identifier '${identifier.name}' requires 'this' but no instance context is available`);
        }
        const fieldIndex = getInstanceFieldIndex(className, identifier.name, context);
        emit('GET_FIELD', targetReg, thisReg, fieldIndex, context);
        return;
    }

    // Check for intrinsic functions
    if (identifier.name === 'println' || identifier.name === 'print' || identifier.name === 'panic') {
        throw new Error(`Intrinsic '${identifier.name}' cannot be used as a value in VM expressions`);
    }

    throw new Error(`Identifier '${identifier.name}' is not bound in the current VM scope`);
}

/**
 * Generate VM code for type conversion function calls like int(), string(), etc.
 */
function generateTypeConversionCall(call: CallExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];
    const argReg = generateExpressionOptimal(call.arguments[0], allocatedRegs, context);

    if (call.typeConversionInfo) {
        const info = call.typeConversionInfo;
        
        switch (info.vmMapping) {
            // Type conversion cases - using just the key cases
            case 'INT_IDENTITY':
            case 'FLOAT_IDENTITY':
            case 'DOUBLE_IDENTITY':
            case 'STRING_IDENTITY':
            case 'BOOL_IDENTITY':
                emit('MOVE', targetReg, argReg, 0, context);
                break;
            default:
                // Use the VM opcode directly from the mapping
                if (info.vmMapping) {
                    emit(info.vmMapping as any, targetReg, argReg, 0, context);
                } else {
                    throw new Error(`Unknown type conversion VM mapping: ${info.vmMapping}`);
                }
                break;
        }
    } else if (call.enumConversionInfo) {
        const info = call.enumConversionInfo;
        const enumIndex = addConstant({ type: 'string', value: info.enumName }, context);
        
        switch (info.vmMapping) {
            case 'INT_TO_ENUM':
                emit('INT_TO_ENUM', targetReg, argReg, enumIndex, context);
                break;
            case 'STRING_TO_ENUM':
                emit('STRING_TO_ENUM', targetReg, argReg, enumIndex, context);
                break;
            default:
                throw new Error(`Unknown enum conversion VM mapping: ${info.vmMapping}`);
        }
    }

    freeRegisters(allocatedRegs, context);
}

export function generateCallExpression(call: CallExpression, targetReg: number, context: CompilationContext): void {
    // Handle optional chaining method calls first: obj?.method(args)
    if (call.callee.kind === 'optionalChain') {
        generateOptionalChainMethodCall(call, targetReg, context);
        return;
    }

    // Handle type conversion calls first
    if (call.typeConversionInfo || call.enumConversionInfo) {
        generateTypeConversionCall(call, targetReg, context);
        return;
    }

    // Handle intrinsic calls first (both identifier and member expressions)
    if (call.intrinsicInfo) {
        generateIntrinsicExternCall(call, targetReg, context);
        return;
    }

    // Use validation-time call dispatch information for efficient codegen
    if (call.callInfo) {
        switch (call.callInfo.kind) {
            case 'intrinsic':
                // Handle intrinsic function calls (println, print, panic, etc.)
                if (call.callee.kind === 'identifier') {
                    const funcName = call.callInfo.targetName!;
                    generateIntrinsicCall(funcName, call.arguments, targetReg, context);
                    return;
                }
                break;
                
            case 'staticMethod':
                generateStaticMethodCall(call.callInfo.className!, call.callInfo.targetName!, call.arguments, targetReg, context);
                return;
                
            case 'instanceMethod':
                if (call.callInfo.methodType === 'class') {
                    const memberExpr = call.callee as MemberExpression;
                    // Prefer the class name resolved from the object's inferred type (specialized),
                    // because validator metadata may retain the unspecialized generic name.
                    const receiverType = resolveExpressionType(memberExpr.object, context);
                    const resolvedClass = resolveClassName(receiverType);
                    const className = resolvedClass || call.callInfo.className!;
                    if (vmDebugEnabled()) {
                        const mismatch = resolvedClass && resolvedClass !== call.callInfo.className!;
                        if (mismatch) {
                            dbg('Instance method call class mismatch; using resolved', {
                                validatorClass: call.callInfo.className,
                                resolvedClass,
                                method: call.callInfo.targetName
                            });
                        } else {
                            dbg('Instance method call', {
                                className,
                                method: call.callInfo.targetName
                            });
                        }
                    }
                    generateInstanceMethodCall(memberExpr.object, className, call.callInfo.targetName!, call.arguments, targetReg, context);
                    return;
                }
                break;
                
            case 'collectionMethod':
                const collectionMemberExpr = call.callee as MemberExpression;
                const methodName = call.callInfo.targetName!;
                
                switch (call.callInfo.methodType) {
                    case 'map':
                        generateMapMethodCall(collectionMemberExpr.object, methodName, call.arguments, targetReg, context);
                        return;
                    case 'set':
                        generateSetMethodCall(collectionMemberExpr.object, methodName, call.arguments, targetReg, context);
                        return;
                    case 'array':
                        generateArrayMethodCall(collectionMemberExpr.object, methodName, call.arguments, targetReg, context);
                        return;
                    case 'string':
                        generateStringMethodCall(collectionMemberExpr.object, methodName, call.arguments, targetReg, context);
                        return;
                }
                break;

            case 'unionMethod':
                throw new Error("Union method calls are not yet supported in the VM generator");
                
            case 'constructor':
                // Constructor calls are handled by converting to positional object expressions
                // This case shouldn't reach here normally, but handle gracefully
                throw new Error("Constructor calls should be converted to positional object expressions during validation");
                
            case 'lambda':
                // Lambda invocation - callee is an expression that evaluates to a lambda
                {
                    const allocatedRegs: number[] = [];
                    const calleeReg = generateExpressionOptimal(call.callee, allocatedRegs, context);
                    generateLambdaInvocation(calleeReg, call.arguments, targetReg, context);
                    
                    // Free allocated registers
                    freeRegisters(allocatedRegs, context);
                    return;
                }
                
            case 'function':
                if (call.callee.kind === 'identifier') {
                    const funcName = call.callInfo.targetName!;
                    
                    // Check if this is a lambda variable first
                    const lambdaReg = context.registerAllocator.getVariable(funcName);
                    if (lambdaReg !== undefined) {
                        const varType = context.variables?.get(funcName);
                        if (varType && isLambdaType(varType)) {
                            generateLambdaInvocation(lambdaReg, call.arguments, targetReg, context);
                            return;
                        }
                    }
                    
                    const funcMetadata = context.functionTable.get(funcName);
                    if (funcMetadata) {
                        // Use evaluation order-preserving call if we have reordering metadata
                        if (call.namedArgumentsLexicalOrder && call.namedArgumentsLexicalOrder.length > 0) {
                            generateUserFunctionCallWithEvalOrder(funcMetadata, call, targetReg, context);
                        } else {
                            generateUserFunctionCall(funcMetadata, call.arguments, targetReg, context);
                        }
                        return;
                    }
                }
                break;
        }
    }

    // Debug information for missing callInfo
    const calleeInfo = call.callee.kind === 'identifier' 
        ? `identifier: ${(call.callee as Identifier).name}`
        : call.callee.kind === 'member'
        ? `member: object=${call.callee.object.kind}, property=${call.callee.property.kind}`
        : `expression: ${call.callee.kind}`;
    
    throw new Error(`Unable to determine call target - missing callInfo in CallExpression for ${calleeInfo}`);
}

function generateMemberExpression(member: MemberExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];

    // Check if this is static member access (object is a class identifier)
    if (member.object.kind === 'identifier') {
        const identName = (member.object as Identifier).name;
        const validationContext = getActiveValidationContext(context);
        if (validationContext?.classes.has(identName) && member.property.kind === 'identifier') {
            const propertyName = member.property.name;
            const classDecl = validationContext.classes.get(identName);
            if (!classDecl) {
                throw new Error(`Class '${identName}' is missing in validation metadata while resolving '${propertyName}'`);
            }

            const staticField = classDecl.fields.find((field: FieldDeclaration) => field.name.name === propertyName && field.isStatic);
            if (!staticField) {
                throw new Error(`Static member '${propertyName}' not found in class '${identName}'`);
            }

            const globalFieldName = `${identName}.${propertyName}`;
            const globalSlot = context.globalSymbolTable.get(globalFieldName);
            if (globalSlot === undefined) {
                throw new Error(`Static field ${globalFieldName} not found in global symbol table`);
            }
            const globalHigh = Math.floor(globalSlot / 256);
            const globalLow = globalSlot % 256;
            emit('GET_GLOBAL', targetReg, globalHigh, globalLow, context);
            return;
        }

        // Handle enum member access: EnumName.Member
        if (validationContext?.enums.has(identName) && member.property.kind === 'identifier') {
            const enumDecl = validationContext.enums.get(identName)!;
            const memberName = member.property.name;
            const exists = enumDecl.members.some(m => m.name.name === memberName);
            if (!exists) {
                throw new Error(`Enum '${identName}' has no member '${memberName}'`);
            }
            // Determine backing value: number literal chains or explicit number, else keep string literal.
            // Determine backing value: explicit number/string or auto-increment numeric; else fallback to label
            let backingValue: any = memberName; // default fallback
            let currentOrdinal = 0;
            for (const m of enumDecl.members) {
                let value: any;
                if (m.value && (m.value as any).literalType === 'number') {
                    value = (m.value as any).value;
                    currentOrdinal = Number(value);
                } else if (!m.value) {
                    value = currentOrdinal;
                } else if ((m.value as any).literalType === 'string') {
                    value = (m.value as any).value;
                } else {
                    value = m.name.name;
                }
                if (m.name.name === memberName) {
                    backingValue = value;
                    break;
                }
                if (typeof value === 'number') {
                    currentOrdinal = Number(value) + 1;
                } else {
                    currentOrdinal = 0;
                }
            }
            if (typeof backingValue === 'number') {
                if (backingValue >= -32768 && backingValue <= 32767) {
                    emit('LOADK_INT16', targetReg, (backingValue >> 8) & 0xFF, backingValue & 0xFF, context);
                } else {
                    const constIndex = addConstant({ type: 'int', value: backingValue }, context);
                    emit('LOADK', targetReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
                }
            } else {
                const constIndex = addConstant({ type: 'string', value: backingValue }, context);
                emit('LOADK', targetReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
            }
            return;
        }
    }

    const objectReg = generateExpressionOptimal(member.object, allocatedRegs, context);
    const objectType = resolveExpressionType(member.object, context);

    if (!member.computed) {
        if (member.property.kind === 'identifier') {
            emitPropertyAccess(member.property.name, targetReg, objectReg, objectType, context);
        } else if (member.property.kind === 'literal' && typeof member.property.value === 'string') {
            emitPropertyAccess(member.property.value, targetReg, objectReg, objectType, context);
        } else {
            throw new Error('Unsupported property literal in member expression');
        }
    } else {
        throw new Error('Dynamic property access is not supported in the VM generator');
    }

    freeRegisters(allocatedRegs, context);
}

function generateIndexExpression(index: IndexExpression, targetReg: number, context: CompilationContext): void {
    const allocatedRegs: number[] = [];
    const objectReg = generateExpressionOptimal(index.object, allocatedRegs, context);
    const indexReg = generateExpressionOptimal(index.index, allocatedRegs, context);
    const objectType = resolveExpressionType(index.object, context);

    emitIndexAccess(targetReg, objectReg, indexReg, objectType, context);

    freeRegisters(allocatedRegs, context);
}

// Null-safety expression generators

function generateNullCoalesceExpression(expr: NullCoalesceExpression, targetReg: number, context: CompilationContext): void {
    // Generate: expr.left ?? expr.right
    // If left is null, use right; otherwise use left
    
    const leftReg = context.registerAllocator.allocate();
    generateExpression(expr.left, leftReg, context);
    
    // Check if left is null using IS_NULL opcode
    const nullCheckReg = context.registerAllocator.allocate();
    emit('IS_NULL', nullCheckReg, leftReg, 0, context);
    
    // If left is null, evaluate right expression
    const rightLabel = createLabel(context);
    const endLabel = createLabel(context);
    emitJump('JMP_IF_TRUE', nullCheckReg, rightLabel, context); // Jump to right if left is null
    
    // Left is not null, use left value
    if (leftReg !== targetReg) {
        emit('MOVE', targetReg, leftReg, 0, context);
    }
    emitJump('JMP', 0, endLabel, context);
    
    // Left is null, generate right expression
    setLabel(rightLabel, context);
    generateExpression(expr.right, targetReg, context);
    
    setLabel(endLabel, context);
    
    context.registerAllocator.free(leftReg);
    context.registerAllocator.free(nullCheckReg);
}

function generateOptionalChainMethodCall(call: CallExpression, targetReg: number, context: CompilationContext): void {
    // Handle: obj?.method(args)
    const optionalChain = call.callee as OptionalChainExpression;

    const objReg = context.registerAllocator.allocate();
    generateExpression(optionalChain.object, objReg, context);

    // Check if object is null
    const nullCheckReg = context.registerAllocator.allocate();
    emit('IS_NULL', nullCheckReg, objReg, 0, context);

    const methodCallLabel = createLabel(context);
    const endLabel = createLabel(context);

    // If object is NOT null, call the method
    emitJump('JMP_IF_FALSE', nullCheckReg, methodCallLabel, context);

    // Object is null, return null
    emit('LOADK_NULL', targetReg, 0, 0, context);
    emitJump('JMP', 0, endLabel, context);

    // Object is not null, call the method
    setLabel(methodCallLabel, context);

    if (optionalChain.property?.kind !== 'identifier') {
        throw new Error('Optional chaining method call requires identifier property access');
    }

    const objectType = resolveExpressionType(optionalChain.object, context);
    const className = resolveClassName(objectType);
    if (!className) {
        throw new Error(`Optional chaining method call requires class or extern class receiver, found ${describeTypeForError(objectType)}`);
    }

    const methodName = optionalChain.property.name;
    generateInstanceMethodCallFromRegister(objReg, className, methodName, call.arguments, targetReg, context);

    setLabel(endLabel, context);

    context.registerAllocator.free(objReg);
    context.registerAllocator.free(nullCheckReg);
}

function generateOptionalChainExpression(expr: OptionalChainExpression, targetReg: number, context: CompilationContext): void {
    // Generate: expr.object?.property (for field access only)
    // Method calls (expr.isMethodCall) are handled by generateOptionalChainMethodCall
    
    if (expr.isMethodCall) {
        throw new Error("Method calls in optional chaining should be handled by generateOptionalChainMethodCall");
    }
    
    const objReg = context.registerAllocator.allocate();
    generateExpression(expr.object, objReg, context);
    
    // Check if object is null
    const nullCheckReg = context.registerAllocator.allocate();
    emit('IS_NULL', nullCheckReg, objReg, 0, context);
    
    const propertyLabel = createLabel(context);
    const endLabel = createLabel(context);
    
    // If object is NOT null, access property
    emitJump('JMP_IF_FALSE', nullCheckReg, propertyLabel, context);
    
    // Object is null, return null
    emit('LOADK_NULL', targetReg, 0, 0, context);
    emitJump('JMP', 0, endLabel, context);
    
    // Object is not null, access property
    setLabel(propertyLabel, context);
    
    const objectType = resolveExpressionType(expr.object, context);

    if (expr.computed) {
        const indexReg = context.registerAllocator.allocate();
        generateExpression(expr.property as Expression, indexReg, context);
        emitIndexAccess(targetReg, objReg, indexReg, objectType, context);
        context.registerAllocator.free(indexReg);
    } else {
        if (!expr.property) {
            throw new Error('Optional chain property access requires a property');
        }

        if (expr.property.kind === 'identifier') {
            emitPropertyAccess(expr.property.name, targetReg, objReg, objectType, context);
        } else if (expr.property.kind === 'literal' && typeof expr.property.value === 'string') {
            emitPropertyAccess(expr.property.value, targetReg, objReg, objectType, context);
        } else {
            throw new Error('Optional chain property access only supports identifier or string literal properties');
        }
    }
    
    setLabel(endLabel, context);
    
    context.registerAllocator.free(objReg);
    context.registerAllocator.free(nullCheckReg);
}

function generateNonNullAssertionExpression(expr: NonNullAssertionExpression, targetReg: number, context: CompilationContext): void {
    // For now, just evaluate the operand without null checking
    // This is a simplified implementation - proper null assertion would need runtime checks
    generateExpression(expr.operand, targetReg, context);
}

function generateTupleExpression(expr: TupleExpression, targetReg: number, context: CompilationContext): void {
    // Get the inferred target type
    const targetType = (expr as any)._inferredTargetType || expr.inferredType;
    
    if (!targetType || (targetType.kind !== 'class' && targetType.kind !== 'externClass')) {
        throw new Error('Tuple expression must have a class or extern class target type');
    }
    
    const typeName = (targetType as any).name;
    
    // Generate the same VM bytecode as positional object expression
    // Create a temporary PositionalObjectExpression
    const positionalExpr: PositionalObjectExpression = {
        kind: 'positionalObject',
        className: typeName,
        arguments: expr.elements,
        location: expr.location
    };
    
    // Delegate to the positional object generator
    generatePositionalObjectExpression(positionalExpr, targetReg, context);
}

function generateEnumShorthandExpression(expr: EnumShorthandMemberExpression, targetReg: number, context: CompilationContext): void {
    const enumType: any = (expr as any)._expectedEnumType || expr.inferredType;
    if (!enumType || enumType.kind !== 'enum') {
        throw new Error(`Enum shorthand .${expr.memberName} missing enum context in VM codegen`);
    }
    const validationContext = getActiveValidationContext(context);
    const enumDecl = validationContext?.enums.get(enumType.name);
    if (!enumDecl) {
        throw new Error(`Enum '${enumType.name}' not found for shorthand .${expr.memberName}`);
    }
    // Determine backing value same way as member access above.
    // Compute backing value for shorthand
    let backingValue: any = expr.memberName;
    let currentOrdinal = 0;
    for (const m of enumDecl.members) {
        let value: any;
        if (m.value && (m.value as any).literalType === 'number') {
            value = (m.value as any).value;
            currentOrdinal = Number(value);
        } else if (!m.value) {
            value = currentOrdinal;
        } else if ((m.value as any).literalType === 'string') {
            value = (m.value as any).value;
        } else {
            value = m.name.name;
        }
        if (m.name.name === expr.memberName) {
            backingValue = value;
            break;
        }
        if (typeof value === 'number') {
            currentOrdinal = Number(value) + 1;
        } else {
            currentOrdinal = 0;
        }
    }
    if (typeof backingValue === 'number') {
        if (backingValue >= -32768 && backingValue <= 32767) {
            emit('LOADK_INT16', targetReg, (backingValue >> 8) & 0xFF, backingValue & 0xFF, context);
        } else {
            const constIndex = addConstant({ type: 'int', value: backingValue }, context);
            emit('LOADK', targetReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
        }
    } else {
        const constIndex = addConstant({ type: 'string', value: backingValue }, context);
        emit('LOADK', targetReg, (constIndex >> 8) & 0xFF, constIndex & 0xFF, context);
    }
}
