import { validateExpression } from "./expression-validator";
import { getMemberPropertyName } from "./member-access-validator";
import { createClassType, createFunctionType, commonTypes, createPrimitiveType, isTypeCompatible, isTypeEqual, typeToString, createExternClassType } from "../type-utils";
import { FunctionTypeNode, PrimitiveTypeNode, MapTypeNode, SetTypeNode, ArrayTypeNode, CallExpression, Identifier, MemberExpression, Type, ExternClassDeclaration, MethodDeclaration } from "../types";
import { Validator, IntrinsicOverload } from "./validator";

export function initializeBuiltins(validator: Validator): void {
  // Add Math object with common methods
  const mathType = createClassType('Math');
  validator.context.symbols.set('Math', mathType);

  // Add StringBuilder type for efficient string building
  const stringBuilderType = createExternClassType('StringBuilder', 'doof_runtime');
  validator.context.symbols.set('StringBuilder', stringBuilderType);

  // Add StringBuilder as an extern class so it can be used as a type
  const emptyBody = { kind: 'block' as const, body: [], location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } };
  const stringBuilderClass: ExternClassDeclaration = {
    kind: 'externClass',
    name: { kind: 'identifier', name: 'StringBuilder', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
    fields: [],
    methods: [
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'create', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [],
        returnType: { kind: 'class', name: 'StringBuilder' },
        body: emptyBody,
        isPublic: true,
        isStatic: true,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      },
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'createWithCapacity', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [
          { kind: 'parameter', name: { kind: 'identifier', name: 'capacity', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }, type: commonTypes.int, location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }
        ],
        returnType: { kind: 'class', name: 'StringBuilder' },
        body: emptyBody,
        isPublic: true,
        isStatic: true,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      },
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'append', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [
          { kind: 'parameter', name: { kind: 'identifier', name: 'value', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }, type: commonTypes.string, location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }
        ],
        returnType: { kind: 'class', name: 'StringBuilder' },
        body: emptyBody,
        isPublic: true,
        isStatic: false,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      },
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'toString', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [],
        returnType: commonTypes.string,
        body: emptyBody,
        isPublic: true,
        isStatic: false,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      }
    ],
  header: 'doof_runtime.h',
  namespace: 'doof_runtime',
    location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
  };
  validator.context.externClasses.set('StringBuilder', stringBuilderClass);

  // Register StringBuilder static factory methods
  const stringBuilderCreateType = createFunctionType([], stringBuilderType);
  validator.context.symbols.set('StringBuilder.create', stringBuilderCreateType);

  const stringBuilderCreateWithCapacityType = createFunctionType(
    [{ name: 'capacity', type: commonTypes.int }], 
    stringBuilderType
  );
  validator.context.symbols.set('StringBuilder.createWithCapacity', stringBuilderCreateWithCapacityType);

  // Add built-in println function (accepts printable types, returns void)
  // We mark println specially to accept any type with operator<< support
  const printlnType = createFunctionType(
    [{ name: 'value', type: commonTypes.string }],
    commonTypes.void
  );
  // Mark this function as special for println type checking
  printlnType.isPrintlnFunction = true;
  validator.context.symbols.set('println', printlnType);

  // Add built-in panic function (accepts string message, never returns)
  const panicType = createFunctionType(
    [{ name: 'message', type: commonTypes.string }],
    commonTypes.void
  );
  validator.context.symbols.set('panic', panicType);

  // Add Future type
  const futureClass: ExternClassDeclaration = {
    kind: 'externClass',
    name: { kind: 'identifier', name: 'Future', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
    typeParameters: [{ name: 'T', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } }],
    fields: [],
    methods: [
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'get', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [],
        returnType: { kind: 'typeParameter', name: 'T' } as any,
        body: emptyBody,
        isPublic: true,
        isStatic: false,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      },
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'wait', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [],
        returnType: commonTypes.void,
        body: emptyBody,
        isPublic: true,
        isStatic: false,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      },
      {
        kind: 'method',
        name: { kind: 'identifier', name: 'isReady', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } } },
        parameters: [],
        returnType: commonTypes.bool,
        body: emptyBody,
        isPublic: true,
        isStatic: false,
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
      }
    ],
    header: 'doof_runtime.h',
    namespace: 'doof_runtime',
    location: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
  };
  validator.context.externClasses.set('Future', futureClass);
  validator.context.symbols.set('Future', createExternClassType('Future', 'doof_runtime'));

  // No time/date runtime types are registered here; any runtime-backed types
  // should be provided by explicit extern-class declarations in source or via
  // the intrinsics registry. We intentionally do not register
  // 'Instant' automatically.
}

