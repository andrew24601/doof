// C++ enum declaration generation for doof

import { EnumDeclaration } from '../../types';
import { CppGenerator } from '../cppgen';

export function generateEnumDeclaration(generator: CppGenerator, enumDecl: EnumDeclaration): string {
    let output = generator.indent() + `enum ${enumDecl.name.name} {\n`;
    generator.increaseIndent();

    for (let i = 0; i < enumDecl.members.length; i++) {
        const member = enumDecl.members[i];
        output += generator.indent() + member.name.name;

        if (member.value && member.value.literalType === 'number') {
            output += ` = ${member.value.value}`;
        } else if (i === 0) {
            output += ' = 0';
        }

        if (i < enumDecl.members.length - 1) {
            output += ',';
        }
        output += '\n';
    }

    generator.decreaseIndent();
    output += generator.indent() + '};\n\n';

    // Generate to_string function for enum
    output += generateEnumToStringFunction(generator, enumDecl);

    // Generate backing string function for string-backed enums
    if (enumDecl.members.some(m => m.value && m.value.literalType === 'string')) {
        const inlineKeyword = generator.isGeneratingHeader ? 'inline ' : '';
        output += generator.indent() + `${inlineKeyword}std::string ${enumDecl.name.name}_backing_string(${enumDecl.name.name} value) {\n`;
        generator.increaseIndent();
        output += generator.indent() + 'switch (value) {\n';
        generator.increaseIndent();
        for (const member of enumDecl.members) {
            const backing = member.value && member.value.literalType === 'string' ? JSON.stringify(String(member.value.value)) : JSON.stringify(member.name.name);
            output += generator.indent() + `case ${enumDecl.name.name}::${member.name.name}: return ${backing};\n`;
        }
        output += generator.indent() + `default: return "";\n`;
        generator.decreaseIndent();
        output += generator.indent() + '}\n';
        generator.decreaseIndent();
        output += generator.indent() + '}\n\n';
    }

    // Generate operator<< overload for enum
    output += generateEnumOperatorOverload(generator, enumDecl);

    return output;
}

export function generateEnumToStringFunction(generator: CppGenerator, enumDecl: EnumDeclaration): string {
    const inlineKeyword = generator.isGeneratingHeader ? 'inline ' : '';
    let output = generator.indent() + `${inlineKeyword}std::string to_string(${enumDecl.name.name} value) {\n`;
    generator.increaseIndent();

    output += generator.indent() + 'switch (value) {\n';
    generator.increaseIndent();

    for (const member of enumDecl.members) {
        output += generator.indent() + `case ${enumDecl.name.name}::${member.name.name}: return "${member.name.name}";\n`;
    }

    output += generator.indent() + `default: return "Unknown";\n`;

    generator.decreaseIndent();
    output += generator.indent() + '}\n';

    generator.decreaseIndent();
    output += generator.indent() + '}\n\n';

    return output;
}

export function generateEnumOperatorOverload(generator: CppGenerator, enumDecl: EnumDeclaration): string {
    const inlineKeyword = generator.isGeneratingHeader ? 'inline ' : '';
    let output = generator.indent() + `${inlineKeyword}std::ostream& operator<<(std::ostream& os, ${enumDecl.name.name} value) {\n`;
    generator.increaseIndent();

    output += generator.indent() + 'switch (value) {\n';
    generator.increaseIndent();

    for (const member of enumDecl.members) {
        output += generator.indent() + `case ${enumDecl.name.name}::${member.name.name}: return os << "${member.name.name}";\n`;
    }

    output += generator.indent() + `default: return os << "Unknown";\n`;

    generator.decreaseIndent();
    output += generator.indent() + '}\n';

    generator.decreaseIndent();
    output += generator.indent() + '}\n\n';

    return output;
}
