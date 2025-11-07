import { CompilationContext, VMBytecodeFormat, VMClassInfo, VMConstant, VMFunctionInfo, VMInstruction, VMInstructionFormat, VMValue, VMDebugFunctionInfo, VMDebugVariableInfo, VMVariableLocation } from "../vmgen";
import { SourceLocation } from "../../types";

// VM opcode mapping to match VM specification
const OPCODES = {
  // No-op and control
  NOP: 0x00,
  HALT: 0x01,

  // Move and load
  MOVE: 0x10,
  LOADK: 0x11,
  LOADK_NULL: 0x12,
  LOADK_INT16: 0x13,
  LOADK_BOOL: 0x14,
  LOADK_FLOAT: 0x15,
  LOADK_CHAR: 0x16,

  // Arithmetic (type-specific)
  ADD_INT: 0x20,
  SUB_INT: 0x21,
  MUL_INT: 0x22,
  DIV_INT: 0x23,
  MOD_INT: 0x24,
  ADD_FLOAT: 0x25,
  SUB_FLOAT: 0x26,
  MUL_FLOAT: 0x27,
  DIV_FLOAT: 0x28,
  ADD_DOUBLE: 0x29,
  SUB_DOUBLE: 0x2A,
  MUL_DOUBLE: 0x2B,
  DIV_DOUBLE: 0x2C,

  // Boolean logic
  NOT_BOOL: 0x30,
  AND_BOOL: 0x31,
  OR_BOOL: 0x32,

  // Comparison (type-specific, collapsed where possible)
  EQ_INT: 0x40,
  LT_INT: 0x41,

  EQ_FLOAT: 0x42,
  LT_FLOAT: 0x43,
  LTE_FLOAT: 0x44,

  EQ_DOUBLE: 0x45,
  LT_DOUBLE: 0x46,
  LTE_DOUBLE: 0x47,

  EQ_STRING: 0x48,
  LT_STRING: 0x49,

  EQ_BOOL: 0x4A,
  LT_BOOL: 0x4B,

  EQ_OBJECT: 0x4C,
  
  EQ_CHAR: 0x4D,
  LT_CHAR: 0x4E,
  // 0x4F reserved for future use

  // Type conversions
  INT_TO_FLOAT: 0x50,
  INT_TO_DOUBLE: 0x51,
  FLOAT_TO_INT: 0x52,
  DOUBLE_TO_INT: 0x53,
  FLOAT_TO_DOUBLE: 0x54,
  DOUBLE_TO_FLOAT: 0x55,

  // Type checking
  IS_NULL: 0x56,
  GET_CLASS_IDX: 0x57,
  TYPE_OF: 0x5D,

  // Type to string conversions
  INT_TO_STRING: 0x58,
  FLOAT_TO_STRING: 0x59,
  DOUBLE_TO_STRING: 0x5A,
  BOOL_TO_STRING: 0x5B,
  CHAR_TO_STRING: 0x5C,

  // Extended type conversions (string parsing)
  STRING_TO_INT: 0x5E,
  STRING_TO_FLOAT: 0x5F,
  STRING_TO_DOUBLE: 0x60,
  STRING_TO_BOOL: 0x61,
  STRING_TO_CHAR: 0x62,
  
  // Identity conversions and extended bool conversions
  INT_TO_BOOL: 0x63,
  FLOAT_TO_BOOL: 0x64,
  DOUBLE_TO_BOOL: 0x65,
  BOOL_TO_INT: 0x66,
  BOOL_TO_FLOAT: 0x67,
  BOOL_TO_DOUBLE: 0x68,
  
  // Char conversions
  CHAR_TO_INT: 0x69,
  INT_TO_CHAR: 0x6A,

  // Enum conversions
  INT_TO_ENUM: 0x6B,
  STRING_TO_ENUM: 0x6C,
  // ENUM_TO_STRING removed: enums currently represented directly as strings in VM constant/register space

  // Class to JSON string conversion
  CLASS_TO_JSON: 0x6E,
  CLASS_FROM_JSON: 0x6F,

  // String operations
  ADD_STRING: 0x70,
  LENGTH_STRING: 0x71,

  // Array operations
  NEW_ARRAY: 0x72,
  GET_ARRAY: 0x73,
  SET_ARRAY: 0x74,
  LENGTH_ARRAY: 0x75,

  // Object operations
  NEW_OBJECT: 0x80,
  GET_FIELD: 0x81,
  SET_FIELD: 0x82,

  // Map operations
  NEW_MAP: 0x83,
  GET_MAP: 0x84,
  SET_MAP: 0x85,
  HAS_KEY_MAP: 0x86,
  DELETE_MAP: 0x87,
  KEYS_MAP: 0x88,
  VALUES_MAP: 0x89,
  SIZE_MAP: 0x8A,
  CLEAR_MAP: 0x8B,

  // Set operations
  NEW_SET: 0x8C,
  ADD_SET: 0x8D,
  HAS_SET: 0x8E,
  DELETE_SET: 0x8F,
  SIZE_SET: 0x90,
  CLEAR_SET: 0x91,
  TO_ARRAY_SET: 0x92,

  // Control flow (updated opcodes)
  JMP: 0x93,
  JMP_IF_TRUE: 0x94,
  JMP_IF_FALSE: 0x95,

  // Function call/return
  CALL: 0xA1,
  RETURN: 0xA2,
  EXTERN_CALL: 0xA3,

  // Lambda operations
  CREATE_LAMBDA: 0xA4,
  INVOKE_LAMBDA: 0xA5,
  CAPTURE_VALUE: 0xA6,

  // Integer-keyed map operations
  NEW_MAP_INT: 0xB1,
  GET_MAP_INT: 0xB2,
  SET_MAP_INT: 0xB3,
  HAS_KEY_MAP_INT: 0xB4,
  DELETE_MAP_INT: 0xB5,

  // Integer-element set operations
  NEW_SET_INT: 0xB6,
  ADD_SET_INT: 0xB7,
  HAS_SET_INT: 0xB8,
  DELETE_SET_INT: 0xB9,

  // Iterator operations (for..of support)
  ITER_INIT: 0xC0,
  ITER_NEXT: 0xC1,
  ITER_VALUE: 0xC2,
  ITER_KEY: 0xC3,

  // Global variable operations
  GET_GLOBAL: 0xD0,
  SET_GLOBAL: 0xD1
} as const;