export function initializeBuiltinMappings(validator: Validator): void {
  // println has special handling in the code generator and is not treated as a regular builtin

  // Map Math functions
  const mathFunctions = [
    'abs', 'min', 'max', 'pow', 'sqrt', 'sin', 'cos', 'tan',
    'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10',
    'floor', 'ceil', 'round', 'fmod', 'hypot'
  ];

  for (const func of mathFunctions) {
    validator.context.codeGenHints.builtinFunctions.set(`Math.${func}`, {
      jsMapping: `Math.${func}`,
      returnType: commonTypes.double
    });
  }
}

export function initializeIntrinsics(validator: Validator): void {
  // Helper function to create type nodes
  const { int: intType, double: doubleType, float: floatType, string: stringType, void: voidType } = commonTypes;

  // Register StringBuilder intrinsics - get the existing type from symbols
  const sbType = validator.context.symbols.get('StringBuilder');
  if (!sbType) {
    throw new Error('StringBuilder type not found in symbols - initializeBuiltins must be called first');
  }

  // StringBuilder.append - chainable, returns StringBuilder
  validator.intrinsicRegistry.set('StringBuilder.append', {
    overloads: [
      {
        paramTypes: [stringType],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      },
      {
        paramTypes: [intType],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      },
      {
        paramTypes: [doubleType],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      },
      {
        paramTypes: [floatType],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      },
      {
        paramTypes: [createPrimitiveType('bool')],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      },
      // Generic fallback for other types (classes)
      {
        paramTypes: [createPrimitiveType('object')],
        returnType: () => sbType,
        cppMapping: 'append',
        vmMapping: 'StringBuilder::append'
      }
    ]
  });

  // StringBuilder.toString
  validator.intrinsicRegistry.set('StringBuilder.toString', {
    overloads: [
      {
        paramTypes: [],
        returnType: () => stringType,
        cppMapping: 'toString',
        vmMapping: 'StringBuilder::toString'
      }
    ]
  });

  // StringBuilder.reserve
  validator.intrinsicRegistry.set('StringBuilder.reserve', {
    overloads: [
      {
        paramTypes: [intType],
        returnType: () => voidType,
        cppMapping: 'reserve',
        vmMapping: 'StringBuilder::reserve'
      }
    ]
  });

  // StringBuilder.clear
  validator.intrinsicRegistry.set('StringBuilder.clear', {
    overloads: [
      {
        paramTypes: [],
        returnType: () => voidType,
        cppMapping: 'clear',
        vmMapping: 'StringBuilder::clear'
      }
    ]
  });

  // StringBuilder static factory methods
  validator.intrinsicRegistry.set('StringBuilder.create', {
    overloads: [
      {
        paramTypes: [],
        returnType: () => sbType,
        cppMapping: 'StringBuilder::create',
        vmMapping: 'StringBuilder::create'
      }
    ]
  });

  validator.intrinsicRegistry.set('StringBuilder.createWithCapacity', {
    overloads: [
      {
        paramTypes: [intType],
        returnType: () => sbType,
        cppMapping: 'StringBuilder::createWithCapacity', 
        vmMapping: 'StringBuilder::createWithCapacity'
      }
    ]
  });

  // Math.abs - preserves input type
  validator.intrinsicRegistry.set('Math.abs', {
    overloads: [
      {
        paramTypes: [intType],
        returnType: () => intType,
        cppMapping: 'std::abs',
        vmMapping: 'Math::abs_int'
      },
      {
        paramTypes: [doubleType],
        returnType: () => doubleType,
        cppMapping: 'std::abs',
        vmMapping: 'Math::abs_double'
      },
      {
        paramTypes: [floatType],
        returnType: () => floatType,
        cppMapping: 'std::abs',
        vmMapping: 'Math::abs_float'
      }
    ]
  });

  // Math.min/max - return promoted type of arguments
  const minMaxOverloads = [
    {
      paramTypes: [intType, intType],
      returnType: () => intType,
      cppMapping: 'std::min',
      vmMapping: 'Math::min_int'
    },
    {
      paramTypes: [doubleType, doubleType],
      returnType: () => doubleType,
      cppMapping: 'std::min',
      vmMapping: 'Math::min_double'
    },
    {
      paramTypes: [floatType, floatType],
      returnType: () => floatType,
      cppMapping: 'std::min',
      vmMapping: 'Math::min_float'
    },
    // Mixed type overloads promote to higher precision
    {
      paramTypes: [intType, doubleType],
      returnType: () => doubleType,
      cppMapping: 'std::min',
      vmMapping: 'Math::min_double'
    },
    {
      paramTypes: [doubleType, intType],
      returnType: () => doubleType,
      cppMapping: 'std::min',
      vmMapping: 'Math::min_double'
    }
  ];

  validator.intrinsicRegistry.set('Math.min', { overloads: minMaxOverloads });
  validator.intrinsicRegistry.set('Math.max', {
    overloads: minMaxOverloads.map(overload => ({
      ...overload,
      cppMapping: 'std::max',
      vmMapping: overload.vmMapping.replace('min', 'max')
    }))
  });

  // Math functions that always return double
  const doubleMathFunctions = [
    'pow', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'exp', 'log', 'log10', 'floor', 'ceil', 'round', 'fmod', 'hypot'
  ];

  for (const funcName of doubleMathFunctions) {
    const overloads = [];
    
    // Double overloads (single parameter) - prioritize over float for integer literals
    overloads.push({
      paramTypes: [doubleType],
      returnType: () => doubleType,
      cppMapping: `std::${funcName}`,
      vmMapping: `Math::${funcName}_double`
    });
    
    // Float overloads (single parameter)
    overloads.push({
      paramTypes: [floatType],
      returnType: () => floatType,
      cppMapping: `std::${funcName}f`,
      vmMapping: `Math::${funcName}_float`
    });
    
    // Double overloads (two parameters for functions like pow, atan2, fmod, hypot)
    if (['pow', 'atan2', 'fmod', 'hypot'].includes(funcName)) {
      overloads.push({
        paramTypes: [doubleType, doubleType],
        returnType: () => doubleType,
        cppMapping: `std::${funcName}`,
        vmMapping: `Math::${funcName}_double`
      });
    }
    
    // Float overloads (two parameters for functions like pow, atan2, fmod, hypot)
    if (['pow', 'atan2', 'fmod', 'hypot'].includes(funcName)) {
      overloads.push({
        paramTypes: [floatType, floatType],
        returnType: () => floatType,
        cppMapping: `std::${funcName}f`,
        vmMapping: `Math::${funcName}_float`
      });
    }
    
    validator.intrinsicRegistry.set(`Math.${funcName}`, {
      overloads
    });
  }

  // String method intrinsics
  // Note: String methods are registered with a special 'string' namespace in the validator
  // that gets resolved to instance method calls on string objects
  
  // string.substring(start, end)
  validator.intrinsicRegistry.set('string.substring', {
    overloads: [
      {
        paramTypes: [intType, intType],
        returnType: () => stringType,
        cppMapping: 'substr', // C++ std::string method
        vmMapping: 'String::substring'
      },
      {
        paramTypes: [intType],
        returnType: () => stringType,
        cppMapping: 'substr',
        vmMapping: 'String::substring'
      }
    ]
  });

  // string.indexOf(searchValue)
  validator.intrinsicRegistry.set('string.indexOf', {
    overloads: [
      {
        paramTypes: [stringType],
        returnType: () => intType,
        cppMapping: 'find',
        vmMapping: 'String::indexOf'
      }
    ]
  });

  // string.replace(searchValue, replaceValue)
  validator.intrinsicRegistry.set('string.replace', {
    overloads: [
      {
        paramTypes: [stringType, stringType],
        returnType: () => stringType,
  cppMapping: 'doof_runtime::string_replace',
        vmMapping: 'String::replace'
      }
    ]
  });

  // string.toUpperCase()
  validator.intrinsicRegistry.set('string.toUpperCase', {
    overloads: [
      {
        paramTypes: [],
        returnType: () => stringType,
  cppMapping: 'doof_runtime::string_to_upper',
        vmMapping: 'String::toUpperCase'
      }
    ]
  });

  // string.toLowerCase()
  validator.intrinsicRegistry.set('string.toLowerCase', {
    overloads: [
      {
        paramTypes: [],
        returnType: () => stringType,
  cppMapping: 'doof_runtime::string_to_lower',
        vmMapping: 'String::toLowerCase'
      }
    ]
  });
}

