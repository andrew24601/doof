#pragma once
#include <cstdint>

// Domino VM opcodes
enum class Opcode : uint8_t {
    // No-op and control
    NOP = 0x00,
    HALT = 0x01,

    // Move and load
    MOVE = 0x10,              // MOVE r0, r1           ; r0 = r1 (any type)
    LOADK = 0x11,             // LOADK r0, kidx        ; r0 = constant_pool[kidx] (any type)
    LOADK_NULL = 0x12,        // LOADK_NULL r0         ; r0 = null
    LOADK_INT16 = 0x13,       // LOADK_INT16 r0, imm16 ; r0 = signed 16-bit immediate
    LOADK_BOOL = 0x14,        // LOADK_BOOL r0, imm8   ; r0 = bool(imm8 != 0)
    LOADK_FLOAT = 0x15,       // LOADK_FLOAT r0, imm16 ; r0 = imm16 as fixed-point float (8.8 format)
    LOADK_CHAR = 0x16,        // LOADK_CHAR r0, imm8   ; r0 = char(imm8)

    // Arithmetic (type-specific)
    ADD_INT = 0x20,           // ADD_INT r0, r1, r2    ; r0 = r1 + r2 (int)
    SUB_INT = 0x21,
    MUL_INT = 0x22,
    DIV_INT = 0x23,
    MOD_INT = 0x24,           // MOD_INT r0, r1, r2    ; r0 = r1 % r2 (int)

    ADD_FLOAT = 0x25,         // ADD_FLOAT r0, r1, r2  ; r0 = r1 + r2 (float)
    SUB_FLOAT = 0x26,
    MUL_FLOAT = 0x27,
    DIV_FLOAT = 0x28,

    ADD_DOUBLE = 0x29,        // ADD_DOUBLE r0, r1, r2 ; r0 = r1 + r2 (double)
    SUB_DOUBLE = 0x2A,
    MUL_DOUBLE = 0x2B,
    DIV_DOUBLE = 0x2C,

    // Boolean logic
    NOT_BOOL = 0x30,          // NOT_BOOL r0, r1       ; r0 = !r1 (bool)
    AND_BOOL = 0x31,          // AND_BOOL r0, r1, r2   ; r0 = r1 && r2 (bool)
    OR_BOOL = 0x32,           // OR_BOOL r0, r1, r2    ; r0 = r1 || r2 (bool)

    // Comparison (type-specific, collapsed where possible)
    EQ_INT = 0x40,            // EQ_INT r0, r1, r2     ; r0 = (r1 == r2) (bool)
    LT_INT = 0x41,            // LT_INT r0, r1, r2     ; r0 = (r1 < r2) (bool)

    EQ_FLOAT = 0x42,          // EQ_FLOAT r0, r1, r2   ; r0 = (r1 == r2) (bool)
    LT_FLOAT = 0x43,          // LT_FLOAT r0, r1, r2   ; r0 = (r1 < r2) (bool)
    LTE_FLOAT = 0x44,         // LTE_FLOAT r0, r1, r2  ; r0 = (r1 <= r2) (bool, retained for NaN handling)

    EQ_DOUBLE = 0x45,         // EQ_DOUBLE r0, r1, r2  ; r0 = (r1 == r2) (bool)
    LT_DOUBLE = 0x46,         // LT_DOUBLE r0, r1, r2  ; r0 = (r1 < r2) (bool)
    LTE_DOUBLE = 0x47,        // LTE_DOUBLE r0, r1, r2 ; r0 = (r1 <= r2) (bool, retained for NaN handling)

    EQ_STRING = 0x48,         // EQ_STRING r0, r1, r2  ; r0 = (r1 == r2) (bool)
    LT_STRING = 0x49,         // LT_STRING r0, r1, r2  ; r0 = (r1 < r2) (bool, lexicographic order)

    EQ_BOOL = 0x4A,           // EQ_BOOL r0, r1, r2    ; r0 = (r1 == r2) (bool)
    LT_BOOL = 0x4B,           // LT_BOOL r0, r1, r2    ; r0 = (r1 < r2) (bool, false < true)

    EQ_OBJECT = 0x4C,         // EQ_OBJECT r0, r1, r2  ; r0 = (r1 == r2) (bool)
    
    EQ_CHAR = 0x4D,           // EQ_CHAR r0, r1, r2    ; r0 = (r1 == r2) (bool)
    LT_CHAR = 0x4E,           // LT_CHAR r0, r1, r2    ; r0 = (r1 < r2) (bool, lexicographic order)
    // 0x4F reserved for future use

