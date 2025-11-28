// C++ class declaration generation for doof

import {
    Type, ClassDeclaration, Expression, ConstructorDeclaration, MethodDeclaration,
    PrimitiveTypeNode, ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, EnumTypeNode, ExternClassTypeNode
} from '../../types';
import { CppGenerator } from '../cppgen';

type JsonGenerationFlags = {
    needsToJSON: boolean;
    needsFromJSON: boolean;
};

function computeJsonGenerationFlags(generator: CppGenerator, className: string): JsonGenerationFlags {
    const validationContext = generator.validationContext;
    if (!validationContext) {
        return { needsToJSON: true, needsFromJSON: true };
    }

    const hints = validationContext.codeGenHints;
    const printSet = hints?.jsonPrintTypes;
    const fromSet = hints?.jsonFromTypes;
    const hasAnyJsonTypes =
        ((printSet?.size ?? 0) > 0) ||
        ((fromSet?.size ?? 0) > 0);

    // If nothing has explicitly opted-in via hints, do not generate any JSON helpers.
    // Generation is driven by actual usage (println or static fromJSON calls).
    if (!hasAnyJsonTypes) {
        return { needsToJSON: false, needsFromJSON: false };
    }

    return {
        needsToJSON: !!printSet?.has(className),
        needsFromJSON: !!fromSet?.has(className)
    };
}

export function generateClassDeclarationHeader(generator: CppGenerator, classDecl: ClassDeclaration): string {
    generator.currentClass = classDecl;

    // All classes inherit from enable_shared_from_this for simplified shared_ptr management
    const inheritance = ` : public std::enable_shared_from_this<${classDecl.name.name}>`;

    let output = generator.indent() + `class ${classDecl.name.name}${inheritance} {\n`;
    generator.increaseIndent();
    const constructorDecl = classDecl.constructor;
    const hasConstructor = !!constructorDecl;
    const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);

    output += generator.indent() + 'public:\n';
    generator.increaseIndent();

    if (hasConstructor) {
        const factoryParams = formatConstructorParameterList(generator, constructorDecl!, true);
        output += generator.indent() + `static std::shared_ptr<${classDecl.name.name}> _new(${factoryParams});\n`;
        if (constructorDecl!.isPublic) {
            output += generateMethodDeclarationHeader(generator, createSyntheticConstructorMethod(classDecl));
        }
    } else {
        output += generator.indent() + `${classDecl.name.name}();\n`;

        if (nonStaticFields.length > 0) {
            const params = nonStaticFields.map(field => {
                const typeStr = generateParameterType(generator, field.type);
                const fieldName = encodeCppFieldName(field.name.name);
                return `${typeStr} ${fieldName}`;
            }).join(', ');
            output += generator.indent() + `${classDecl.name.name}(${params});\n`;
        }
    }

    for (const method of classDecl.methods) {
        if (method.isPublic && !method.isStatic) {
            output += generateMethodDeclarationHeader(generator, method);
        }
    }

    const { needsToJSON, needsFromJSON } = computeJsonGenerationFlags(generator, classDecl.name.name);

    if (needsToJSON) {
        output += generator.indent() + 'void _toJSON(std::ostream& os) const;\n';
    }

    if (needsFromJSON) {
        output += generator.indent() + `static std::shared_ptr<${classDecl.name.name}> fromJSON(const std::string& json_str);\n`;
        output += generator.indent() + `static std::shared_ptr<${classDecl.name.name}> _fromJSON(const doof_runtime::json::JSONObject& json_obj);\n`;
    }

    for (const method of classDecl.methods) {
        if (method.isStatic) {
            output += generator.indent() + 'static ' + generateMethodDeclarationHeader(generator, method, false);
        }
    }

    for (const field of classDecl.fields) {
        if (field.isPublic && !field.isStatic) {
            output += generator.indent();
            if (field.isConst || field.isReadonly) {
                output += 'const ';
            }
            const fieldName = getCppFieldName(field);
            output += `${generator.generateType(field.type)} ${fieldName}`;
            if (field.defaultValue && (field.isConst || field.isReadonly)) {
                output += ` = ${generator.generateExpression(field.defaultValue, field.type)}`;
            }
            output += ';\n';
        }
    }

    const hasPrivateMembers = hasConstructor || classDecl.fields.some(f => !f.isPublic) ||
        classDecl.methods.some(m => !m.isPublic);

    if (hasPrivateMembers) {
        generator.decreaseIndent();
        output += generator.indent() + 'private:\n';
        generator.increaseIndent();

        if (hasConstructor) {
            output += generator.indent() + `${classDecl.name.name}();\n`;
            if (!constructorDecl!.isPublic) {
                output += generateMethodDeclarationHeader(generator, createSyntheticConstructorMethod(classDecl));
            }
        }

        for (const field of classDecl.fields) {
            if (!field.isPublic && !field.isStatic) {
                output += generator.indent();
                if (field.isConst || field.isReadonly) {
                    output += 'const ';
                }
                const fieldName = getCppFieldName(field);
                output += `${generator.generateType(field.type)} ${fieldName}`;
                if (field.defaultValue) {
                    output += ` = ${generator.generateExpression(field.defaultValue, field.type)}`;
                }
                output += ';\n';
            }
        }

        for (const method of classDecl.methods) {
            if (!method.isPublic && !method.isStatic) {
                output += generateMethodDeclarationHeader(generator, method);
            }
        }
    }

    const staticFields = classDecl.fields.filter(f => f.isStatic);
    if (staticFields.length > 0) {
        generator.decreaseIndent();
        output += generator.indent() + 'public: // Static members\n';
        generator.increaseIndent();

        for (const field of staticFields) {
            output += generator.indent() + 'static ';
            if (field.isConst || field.isReadonly) {
                if (generator.canUseConstexpr(field.type, field.defaultValue)) {
                    output += 'constexpr ';
                } else {
                    output += 'const ';
                }
            }
            output += `${generator.generateType(field.type)} ${field.name.name}`;
            if ((field.isConst || field.isReadonly) && field.defaultValue && generator.canUseConstexpr(field.type, field.defaultValue)) {
                output += ` = ${generator.generateExpression(field.defaultValue, field.type)}`;
            }
            output += ';\n';
        }
    }

    generator.decreaseIndent();
    generator.decreaseIndent();
    output += generator.indent() + '};\n';

    if (needsToJSON) {
        output += '\n';
        output += generator.indent() + `std::ostream& operator<<(std::ostream& os, const ${classDecl.name.name}& obj);\n`;
        output += generator.indent() + `std::ostream& operator<<(std::ostream& os, const std::shared_ptr<${classDecl.name.name}>& obj);\n`;
    }

    generator.currentClass = undefined;
    generator.currentMethod = undefined;
    return output;
}