export function emit(opcode: string, a: number, b: number, c: number, context: CompilationContext): void {
    const instructionIndex = context.instructions.length;
    context.instructions.push({ opcode, a, b, c });
    
    // Emit source map entry if we have current source location
    if (context.debug.currentSourceLine !== undefined && context.debug.currentSourceColumn !== undefined) {
        context.debug.sourceMap.push({
            instructionIndex,
            sourceLine: context.debug.currentSourceLine,
            sourceColumn: context.debug.currentSourceColumn,
            fileIndex: context.debug.currentFileIndex
        });
    }
}

export function emitJump(opcode: string, reg: number, labelName: string, context: CompilationContext): void {
    const instructionIndex = context.instructions.length;
    context.instructions.push({ opcode, a: reg, b: 0, c: 0 });
    context.pendingJumps.push({ instructionIndex, labelName });
}

export function addConstant(value: VMValue, context: CompilationContext): number {
    // Check if constant already exists
    const existingIndex = context.constantPool.findIndex(v =>
        v.type === value.type && JSON.stringify(v.value) === JSON.stringify(value.value)
    );

    if (existingIndex !== -1) {
        return existingIndex;
    }

    context.constantPool.push(value);
    return context.constantPool.length - 1;
}

// Debug helper functions
export function setSourceLocation(line: number, column: number, context: CompilationContext): void {
    context.debug.currentSourceLine = line;
    context.debug.currentSourceColumn = column;
}

export function clearSourceLocation(context: CompilationContext): void {
    context.debug.currentSourceLine = undefined;
    context.debug.currentSourceColumn = undefined;
}

export function beginFunction(name: string, startInstruction: number, line: number, column: number, parameterCount: number, context: CompilationContext): void {
    const functionInfo: VMDebugFunctionInfo = {
        name,
        startInstruction,
        endInstruction: -1, // Will be set when function ends
        fileIndex: context.debug.currentFileIndex,
        sourceLine: line,
        sourceColumn: column,
        parameterCount,
        localVariableCount: 0 // Will be updated as variables are encountered
    };
    context.debug.functions.push(functionInfo);
}