    // Type conversions
    INT_TO_FLOAT = 0x50,      // INT_TO_FLOAT r0, r1   ; r0 = float(r1)
    INT_TO_DOUBLE = 0x51,
    FLOAT_TO_INT = 0x52,
    DOUBLE_TO_INT = 0x53,
    FLOAT_TO_DOUBLE = 0x54,
    DOUBLE_TO_FLOAT = 0x55,

    // Type checking
    IS_NULL = 0x56,           // IS_NULL r0, r1        ; r0 = r1.is_null() (bool)
    GET_CLASS_IDX = 0x57,     // GET_CLASS_IDX r0, r1  ; r0 = r1.class_idx (int, -1 for null/non-objects)

    // Type to string conversions
    INT_TO_STRING = 0x58,     // INT_TO_STRING r0, r1  ; r0 = std::to_string(r1)
    FLOAT_TO_STRING = 0x59,   // FLOAT_TO_STRING r0, r1; r0 = std::to_string(r1)
    DOUBLE_TO_STRING = 0x5A,  // DOUBLE_TO_STRING r0, r1; r0 = std::to_string(r1)
    BOOL_TO_STRING = 0x5B,    // BOOL_TO_STRING r0, r1 ; r0 = r1 ? "true" : "false"
    CHAR_TO_STRING = 0x5C,    // CHAR_TO_STRING r0, r1 ; r0 = std::string(1, r1)
    TYPE_OF = 0x5D,           // TYPE_OF r0, r1        ; r0 = r1.type() (int, ValueType enum)

    // Extended type conversions (string parsing)
    STRING_TO_INT = 0x5E,     // STRING_TO_INT r0, r1  ; r0 = parse_int(r1), panics if invalid
    STRING_TO_FLOAT = 0x5F,   // STRING_TO_FLOAT r0, r1; r0 = parse_float(r1), panics if invalid  
    STRING_TO_DOUBLE = 0x60,  // STRING_TO_DOUBLE r0, r1; r0 = parse_double(r1), panics if invalid
    STRING_TO_BOOL = 0x61,    // STRING_TO_BOOL r0, r1 ; r0 = parse_bool(r1), panics if invalid
    STRING_TO_CHAR = 0x62,    // STRING_TO_CHAR r0, r1 ; r0 = r1[0] (first char), panics if empty
    
    // Identity conversions and extended bool conversions
    INT_TO_BOOL = 0x63,       // INT_TO_BOOL r0, r1    ; r0 = bool(r1) (0 -> false, else true)
    FLOAT_TO_BOOL = 0x64,     // FLOAT_TO_BOOL r0, r1  ; r0 = bool(r1) (0.0 -> false, else true)
    DOUBLE_TO_BOOL = 0x65,    // DOUBLE_TO_BOOL r0, r1 ; r0 = bool(r1) (0.0 -> false, else true)
    BOOL_TO_INT = 0x66,       // BOOL_TO_INT r0, r1    ; r0 = int(r1) (false -> 0, true -> 1)
    BOOL_TO_FLOAT = 0x67,     // BOOL_TO_FLOAT r0, r1  ; r0 = float(r1) (false -> 0.0, true -> 1.0)
    BOOL_TO_DOUBLE = 0x68,    // BOOL_TO_DOUBLE r0, r1 ; r0 = double(r1) (false -> 0.0, true -> 1.0)
    
    // Char conversions
    CHAR_TO_INT = 0x69,       // CHAR_TO_INT r0, r1    ; r0 = int(r1) (char code)
    INT_TO_CHAR = 0x6A,       // INT_TO_CHAR r0, r1    ; r0 = char(r1) (panics if out of range)
    
    // Enum conversions
    INT_TO_ENUM = 0x6B,       // INT_TO_ENUM r0, r1, kidx ; r0 = validate_enum<kidx>(r1), panics if invalid
    STRING_TO_ENUM = 0x6C,    // STRING_TO_ENUM r0, r1, kidx ; r0 = validate_enum<kidx>(r1), panics if invalid
    ENUM_TO_STRING = 0x6D,    // ENUM_TO_STRING r0, r1, kidx ; r0 = enum_label<kidx>(r1)
    
    // Class to JSON string conversion
    CLASS_TO_JSON = 0x6E,     // CLASS_TO_JSON r0, r1  ; r0 = json_string(r1)

