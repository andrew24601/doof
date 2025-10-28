import { describe, it, expect, afterEach, vi } from 'vitest';
import { BinaryExpression, Identifier, MemberExpression, CallExpression, PrimitiveTypeNode, ClassDeclaration, Type } from '../src/types';
import { generateBinaryExpression } from '../src/codegen/vm/vmgen-binary-codegen';
import * as expressionModule from '../src/codegen/vm/vmgen-expression-codegen';
import * as emitModule from '../src/codegen/vm/vmgen-emit';
import { CompilationContext } from '../src/codegen/vmgen';

const dummyLocation = {
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 }
} as const;

function createPrimitive(type: 'int' | 'float' | 'double' | 'string'): PrimitiveTypeNode {
  return { kind: 'primitive', type, location: dummyLocation } as PrimitiveTypeNode;
}

function createClassDeclaration(name: string, fields: Array<{ field: string; isStatic?: boolean }>): ClassDeclaration {
  return {
    kind: 'class',
    name: { kind: 'identifier', name, location: dummyLocation },
    fields: fields.map(({ field, isStatic }) => ({
      kind: 'field',
      name: { kind: 'identifier', name: field, location: dummyLocation },
      isStatic: !!isStatic,
      type: createPrimitive('int'),
      location: dummyLocation,
      modifiers: []
    })),
    methods: [],
    constructors: [],
    location: dummyLocation,
    heritageClauses: [],
    modifiers: []
  } as unknown as ClassDeclaration;
}

function createTestContext(): CompilationContext {
  const validationContext = {
    classes: new Map(),
    symbols: new Map(),
    globalSymbols: new Map(),
    imports: new Map(),
    externClasses: new Map(),
    enums: new Map(),
    functions: new Map(),
    typeAliases: new Map(),
    typeSymbols: undefined!,
    errors: [],
    codeGenHints: {
      builtinFunctions: new Map(),
      objectInstantiations: new Map(),
      typeGuards: new Map(),
      typeNarrowing: new Map(),
      scopeTracker: new Map(),
      jsonPrintTypes: new Set(),
      jsonFromTypes: new Set(),
      includeTypeConversions: false,
      enumToStringFunctions: new Set(),
      enumValidationFunctions: new Set(),
      callDispatch: new Map(),
      externDependencies: new Set()
    }
  } as any;

  return {
    instructions: [],
    constantPool: [],
    functionTable: new Map(),
    classTable: new Map(),
    registerAllocator: {
      allocate: vi.fn(() => {
        throw new Error('Unexpected allocate');
      }),
      allocateTemporary: vi.fn(() => {
        throw new Error('Unexpected allocateTemporary');
      }),
      allocateContiguous: vi.fn(() => {
        throw new Error('Unexpected allocateContiguous');
      }),
      free: vi.fn(),
      freeTemporary: vi.fn(),
      freeContiguous: vi.fn(),
      getVariable: vi.fn(),
      getParameterCount: vi.fn(() => 0),
      getLocalCount: vi.fn(() => 0),
      getFirstTemporaryRegister: vi.fn(() => 0),
      getTotalRegistersUsed: vi.fn(() => 0),
      isAllocated: vi.fn(() => false),
      getAllocatedRegisters: vi.fn(() => []),
      getFreeTemporaries: vi.fn(() => []),
      reset: vi.fn(),
      getRegisterLayout: vi.fn(() => '')
    },
    labelCounter: 0,
    labels: new Map(),
    pendingJumps: [],
    variables: new Map(),
    validationContext,
    validationContexts: new Map([["__test__", validationContext]]),
    currentFilePath: "__test__",
    loopContextStack: [],
    globalSymbolTable: new Map(),
    arrayIntrinsicsUsed: new Set(),
    arrayIntrinsicsGenerated: new Set(),
    debug: {
      sourceMap: [],
      functions: [],
      variables: [],
      scopes: [],
      files: [],
      currentFileIndex: 0,
      variableCounter: 0,
      scopeCounter: 0
    }
  } as unknown as CompilationContext;
}