export function generateClassDeclarationSource(generator: CppGenerator, classDecl: ClassDeclaration): string {
    generator.currentClass = classDecl;
    let output = '';
    const constructorDecl = classDecl.constructor;
    const hasConstructor = !!constructorDecl;

    const constFields = classDecl.fields.filter(f => (f.isConst || f.isReadonly) && !f.isStatic);
    const constInitializers = constFields
        .filter(f => f.defaultValue)
        .map(f => `${getCppFieldName(f)}(${generator.generateExpression(f.defaultValue!, f.type)})`);

    output += `${classDecl.name.name}::${classDecl.name.name}()`;

    if (constInitializers.length > 0) {
        output += ' : ' + constInitializers.join(', ');
    }

    output += ' {\n';

    for (const field of classDecl.fields) {
        if (field.defaultValue && !field.isStatic && !field.isConst && !field.isReadonly) {
            const cppFieldName = getCppFieldName(field);
            output += `    ${cppFieldName} = ${generator.generateExpression(field.defaultValue, field.type)};\n`;
        }
    }

    output += '}\n\n';

    const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);
    if (!hasConstructor && nonStaticFields.length > 0) {
        const params = nonStaticFields.map(field => {
            const typeStr = generateParameterType(generator, field.type);
            const fieldName = getCppFieldName(field);
            return `${typeStr} ${fieldName}`;
        }).join(', ');

        output += `${classDecl.name.name}::${classDecl.name.name}(${params})`;

        const memberInitializerList = nonStaticFields
            .filter(field => field.isConst || field.isReadonly)
            .map(field => `${getCppFieldName(field)}(${getCppFieldName(field)})`);

        if (memberInitializerList.length > 0) {
            output += ' : ' + memberInitializerList.join(', ');
        }

        output += ' {\n';

        for (const field of nonStaticFields) {
            if (!field.isConst && !field.isReadonly) {
                const cppFieldName = getCppFieldName(field);
                output += `    this->${cppFieldName} = ${cppFieldName};\n`;
            }
        }

        output += '}\n\n';
    }

    if (constructorDecl) {
        output += generateFactoryMethodSource(generator, classDecl);
        output += '\n';
        output += generateMethodDeclarationSource(generator, createSyntheticConstructorMethod(classDecl), classDecl.name.name);
        output += '\n';
    }

    for (const method of classDecl.methods) {
        if (!method.isStatic) {
            output += generateMethodDeclarationSource(generator, method, classDecl.name.name);
            output += '\n';
        } else {
            output += generateStaticMethodDeclarationSource(generator, method, classDecl.name.name);
            output += '\n';
        }
    }

    const { needsToJSON, needsFromJSON } = computeJsonGenerationFlags(generator, classDecl.name.name);

    if (needsToJSON) {
        output += generateToJSONMethodSource(generator, classDecl);
        output += '\n';
        output += generateOperatorOverloadSource(generator, classDecl);
        output += '\n';
    }

    if (needsFromJSON) {
        output += generateFromJSONMethodSource(generator, classDecl);
        output += '\n';
    }

    for (const field of classDecl.fields) {
        if (!field.isStatic) {
            continue;
        }

        const fieldType = generator.generateType(field.type);
        const qualifiedName = `${classDecl.name.name}::${field.name.name}`;

        if (field.isConst || field.isReadonly) {
            if (field.defaultValue && generator.canUseConstexpr(field.type, field.defaultValue)) {
                continue;
            }
            output += `const ${fieldType} ${qualifiedName}`;
        } else {
            output += `${fieldType} ${qualifiedName}`;
        }

        if (field.defaultValue) {
            output += ` = ${generator.generateExpression(field.defaultValue, field.type)}`;
        }

        output += ';\n';
    }

    generator.currentClass = undefined;
    generator.currentMethod = undefined;
    return output;
}

