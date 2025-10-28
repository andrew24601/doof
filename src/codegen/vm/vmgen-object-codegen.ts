import { ObjectExpression, PositionalObjectExpression, SetExpression, ArrayExpression, InterpolatedString, TypeGuardExpression, PrimitiveTypeNode, ClassTypeNode, ExternClassTypeNode, ObjectProperty, MapTypeNode, Identifier, Expression, Literal } from "../../types";
import { CompilationContext, VMValue, getActiveValidationContext } from "../vmgen";
import { addConstant, emit, findClassInConstantPool } from "./vmgen-emit";
import { generateExpression } from "./vmgen-expression-codegen";
import { getInstanceFieldIndex } from "./vmgen-class-utils";
import { getTypeCategory } from "./vmgen-type-utils";
import { generateConstructorCall, isExternClass, generateExternCall } from "./vmgen-call-codegen";

const VALUE_TYPE_IDS: Partial<Record<PrimitiveTypeNode['type'], number>> = {
    bool: 1,
    int: 2,
    float: 3,
    double: 4,
    char: 5,
    string: 6,
};

function getPrimitiveValueTypeId(type: PrimitiveTypeNode['type']): number {
    const valueTypeId = VALUE_TYPE_IDS[type];
    if (valueTypeId === undefined) {
        throw new Error(`Unsupported primitive type guard for '${type}'`);
    }
    return valueTypeId;
}

export function generateObjectExpression(objExpr: ObjectExpression, targetReg: number, context: CompilationContext): void {
    const inferredType = objExpr.inferredType;

    if (!inferredType) {
        throw new Error("Object expression is missing inferred type information for VM generation");
    }

    if (inferredType.kind === 'map') {
        generateMapLiteral(objExpr, targetReg, context);
        return;
    }

    if (inferredType.kind === 'set') {
        generateSetLiteral(objExpr, targetReg, context);
        return;
    }

    const className = objExpr.instantiationInfo?.targetClass ?? objExpr.className;
    if (!className) {
        throw new Error("Object literal must target a class or map/set type in VM backend");
    }

    if (isExternClass(className, context)) {
        if (className === 'StringBuilder') {
            generateExternCall('StringBuilder::create', [], context);
            if (targetReg !== 0) {
                emit('MOVE', targetReg, 0, 0, context);
            }
            return;
        }

        throw new Error(`Object literal construction not supported for extern class ${className}`);
    }

    const validationContext = getActiveValidationContext(context);
    if (!validationContext?.classes.has(className)) {
        throw new Error(`Class metadata not found for ${className}`);
    }

    generateObjectWithFieldAssignments(className, objExpr.properties, targetReg, context);
}

/**
 * Generate positional object expression (field-order initialization)
 */
export function generatePositionalObjectExpression(posExpr: PositionalObjectExpression, targetReg: number, context: CompilationContext): void {
    const className = posExpr.className;

    // For extern classes, use special constructor handling
    if (isExternClass(className, context)) {
        generateConstructorCall(className, posExpr.arguments, targetReg, context);
        return;
    }
    
    // For regular classes, use field-order initialization (no explicit constructors)
    const validationContext = getActiveValidationContext(context);
    if (validationContext?.classes.has(className)) {
        const classDecl = validationContext.classes.get(className)!;
        
        // Create object
        const classConstantIndex = findClassInConstantPool(className, context);
        emit('NEW_OBJECT', targetReg, Math.floor(classConstantIndex / 256), classConstantIndex % 256, context);
        
        // Initialize all fields with their default values first
        const allFields = classDecl.fields.filter(f => !f.isStatic);
        for (const field of allFields) {
            if (field.defaultValue) {
                const fieldIndex = getInstanceFieldIndex(className, field.name.name, context);
                
                // Generate default value
                const valueReg = context.registerAllocator.allocate();
                generateExpression(field.defaultValue, valueReg, context);
                
                // Set field: SET_FIELD objectReg, fieldIndex, valueReg
                emit('SET_FIELD', targetReg, fieldIndex, valueReg, context);
                
                context.registerAllocator.free(valueReg);
            }
        }
        
        // Then initialize fields with positional arguments (overriding defaults)
        const publicFields = classDecl.fields.filter(f => f.isPublic && !f.isStatic);
        
        for (let i = 0; i < posExpr.arguments.length && i < publicFields.length; i++) {
            const field = publicFields[i];
            const fieldIndex = getInstanceFieldIndex(className, field.name.name, context);
            
            // Generate argument value
            const valueReg = context.registerAllocator.allocate();
            generateExpression(posExpr.arguments[i], valueReg, context);
            
            // Set field: SET_FIELD objectReg, fieldIndex, valueReg
            emit('SET_FIELD', targetReg, fieldIndex, valueReg, context);
            
            context.registerAllocator.free(valueReg);
        }
    } else {
        throw new Error(`Class metadata not found for ${className}`);
    }
}

