import {
    Expression, Type, ArrayExpression, ObjectExpression, PositionalObjectExpression, SetExpression,
    ObjectProperty, Identifier, Literal, MemberExpression, EnumShorthandMemberExpression,
    ArrayTypeNode, MapTypeNode, SetTypeNode, EnumTypeNode, ClassDeclaration, ExternClassDeclaration
} from "../../../types";
import { CppGenerator } from "../../cppgen";
import { generateExpression } from "../cpp-expression-codegen";
import { generateMemberExpression } from "./method-call-generators";

/**
 * Generates C++ code for array expressions
 */
export function generateArrayExpression(generator: CppGenerator, expr: ArrayExpression): string {
    // For multi-dimensional arrays, we need to pass the correct target type to each element
    let elements: string[];
    const targetType = expr.inferredType;

    if (!targetType ||  targetType.kind !== 'array') {
        throw new Error('Array expression missing inferred array type');
    }

    elements = expr.elements.map(elem => generateExpression(generator, elem, { targetType: targetType.elementType }));

    const elementsStr = elements.join(', ');

    const elementTypeStr = generator.generateType(targetType.elementType);

    // For empty arrays, use default constructor
    if (expr.elements.length === 0) {
        return `std::make_shared<std::vector<${elementTypeStr}>>()`;
    }

    return `std::make_shared<std::vector<${elementTypeStr}>>(std::initializer_list<${elementTypeStr}>{${elementsStr}})`;
}

/**
 * Generates C++ code for object expressions (both class instances and maps)
 */
export function generateObjectExpression(generator: CppGenerator, expr: ObjectExpression, targetType?: Type): string {
    if (expr.className) {
        return generateClassObjectExpression(generator, expr, targetType);
    } else {
        return generateMapObjectExpression(generator, expr);
    }
}

/**
 * Generates C++ code for positional object expressions
 */
export function generatePositionalObjectExpression(generator: CppGenerator, expr: PositionalObjectExpression): string {
    const className = expr.className;
    const qualifiedClassName = generator.getQualifiedClassName(className);

    // Use class positional initialization for all cases
    return generateClassPositionalInitialization(generator, expr);
}

/**
 * Generates C++ code for set expressions
 */
export function generateSetExpression(generator: CppGenerator, expr: SetExpression): string {
    // Get the element type from the set's inferred type
    let elementType: Type | undefined;
    if (expr.inferredType && expr.inferredType.kind === 'set') {
        const setType = expr.inferredType as SetTypeNode;
        elementType = setType.elementType;
    }

    // Generate elements with enum context if applicable
    const elements = expr.elements.map(elem => {
        if (elem.kind === 'enumShorthand' && elementType?.kind === 'enum') {
            const enumType = elementType as EnumTypeNode;
            const shorthandExpr = elem as EnumShorthandMemberExpression;
            return `${enumType.name}::${shorthandExpr.memberName}`;
        }
        return generateExpression(generator, elem);
    });

    // Generate compact initializer format
    return `{${elements.join(', ')}}`;
}

/**
 * Generates C++ code for class object expressions (named object expressions)
 */
function generateClassObjectExpression(generator: CppGenerator, expr: ObjectExpression, targetType?: Type): string {
    return generateClassInitialization(generator, expr, targetType);
}

/**
 * Generates C++ code for map object expressions (anonymous object expressions)
 */
function generateMapObjectExpression(generator: CppGenerator, expr: ObjectExpression): string {
    // Get the key type from the map's inferred type for enum resolution
    let keyType: Type | undefined;
    if (expr.inferredType && expr.inferredType.kind === 'map') {
        const mapType = expr.inferredType as MapTypeNode;
        keyType = mapType.keyType;
    }

    // Generate as compact initializer list format for map literals
    const entries = expr.properties.map(prop => {
        let key: string;
        if (prop.key.kind === 'enumShorthand' && keyType?.kind === 'enum') {
            const enumType = keyType as EnumTypeNode;
            const shorthandExpr = prop.key as EnumShorthandMemberExpression;
            key = `${enumType.name}::${shorthandExpr.memberName}`;
        } else {
            key = generatePropertyKey(generator, prop.key);
        }
        const value = getPropertyValue(generator, prop);
        return `{${key}, ${value}}`;
    });

    return `{${entries.join(', ')}}`;
}

/**
 * Generates C++ code for class initialization
 */
function generateClassInitialization(generator: CppGenerator, expr: ObjectExpression, targetType?: Type): string {
    const className = expr.className!;
    const qualifiedClassName = generator.getQualifiedClassName(className);

    const classDecl = generator.getClassDeclaration(className);
    const externClassDecl = generator.getExternClassDeclaration(className);

    if (!classDecl && !externClassDecl) {
        throw new Error(`Unknown class: ${className}`);
    }

    // Handle extern classes
    if (externClassDecl) {
        return generateAggregateExternClassInitialization(generator, expr, externClassDecl);
    }

    if (!classDecl) {
        throw new Error(`Class definition not found: ${className}`);
    }

    if (classDecl.constructor) {
        return generateConstructorClassInitialization(generator, expr, classDecl);
    }

    return generateAggregateClassInitialization(generator, expr, classDecl);
}

/**
 * Generates C++ code for extern class initialization
 */