export function endFunction(context: CompilationContext): void {
    const functionInfo = context.debug.functions[context.debug.functions.length - 1];
    if (functionInfo) {
        functionInfo.endInstruction = context.instructions.length - 1;
    }
}

export function addVariable(name: string, type: string, startInstruction: number, location: VMVariableLocation, context: CompilationContext): number {
    const variableInfo: VMDebugVariableInfo = {
        name,
        type,
        startInstruction,
        endInstruction: -1, // Will be set when variable goes out of scope
        location
    };
    context.debug.variables.push(variableInfo);
    return context.debug.variableCounter++;
}

export function endVariable(variableIndex: number, endInstruction: number, context: CompilationContext): void {
    if (variableIndex < context.debug.variables.length) {
        context.debug.variables[variableIndex].endInstruction = endInstruction;
    }
}

// Set source location from AST node
export function setSourceLocationFromNode(node: { location?: SourceLocation }, context: CompilationContext): void {
    if (node.location) {
        setSourceLocation(node.location.start.line, node.location.start.column, context);
    }
}

export function findClassInConstantPool(className: string, context: CompilationContext): number {
    const classMetadata = context.classTable.get(className);
    if (!classMetadata) return -1;

    const classValue: VMValue = {
        type: 'class',
        value: classMetadata
    };

    return addConstant(classValue, context);
}

export function createLabel(context: CompilationContext): string {
    return `L${context.labelCounter++}`;
}

export function setLabel(labelName: string, context: CompilationContext): void {
    context.labels.set(labelName, context.instructions.length);
}

export function findFunctionConstantIndex(functionName: string, context: CompilationContext): number {
    return context.constantPool.findIndex(constant =>
        constant.type === 'function' && constant.value?.name === functionName
    );
}