export function generateToJSONMethodSource(generator: CppGenerator, classDecl: ClassDeclaration): string {
    let output = `void ${classDecl.name.name}::_toJSON(std::ostream& os) const {\n`;
    output += '    os << "{";\n';

    const allFields = classDecl.fields.filter(f => !f.isStatic);

    for (let i = 0; i < allFields.length; i++) {
        const field = allFields[i];
        const isLast = i === allFields.length - 1;
        const cppFieldName = getCppFieldName(field);

        if (field.type.kind === 'enum') {
            // For enums: if string-backed, print backing string; otherwise print underlying int value
            const enumType = field.type as EnumTypeNode;
            const enumDecl = generator.validationContext?.enums.get(enumType.name);
                if (enumDecl && enumDecl.members.some(m => m.value && m.value.literalType === 'string')) {
                    // string-backed enum: quote field name and JSON-encode backing string
                    output += `    os << "\\"${field.name.name}\\":" << doof_runtime::json_encode(${enumDecl.name.name}_backing_string(${cppFieldName}));\n`;
                } else {
                    // numeric-backed enum: quote field name then output underlying int
                    output += `    os << "\\"${field.name.name}\\":" << static_cast<int>(${cppFieldName});\n`;
                }
        } else if (field.type.kind === 'primitive') {
            const primitive = field.type as PrimitiveTypeNode;
            if (primitive.type === 'string') {
                output += `    os << "\\"${field.name.name}\\":" << doof_runtime::json_encode(${cppFieldName});\n`;
            } else if (primitive.type === 'bool') {
                output += `    os << "\\"${field.name.name}\\":" << (${cppFieldName} ? "true" : "false");\n`;
            } else {
                output += `    os << "\\"${field.name.name}\\":" << ${cppFieldName};\n`;
            }
        } else if (field.type.kind === 'class' || field.type.kind === 'externClass') {
            output += `    os << "\\"${field.name.name}\\":";\n`;
            output += `    if (${cppFieldName}) {\n`;
            output += `        ${cppFieldName}->_toJSON(os);\n`;
            output += '    } else {\n';
            output += '        os << "null";\n';
            output += '    }\n';
        } else if (field.type.kind === 'array') {
            const arrayType = field.type as ArrayTypeNode;
            output += `    os << "\\"${field.name.name}\\":";\n`;
            output += `    if (${cppFieldName}) {\n`;
            output += '        os << "[";\n';
            output += `        for (size_t i = 0; i < ${cppFieldName}->size(); ++i) {\n`;
            output += `            const auto& element = (*${cppFieldName})[i];\n`;
            if (arrayType.elementType.kind === 'class' || arrayType.elementType.kind === 'externClass') {
                output += '            if (element) {\n';
                output += '                element->_toJSON(os);\n';
                output += '            } else {\n';
                output += '                os << "null";\n';
                output += '            }\n';
            } else if (arrayType.elementType.kind === 'primitive') {
                const elementPrimitive = arrayType.elementType as PrimitiveTypeNode;
                if (elementPrimitive.type === 'string') {
                    output += '            os << doof_runtime::json_encode(element);\n';
                } else if (elementPrimitive.type === 'bool') {
                    output += '            os << (element ? "true" : "false");\n';
                } else {
                    output += '            os << element;\n';
                }
            } else {
                output += '            os << element;\n';
            }
            output += `            if (i + 1 < ${cppFieldName}->size()) os << ",";\n`;
            output += '        }\n';
            output += '        os << "]";\n';
            output += '    } else {\n';
            output += '        os << "null";\n';
            output += '    }\n';
        } else if (field.type.kind === 'map') {
            const mapType = field.type as MapTypeNode;
            const isStringKey = mapType.keyType.kind === 'primitive' && (mapType.keyType as PrimitiveTypeNode).type === 'string';
            output += `    os << "\\\"${field.name.name}\\\":";\n`;
            output += `    if (${cppFieldName}) {\n`;
            if (isStringKey) {
                output += '        os << "{";\n';
                output += `        bool first = true;\n`;
                output += `        for (const auto& kv : *${cppFieldName}) {\n`;
                output += `            if (!first) os << ",";\n`;
                output += `            first = false;\n`;
                // key
                output += `            os << doof_runtime::json_encode(kv.first) << ":";\n`;
                // value
                if (mapType.valueType.kind === 'class' || mapType.valueType.kind === 'externClass') {
                    output += '            if (kv.second) { kv.second->_toJSON(os); } else { os << "null"; }\n';
                } else if (mapType.valueType.kind === 'primitive') {
                    const valPrim = mapType.valueType as PrimitiveTypeNode;
                    if (valPrim.type === 'string') {
                        output += '            os << doof_runtime::json_encode(kv.second);\n';
                    } else if (valPrim.type === 'bool') {
                        output += '            os << (kv.second ? "true" : "false");\n';
                    } else {
                        output += '            os << kv.second;\n';
                    }
                } else {
                    output += '            os << kv.second;\n';
                }
                output += '        }\n';
                output += '        os << "}";\n';
            } else {
                // Non-string keys: emit as array of {"key": ..., "value": ...}
                output += '        os << "[";\n';
                output += `        bool first = true;\n`;
                output += `        for (const auto& kv : *${cppFieldName}) {\n`;
                output += `            if (!first) os << ",";\n`;
                output += `            first = false;\n`;
                output += `            os << "{\"key\":";\n`;
                // key value
                if (mapType.keyType.kind === 'primitive') {
                    const keyPrim = mapType.keyType as PrimitiveTypeNode;
                    if (keyPrim.type === 'string') {
                        output += '            os << doof_runtime::json_encode(kv.first);\n';
                    } else if (keyPrim.type === 'bool') {
                        output += '            os << (kv.first ? "true" : "false");\n';
                    } else {
                        output += '            os << kv.first;\n';
                    }
                } else {
                    output += '            os << kv.first;\n';
                }
                output += `            os << ",\"value\":";\n`;
                if (mapType.valueType.kind === 'class' || mapType.valueType.kind === 'externClass') {
                    output += '            if (kv.second) { kv.second->_toJSON(os); } else { os << "null"; }\n';
                } else if (mapType.valueType.kind === 'primitive') {
                    const valPrim2 = mapType.valueType as PrimitiveTypeNode;
                    if (valPrim2.type === 'string') {
                        output += '            os << doof_runtime::json_encode(kv.second);\n';
                    } else if (valPrim2.type === 'bool') {
                        output += '            os << (kv.second ? "true" : "false");\n';
                    } else {
                        output += '            os << kv.second;\n';
                    }
                } else {
                    output += '            os << kv.second;\n';
                }
                output += `            os << "}";\n`;
                output += `        }\n`;
                output += '        os << "]";\n';
            }
            output += '    } else {\n';
            output += '        os << "null";\n';
            output += '    }\n';
        } else if (field.type.kind === 'set') {
            const setType = field.type as SetTypeNode;
            output += `    os << "\\\"${field.name.name}\\\":";\n`;
            output += `    if (${cppFieldName}) {\n`;
            output += '        os << "[";\n';
            output += `        bool first = true;\n`;
            output += `        for (const auto& element : *${cppFieldName}) {\n`;
            output += `            if (!first) os << ",";\n`;
            output += `            first = false;\n`;
            if (setType.elementType.kind === 'class' || setType.elementType.kind === 'externClass') {
                output += '            if (element) { element->_toJSON(os); } else { os << "null"; }\n';
            } else if (setType.elementType.kind === 'primitive') {
                const elemPrim = setType.elementType as PrimitiveTypeNode;
                if (elemPrim.type === 'string') {
                    output += '            os << doof_runtime::json_encode(element);\n';
                } else if (elemPrim.type === 'bool') {
                    output += '            os << (element ? "true" : "false");\n';
                } else {
                    output += '            os << element;\n';
                }
            } else {
                output += '            os << element;\n';
            }
            output += `        }\n`;
            output += '        os << "]";\n';
            output += '    } else {\n';
            output += '        os << "null";\n';
            output += '    }\n';
        } else {
            output += `    os << "\\"${field.name.name}\\":" << ${cppFieldName};\n`;
        }

        if (!isLast) {
            output += '    os << ",";\n';
        }
    }

    output += '    os << "}";\n';
    output += '}';

    return output;
}

