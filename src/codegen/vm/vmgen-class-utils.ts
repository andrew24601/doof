import { CompilationContext, getActiveValidationContext } from "../vmgen";

export function getInstanceFieldIndex(className: string, fieldName: string, context: CompilationContext): number {
  const classMetadata = context.classTable.get(className);
  if (classMetadata) {
    const fieldIndex = classMetadata.fields.findIndex((field) => field === fieldName);
    if (fieldIndex !== -1) {
      return fieldIndex;
    }
  }

  const validationContext = getActiveValidationContext(context);
  if (validationContext?.classes.has(className)) {
    const classDecl = validationContext.classes.get(className)!;
    const nonStaticFields = classDecl.fields.filter((field) => !field.isStatic);
    const fieldIndex = nonStaticFields.findIndex((field) => field.name.name === fieldName);
    if (fieldIndex !== -1) {
      return fieldIndex;
    }
  }

  throw new Error(`Unknown field ${fieldName} in class ${className}`);
}
