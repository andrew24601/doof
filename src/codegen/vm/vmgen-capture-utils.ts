import { Identifier, SourceLocation, VariableDeclaration, ScopeTrackerEntry, Parameter, ValidationContext } from '../../types';
import { CompilationContext, VMClassMetadata, VMValue, getActiveValidationContext } from '../vmgen';
import { addConstant, emit } from './vmgen-emit';

export const CAPTURE_WRAPPER_CLASS_NAME = '__doof_capture_wrapper';
export const CAPTURE_WRAPPER_FIELD_INDEX = 0;

function locationsEqual(a?: SourceLocation, b?: SourceLocation): boolean {
  if (!a || !b) {
    return false;
  }

  const sameFile = !a.filename || !b.filename || a.filename === b.filename;
  return sameFile &&
    a.start.line === b.start.line &&
    a.start.column === b.start.column &&
    a.end.line === b.end.line &&
    a.end.column === b.end.column;
}

function getScopeTracker(context: CompilationContext): Map<string, ScopeTrackerEntry> | undefined {
  return getActiveValidationContext(context)?.codeGenHints.scopeTracker;
}

function getCapturedMutableScopes(context: CompilationContext): Set<string> | undefined {
  return getActiveValidationContext(context)?.codeGenHints.capturedMutableScopes;
}

function isCapturedScope(scopeId: string | undefined, context: CompilationContext): boolean {
  if (!scopeId) {
    return false;
  }

  const capturedMutableScopes = getCapturedMutableScopes(context);
  if (!capturedMutableScopes) {
    return false;
  }

  return capturedMutableScopes.has(scopeId);
}

export function getScopeIdForIdentifier(identifier: Identifier, context: CompilationContext): string | undefined {
  const fromScopeInfo = identifier.scopeInfo?.scopeId;
  if (fromScopeInfo) {
    return fromScopeInfo;
  }

  const tracker = getScopeTracker(context);
  if (!tracker) {
    return undefined;
  }

  for (const entry of tracker.values()) {
    if (entry.name !== identifier.name) {
      continue;
    }

    if (locationsEqual(entry.declarationLocation, identifier.location)) {
      return entry.scopeId;
    }
  }

  return undefined;
}

export function getScopeIdForVariable(varDecl: VariableDeclaration, context: CompilationContext): string | undefined {
  const idScope = getScopeIdForIdentifier(varDecl.identifier, context);
  if (idScope) {
    return idScope;
  }

  const tracker = getScopeTracker(context);
  if (!tracker) {
    return undefined;
  }

  for (const entry of tracker.values()) {
    if (entry.name !== varDecl.identifier.name) {
      continue;
    }

    if (locationsEqual(entry.declarationLocation, varDecl.location)) {
      return entry.scopeId;
    }
  }

  const fallback = tracker.get(varDecl.identifier.name);
  if (fallback) {
    return fallback.scopeId;
  }

  return undefined;
}

export function shouldWrapCapturedMutable(varDecl: VariableDeclaration, context: CompilationContext): boolean {
  if (varDecl.isConst) {
    return false;
  }

  return isCapturedScope(getScopeIdForVariable(varDecl, context), context);
}

export function getScopeIdForParameter(param: Parameter, context: CompilationContext): string | undefined {
  return getScopeIdForIdentifier(param.name, context);
}

export function shouldWrapCapturedMutableParameter(param: Parameter, context: CompilationContext): boolean {
  return isCapturedScope(getScopeIdForParameter(param, context), context);
}

export function isCapturedMutableIdentifier(identifier: Identifier, context: CompilationContext): boolean {
  return isCapturedScope(getScopeIdForIdentifier(identifier, context), context);
}

export function ensureCaptureWrapperClass(context: CompilationContext): number {
  if (context.captureWrapperClassConstant !== undefined) {
    return context.captureWrapperClassConstant;
  }

  const existingMetadata = context.classTable.get(CAPTURE_WRAPPER_CLASS_NAME);
  if (existingMetadata) {
    const classValue: VMValue = {
      type: 'class',
      value: existingMetadata
    };
    const constantIndex = addConstant(classValue, context);
    context.captureWrapperClassConstant = constantIndex;
    context.captureWrapperMetadata = existingMetadata;
    return constantIndex;
  }

  const metadata: VMClassMetadata = {
    name: CAPTURE_WRAPPER_CLASS_NAME,
    fieldCount: 1,
    methodCount: 0,
    fields: ['value'],
    methods: []
  };

  context.classTable.set(CAPTURE_WRAPPER_CLASS_NAME, metadata);
  context.captureWrapperMetadata = metadata;

  const classValue: VMValue = {
    type: 'class',
    value: metadata
  };

  const constantIndex = addConstant(classValue, context);
  context.captureWrapperClassConstant = constantIndex;
  return constantIndex;
}

export function emitWrapRegisterWithCurrentValue(targetReg: number, context: CompilationContext): void {
  const classConstIndex = ensureCaptureWrapperClass(context);
  const high = Math.floor(classConstIndex / 256);
  const low = classConstIndex % 256;

  const tempReg = context.registerAllocator.allocate();
  emit('MOVE', tempReg, targetReg, 0, context);
  emit('NEW_OBJECT', targetReg, high, low, context);
  emit('SET_FIELD', targetReg, CAPTURE_WRAPPER_FIELD_INDEX, tempReg, context);
  context.registerAllocator.free(tempReg);
}

export function wrapCapturedMutableParameters(parameters: Parameter[], context: CompilationContext): void {
  if (!parameters.length) {
    return;
  }

  for (const param of parameters) {
    if (!shouldWrapCapturedMutableParameter(param, context)) {
      continue;
    }

    const register = context.registerAllocator.getVariable(param.name.name);
    if (register === undefined) {
      continue;
    }

    emitWrapRegisterWithCurrentValue(register, context);
  }
}