// Helper method for getting Math methods
export function getMathMethodType(methodName: string): FunctionTypeNode | PrimitiveTypeNode | null {
  const { double: doubleType, int: intType } = commonTypes;

  // Math functions
  switch (methodName) {
    // Basic arithmetic
    case 'abs':
      return createFunctionType([{ name: 'x', type: doubleType }], doubleType);
    case 'pow':
      return createFunctionType([
        { name: 'base', type: doubleType },
        { name: 'exp', type: doubleType }
      ], doubleType);
    case 'sqrt':
      return createFunctionType([{ name: 'x', type: doubleType }], doubleType);
    case 'min':
    case 'max':
      return createFunctionType([
        { name: 'a', type: doubleType },
        { name: 'b', type: doubleType }
      ], doubleType);

    // Trigonometric functions
    case 'sin':
    case 'cos':
    case 'tan':
    case 'asin':
    case 'acos':
    case 'atan':
      return createFunctionType([{ name: 'x', type: doubleType }], doubleType);
    case 'atan2':
      return createFunctionType([
        { name: 'y', type: doubleType },
        { name: 'x', type: doubleType }
      ], doubleType);

    // Exponential and logarithmic
    case 'exp':
    case 'log':
    case 'log10':
      return createFunctionType([{ name: 'x', type: doubleType }], doubleType);

    // Rounding functions
    case 'floor':
    case 'ceil':
    case 'round':
      return createFunctionType([{ name: 'x', type: doubleType }], doubleType);

    // Additional functions
    case 'fmod':
      return createFunctionType([
        { name: 'a', type: doubleType },
        { name: 'b', type: doubleType }
      ], doubleType);
    case 'hypot':
      return createFunctionType([
        { name: 'a', type: doubleType },
        { name: 'b', type: doubleType }
      ], doubleType);

    // Math constants (these are properties, not functions)
    case 'PI':
    case 'E':
    case 'LN2':
    case 'LN10':
    case 'LOG2E':
    case 'LOG10E':
    case 'SQRT1_2':
    case 'SQRT2':
      return doubleType;

    default:
      return null;
  }
}