    // String operations
    ADD_STRING = 0x70,        // ADD_STRING r0, r1, r2 ; r0 = r1 + r2 (concat)
    LENGTH_STRING = 0x71,     // LENGTH_STRING r0, r1  ; r0 = r1.length()

    // Array operations
    NEW_ARRAY = 0x72,         // NEW_ARRAY r0, imm24    ; r0 = new array of size imm24
    GET_ARRAY = 0x73,         // GET_ARRAY r0, r1, r2  ; r0 = r1[r2]
    SET_ARRAY = 0x74,         // SET_ARRAY r0, r1, r2  ; r0[r1] = r2
    LENGTH_ARRAY = 0x75,      // LENGTH_ARRAY r0, r1   ; r0 = r1.length

    // Object operations
    NEW_OBJECT = 0x80,        // NEW_OBJECT r0, uimm16   ; r0 = new object of class constant_pool[imm16]
    GET_FIELD = 0x81,         // GET_FIELD r0, r1, uimm8; r0 = r1.field (by uimm8 idx)
    SET_FIELD = 0x82,         // SET_FIELD r0, uimm8, r2; r0.field (by uimm8 idx) = r2

    // Map operations (string keys - existing)
    NEW_MAP = 0x83,           // NEW_MAP r0             ; r0 = new empty map<string, Value>
    GET_MAP = 0x84,           // GET_MAP r0, r1, r2     ; r0 = r1[r2] (map[string key])
    SET_MAP = 0x85,           // SET_MAP r0, r1, r2     ; r0[r1] = r2 (map[string key] = value)  
    HAS_KEY_MAP = 0x86,       // HAS_KEY_MAP r0, r1, r2 ; r0 = r1.has(r2) (bool, string key)
    DELETE_MAP = 0x87,        // DELETE_MAP r0, r1, r2  ; r0 = r1.delete(r2), return success (bool, string key)
    KEYS_MAP = 0x88,          // KEYS_MAP r0, r1        ; r0 = r1.keys() (array)
    VALUES_MAP = 0x89,        // VALUES_MAP r0, r1      ; r0 = r1.values() (array)
    SIZE_MAP = 0x8A,          // SIZE_MAP r0, r1        ; r0 = r1.size() (int)
    CLEAR_MAP = 0x8B,         // CLEAR_MAP r0           ; r0.clear()

    // Set operations (string elements - existing)
    NEW_SET = 0x8C,           // NEW_SET r0             ; r0 = new empty set<string>
    ADD_SET = 0x8D,           // ADD_SET r0, r1, r2     ; r0 = r1.add(r2), return true if added (string element)
    HAS_SET = 0x8E,           // HAS_SET r0, r1, r2     ; r0 = r1.has(r2) (bool, string element)
    DELETE_SET = 0x8F,        // DELETE_SET r0, r1, r2  ; r0 = r1.delete(r2), return true if removed (string element)
    SIZE_SET = 0x90,          // SIZE_SET r0, r1        ; r0 = r1.size() (int)
    CLEAR_SET = 0x91,         // CLEAR_SET r0           ; r0.clear()
    TO_ARRAY_SET = 0x92,      // TO_ARRAY_SET r0, r1    ; r0 = r1.toArray() (array)
    
    // Control flow (moved to make room for set operations)
    JMP = 0x93,               // JMP offset
    JMP_IF_TRUE = 0x94,       // JMP_IF_TRUE r0, offset
    JMP_IF_FALSE = 0x95,      // JMP_IF_FALSE r0, offset

    // Function call/return
    CALL = 0xA1,              // CALL r0, uimm16  ; call function at constant_pool[uimm16] passing parameters in r0..rN
    RETURN = 0xA2,            // RETURN r0
    EXTERN_CALL = 0xA3,       // EXTERN_CALL r0, uimm16 ; call external function named constant_pool[uimm16]

    // Lambda operations
    CREATE_LAMBDA = 0xA4,          // Create lambda (either escapting or non-escaping)
    INVOKE_LAMBDA = 0xA5,               // Invoke a lambda
    CAPTURE_VALUE = 0xA6,               // Capture by value (copy for escaping lambdas)
    // 0xA7-0xA9 reserved for legacy reference capture opcodes