export function findClassConstantIndex(className: string, context: CompilationContext): number {
    return context.constantPool.findIndex(constant =>
        constant.type === 'class' && constant.value?.name === className
    );
}

  export function generateFunctionsArray(context: CompilationContext): VMFunctionInfo[] {
    const functions: VMFunctionInfo[] = [];
    
    for (const [name, metadata] of context.functionTable) {
      const constantIndex = findFunctionConstantIndex(name, context);
      functions.push({
        name: metadata.name,
        parameterCount: metadata.parameterCount,
        registerCount: metadata.registerCount,
        codeIndex: metadata.codeIndex,
        constantIndex: constantIndex >= 0 ? constantIndex : undefined
      });
    }
    
    return functions;
  }

  export function generateClassesArray(context: CompilationContext): VMClassInfo[] {
    const classes: VMClassInfo[] = [];
    
    for (const [name, metadata] of context.classTable) {
      const constantIndex = findClassConstantIndex(name, context);
      classes.push({
        name: metadata.name,
        fieldCount: metadata.fieldCount,
        methodCount: metadata.methodCount,
        fields: metadata.fields,
        methods: metadata.methods,
        constantIndex: constantIndex >= 0 ? constantIndex : undefined
      });
    }
    
    return classes;
  }

  export function generateInstructionsArray(context: CompilationContext): VMInstructionFormat[] {
    return context.instructions.map((instr, idx) => ({
      opcode: getOpcodeValue(instr.opcode),
      mnemonic: instr.opcode,
      a: instr.a,
      b: instr.b,
      c: instr.c,
      comment: `${idx}: ${generateInstructionComment(instr, context, idx)}`
    }));
  }

  export function getOpcodeValue(opcodeString: string): number {
    const opcode = OPCODES[opcodeString as keyof typeof OPCODES];
    if (opcode === undefined) {
      throw new Error(`Unknown opcode: ${opcodeString}`);
    }
    return opcode;
  }

  export function generateInstructionComment(instr: VMInstruction, context: CompilationContext, idx: number): string | undefined {
    switch (instr.opcode) {
      case 'LOADK':
        const constIndex = (instr.b << 8) | instr.c;
        const constant = context.constantPool[constIndex];
        return `r${instr.a} = constants[${constIndex}] (${constant?.type}: ${JSON.stringify(constant?.value)})`;
      
      case 'LOADK_INT16':
        const value = (instr.b << 8) | instr.c;
        const signedValue = value > 32767 ? value - 65536 : value;
        return `r${instr.a} = ${signedValue}`;
      
      case 'LOADK_BOOL':
        return `r${instr.a} = ${instr.b ? 'true' : 'false'}`;
      
      case 'LOADK_CHAR':
        const charValue = String.fromCharCode(instr.b);
        return `r${instr.a} = '${charValue}'`;
      
      case 'MOVE':
        return `r${instr.a} = r${instr.b}`;
      
      case 'ADD_INT':
        return `r${instr.a} = r${instr.b} + r${instr.c} (int)`;
      
      case 'SUB_INT':
        return `r${instr.a} = r${instr.b} - r${instr.c} (int)`;
      
      case 'MUL_INT':
        return `r${instr.a} = r${instr.b} * r${instr.c} (int)`;
      
      case 'DIV_INT':
        return `r${instr.a} = r${instr.b} / r${instr.c} (int)`;
      
      case 'ADD_FLOAT':
        return `r${instr.a} = r${instr.b} + r${instr.c} (float)`;
      
      case 'ADD_DOUBLE':
        return `r${instr.a} = r${instr.b} + r${instr.c} (double)`;
      
      case 'ADD_STRING':
        return `r${instr.a} = r${instr.b} + r${instr.c} (string concat)`;
      
      case 'EQ_INT':
        return `r${instr.a} = r${instr.b} == r${instr.c} (int)`;
      
      case 'LT_INT':
        return `r${instr.a} = r${instr.b} < r${instr.c} (int)`;
      
      case 'EQ_CHAR':
        return `r${instr.a} = r${instr.b} == r${instr.c} (char)`;
      
      case 'LT_CHAR':
        return `r${instr.a} = r${instr.b} < r${instr.c} (char)`;
      
      case 'EQ_FLOAT':
        return `r${instr.a} = r${instr.b} == r${instr.c} (float)`;
      
      case 'LT_FLOAT':
        return `r${instr.a} = r${instr.b} < r${instr.c} (float)`;
      
      case 'LTE_FLOAT':
        return `r${instr.a} = r${instr.b} <= r${instr.c} (float)`;
      
      case 'EQ_DOUBLE':
        return `r${instr.a} = r${instr.b} == r${instr.c} (double)`;
      
      case 'LT_DOUBLE':
        return `r${instr.a} = r${instr.b} < r${instr.c} (double)`;
      
      case 'LTE_DOUBLE':
        return `r${instr.a} = r${instr.b} <= r${instr.c} (double)`;
      
      case 'EQ_STRING':
        return `r${instr.a} = r${instr.b} == r${instr.c} (string)`;
      
      case 'LT_STRING':
        return `r${instr.a} = r${instr.b} < r${instr.c} (string)`;
      
      case 'EQ_BOOL':
        return `r${instr.a} = r${instr.b} == r${instr.c} (bool)`;
      
      case 'LT_BOOL':
        return `r${instr.a} = r${instr.b} < r${instr.c} (bool)`;
      
      case 'EQ_OBJECT':
        return `r${instr.a} = r${instr.b} == r${instr.c} (object)`;
      
      case 'AND_BOOL':
        return `r${instr.a} = r${instr.b} && r${instr.c} (bool)`;
      
      case 'OR_BOOL':
        return `r${instr.a} = r${instr.b} || r${instr.c} (bool)`;
      
      case 'NOT_BOOL':
        return `r${instr.a} = !r${instr.b} (bool)`;
      
      case 'JMP':
        const offset = (instr.b << 8) | instr.c;
        const signedOffset = offset > 32767 ? offset - 65536 : offset;
        return `jump to offset ${idx + signedOffset}`;
      
      case 'JMP_IF_TRUE':
        const trueOffset = (instr.b << 8) | instr.c;
        const signedTrueOffset = trueOffset > 32767 ? trueOffset - 65536 : trueOffset;
        return `jump to offset ${idx + signedTrueOffset} if r${instr.a} is true`;
      
      case 'JMP_IF_FALSE':
        const falseOffset = (instr.b << 8) | instr.c;
        const signedFalseOffset = falseOffset > 32767 ? falseOffset - 65536 : falseOffset;
        return `jump to offset ${idx + signedFalseOffset} if r${instr.a} is false`;
      
      case 'CALL':
        const funcConstIndex = (instr.b << 8) | instr.c;
        const funcConstant = context.constantPool[funcConstIndex];
        const funcName = funcConstant?.value?.name || 'unknown';
        return `call ${funcName}, params@r${instr.a}`;
      
      case 'EXTERN_CALL':
        const externConstIndex = (instr.b << 8) | instr.c;
        const externConstant = context.constantPool[externConstIndex];
        const externName = externConstant?.value || 'unknown';
        return `extern_call ${externName}(r${instr.a})`;
      
      case 'RETURN':
        return `return r${instr.a}`;
      
      case 'NEW_ARRAY':
        const arraySize = (instr.a << 16) | (instr.b << 8) | instr.c;
        return `new array of size ${arraySize}`;
      
      case 'GET_ARRAY':
        return `r${instr.a} = r${instr.b}[r${instr.c}]`;
      
      case 'SET_ARRAY':
        return `r${instr.a}[r${instr.b}] = r${instr.c}`;
      
      case 'NEW_OBJECT':
        const classConstIndex = (instr.b << 8) | instr.c;
        const classConstant = context.constantPool[classConstIndex];
        const className = classConstant?.value?.name || 'unknown';
        return `r${instr.a} = new ${className}()`;
      
      case 'GET_FIELD':
        return `r${instr.a} = r${instr.b}.field[${instr.c}]`;
      
      case 'SET_FIELD':
        return `r${instr.a}.field[${instr.b}] = r${instr.c}`;
      
      case 'CREATE_LAMBDA':
        return `r${instr.a} = create lambda`;
      
      case 'INVOKE_LAMBDA':
        return `invoke lambda r${instr.a}`;
      
      case 'CAPTURE_VALUE':
        return `capture value r${instr.b} into r${instr.a}`;
      
      case 'INT_TO_FLOAT':
        return `r${instr.a} = float(r${instr.b})`;
      
      case 'INT_TO_DOUBLE':
        return `r${instr.a} = double(r${instr.b})`;
      
      case 'CHAR_TO_STRING':
        return `r${instr.a} = string(r${instr.b})`;
      
      case 'STRING_TO_CHAR':
        return `r${instr.a} = char(r${instr.b})`;
      
      case 'CHAR_TO_INT':
        return `r${instr.a} = int(r${instr.b})`;
      
      case 'INT_TO_CHAR':
        return `r${instr.a} = char(r${instr.b})`;
      
      case 'HALT':
        return 'program end';
      
      default:
        return undefined;
    }
  }

    export function generateVMOutput(context: CompilationContext, filename: string): string {
      // Entry point is always 0 - start of program execution
      // If we have global variables, the program starts with global initialization
      // followed by a call to main, otherwise it starts with the main function directly
      let entryPoint = 0;
  
      const vmFormat: VMBytecodeFormat = {
        version: "1.0.0",
        metadata: {
          sourceFile: filename,
          generatedAt: new Date().toISOString(),
          doofVersion: "0.1.0"
        },
        constants: generateConstantsArray(context),
        functions: generateFunctionsArray(context),
        classes: generateClassesArray(context),
        entryPoint: entryPoint,
        globalCount: context.globalSymbolTable.size,
        instructions: generateInstructionsArray(context),
        debug: {
          sourceMap: context.debug.sourceMap,
          functions: context.debug.functions,
          variables: context.debug.variables,
          scopes: context.debug.scopes,
          files: context.debug.files
        }
      };
  
      return JSON.stringify(vmFormat, null, 2);
    }
  
    export function generateConstantsArray(context: CompilationContext): VMConstant[] {
      return context.constantPool.map((constant) => ({
        type: constant.type as VMConstant['type'],
        value: constant.value
      }));
    }
  