// Time/date intrinsics (e.g. Instant) are handled as extern classes in the
// extern class system. Removed the previous helper so time is resolved via
// extern-class metadata and the method registries.

// Helper method for getting Map methods
export function getMapMethodType(name: string, mapType: MapTypeNode): FunctionTypeNode | PrimitiveTypeNode | null {
  const keyType = mapType.keyType;
  const valueType = mapType.valueType;
  const { void: voidType, bool: boolType, int: intType } = commonTypes;

  switch (name) {
    case 'set':
      return createFunctionType([
        { name: 'key', type: keyType },
        { name: 'value', type: valueType }
      ], voidType);
    case 'get':
      return createFunctionType([{ name: 'key', type: keyType }], valueType);
    case 'has':
      return createFunctionType([{ name: 'key', type: keyType }], boolType);
    case 'delete':
      return createFunctionType([{ name: 'key', type: keyType }], boolType);
    case 'clear':
      return createFunctionType([], voidType);
    case 'keys':
      return createFunctionType([], { kind: 'array', elementType: keyType } as ArrayTypeNode);
    case 'values':
      return createFunctionType([], { kind: 'array', elementType: valueType } as ArrayTypeNode);
    case 'forEach':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'value', type: valueType },
          { name: 'key', type: keyType }
        ], voidType)
      }], voidType);
    case 'size':
      return intType; // Property, not method
  }
  return null;
}

// Helper method for getting Set methods
export function getSetMethodType(name: string, setType: SetTypeNode): FunctionTypeNode | PrimitiveTypeNode | null {
  const elementType = setType.elementType;
  const { void: voidType, bool: boolType, int: intType } = commonTypes;

  switch (name) {
    case 'add':
      return createFunctionType([{ name: 'value', type: elementType }], boolType);
    case 'has':
      return createFunctionType([{ name: 'value', type: elementType }], boolType);
    case 'delete':
      return createFunctionType([{ name: 'value', type: elementType }], boolType);
    case 'clear':
      return createFunctionType([], voidType);
    case 'toArray':
      return createFunctionType([], { kind: 'array', elementType: elementType } as ArrayTypeNode);
    case 'forEach':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'value', type: elementType }
        ], voidType)
      }], voidType);
    case 'size':
      return intType; // Property, not method
  }
  return null;
}