describe('vm binary assignment regressions', () => {

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluates member assignment RHS only once', () => {
  const context = createTestContext();
  const generateExpressionSpy = vi.spyOn(expressionModule as any, 'generateExpressionOptimal') as any;
  const emitSpy = vi.spyOn(emitModule as any, 'emit') as any;
    const holderType = { kind: 'class', name: 'Holder' } as Type;
    const holderIdentifier: Identifier = {
      kind: 'identifier',
      name: 'holder',
      location: dummyLocation,
      inferredType: holderType
    };
    const propertyIdentifier: Identifier = {
      kind: 'identifier',
      name: 'value',
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };

    const memberExpr: MemberExpression = {
      kind: 'member',
      object: holderIdentifier,
      property: propertyIdentifier,
      computed: false,
      location: dummyLocation
    };

    const rhsCall: CallExpression = {
      kind: 'call',
      callee: { kind: 'identifier', name: 'bump', location: dummyLocation, inferredType: { kind: 'function' } as any },
      arguments: [],
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };

    const assignment: BinaryExpression = {
      kind: 'binary',
      operator: '=',
      left: memberExpr,
      right: rhsCall,
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };

    const classDecl = createClassDeclaration('Holder', [{ field: 'value' }]);
    const activeValidationContext = context.validationContexts!.get('__test__')!;
    context.classTable.set('Holder', {
      name: 'Holder',
      fieldCount: 1,
      methodCount: 0,
      fields: ['value'],
      methods: []
    } as any);
    activeValidationContext.classes.set('Holder', classDecl);

    const rhsReg = 5;
    const objectReg = 2;
    const targetReg = 8;
    const callOrder: string[] = [];

    generateExpressionSpy.mockImplementation((expr: any, allocatedRegs: number[]) => {
      if (expr === rhsCall) {
        callOrder.push('rhs');
        allocatedRegs.push(rhsReg);
        return rhsReg;
      }
      if (expr === holderIdentifier) {
        callOrder.push('object');
        allocatedRegs.push(objectReg);
        return objectReg;
      }
      throw new Error('Unexpected expression');
    });

    generateBinaryExpression(assignment, targetReg, context);

    const rhsEvaluations = callOrder.filter((entry) => entry === 'rhs').length;
    expect(rhsEvaluations).toBe(1);
    expect(callOrder).toContain('object');

    expect(emitSpy).toHaveBeenCalledWith('SET_FIELD', objectReg, 0, rhsReg, context);
    expect(emitSpy).toHaveBeenCalledWith('MOVE', targetReg, rhsReg, 0, context);
    expect(context.registerAllocator.free).toHaveBeenCalledWith(objectReg);
    expect(context.registerAllocator.free).toHaveBeenCalledWith(rhsReg);
  });

  it('evaluates static assignment RHS only once and chooses float opcodes for +=', () => {
  const context = createTestContext();
  const generateExpressionSpy = vi.spyOn(expressionModule as any, 'generateExpressionOptimal') as any;
  const emitSpy = vi.spyOn(emitModule as any, 'emit') as any;
  const counterDecl = createClassDeclaration('Counter', [{ field: 'hits', isStatic: true }]);
  const staticValidationContext = context.validationContexts!.get('__test__')!;
  staticValidationContext.classes.set('Counter', counterDecl);
    context.globalSymbolTable.set('Counter.hits', 42);

    const staticObject: Identifier = {
      kind: 'identifier',
      name: 'Counter',
      location: dummyLocation,
      inferredType: { kind: 'class', name: 'Counter' } as any
    };
    const staticProperty: Identifier = {
      kind: 'identifier',
      name: 'hits',
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };
    const staticMember: MemberExpression = {
      kind: 'member',
      object: staticObject,
      property: staticProperty,
      computed: false,
      location: dummyLocation
    };

    const rhsCall: CallExpression = {
      kind: 'call',
      callee: { kind: 'identifier', name: 'bump', location: dummyLocation, inferredType: { kind: 'function' } as any },
      arguments: [],
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };

    const staticAssignment: BinaryExpression = {
      kind: 'binary',
      operator: '=',
      left: staticMember,
      right: rhsCall,
      location: dummyLocation,
      inferredType: createPrimitive('int')
    };

    const rhsReg = 6;
    const targetReg = 9;
    const callOrder: string[] = [];

    generateExpressionSpy.mockImplementation((expr: any, allocatedRegs: number[]) => {
      if (expr === rhsCall) {
        callOrder.push('rhs');
        allocatedRegs.push(rhsReg);
        return rhsReg;
      }
      throw new Error('Unexpected expression');
    });

    generateBinaryExpression(staticAssignment, targetReg, context);

    expect(callOrder.filter((entry) => entry === 'rhs')).toHaveLength(1);
    expect(emitSpy).toHaveBeenCalledWith('SET_GLOBAL', rhsReg, Math.floor(42 / 256), 42 % 256, context);
    expect(emitSpy).toHaveBeenCalledWith('MOVE', targetReg, rhsReg, 0, context);

  generateExpressionSpy.mockRestore();
  emitSpy.mockRestore();

    // Now verify += emits float opcode via compound assignment path
    const floatLeft: Identifier = {
      kind: 'identifier',
      name: 'value',
      location: dummyLocation,
      inferredType: createPrimitive('float')
    };
    const floatRight: Identifier = {
      kind: 'identifier',
      name: 'delta',
      location: dummyLocation,
      inferredType: createPrimitive('float')
    };
    const floatAssignment: BinaryExpression = {
      kind: 'binary',
      operator: '+=',
      left: floatLeft,
      right: floatRight,
      location: dummyLocation,
      inferredType: createPrimitive('float')
    };

    const floatContext = createTestContext();
    (floatContext.registerAllocator.getVariable as any).mockReturnValueOnce(3);

  const floatEmitSpy = vi.spyOn(emitModule as any, 'emit') as any;
  const floatGenerateSpy = vi.spyOn(expressionModule as any, 'generateExpressionOptimal') as any;
    floatGenerateSpy.mockImplementation((expr: any, allocatedRegs: number[]) => {
      if (expr === floatRight) {
        allocatedRegs.push(4);
        return 4;
      }
      if (expr === floatLeft) {
        return 3;
      }
      throw new Error('Unexpected expression in float += test');
    });

    generateBinaryExpression(floatAssignment, 10, floatContext);

    expect(floatEmitSpy).toHaveBeenCalledWith('ADD_FLOAT', 3, 3, 4, floatContext);
    expect(floatEmitSpy).not.toHaveBeenCalledWith('ADD_INT', expect.anything(), expect.anything(), expect.anything(), floatContext);
  });
});