export function generateArrayExpression(array: ArrayExpression, targetReg: number, context: CompilationContext): void {
    // Create new array
    const size = array.elements.length;
    emit('NEW_ARRAY', targetReg, Math.floor(size / 256), size % 256, context);

    // Set array elements
    for (let i = 0; i < array.elements.length; i++) {
        const elementReg = context.registerAllocator.allocate();
        const indexReg = context.registerAllocator.allocate();

        generateExpression(array.elements[i], elementReg, context);
        emit('LOADK_INT16', indexReg, Math.floor(i / 256), i % 256, context);
        emit('SET_ARRAY', targetReg, indexReg, elementReg, context);

        context.registerAllocator.free(elementReg);
        context.registerAllocator.free(indexReg);
    }
}

export function generateInterpolatedString(interpolated: InterpolatedString, targetReg: number, context: CompilationContext): void {
    if (interpolated.parts.length === 0) {
        // Empty string
        const stringValue: VMValue = {
            type: 'string',
            value: ''
        };
        const stringIndex = addConstant(stringValue, context);
        emit('LOADK', targetReg, Math.floor(stringIndex / 256), stringIndex % 256, context);
        return;
    }

    // For simplicity, concatenate all parts using string addition
    let currentResultReg = targetReg;
    let isFirstPart = true;

    for (let i = 0; i < interpolated.parts.length; i++) {
        const part = interpolated.parts[i];
        const partReg = context.registerAllocator.allocate();

        if (typeof part === 'string') {
            // String literal part
            const stringValue: VMValue = {
                type: 'string',
                value: part
            };
            const stringIndex = addConstant(stringValue, context);
            emit('LOADK', partReg, Math.floor(stringIndex / 256), stringIndex % 256, context);
        } else {
            // Expression part - generate and convert to string if needed
            generateExpression(part, partReg, context);
            // TODO: Add type conversion to string if needed
        }

        if (isFirstPart) {
            // First part goes directly to target
            emit('MOVE', targetReg, partReg, 0, context);
            isFirstPart = false;
        } else {
            // Concatenate with previous result
            const tempReg = context.registerAllocator.allocate();
            emit('ADD_STRING', tempReg, currentResultReg, partReg, context);
            emit('MOVE', currentResultReg, tempReg, 0, context);
            context.registerAllocator.free(tempReg);
        }

        context.registerAllocator.free(partReg);
    }
}

/**
 * Generate set expression (set literal) - creates set with initial elements
 */
export function generateSetExpression(setExpr: SetExpression, targetReg: number, context: CompilationContext): void {
    // Get set element type from inferred type
    let elementTypeCategory = 'string';
    if (setExpr.inferredType && setExpr.inferredType.kind === 'set') {
        const setType = setExpr.inferredType as any;
        elementTypeCategory = setType.elementType?.kind === 'primitive' && 
                              (setType.elementType as any).type === 'int' ? 'int' : 'string';
    }
    const newSetOpcode = elementTypeCategory === 'int' ? 'NEW_SET_INT' : 'NEW_SET';
    const addSetOpcode = elementTypeCategory === 'int' ? 'ADD_SET_INT' : 'ADD_SET';

    // Create new set
    emit(newSetOpcode, targetReg, 0, 0, context);

    // Add each element to the set
    for (const element of setExpr.elements) {
        const elementReg = context.registerAllocator.allocate();

        // Generate the element value
        generateExpression(element, elementReg, context);

        // Add element to set with appropriate opcode
        emit(addSetOpcode, 0, targetReg, elementReg, context);

        context.registerAllocator.free(elementReg);
    }
}

/**
 * Generate type guard expression (type check) - creates boolean result
 */