// Helper method for getting Array methods
export function getArrayMethodType(name: string, arrayType: ArrayTypeNode): FunctionTypeNode | PrimitiveTypeNode | null {
  const elementType = arrayType.elementType;
  const { void: voidType, bool: boolType, int: intType } = commonTypes;

  switch (name) {
    case 'push':
      return createFunctionType([{ name: 'element', type: elementType }], voidType);
    case 'pop':
      return createFunctionType([], elementType);
    case 'forEach':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'it', type: elementType },
          { name: 'index', type: intType }
        ], voidType)
      }], voidType);
    case 'map':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'it', type: elementType },
          { name: 'index', type: intType }
        ], elementType)
      }], arrayType);
    case 'filter':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'it', type: elementType },
          { name: 'index', type: intType }
        ], boolType)
      }], arrayType);
    case 'find':
      return createFunctionType([{
        name: 'callback',
        type: createFunctionType([
          { name: 'it', type: elementType },
          { name: 'index', type: intType }
        ], boolType)
      }], elementType);
    case 'indexOf':
      return createFunctionType([{ name: 'element', type: elementType }], intType);
    case 'reduce':
      // reduce(initialValue: T, reducer: (acc: T, it: T, index: int, array: T[]) => T): T
      // Require initialValue to avoid type inference complexity
      return createFunctionType([{
        name: 'initialValue',
        type: elementType
      }, {
        name: 'reducer',
        type: createFunctionType([
          { name: 'acc', type: elementType },
          { name: 'it', type: elementType },
          { name: 'index', type: intType },
          { name: 'array', type: arrayType }
        ], elementType)
      }], elementType);
    case 'length':
      return intType; // Property, not method
  }
  return null;
}

// Helper method for getting String methods
export function getStringMethodType(name: string): FunctionTypeNode | PrimitiveTypeNode | null {
  const { string: stringType, int: intType, bool: boolType } = commonTypes;

  switch (name) {
    case 'substring':
      return createFunctionType([
        { name: 'start', type: intType },
        { name: 'end', type: intType }
      ], stringType);
    case 'indexOf':
      return createFunctionType([{ name: 'searchValue', type: stringType }], intType);
    case 'replace':
      return createFunctionType([
        { name: 'searchValue', type: stringType },
        { name: 'replaceValue', type: stringType }
      ], stringType);
    case 'toUpperCase':
    case 'toLowerCase':
      return createFunctionType([], stringType);
    case 'split':
      // split returns an array of strings
      const stringArrayType: ArrayTypeNode = {
        kind: 'array',
        elementType: stringType
      };
      // Accept both string and char separators
      const charType = createPrimitiveType('char');
      return createFunctionType([{ name: 'separator', type: stringType }], stringArrayType);
    case 'length':
      return intType; // Property, not method
  }
  return null;
}