function generateAggregateExternClassInitialization(generator: CppGenerator, expr: ObjectExpression, externClassDecl: ExternClassDeclaration): string {
    const className = expr.className!;
    const qualifiedClassName = generator.getQualifiedClassName(className);

    // For extern classes, use the properties provided in the object expression
    const args: string[] = [];
    for (const prop of expr.properties) {
        args.push(getPropertyValue(generator, prop));
    }

    return `std::make_shared<${qualifiedClassName}>(${args.join(', ')})`;
}

/**
 * Generates C++ code for aggregate class initialization
 */
function generateAggregateClassInitialization(generator: CppGenerator, expr: ObjectExpression, classDecl: ClassDeclaration): string {
    const className = expr.className!;
    const qualifiedClassName = generator.getQualifiedClassName(className);

    // Get all non-static fields in order
    const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);

    // Use aggregate constructor with make_shared
    const args = nonStaticFields.map(field => {
        // Find property for this field
        const prop = expr.properties.find(p =>
            p.key.kind === 'identifier' && (p.key as Identifier).name === field.name.name
        );

        if (prop) {
            return getPropertyValue(generator, prop, field.type);
        } else if (field.defaultValue) {
            return generateExpression(generator, field.defaultValue, { targetType: field.type });
        } else {
            return generator.generateDefaultInitializer(field.type);
        }
    });

    return `std::make_shared<${qualifiedClassName}>(${args.join(', ')})`;
}

function generateConstructorClassInitialization(generator: CppGenerator, expr: ObjectExpression, classDecl: ClassDeclaration): string {
    const qualifiedClassName = generator.getQualifiedClassName(classDecl.name.name);
    const constructorDecl = classDecl.constructor!;

    const propertyMap = new Map<string, ObjectProperty>();
    for (const prop of expr.properties) {
        if (prop.key.kind === 'identifier') {
            propertyMap.set((prop.key as Identifier).name, prop);
        }
    }

    let lastProvidedIndex = -1;
    for (let i = constructorDecl.parameters.length - 1; i >= 0; i--) {
        const paramName = constructorDecl.parameters[i].name.name;
        if (propertyMap.has(paramName)) {
            lastProvidedIndex = i;
            break;
        }
    }

    if (lastProvidedIndex === -1) {
        return `${qualifiedClassName}::_new()`;
    }

    const args: string[] = [];
    for (let i = 0; i <= lastProvidedIndex; i++) {
        const param = constructorDecl.parameters[i];
        const prop = propertyMap.get(param.name.name);
        if (!prop) {
            throw new Error(`Missing constructor argument '${param.name.name}' for class '${classDecl.name.name}'`);
        }
        args.push(getPropertyValue(generator, prop, param.type));
    }

    return `${qualifiedClassName}::_new(${args.join(', ')})`;
}

/**
 * Generates C++ code for positional class initialization
 */
function generateClassPositionalInitialization(generator: CppGenerator, expr: PositionalObjectExpression): string {
    const className = expr.className;
    const qualifiedClassName = generator.getQualifiedClassName(className);

    // Get class declaration to check for constructor
    const classDecl = generator.getClassDeclaration(className);
    const externClassDecl = generator.getExternClassDeclaration(className);

    if (!classDecl && !externClassDecl) {
        throw new Error(`Unknown class: ${className}`);
    }

    const args = expr.arguments.map(arg => generateExpression(generator, arg));

    // Handle extern classes
    if (externClassDecl) {
        return `std::make_shared<${qualifiedClassName}>(${args.join(', ')})`;
    }

    if (classDecl && classDecl.constructor) {
        return `${qualifiedClassName}::_new(${args.join(', ')})`;
    }

    return `std::make_shared<${qualifiedClassName}>(${args.join(', ')})`;
}

/**
 * Gets the value of an object property
 */
function getPropertyValue(generator: CppGenerator, prop: ObjectProperty, targetType?: Type): string {
    if (prop.value) {
        return generateExpression(generator, prop.value, { targetType });
    } else {
        // Shorthand property: {name} is equivalent to {name: name}
        if (prop.key.kind === 'identifier') {
            return (prop.key as Identifier).name;
        }
        throw new Error('Shorthand property requires identifier key');
    }
}

/**
 * Generates property keys for object literals and maps
 */
function generatePropertyKey(generator: CppGenerator, key: Identifier | Literal | MemberExpression | EnumShorthandMemberExpression, expectedEnumType?: string, isMapKey: boolean = false): string {
    if (key.kind === 'identifier') {
        return `"${(key as Identifier).name}"`;
    } else if (key.kind === 'literal') {
        const literal = key as Literal;
        if (literal.literalType === 'string') {
            return `"${String(literal.value)}"`;
        } else {
            return String(literal.value);
        }
    } else if (key.kind === 'member') {
        // Member expression like Enum.Value
        return generateMemberExpression(generator, key as MemberExpression);
    } else if (key.kind === 'enumShorthand') {
        // Shorthand like .Value
        const shorthand = key as EnumShorthandMemberExpression;
        if (expectedEnumType) {
            return `${expectedEnumType}::${shorthand.memberName}`;
        } else {
            throw new Error(`Enum shorthand .${shorthand.memberName} requires expected enum type`);
        }
    } else {
        const exhaustiveCheck: never = key;
        throw new Error(`Unsupported property key type: ${(exhaustiveCheck as any).kind}`);
    }
}

// Type inference utility (simplified)
function inferTypeFromExpression(generator: CppGenerator, expr: Expression): Type {
    if (expr.inferredType) {
        return expr.inferredType;
    }
    // Simplified implementation - would need full type inference
    return { kind: 'primitive', type: 'void' } as any;
}