export function generateTypeGuardExpression(typeGuard: TypeGuardExpression, targetReg: number, context: CompilationContext): void {
    // Generate the object to check
    const objectReg = context.registerAllocator.allocate();
    generateExpression(typeGuard.expression, objectReg, context);

    if (typeGuard.type.kind === 'primitive') {
        // Handle primitive type guards
        const primitiveType = typeGuard.type as PrimitiveTypeNode;
        generatePrimitiveTypeGuard(objectReg, primitiveType.type, targetReg, context);
    } else if (typeGuard.type.kind === 'class') {
        // Handle class type guards (instanceof checks)
        const className = (typeGuard.type as ClassTypeNode).name;
        generateClassTypeGuard(objectReg, className, targetReg, context);
    } else if (typeGuard.type.kind === 'externClass') {
        // Handle extern class type guards
        const className = (typeGuard.type as ExternClassTypeNode).name;
        generateClassTypeGuard(objectReg, className, targetReg, context);
    } else {
        throw new Error(`Type guard not supported for type: ${typeGuard.type.kind}`);
    }

    context.registerAllocator.free(objectReg);
}

/**
 * Generate object creation with field assignments (for classes without constructors)
 */
function resolveFieldName(prop: ObjectProperty): string | null {
    if (prop.key.kind === 'identifier') {
        return prop.key.name;
    }

    if (prop.key.kind === 'literal') {
        const literalKey = prop.key as Literal;
        return typeof literalKey.value === 'string' ? literalKey.value : null;
    }

    return null;
}

function resolvePropertyValueExpression(prop: ObjectProperty): Expression | null {
    if (prop.value) {
        return prop.value;
    }

    if (prop.shorthand && prop.key.kind === 'identifier') {
        return prop.key;
    }

    return null;
}

function generateObjectWithFieldAssignments(
    className: string,
    properties: ObjectProperty[],
    targetReg: number,
    context: CompilationContext
): void {
    // Create the object first
    const classConstantIndex = findClassInConstantPool(className, context);
    emit('NEW_OBJECT', targetReg, Math.floor(classConstantIndex / 256), classConstantIndex % 256, context);

    // Initialize all fields with their default values first
    const validationContext = getActiveValidationContext(context);
    if (validationContext?.classes.has(className)) {
        const classDecl = validationContext.classes.get(className)!;
        const allFields = classDecl.fields.filter(f => !f.isStatic);
        
        for (const field of allFields) {
            if (field.defaultValue) {
                const fieldIndex = getInstanceFieldIndex(className, field.name.name, context);
                
                // Generate default value
                const valueReg = context.registerAllocator.allocate();
                generateExpression(field.defaultValue, valueReg, context);
                
                // Set field: SET_FIELD objectReg, fieldIndex, valueReg
                emit('SET_FIELD', targetReg, fieldIndex, valueReg, context);
                
                context.registerAllocator.free(valueReg);
            }
        }
    }

    // Then set each explicitly provided field (overriding defaults)
    for (const prop of properties) {
        const fieldName = resolveFieldName(prop);
        if (!fieldName) {
            throw new Error(`Unsupported object literal key '${prop.key.kind}' for class ${className}`);
        }

        const valueExpression = resolvePropertyValueExpression(prop);
        if (!valueExpression) {
            throw new Error(`Object literal property '${fieldName}' for class ${className} is missing a value`);
        }

        const fieldIndex = getInstanceFieldIndex(className, fieldName, context);

        const valueReg = context.registerAllocator.allocate();
        generateExpression(valueExpression, valueReg, context);

        emit('SET_FIELD', targetReg, fieldIndex, valueReg, context);

        context.registerAllocator.free(valueReg);
    }
}

/**
 * Generate set literal from object expression - creates set with initial elements from object properties
 */
function generateSetLiteral(objExpr: ObjectExpression, targetReg: number, context: CompilationContext): void {
    // Get set element type from inferred type
    const setType = objExpr.inferredType as any;
    const elementTypeCategory = setType.elementType?.kind === 'primitive' && 
                                (setType.elementType as any).type === 'int' ? 'int' : 'string';
    const newSetOpcode = elementTypeCategory === 'int' ? 'NEW_SET_INT' : 'NEW_SET';
    const addSetOpcode = elementTypeCategory === 'int' ? 'ADD_SET_INT' : 'ADD_SET';

    // Create new set
    emit(newSetOpcode, targetReg, 0, 0, context);

    // Add each property value as a set element
    for (const prop of objExpr.properties) {
        if (prop.value) {
            const elementReg = context.registerAllocator.allocate();

            // Generate the element value
            generateExpression(prop.value, elementReg, context);

            // Add element to set with appropriate opcode
            emit(addSetOpcode, 0, targetReg, elementReg, context);

            context.registerAllocator.free(elementReg);
        }
    }
}