export function tryResolveIntrinsic(expr: CallExpression, validator: Validator): {
  namespace: string;
  function: string;
  cppMapping: string;
  vmMapping: string;
  returnType: Type;
} | null {
  // Handle simple function calls like println
  if (expr.callee.kind === 'identifier') {
    const funcName = (expr.callee as Identifier).name;

    // Check if this is a builtin function
    const builtinMapping = validator.context.codeGenHints.builtinFunctions.get(funcName);
    if (builtinMapping) {
      // Validate arguments
      for (const arg of expr.arguments) {
        validateExpression(arg, validator);
      }

      return {
        namespace: '',
        function: funcName,
        cppMapping: '', // Not needed for simple builtins
        vmMapping: funcName, // Use function name directly for VM
        returnType: builtinMapping.returnType
      };
    }

    return null;
  }

  // Only handle member expressions (e.g., Math.abs)
  if (expr.callee.kind !== 'member') {
    return null;
  }

  const memberExpr = expr.callee as MemberExpression;

  // Only handle non-computed member access (e.g., Math.abs, not Math['abs'])
  if (memberExpr.computed) {
    return null;
  }

  // Check if object is a global identifier (not shadowed) or a method call result
  let objectName: string | null = null;
  let isStringBuilderInstance = false;

  if (memberExpr.object.kind === 'identifier') {
    objectName = (memberExpr.object as Identifier).name;
    
    // Check if the object name is shadowed by a local variable
    // But exclude builtin objects like Math which are intentionally in the symbol table
    const isBuiltinObject = ['Math', 'StringBuilder'].includes(objectName);
    if (!isBuiltinObject && validator.context.symbols.has(objectName)) {
      // Special case: check if this is a StringBuilder instance method call
      const symbolType = validator.context.symbols.get(objectName);
      if (symbolType && symbolType.kind === 'externClass' && symbolType.name === 'StringBuilder') {
        isStringBuilderInstance = true;
        objectName = 'StringBuilder';
      } else {
        return null; // Shadowed, not an intrinsic
      }
    }
  } else if (memberExpr.object.kind === 'call') {
    // Check if this is a chained call on a StringBuilder method
    const callExpr = memberExpr.object as CallExpression;
    if (callExpr.intrinsicInfo && callExpr.intrinsicInfo.namespace === 'StringBuilder') {
      isStringBuilderInstance = true;
      objectName = 'StringBuilder';
    } else {
      return null;
    }
  } else {
    return null;
  }

  const methodName = getMemberPropertyName(memberExpr.property);

  // Handle StringBuilder instance methods
  if (isStringBuilderInstance && objectName === 'StringBuilder') {
    const intrinsicKey = `StringBuilder.${methodName}`;
    const intrinsicDef = validator.intrinsicRegistry.get(intrinsicKey);
    
    if (!intrinsicDef) {
      return null; // Not a known intrinsic
    }

    // Validate arguments and find matching overload
    const argTypes: Type[] = [];
    for (const arg of expr.arguments) {
      argTypes.push(validateExpression(arg, validator));
    }

    // Find the best matching overload
    const matchingOverload = findBestIntrinsicOverload(intrinsicDef.overloads, argTypes, validator);

    if (!matchingOverload) {
      validator.addError(
        `No matching overload for ${intrinsicKey} with arguments (${argTypes.map(t => typeToString(t)).join(', ')})`,
        expr.location
      );
      return null;
    }

    return {
      namespace: 'StringBuilder',
      function: methodName,
      cppMapping: matchingOverload.cppMapping,
      vmMapping: matchingOverload.vmMapping,
      returnType: matchingOverload.returnType(argTypes)
    };
  }

  // Handle regular builtin objects like Math
  if (!objectName) {
    return null; // No valid object name found
  }

  const intrinsicKey = `${objectName}.${methodName}`;
  const intrinsicDef = validator.intrinsicRegistry.get(intrinsicKey);

  if (!intrinsicDef) {
    return null; // Not a known intrinsic
  }

  // Validate arguments and find matching overload
  const argTypes: Type[] = [];
  for (const arg of expr.arguments) {
    argTypes.push(validateExpression(arg, validator));
  }

  // Find the best matching overload
  const matchingOverload = findBestIntrinsicOverload(intrinsicDef.overloads, argTypes, validator);

  if (!matchingOverload) {
    validator.addError(
      `No matching overload for ${intrinsicKey} with arguments (${argTypes.map(t => typeToString(t)).join(', ')})`,
      expr.location
    );
    return null;
  }

  return {
    namespace: objectName,
    function: methodName,
    cppMapping: matchingOverload.cppMapping,
    vmMapping: matchingOverload.vmMapping,
    returnType: matchingOverload.returnType(argTypes)
  };
}

export function findBestIntrinsicOverload(
  overloads: IntrinsicOverload[],
  argTypes: Type[],
  validator: Validator
) {
  // First, try exact match
  for (const overload of overloads) {
    if (overload.paramTypes.length === argTypes.length &&
      overload.paramTypes.every((paramType, i) => isTypeEqual(paramType, argTypes[i]))) {
      return overload;
    }
  }

  // Then try compatible match with type promotion
  for (const overload of overloads) {
    if (overload.paramTypes.length === argTypes.length &&
      overload.paramTypes.every((paramType, i) => isTypeCompatible(argTypes[i], paramType, validator))) {
      return overload;
    }
  }

  return null;
}
