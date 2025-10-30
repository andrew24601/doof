import { CompilationContext, getActiveValidationContext } from "../vmgen";

function vmDebugEnabled(): boolean {
  const flag = process.env.DOOF_DEBUG;
  return flag === '1' || flag === 'true' || flag === 'vm' || flag === 'vmgen';
}
function dbg(...args: any[]) {
  if (vmDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.error('[VMGEN][field]', ...args);
  }
}

export function getInstanceFieldIndex(className: string, fieldName: string, context: CompilationContext): number {
  if (vmDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.error('[VMGEN][field] Lookup', { className, fieldName });
  }
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

  const knownFields = classMetadata ? classMetadata.fields : [];
  const availableClasses = Array.from(context.classTable.keys()).slice(0, 20);
  dbg('Unknown field in class', { className, fieldName, knownFields, classTableSample: availableClasses });
  throw new Error(`Unknown field ${fieldName} in class ${className}`);
}