    // Integer-keyed map operations (new)
    NEW_MAP_INT = 0xB1,       // NEW_MAP_INT r0         ; r0 = new empty map<int, Value>
    GET_MAP_INT = 0xB2,       // GET_MAP_INT r0, r1, r2 ; r0 = r1[r2] (map[int key])
    SET_MAP_INT = 0xB3,       // SET_MAP_INT r0, r1, r2 ; r0[r1] = r2 (map[int key] = value)
    HAS_KEY_MAP_INT = 0xB4,   // HAS_KEY_MAP_INT r0, r1, r2 ; r0 = r1.has(r2) (bool, int key)
    DELETE_MAP_INT = 0xB5,    // DELETE_MAP_INT r0, r1, r2 ; r0 = r1.delete(r2), return success (bool, int key)

    // Integer-element set operations (new) 
    NEW_SET_INT = 0xB6,       // NEW_SET_INT r0         ; r0 = new empty set<int>
    ADD_SET_INT = 0xB7,       // ADD_SET_INT r0, r1, r2 ; r0 = r1.add(r2), return true if added (int element)
    HAS_SET_INT = 0xB8,       // HAS_SET_INT r0, r1, r2 ; r0 = r1.has(r2) (bool, int element)
    DELETE_SET_INT = 0xB9,    // DELETE_SET_INT r0, r1, r2 ; r0 = r1.delete(r2), return true if removed (int element)
    
    // Iterator operations (for..of support)
    ITER_INIT = 0xC0,         // ITER_INIT r0, r1       ; r0 = new iterator for collection r1
    ITER_NEXT = 0xC1,         // ITER_NEXT r0, r1       ; r0 = 1 if next value exists, 0 if exhausted; advances iterator r1
    ITER_VALUE = 0xC2,        // ITER_VALUE r0, r1      ; r0 = current value from iterator r1
    ITER_KEY = 0xC3,          // ITER_KEY r0, r1        ; r0 = current key from iterator r1 (maps only)
    
    // Global variable operations (for static fields)
    GET_GLOBAL = 0xD0,        // GET_GLOBAL r0, uimm16  ; r0 = globals[uimm16]  
    SET_GLOBAL = 0xD1,        // SET_GLOBAL uimm16, r0  ; globals[uimm16] = r0
    
    // Reserved for future expansion
};

struct Instruction {
    uint8_t opcode;   // 1 byte (Opcode)
    uint8_t a;        // 1 byte (register or index)
    uint8_t b;        // 1 byte (register, index, or offset part)
    uint8_t c;        // 1 byte (register, index, or offset part)

    Instruction()
        : opcode(static_cast<uint8_t>(Opcode::NOP)), a(0), b(0), c(0) {}

    Instruction(Opcode op, uint8_t a_, uint8_t b_ = 0, uint8_t c_ = 0)
        : opcode(static_cast<uint8_t>(op)), a(a_), b(b_), c(c_) {}

    // For 24-bit immediates (e.g., jump offsets or LOADK_INT24)
    static Instruction with_imm24(Opcode op, int32_t imm24) {
        uint32_t uimm24 = static_cast<uint32_t>(imm24) & 0xFFFFFF;
        return Instruction(
            op,
            static_cast<uint8_t>((uimm24 >> 16) & 0xFF),
            static_cast<uint8_t>((uimm24 >> 8) & 0xFF),
            static_cast<uint8_t>(uimm24 & 0xFF)
        );
    }
    
    // For instructions with register target and 24-bit immediate
    static Instruction with_reg_imm16(Opcode op, uint8_t reg, int32_t imm16) {
        uint16_t uimm16 = static_cast<uint32_t>(imm16) & 0xFFFF;
        Instruction instr(
            op,
            reg,
            static_cast<uint8_t>((uimm16 >> 8) & 0xFF),
            static_cast<uint8_t>(uimm16 & 0xFF)
        );
        instr.a = reg;  // Override register
        return instr;
    }

    // Get signed 24-bit immediate from a, b, c
    int32_t imm24() const {
        int32_t val = (static_cast<int32_t>(a) << 16) |
                      (static_cast<int32_t>(b) << 8) |
                      static_cast<int32_t>(c);
        if (val & 0x800000) val |= ~0xFFFFFF;
        return val;
    }

    // Get signed 24-bit immediate from b, c
    int32_t imm16() const {
        int32_t val = (static_cast<int32_t>(b) << 8) | static_cast<int32_t>(c);
        if (val & 0x8000) val |= ~0xFFFF; // Sign extend
        return val;
    }

    uint16_t uimm16() const { return (static_cast<uint16_t>(b) << 8) | c; }
};
