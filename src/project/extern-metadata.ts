import { ExternClassDeclaration, FieldDeclaration, MethodDeclaration, Program, ValidationContext } from "../types";
import { typeToString } from "../type-utils";

export interface ExternFieldMetadata {
  name: string;
  type: string;
  isStatic: boolean;
}

export interface ExternMethodParameterMetadata {
  name: string;
  type: string;
}

export interface ExternMethodMetadata {
  name: string;
  isStatic: boolean;
  parameters: ExternMethodParameterMetadata[];
  returnType: string;
}

export interface ExternClassMetadata {
  name: string;
  header: string;
  namespace?: string;
  sourceFile?: string;
  fields: ExternFieldMetadata[];
  methods: ExternMethodMetadata[];
}

function convertField(field: FieldDeclaration): ExternFieldMetadata {
  return {
    name: field.name.name,
    type: typeToString(field.type),
    isStatic: field.isStatic
  };
}

function convertMethod(method: MethodDeclaration): ExternMethodMetadata {
  return {
    name: method.name.name,
    isStatic: method.isStatic,
    returnType: typeToString(method.returnType),
    parameters: method.parameters.map(param => ({
      name: param.name.name,
      type: typeToString(param.type)
    }))
  };
}

function convertExternClass(decl: ExternClassDeclaration, sourceFile?: string): ExternClassMetadata {
  const headerName = decl.header || `${decl.name.name}.h`;
  return {
    name: decl.name.name,
    header: headerName,
    namespace: decl.namespace,
    sourceFile,
    fields: decl.fields.map(convertField),
    methods: decl.methods.map(convertMethod)
  };
}

/**
 * Collects extern class metadata from the provided program and validation context.
 * Program-declared extern classes take precedence over validation context entries.
 */
export function collectExternClassMetadata(
  program?: Program,
  validationContext?: ValidationContext
): ExternClassMetadata[] {
  const metadata = new Map<string, ExternClassMetadata>();

  if (validationContext) {
    for (const [name, decl] of validationContext.externClasses.entries()) {
      metadata.set(name, convertExternClass(decl));
    }
  }

  if (program) {
    for (const stmt of program.body) {
      if (stmt.kind !== "externClass") {
        continue;
      }
      const decl = stmt as ExternClassDeclaration;
      const sourceFile = program.filename;
      metadata.set(decl.name.name, convertExternClass(decl, sourceFile));
    }
  }

  return Array.from(metadata.values()).sort((a, b) => a.name.localeCompare(b.name));
}