export function generateOperatorOverloadSource(generator: CppGenerator, classDecl: ClassDeclaration): string {
    let output = `std::ostream& operator<<(std::ostream& os, const ${classDecl.name.name}& obj) {\n`;
    output += '    obj._toJSON(os);\n';
    output += '    return os;\n';
    output += '}\n\n';

    // Also generate operator<< for shared_ptr
    output += `std::ostream& operator<<(std::ostream& os, const std::shared_ptr<${classDecl.name.name}>& obj) {\n`;
    output += '    if (obj) {\n';
    output += '        obj->_toJSON(os);\n';
    output += '    } else {\n';
    output += '        os << "null";\n';
    output += '    }\n';
    output += '    return os;\n';
    output += '}';

    return output;
}

export function generateFromJSONMethodSource(generator: CppGenerator, classDecl: ClassDeclaration): string {
    let output = '';

    output += `std::shared_ptr<${classDecl.name.name}> ${classDecl.name.name}::fromJSON(const std::string& json_str) {\n`;
    output += '    doof_runtime::json::JSONParser parser(json_str);\n';
    output += '    doof_runtime::json::JSONValue parsed = parser.parse();\n';
    output += '    if (!parsed.is_object()) {\n';
    output += '        throw std::runtime_error("Expected JSON object for deserialization");\n';
    output += '    }\n';
    output += '    return _fromJSON(parsed.as_object());\n';
    output += '}\n\n';

    output += `std::shared_ptr<${classDecl.name.name}> ${classDecl.name.name}::_fromJSON(const doof_runtime::json::JSONObject& json_obj) {\n`;

    const constructorDecl = classDecl.constructor;
    const nonStaticFields = classDecl.fields.filter(f => !f.isStatic);

    if (constructorDecl) {
        const parameterNames = new Set(constructorDecl.parameters.map(param => param.name.name));

        for (const param of constructorDecl.parameters) {
            output += generateFieldDeserialization(
                generator,
                param.type,
                param.name.name,
                param.name.name,
                'json_obj',
                param.defaultValue === undefined,
                param.defaultValue
            );
        }

        const argumentList = constructorDecl.parameters.map(param => param.name.name).join(', ');
        output += `    auto result = ${classDecl.name.name}::_new(${argumentList});\n`;

        for (const field of nonStaticFields) {
            if (parameterNames.has(field.name.name)) {
                continue;
            }
            if (field.isConst || field.isReadonly) {
                continue;
            }

            const cppFieldName = getCppFieldName(field);
            output += generateFieldDeserialization(
                generator,
                field.type,
                cppFieldName,
                field.name.name,
                'json_obj',
                field.defaultValue === undefined,
                field.defaultValue
            );
            output += `    result->${cppFieldName} = ${cppFieldName};\n`;
        }

        output += '    return result;\n';
        output += '}\n';
    } else {
        output += '    // Aggregate deserialization - all fields are deserialized\n';

        const hasConstFields = nonStaticFields.some(f => f.isConst || f.isReadonly);

        if (hasConstFields) {
            for (const field of nonStaticFields) {
                const cppFieldName = getCppFieldName(field);
                output += generateFieldDeserialization(generator, field.type, cppFieldName, field.name.name, 'json_obj', field.defaultValue === undefined, field.defaultValue);
            }

            const paramNames = nonStaticFields.map(f => getCppFieldName(f)).join(', ');
            output += `    auto result = std::make_shared<${classDecl.name.name}>(${paramNames});\n`;
            output += '    return result;\n';
            output += '}\n';
        } else {
            output += `    auto result = std::make_shared<${classDecl.name.name}>();\n`;

            for (const field of nonStaticFields) {
                const cppFieldName = getCppFieldName(field);
                output += generateFieldDeserialization(generator, field.type, cppFieldName, field.name.name, 'json_obj', field.defaultValue === undefined, field.defaultValue);
                output += `    result->${cppFieldName} = ${cppFieldName};\n`;
            }

            output += '    return result;\n';
            output += '}\n';
        }
    }

    return output;
}