/**
 * Generate map literal from object expression - creates map with key-value pairs
 */
function generateMapLiteral(objExpr: ObjectExpression, targetReg: number, context: CompilationContext): void {
    // Validate that this is a proper map type
    const mapType = objExpr.inferredType as MapTypeNode;

    // Get map key type from inferred type
    const keyTypeCategory = getTypeCategory(mapType.keyType);

    // Create new map with appropriate type
    const newMapOpcode = keyTypeCategory === 'int' ? 'NEW_MAP_INT' : 'NEW_MAP';
    emit(newMapOpcode, targetReg, 0, 0, context);

    // Set each key-value pair
    const setMapOpcode = keyTypeCategory === 'int' ? 'SET_MAP_INT' : 'SET_MAP';
    for (const prop of objExpr.properties) {
        if (prop.key.kind === 'literal' && prop.value) {
            const keyReg = context.registerAllocator.allocate();
            const valueReg = context.registerAllocator.allocate();

            // Generate key
            generateExpression(prop.key as any, keyReg, context);

            // Generate value
            generateExpression(prop.value, valueReg, context);

            // Set map entry with appropriate opcode
            emit(setMapOpcode, targetReg, keyReg, valueReg, context);

            context.registerAllocator.free(keyReg);
            context.registerAllocator.free(valueReg);
        } else if (prop.key.kind === 'identifier' && prop.value) {
            // For identifier keys, convert to string literal
            const keyReg = context.registerAllocator.allocate();
            const valueReg = context.registerAllocator.allocate();

            const keyName = (prop.key as Identifier).name;
            const stringValue: VMValue = {
                type: 'string',
                value: keyName
            };
            const stringIndex = addConstant(stringValue, context);
            emit('LOADK', keyReg, Math.floor(stringIndex / 256), stringIndex % 256, context);

            // Generate value
            generateExpression(prop.value, valueReg, context);

            // Set map entry with appropriate opcode
            emit('SET_MAP', targetReg, keyReg, valueReg, context);

            context.registerAllocator.free(keyReg);
            context.registerAllocator.free(valueReg);
        }
    }
}

/**
 * Generate primitive type guard using runtime type checks
 */
function generatePrimitiveTypeGuard(objectReg: number, primitiveType: PrimitiveTypeNode['type'], targetReg: number, context: CompilationContext): void {
    // Use TYPE_OF opcode to get the runtime type and compare it with expected type
    if (primitiveType === 'null') {
        emit('IS_NULL', targetReg, objectReg, 0, context);
        return;
    }

    const typeId = getPrimitiveValueTypeId(primitiveType);
    const typeReg = context.registerAllocator.allocate();
    const expectedTypeReg = context.registerAllocator.allocate();

    emit('TYPE_OF', typeReg, objectReg, 0, context);
    emit('LOADK_INT16', expectedTypeReg, 0, typeId, context);
    emit('EQ_INT', targetReg, typeReg, expectedTypeReg, context);

    context.registerAllocator.free(expectedTypeReg);
    context.registerAllocator.free(typeReg);
}

/**
 * Generate class type guard (instanceof check)
 */
function generateClassTypeGuard(objectReg: number, className: string, targetReg: number, context: CompilationContext): void {
    const classConstantIndex = findClassInConstantPool(className, context);

    // Get the class index of the object
    const classIdxReg = context.registerAllocator.allocate();
    emit('GET_CLASS_IDX', classIdxReg, objectReg, 0, context);

    // Load the expected class index as an immediate
    const expectedClassReg = context.registerAllocator.allocate();
    emit('LOADK_INT16', expectedClassReg, Math.floor(classConstantIndex / 256), classConstantIndex % 256, context);

    // Compare the class indices
    emit('EQ_INT', targetReg, classIdxReg, expectedClassReg, context);

    context.registerAllocator.free(expectedClassReg);
    context.registerAllocator.free(classIdxReg);
}