export function generateFieldDeserialization(generator: CppGenerator, type: Type, cppFieldName: string, jsonFieldName: string, jsonObjName: string, isRequired: boolean, defaultValue?: Expression): string {
    let output = '';

    if (isRequired) {
        // Required field - use get_* helpers that throw on missing fields
        switch (type.kind) {
            case 'primitive':
                switch (type.type) {
                    case 'int':
                        output += `    int ${cppFieldName} = doof_runtime::json::get_int(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'float':
                    case 'double':
                        output += `    double ${cppFieldName} = doof_runtime::json::get_double(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'bool':
                        output += `    bool ${cppFieldName} = doof_runtime::json::get_bool(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'string':
                        output += `    std::string ${cppFieldName} = doof_runtime::json::get_string(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    default:
                        output += `    auto ${cppFieldName} = doof_runtime::json::get_double(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                }
                break;

            case 'class':
                const typeName = type.name;
                output += `    const auto& ${cppFieldName}_obj = doof_runtime::json::get_object(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `    auto ${cppFieldName} = ${typeName}::_fromJSON(${cppFieldName}_obj);\n`;
                break;

            case 'array':
                const elementTypeName = generator.generateType(type.elementType);
                output += `    const auto& ${cppFieldName}_arr = doof_runtime::json::get_array(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `    auto ${cppFieldName} = std::make_shared<std::vector<${elementTypeName}>>();\n`;
                output += `    ${cppFieldName}->reserve(${cppFieldName}_arr.size());\n`;
                output += `    for (const auto& item : ${cppFieldName}_arr) {\n`;

                if (type.elementType.kind === 'primitive') {
                    switch (type.elementType.type) {
                        case 'int':
                            output += `        ${cppFieldName}->push_back(item.as_int());\n`;
                            break;
                        case 'float':
                        case 'double':
                            output += `        ${cppFieldName}->push_back(item.as_number());\n`;
                            break;
                        case 'bool':
                            output += `        ${cppFieldName}->push_back(item.as_bool());\n`;
                            break;
                        case 'string':
                            output += `        ${cppFieldName}->push_back(item.as_string());\n`;
                            break;
                        default:
                            output += `        ${cppFieldName}->push_back(item.as_number());\n`;
                            break;
                    }
                } else if (type.elementType.kind === 'class' || type.elementType.kind === 'externClass') {
                    const elemTypeName = type.elementType.name;
                    output += `        if (item.is_object()) {\n`;
                    output += `            ${cppFieldName}->push_back(${elemTypeName}::_fromJSON(item.as_object()));\n`;
                    output += `        } else {\n`;
                    output += `            ${cppFieldName}->push_back(nullptr);\n`;
                    output += `        }\n`;
                } else {
                    output += `        // TODO: Implement deserialization for array element type: ${type.elementType.kind}\n`;
                }

                output += `    }\n`;
                break;

            case 'map': {
                const mapType = type as MapTypeNode;
                const keyIsString = mapType.keyType.kind === 'primitive' && (mapType.keyType as PrimitiveTypeNode).type === 'string';
                const rawMapType = `std::map<${generator.typeGen.generateType(mapType.keyType)}, ${generator.typeGen.generateType(mapType.valueType)}>`;
                output += `    const auto& ${cppFieldName}_obj = doof_runtime::json::get_object(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `    auto ${cppFieldName} = std::make_shared<${rawMapType}>();\n`;
                if (keyIsString) {
                    output += `    for (const auto& kv : ${cppFieldName}_obj) {\n`;
                    // deserialize value by kind
                    if (mapType.valueType.kind === 'primitive') {
                        const vp = mapType.valueType as PrimitiveTypeNode;
                        if (vp.type === 'int') {
                            output += `        (*${cppFieldName})[kv.first] = kv.second.as_int();\n`;
                        } else if (vp.type === 'float' || vp.type === 'double') {
                            output += `        (*${cppFieldName})[kv.first] = kv.second.as_number();\n`;
                        } else if (vp.type === 'bool') {
                            output += `        (*${cppFieldName})[kv.first] = kv.second.as_bool();\n`;
                        } else if (vp.type === 'string') {
                            output += `        (*${cppFieldName})[kv.first] = kv.second.as_string();\n`;
                        } else {
                            output += `        (*${cppFieldName})[kv.first] = kv.second.as_number();\n`;
                        }
                    } else if (mapType.valueType.kind === 'class' || mapType.valueType.kind === 'externClass') {
                        const vtName = (mapType.valueType as any).name;
                        output += `        if (!kv.second.is_object()) { throw std::runtime_error("Expected object as map value for key '" + kv.first + "'"); }\n`;
                        output += `        (*${cppFieldName})[kv.first] = ${vtName}::_fromJSON(kv.second.as_object());\n`;
                    } else {
                        output += `        // TODO: Map value type '${mapType.valueType.kind}' not yet supported\n`;
                    }
                    output += `    }\n`;
                } else {
                    output += `    throw std::runtime_error("Map keys must be strings for JSON deserialization of field '${jsonFieldName}'");\n`;
                }
                break;
            }

            case 'set': {
                const setType = type as SetTypeNode;
                const elemType = setType.elementType;
                const rawSetType = `std::unordered_set<${generator.typeGen.generateType(elemType)}>`;
                output += `    const auto& ${cppFieldName}_arr = doof_runtime::json::get_array(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `    auto ${cppFieldName} = std::make_shared<${rawSetType}>();\n`;
                output += `    for (const auto& item : ${cppFieldName}_arr) {\n`;
                if (elemType.kind === 'primitive') {
                    const ep = elemType as PrimitiveTypeNode;
                    if (ep.type === 'int') {
                        output += `        ${cppFieldName}->insert(item.as_int());\n`;
                    } else if (ep.type === 'float' || ep.type === 'double') {
                        output += `        ${cppFieldName}->insert(item.as_number());\n`;
                    } else if (ep.type === 'bool') {
                        output += `        ${cppFieldName}->insert(item.as_bool());\n`;
                    } else if (ep.type === 'string') {
                        output += `        ${cppFieldName}->insert(item.as_string());\n`;
                    } else {
                        output += `        ${cppFieldName}->insert(item.as_number());\n`;
                    }
                } else if (elemType.kind === 'class' || elemType.kind === 'externClass') {
                    const etName = (elemType as any).name;
                    output += `        if (item.is_object()) { ${cppFieldName}->insert(${etName}::_fromJSON(item.as_object())); } else { ${cppFieldName}->insert(nullptr); }\n`;
                } else {
                    output += `        // TODO: Set element type '${elemType.kind}' not yet supported\n`;
                }
                output += `    }\n`;
                break;
            }

            case 'enum':
                {
                    const enumTypeName = (type as EnumTypeNode).name;
                    const enumDecl = generator.validationContext?.enums.get(enumTypeName);
                    if (!enumDecl) {
                        output += `    throw std::runtime_error("Enum metadata for '${enumTypeName}' not found during deserialization");\n`;
                        output += `    ${enumTypeName} ${cppFieldName} = static_cast<${enumTypeName}>(0);\n`;
                        break;
                    }
                    const isStringBacked = enumDecl.members.some(m => m.value && m.value.literalType === 'string');
                    if (isStringBacked) {
                        // String-backed: JSON contains backing string values
                        output += `    std::string ${cppFieldName}_raw = doof_runtime::json::get_string(${jsonObjName}, "${jsonFieldName}");\n`;
                        output += `    ${enumTypeName} ${cppFieldName};\n`;
                        // Generate if/else chain comparing backing strings
                        for (let i = 0; i < enumDecl.members.length; i++) {
                            const m = enumDecl.members[i];
                            const raw = m.value && m.value.literalType === 'string'
                                ? JSON.stringify(String(m.value.value))
                                : JSON.stringify(m.name.name);
                            const prefix = i === 0 ? 'if' : 'else if';
                            output += `    ${prefix} (${cppFieldName}_raw == ${raw}) { ${cppFieldName} = ${enumTypeName}::${m.name.name}; }\n`;
                        }
                        output += `    else { throw std::runtime_error("Invalid backing value '" + ${cppFieldName}_raw + "' for enum ${enumTypeName}"); }\n`;
                    } else {
                        // Numeric-backed: JSON contains integral backing values
                        output += `    int ${cppFieldName}_raw = doof_runtime::json::get_int(${jsonObjName}, "${jsonFieldName}");\n`;
                        output += `    ${enumTypeName} ${cppFieldName};\n`;
                        // Build mapping using same auto-increment rules as enum generation
                        output += `    switch (${cppFieldName}_raw) {\n`;
                        let currentOrdinal = 0;
                        for (const m of enumDecl.members) {
                            let backing: number;
                            if (m.value && m.value.literalType === 'number') {
                                backing = Number(m.value.value);
                                currentOrdinal = backing;
                            } else if (!m.value) {
                                backing = currentOrdinal;
                            } else {
                                // Should not happen for numeric-backed (string value would have made isStringBacked true)
                                backing = currentOrdinal;
                            }
                            output += `    case ${backing}: ${cppFieldName} = ${enumTypeName}::${m.name.name}; break;\n`;
                            if (!m.value || (m.value && m.value.literalType === 'number')) {
                                currentOrdinal = backing + 1;
                            } else {
                                currentOrdinal = 0; // reset if unexpected type
                            }
                        }
                        output += `    default: throw std::runtime_error("Invalid backing value " + std::to_string(${cppFieldName}_raw) + " for enum ${enumTypeName}");\n`;
                        output += `    }\n`;
                    }
                }
                break;

            default:
                output += `    // TODO: Implement deserialization for type: ${type.kind}\n`;
                output += `    auto ${cppFieldName} = /* default value */;\n`;
                break;
        }
    } else {
        // Optional field - check if key exists, use default if not
        output += `    // Optional field: ${cppFieldName}\n`;
        const typeStr = generator.generateType(type);
        output += `    ${typeStr} ${cppFieldName};\n`;
        output += `    if (doof_runtime::json::has_key(${jsonObjName}, "${jsonFieldName}")) {\n`;

        // Generate the same deserialization logic but for the existing variable
        switch (type.kind) {
            case 'primitive':
                const primType = type as PrimitiveTypeNode;
                switch (primType.type) {
                    case 'int':
                        output += `        ${cppFieldName} = doof_runtime::json::get_int(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'float':
                    case 'double':
                        output += `        ${cppFieldName} = doof_runtime::json::get_double(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'bool':
                        output += `        ${cppFieldName} = doof_runtime::json::get_bool(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    case 'string':
                        output += `        ${cppFieldName} = doof_runtime::json::get_string(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                    default:
                        output += `        ${cppFieldName} = doof_runtime::json::get_double(${jsonObjName}, "${jsonFieldName}");\n`;
                        break;
                }
                break;

            case 'class':
                const typeName2 = (type as ClassTypeNode).name;
                output += `        const auto& ${cppFieldName}_obj = doof_runtime::json::get_object(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `        ${cppFieldName} = ${typeName2}::_fromJSON(${cppFieldName}_obj);\n`;
                break;

            case 'array':
                const arrayType = type as ArrayTypeNode;
                const elementTypeName2 = generator.generateType(arrayType.elementType);
                output += `        const auto& ${cppFieldName}_arr = doof_runtime::json::get_array(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `        ${cppFieldName} = std::make_shared<std::vector<${elementTypeName2}>>();\n`;
                output += `        ${cppFieldName}->reserve(${cppFieldName}_arr.size());\n`;
                output += `        for (const auto& item : ${cppFieldName}_arr) {\n`;

                if (arrayType.elementType.kind === 'primitive') {
                    const elemPrimType = arrayType.elementType as PrimitiveTypeNode;
                    switch (elemPrimType.type) {
                        case 'int':
                            output += `            ${cppFieldName}->push_back(item.as_int());\n`;
                            break;
                        case 'float':
                        case 'double':
                            output += `            ${cppFieldName}->push_back(item.as_number());\n`;
                            break;
                        case 'bool':
                            output += `            ${cppFieldName}->push_back(item.as_bool());\n`;
                            break;
                        case 'string':
                            output += `            ${cppFieldName}->push_back(item.as_string());\n`;
                            break;
                        default:
                            output += `            ${cppFieldName}->push_back(item.as_number());\n`;
                            break;
                    }
                } else if (arrayType.elementType.kind === 'class' || arrayType.elementType.kind === 'externClass') {
                    const elemTypeName2 = (arrayType.elementType as ClassTypeNode | ExternClassTypeNode).name;
                    output += `            if (item.is_object()) {\n`;
                    output += `                ${cppFieldName}->push_back(${elemTypeName2}::_fromJSON(item.as_object()));\n`;
                    output += `            } else {\n`;
                    output += `                ${cppFieldName}->push_back(nullptr);\n`;
                    output += `            }\n`;
                } else {
                    output += `            // TODO: Implement deserialization for array element type: ${arrayType.elementType.kind}\n`;
                }

                output += `        }\n`;
                break;

            case 'map': {
                const mapType2 = type as MapTypeNode;
                const keyIsString2 = mapType2.keyType.kind === 'primitive' && (mapType2.keyType as PrimitiveTypeNode).type === 'string';
                const rawMapType2 = `std::map<${generator.typeGen.generateType(mapType2.keyType)}, ${generator.typeGen.generateType(mapType2.valueType)}>`;
                output += `        const auto& ${cppFieldName}_obj = doof_runtime::json::get_object(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `        ${cppFieldName} = std::make_shared<${rawMapType2}>();\n`;
                if (keyIsString2) {
                    output += `        for (const auto& kv : ${cppFieldName}_obj) {\n`;
                    if (mapType2.valueType.kind === 'primitive') {
                        const vp2 = mapType2.valueType as PrimitiveTypeNode;
                        if (vp2.type === 'int') {
                            output += `            (*${cppFieldName})[kv.first] = kv.second.as_int();\n`;
                        } else if (vp2.type === 'float' || vp2.type === 'double') {
                            output += `            (*${cppFieldName})[kv.first] = kv.second.as_number();\n`;
                        } else if (vp2.type === 'bool') {
                            output += `            (*${cppFieldName})[kv.first] = kv.second.as_bool();\n`;
                        } else if (vp2.type === 'string') {
                            output += `            (*${cppFieldName})[kv.first] = kv.second.as_string();\n`;
                        } else {
                            output += `            (*${cppFieldName})[kv.first] = kv.second.as_number();\n`;
                        }
                    } else if (mapType2.valueType.kind === 'class' || mapType2.valueType.kind === 'externClass') {
                        const vtName2 = (mapType2.valueType as any).name;
                        output += `            if (!kv.second.is_object()) { throw std::runtime_error("Expected object as map value for key '" + kv.first + "'"); }\n`;
                        output += `            (*${cppFieldName})[kv.first] = ${vtName2}::_fromJSON(kv.second.as_object());\n`;
                    } else {
                        output += `            // TODO: Map value type '${mapType2.valueType.kind}' not yet supported\n`;
                    }
                    output += `        }\n`;
                } else {
                    output += `        throw std::runtime_error("Map keys must be strings for JSON deserialization of field '${jsonFieldName}'");\n`;
                }
                break;
            }

            case 'set': {
                const setType2 = type as SetTypeNode;
                const elemType2 = setType2.elementType;
                const rawSetType2 = `std::unordered_set<${generator.typeGen.generateType(elemType2)}>`;
                output += `        const auto& ${cppFieldName}_arr = doof_runtime::json::get_array(${jsonObjName}, "${jsonFieldName}");\n`;
                output += `        ${cppFieldName} = std::make_shared<${rawSetType2}>();\n`;
                output += `        for (const auto& item : ${cppFieldName}_arr) {\n`;
                if (elemType2.kind === 'primitive') {
                    const ep2 = elemType2 as PrimitiveTypeNode;
                    if (ep2.type === 'int') {
                        output += `            ${cppFieldName}->insert(item.as_int());\n`;
                    } else if (ep2.type === 'float' || ep2.type === 'double') {
                        output += `            ${cppFieldName}->insert(item.as_number());\n`;
                    } else if (ep2.type === 'bool') {
                        output += `            ${cppFieldName}->insert(item.as_bool());\n`;
                    } else if (ep2.type === 'string') {
                        output += `            ${cppFieldName}->insert(item.as_string());\n`;
                    } else {
                        output += `            ${cppFieldName}->insert(item.as_number());\n`;
                    }
                } else if (elemType2.kind === 'class' || elemType2.kind === 'externClass') {
                    const etName2 = (elemType2 as any).name;
                    output += `            if (item.is_object()) { ${cppFieldName}->insert(${etName2}::_fromJSON(item.as_object())); } else { ${cppFieldName}->insert(nullptr); }\n`;
                } else {
                    output += `            // TODO: Set element type '${elemType2.kind}' not yet supported\n`;
                }
                output += `        }\n`;
                break;
            }

            case 'enum': {
                const enumTypeName2 = (type as EnumTypeNode).name;
                const enumDecl2 = generator.validationContext?.enums.get(enumTypeName2);
                if (!enumDecl2) {
                    output += `        throw std::runtime_error("Enum metadata for '${enumTypeName2}' not found during deserialization");\n`;
                    break;
                }
                const isStringBacked2 = enumDecl2.members.some(m => m.value && m.value.literalType === 'string');
                if (isStringBacked2) {
                    output += `        {\n`;
                    output += `            std::string ${cppFieldName}_raw = doof_runtime::json::get_string(${jsonObjName}, "${jsonFieldName}");\n`;
                    for (let i = 0; i < enumDecl2.members.length; i++) {
                        const m = enumDecl2.members[i];
                        const raw = m.value && m.value.literalType === 'string'
                            ? JSON.stringify(String(m.value.value))
                            : JSON.stringify(m.name.name);
                        const prefix = i === 0 ? 'if' : 'else if';
                        output += `            ${prefix} (${cppFieldName}_raw == ${raw}) { ${cppFieldName} = ${enumTypeName2}::${m.name.name}; }\n`;
                    }
                    output += `            else { throw std::runtime_error("Invalid backing value '" + ${cppFieldName}_raw + "' for enum ${enumTypeName2}"); }\n`;
                    output += `        }\n`;
                } else {
                    output += `        {\n`;
                    output += `            int ${cppFieldName}_raw = doof_runtime::json::get_int(${jsonObjName}, "${jsonFieldName}");\n`;
                    output += `            switch (${cppFieldName}_raw) {\n`;
                    let currentOrdinal2 = 0;
                    for (const m of enumDecl2.members) {
                        let backing: number;
                        if (m.value && m.value.literalType === 'number') {
                            backing = Number(m.value.value);
                            currentOrdinal2 = backing;
                        } else if (!m.value) {
                            backing = currentOrdinal2;
                        } else {
                            backing = currentOrdinal2;
                        }
                        output += `            case ${backing}: ${cppFieldName} = ${enumTypeName2}::${m.name.name}; break;\n`;
                        if (!m.value || (m.value && m.value.literalType === 'number')) {
                            currentOrdinal2 = backing + 1;
                        } else {
                            currentOrdinal2 = 0;
                        }
                    }
                    output += `            default: throw std::runtime_error("Invalid backing value " + std::to_string(${cppFieldName}_raw) + " for enum ${enumTypeName2}");\n`;
                    output += `            }\n`;
                    output += `        }\n`;
                }
                break;
            }

            default:
                output += `        // TODO: Implement deserialization for type: ${type.kind}\n`;
                break;
        }

        output += `    } else {\n`;
        output += `        // Use default value\n`;
        if (defaultValue) {
            output += `        ${cppFieldName} = ${generator.generateExpression(defaultValue, type)};\n`;
        } else {
            output += `        ${cppFieldName} = ${generator.generateDefaultInitializer(type)};\n`;
        }
        output += `    }\n`;
    }

    return output;
}

function formatConstructorParameterList(generator: CppGenerator, ctor: ConstructorDeclaration, includeDefaults: boolean): string {
    return ctor.parameters.map(param => {
        let result = `${generateParameterType(generator, param.type)} ${param.name.name}`;
        if (includeDefaults && param.defaultValue) {
            result += ` = ${generator.generateExpression(param.defaultValue, param.type)}`;
        }
        return result;
    }).join(', ');
}

function createSyntheticConstructorMethod(classDecl: ClassDeclaration): MethodDeclaration {
    const ctor = classDecl.constructor!;
    return {
        kind: 'method',
        name: {
            kind: 'identifier',
            name: 'constructor',
            location: ctor.location
        },
        parameters: ctor.parameters,
        returnType: { kind: 'primitive', type: 'void' },
        body: ctor.body,
        isPublic: ctor.isPublic,
        isStatic: false,
        location: ctor.location
    };
}

function generateFactoryMethodSource(generator: CppGenerator, classDecl: ClassDeclaration): string {
    const ctor = classDecl.constructor;
    if (!ctor) {
        return '';
    }

    const params = formatConstructorParameterList(generator, ctor, false);
    const argumentList = ctor.parameters.map(param => param.name.name).join(', ');

    let output = `std::shared_ptr<${classDecl.name.name}> ${classDecl.name.name}::_new(${params}) {\n`;
    output += `    auto obj = std::make_shared<${classDecl.name.name}>();\n`;
    if (ctor.parameters.length > 0) {
        output += `    obj->constructor(${argumentList});\n`;
    } else {
        output += '    obj->constructor();\n';
    }
    output += '    return obj;\n';
    output += '}\n';
    return output;
}

// Helper functions

function generateParameterType(generator: CppGenerator, type: Type): string {
    switch (type.kind) {
        case 'primitive':
            const primType = type as PrimitiveTypeNode;
            switch (primType.type) {
                case 'string': return 'const std::string&'; // Pass strings by const reference
                case 'void': return 'void';
                default: return primType.type; // Pass primitives by value
            }
        case 'array':
        case 'class':
        case 'externClass':
        case 'union':
        case 'function':
        case 'map':
        case 'set':
            // Maps and Sets are now shared_ptr like arrays
            return generator.typeGen.generateType(type);
        case 'enum':
            const enumType = type as EnumTypeNode;
            return enumType.name; // Pass enums by value
        default:
            throw new Error("Compiler error - unsupported parameter type");
    }
}

// Import method declaration functions
import {
    generateMethodDeclarationHeader,
    generateMethodDeclarationSource,
    generateStaticMethodDeclarationSource
} from './cpp-function-decl-codegen';
import { encodeCppFieldName, getCppFieldName } from './cpp-utility-functions';
