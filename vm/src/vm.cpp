// Helper to extract 16-bit unsigned immediate from b and c fields
// (Assumes Instruction is defined in vm.h or included header)
// Add this method to the Instruction struct/class definition in vm.h:
//     uint16_t uimm16() const { return (static_cast<uint16_t>(b) << 8) | c; }
#include "vm.h"
#include "json.h"
#include "iterator.h"
#include "dap.h"
#include <stdexcept>
#include <iostream>
#include <sstream>
#include <cmath>
#include <algorithm>
#include <thread>
#include <chrono>
#include <iomanip>
#include <cctype>
#include <cstdlib>

struct StringBuilderObject : public Object {
    std::string buffer;
    int reserved_capacity = 0;

    void append_value(const Value& value) {
        switch (value.type()) {
            case ValueType::Null:
                buffer += "null";
                break;
            case ValueType::Bool:
                buffer += value.as_bool() ? "true" : "false";
                break;
            case ValueType::Int:
                buffer += std::to_string(value.as_int());
                break;
            case ValueType::Float:
                buffer += std::to_string(value.as_float());
                break;
            case ValueType::Double:
                buffer += std::to_string(value.as_double());
                break;
            case ValueType::String:
                buffer += value.as_string();
                break;
            case ValueType::Future:
                buffer += "[future]";
                break;
            default:
                buffer += "[object]";
                break;
        }
    }

    void clear_buffer() {
        buffer.clear();
    }

    void reserve_capacity(int capacity) {
        if (capacity < 0) {
            capacity = 0;
        }
        reserved_capacity = std::max(reserved_capacity, capacity);
        buffer.reserve(static_cast<std::size_t>(capacity));
    }
};

namespace {

inline int32_t as_int(const Value& value)
{
    if (value.type() != ValueType::Int)
    {
        throw std::runtime_error("Extern method expected int argument");
    }
    return value.as_int();
}

std::string format_register(uint8_t reg)
{
    return "r" + std::to_string(static_cast<int>(reg));
}

std::string value_debug_string(const Value &value);

std::string opcode_to_string(Opcode op)
{
    switch (op)
    {
    case Opcode::NOP: return "NOP";
    case Opcode::HALT: return "HALT";
    case Opcode::MOVE: return "MOVE";
    case Opcode::LOADK: return "LOADK";
    case Opcode::LOADK_NULL: return "LOADK_NULL";
    case Opcode::LOADK_INT16: return "LOADK_INT16";
    case Opcode::LOADK_BOOL: return "LOADK_BOOL";
    case Opcode::LOADK_FLOAT: return "LOADK_FLOAT";
    case Opcode::LOADK_CHAR: return "LOADK_CHAR";
    case Opcode::ADD_INT: return "ADD_INT";
    case Opcode::SUB_INT: return "SUB_INT";
    case Opcode::MUL_INT: return "MUL_INT";
    case Opcode::DIV_INT: return "DIV_INT";
    case Opcode::MOD_INT: return "MOD_INT";
    case Opcode::ADD_FLOAT: return "ADD_FLOAT";
    case Opcode::SUB_FLOAT: return "SUB_FLOAT";
    case Opcode::MUL_FLOAT: return "MUL_FLOAT";
    case Opcode::DIV_FLOAT: return "DIV_FLOAT";
    case Opcode::ADD_DOUBLE: return "ADD_DOUBLE";
    case Opcode::SUB_DOUBLE: return "SUB_DOUBLE";
    case Opcode::MUL_DOUBLE: return "MUL_DOUBLE";
    case Opcode::DIV_DOUBLE: return "DIV_DOUBLE";
    case Opcode::NOT_BOOL: return "NOT_BOOL";
    case Opcode::AND_BOOL: return "AND_BOOL";
    case Opcode::OR_BOOL: return "OR_BOOL";
    case Opcode::EQ_INT: return "EQ_INT";
    case Opcode::LT_INT: return "LT_INT";
    case Opcode::EQ_FLOAT: return "EQ_FLOAT";
    case Opcode::LT_FLOAT: return "LT_FLOAT";
    case Opcode::LTE_FLOAT: return "LTE_FLOAT";
    case Opcode::EQ_DOUBLE: return "EQ_DOUBLE";
    case Opcode::LT_DOUBLE: return "LT_DOUBLE";
    case Opcode::LTE_DOUBLE: return "LTE_DOUBLE";
    case Opcode::EQ_STRING: return "EQ_STRING";
    case Opcode::LT_STRING: return "LT_STRING";
    case Opcode::EQ_BOOL: return "EQ_BOOL";
    case Opcode::LT_BOOL: return "LT_BOOL";
    case Opcode::EQ_OBJECT: return "EQ_OBJECT";
    case Opcode::EQ_CHAR: return "EQ_CHAR";
    case Opcode::LT_CHAR: return "LT_CHAR";
    case Opcode::INT_TO_FLOAT: return "INT_TO_FLOAT";
    case Opcode::INT_TO_DOUBLE: return "INT_TO_DOUBLE";
    case Opcode::FLOAT_TO_INT: return "FLOAT_TO_INT";
    case Opcode::DOUBLE_TO_INT: return "DOUBLE_TO_INT";
    case Opcode::FLOAT_TO_DOUBLE: return "FLOAT_TO_DOUBLE";
    case Opcode::DOUBLE_TO_FLOAT: return "DOUBLE_TO_FLOAT";
    case Opcode::IS_NULL: return "IS_NULL";
    case Opcode::GET_CLASS_IDX: return "GET_CLASS_IDX";
    case Opcode::INT_TO_STRING: return "INT_TO_STRING";
    case Opcode::FLOAT_TO_STRING: return "FLOAT_TO_STRING";
    case Opcode::DOUBLE_TO_STRING: return "DOUBLE_TO_STRING";
    case Opcode::BOOL_TO_STRING: return "BOOL_TO_STRING";
    case Opcode::CHAR_TO_STRING: return "CHAR_TO_STRING";
    case Opcode::TYPE_OF: return "TYPE_OF";
    case Opcode::STRING_TO_INT: return "STRING_TO_INT";
    case Opcode::STRING_TO_FLOAT: return "STRING_TO_FLOAT";
    case Opcode::STRING_TO_DOUBLE: return "STRING_TO_DOUBLE";
    case Opcode::STRING_TO_BOOL: return "STRING_TO_BOOL";
    case Opcode::STRING_TO_CHAR: return "STRING_TO_CHAR";
    case Opcode::INT_TO_BOOL: return "INT_TO_BOOL";
    case Opcode::FLOAT_TO_BOOL: return "FLOAT_TO_BOOL";
    case Opcode::DOUBLE_TO_BOOL: return "DOUBLE_TO_BOOL";
    case Opcode::BOOL_TO_INT: return "BOOL_TO_INT";
    case Opcode::BOOL_TO_FLOAT: return "BOOL_TO_FLOAT";
    case Opcode::BOOL_TO_DOUBLE: return "BOOL_TO_DOUBLE";
    case Opcode::CHAR_TO_INT: return "CHAR_TO_INT";
    case Opcode::INT_TO_CHAR: return "INT_TO_CHAR";
    case Opcode::INT_TO_ENUM: return "INT_TO_ENUM"; // TODO: currently unused with string-backed enums
    case Opcode::STRING_TO_ENUM: return "STRING_TO_ENUM"; // TODO: currently unused with string-backed enums
    // Removed ENUM_TO_STRING opcode: enums are represented directly as strings in current design.
    case Opcode::CLASS_TO_JSON: return "CLASS_TO_JSON";
    case Opcode::CLASS_FROM_JSON: return "CLASS_FROM_JSON";
    case Opcode::ADD_STRING: return "ADD_STRING";
    case Opcode::LENGTH_STRING: return "LENGTH_STRING";
    case Opcode::NEW_ARRAY: return "NEW_ARRAY";
    case Opcode::GET_ARRAY: return "GET_ARRAY";
    case Opcode::SET_ARRAY: return "SET_ARRAY";
    case Opcode::LENGTH_ARRAY: return "LENGTH_ARRAY";
    case Opcode::NEW_OBJECT: return "NEW_OBJECT";
    case Opcode::GET_FIELD: return "GET_FIELD";
    case Opcode::SET_FIELD: return "SET_FIELD";
    case Opcode::NEW_MAP: return "NEW_MAP";
    case Opcode::GET_MAP: return "GET_MAP";
    case Opcode::SET_MAP: return "SET_MAP";
    case Opcode::HAS_KEY_MAP: return "HAS_KEY_MAP";
    case Opcode::DELETE_MAP: return "DELETE_MAP";
    case Opcode::KEYS_MAP: return "KEYS_MAP";
    case Opcode::VALUES_MAP: return "VALUES_MAP";
    case Opcode::SIZE_MAP: return "SIZE_MAP";
    case Opcode::CLEAR_MAP: return "CLEAR_MAP";
    case Opcode::NEW_SET: return "NEW_SET";
    case Opcode::ADD_SET: return "ADD_SET";
    case Opcode::HAS_SET: return "HAS_SET";
    case Opcode::DELETE_SET: return "DELETE_SET";
    case Opcode::SIZE_SET: return "SIZE_SET";
    case Opcode::CLEAR_SET: return "CLEAR_SET";
    case Opcode::TO_ARRAY_SET: return "TO_ARRAY_SET";
    case Opcode::JMP: return "JMP";
    case Opcode::JMP_IF_TRUE: return "JMP_IF_TRUE";
    case Opcode::JMP_IF_FALSE: return "JMP_IF_FALSE";
    case Opcode::CALL: return "CALL";
    case Opcode::RETURN: return "RETURN";
    case Opcode::EXTERN_CALL: return "EXTERN_CALL";
    case Opcode::CREATE_LAMBDA: return "CREATE_LAMBDA";
    case Opcode::INVOKE_LAMBDA: return "INVOKE_LAMBDA";
    case Opcode::CAPTURE_VALUE: return "CAPTURE_VALUE";
    case Opcode::NEW_MAP_INT: return "NEW_MAP_INT";
    case Opcode::GET_MAP_INT: return "GET_MAP_INT";
    case Opcode::SET_MAP_INT: return "SET_MAP_INT";
    case Opcode::HAS_KEY_MAP_INT: return "HAS_KEY_MAP_INT";
    case Opcode::DELETE_MAP_INT: return "DELETE_MAP_INT";
    case Opcode::NEW_SET_INT: return "NEW_SET_INT";
    case Opcode::ADD_SET_INT: return "ADD_SET_INT";
    case Opcode::HAS_SET_INT: return "HAS_SET_INT";
    case Opcode::DELETE_SET_INT: return "DELETE_SET_INT";
    case Opcode::ITER_INIT: return "ITER_INIT";
    case Opcode::ITER_NEXT: return "ITER_NEXT";
    case Opcode::ITER_VALUE: return "ITER_VALUE";
    case Opcode::ITER_KEY: return "ITER_KEY";
    case Opcode::GET_GLOBAL: return "GET_GLOBAL";
    case Opcode::SET_GLOBAL: return "SET_GLOBAL";
    case Opcode::ASYNC_CALL: return "ASYNC_CALL";
    case Opcode::AWAIT: return "AWAIT";
    }
    return "UNKNOWN";
}

bool is_three_register_op(Opcode op)
{
    switch (op)
    {
    case Opcode::ADD_INT:
    case Opcode::SUB_INT:
    case Opcode::MUL_INT:
    case Opcode::DIV_INT:
    case Opcode::MOD_INT:
    case Opcode::ADD_FLOAT:
    case Opcode::SUB_FLOAT:
    case Opcode::MUL_FLOAT:
    case Opcode::DIV_FLOAT:
    case Opcode::ADD_DOUBLE:
    case Opcode::SUB_DOUBLE:
    case Opcode::MUL_DOUBLE:
    case Opcode::DIV_DOUBLE:
    case Opcode::AND_BOOL:
    case Opcode::OR_BOOL:
    case Opcode::EQ_INT:
    case Opcode::LT_INT:
    case Opcode::EQ_FLOAT:
    case Opcode::LT_FLOAT:
    case Opcode::LTE_FLOAT:
    case Opcode::EQ_DOUBLE:
    case Opcode::LT_DOUBLE:
    case Opcode::LTE_DOUBLE:
    case Opcode::EQ_STRING:
    case Opcode::LT_STRING:
    case Opcode::EQ_BOOL:
    case Opcode::LT_BOOL:
    case Opcode::EQ_OBJECT:
    case Opcode::EQ_CHAR:
    case Opcode::LT_CHAR:
    case Opcode::ADD_STRING:
    case Opcode::GET_ARRAY:
    case Opcode::SET_ARRAY:
    case Opcode::GET_MAP:
    case Opcode::SET_MAP:
    case Opcode::HAS_KEY_MAP:
    case Opcode::DELETE_MAP:
    case Opcode::GET_MAP_INT:
    case Opcode::SET_MAP_INT:
    case Opcode::HAS_KEY_MAP_INT:
    case Opcode::DELETE_MAP_INT:
    case Opcode::ADD_SET:
    case Opcode::HAS_SET:
    case Opcode::DELETE_SET:
    case Opcode::ADD_SET_INT:
    case Opcode::HAS_SET_INT:
    case Opcode::DELETE_SET_INT:
        return true;
    default:
        return false;
    }
}

bool is_two_register_op(Opcode op)
{
    switch (op)
    {
    case Opcode::MOVE:
    case Opcode::NOT_BOOL:
    case Opcode::LENGTH_STRING:
    case Opcode::LENGTH_ARRAY:
    case Opcode::GET_FIELD:
    case Opcode::SET_FIELD:
    case Opcode::VALUES_MAP:
    case Opcode::KEYS_MAP:
    case Opcode::SIZE_MAP:
    case Opcode::SIZE_SET:
    case Opcode::TO_ARRAY_SET:
    case Opcode::ITER_INIT:
    case Opcode::ITER_NEXT:
    case Opcode::ITER_VALUE:
    case Opcode::ITER_KEY:
    case Opcode::IS_NULL:
    case Opcode::GET_CLASS_IDX:
    case Opcode::INT_TO_FLOAT:
    case Opcode::INT_TO_DOUBLE:
    case Opcode::FLOAT_TO_INT:
    case Opcode::DOUBLE_TO_INT:
    case Opcode::FLOAT_TO_DOUBLE:
    case Opcode::DOUBLE_TO_FLOAT:
    case Opcode::INT_TO_STRING:
    case Opcode::FLOAT_TO_STRING:
    case Opcode::DOUBLE_TO_STRING:
    case Opcode::BOOL_TO_STRING:
    case Opcode::CHAR_TO_STRING:
    case Opcode::TYPE_OF:
    case Opcode::STRING_TO_INT:
    case Opcode::STRING_TO_FLOAT:
    case Opcode::STRING_TO_DOUBLE:
    case Opcode::STRING_TO_BOOL:
    case Opcode::STRING_TO_CHAR:
    case Opcode::INT_TO_BOOL:
    case Opcode::FLOAT_TO_BOOL:
    case Opcode::DOUBLE_TO_BOOL:
    case Opcode::BOOL_TO_INT:
    case Opcode::BOOL_TO_FLOAT:
    case Opcode::BOOL_TO_DOUBLE:
    case Opcode::CHAR_TO_INT:
    case Opcode::INT_TO_CHAR:
    case Opcode::CLASS_TO_JSON:
    case Opcode::CLASS_FROM_JSON:
    case Opcode::CAPTURE_VALUE:
    case Opcode::RETURN:
    case Opcode::JMP_IF_TRUE:
    case Opcode::JMP_IF_FALSE:
    case Opcode::SET_GLOBAL:
    case Opcode::GET_GLOBAL:
    case Opcode::AWAIT:
        return true;
    default:
        return false;
    }
}

std::string value_debug_string(const Value &value)
{
    switch (value.type())
    {
    case ValueType::Null:
        return "null";
    case ValueType::Bool:
        return value.as_bool() ? "true" : "false";
    case ValueType::Int:
        return std::to_string(value.as_int());
    case ValueType::Float:
    {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(4) << value.as_float();
        return oss.str();
    }
    case ValueType::Double:
    {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(4) << value.as_double();
        return oss.str();
    }
    case ValueType::Char:
    {
        char c = value.as_char();
        if (std::isprint(static_cast<unsigned char>(c)))
        {
            return std::string("'") + c + "'";
        }
        return "#" + std::to_string(static_cast<int>(static_cast<unsigned char>(c)));
    }
    case ValueType::String:
    {
        const std::string &s = value.as_string();
        if (s.size() <= 32)
        {
            return std::string("\"") + s + "\"";
        }
        return std::string("\"") + s.substr(0, 29) + "...\"";
    }
    case ValueType::Object:
        return "[object]";
    case ValueType::Array:
        return "[array len=" + std::to_string(value.as_array()->size()) + "]";
    case ValueType::Lambda:
        return "[lambda]";
    case ValueType::Map:
        return "[map size=" + std::to_string(value.as_map()->size()) + "]";
    case ValueType::Set:
        return "[set size=" + std::to_string(value.as_set()->size()) + "]";
    case ValueType::IntMap:
        return "[intmap size=" + std::to_string(value.as_int_map()->size()) + "]";
    case ValueType::IntSet:
        return "[intset size=" + std::to_string(value.as_int_set()->size()) + "]";
    case ValueType::Iterator:
        return "[iterator]";
    }
    return "<unknown>";
}

std::string format_instruction(const Instruction &instr, const std::vector<Value> &constant_pool)
{
    const Opcode op = static_cast<Opcode>(instr.opcode);
    const std::string mnemonic = opcode_to_string(op);
    const std::string regA = format_register(instr.a);
    const std::string regB = format_register(instr.b);
    const std::string regC = format_register(instr.c);

    auto append_const_info = [&](std::ostringstream &out, uint16_t index) {
        out << "const[" << index << "]";
        if (index < constant_pool.size())
        {
            out << "=" << value_debug_string(constant_pool[index]);
        }
        else
        {
            out << "=<out-of-range>";
        }
    };

    std::ostringstream out;
    out << mnemonic;

    if (is_three_register_op(op))
    {
        out << ' ' << regA << ", " << regB << ", " << regC;
        if (op == Opcode::SET_ARRAY)
        {
            out << "  // " << regA << "[" << regB << "] = " << regC;
        }
        else if (op == Opcode::GET_ARRAY)
        {
            out << "  // " << regA << " = " << regB << "[" << regC << "]";
        }
        return out.str();
    }

    if (is_two_register_op(op))
    {
        switch (op)
        {
        case Opcode::GET_FIELD:
        case Opcode::SET_FIELD:
        {
            out << ' ' << regA << ", " << regB;
            if (op == Opcode::SET_FIELD)
            {
                out << ", " << regC;
                out << "  // " << regA << ".field[" << static_cast<int>(instr.b) << "] = " << regC;
            }
            else
            {
                out << "  // " << regA << " = " << regB << ".field[" << static_cast<int>(instr.c) << "]";
            }
            return out.str();
        }
        case Opcode::SET_GLOBAL:
        {
            out << " global[" << instr.uimm16() << "], " << regA;
            return out.str();
        }
        case Opcode::GET_GLOBAL:
        {
            out << ' ' << regA << ", global[" << instr.uimm16() << "]";
            return out.str();
        }
        case Opcode::JMP_IF_TRUE:
        case Opcode::JMP_IF_FALSE:
        {
            out << ' ' << regA << ", offset=" << instr.imm16();
            return out.str();
        }
        case Opcode::RETURN:
        {
            out << ' ' << regA;
            return out.str();
        }
        default:
            out << ' ' << regA << ", " << regB;
            return out.str();
        }
    }

    switch (op)
    {
    case Opcode::LOADK:
    {
        out << ' ' << regA << ", ";
        append_const_info(out, instr.uimm16());
        return out.str();
    }
    case Opcode::NOP:
    case Opcode::HALT:
    {
        return mnemonic;
    }
    case Opcode::LOADK_NULL:
    {
        out << ' ' << regA << " = null";
        return out.str();
    }
    case Opcode::LOADK_INT16:
    {
        out << ' ' << regA << ", imm=" << instr.imm16();
        return out.str();
    }
    case Opcode::LOADK_BOOL:
    {
        out << ' ' << regA << ", value=" << (instr.b != 0 ? "true" : "false");
        return out.str();
    }
    case Opcode::LOADK_FLOAT:
    {
        float floatValue = static_cast<float>(instr.imm16()) / 256.0f;
        out << ' ' << regA << ", value=" << floatValue;
        return out.str();
    }
    case Opcode::LOADK_CHAR:
    {
        char c = static_cast<char>(instr.b);
        out << ' ' << regA << ", value='";
        if (std::isprint(static_cast<unsigned char>(c)))
        {
            out << c;
        }
        else
        {
            out << "\\x" << std::hex << std::setw(2) << std::setfill('0') << (static_cast<int>(static_cast<unsigned char>(c)) & 0xFF);
        }
        out << "'";
        return out.str();
    }
    case Opcode::NEW_ARRAY:
    {
        out << ' ' << regA << ", size=" << instr.imm16();
        return out.str();
    }
    case Opcode::NEW_OBJECT:
    {
        out << ' ' << regA << ", class=";
        append_const_info(out, instr.uimm16());
        return out.str();
    }
    case Opcode::NEW_MAP:
    case Opcode::NEW_SET:
    case Opcode::NEW_MAP_INT:
    case Opcode::NEW_SET_INT:
    {
        out << ' ' << regA;
        return out.str();
    }
    case Opcode::CLEAR_MAP:
    case Opcode::CLEAR_SET:
    {
        out << ' ' << regA;
        return out.str();
    }
    case Opcode::JMP:
    {
        out << " offset=" << instr.imm16();
        return out.str();
    }
    case Opcode::CALL:
    case Opcode::ASYNC_CALL:
    {
        out << ' ' << regA << ", target=";
        append_const_info(out, instr.uimm16());
        return out.str();
    }
    case Opcode::EXTERN_CALL:
    {
        out << ' ' << regA << ", name=";
        append_const_info(out, instr.uimm16());
        return out.str();
    }
    case Opcode::CREATE_LAMBDA:
    {
        out << ' ' << regA << ", codeIndex=" << instr.uimm16();
        return out.str();
    }
    case Opcode::CAPTURE_VALUE:
    {
        out << ' ' << regA << ", " << regB;
        return out.str();
    }
    case Opcode::INVOKE_LAMBDA:
    {
        out << ' ' << regA << ", " << regB;
        return out.str();
    }
    default:
        out << " (a=" << static_cast<int>(instr.a)
            << ", b=" << static_cast<int>(instr.b)
            << ", c=" << static_cast<int>(instr.c) << ")";
        return out.str();
    }
}

} // namespace

// Conditional validation macros for performance optimization
#ifdef DOMINO_VM_UNSAFE
#define VM_VALIDATE_REGISTER(reg) ((void)0)
#define VM_VALIDATE_CONSTANT_INDEX(idx, pool) ((void)0)
#define VM_BOUNDS_CHECK(condition, message) ((void)0)
#else
#define VM_VALIDATE_REGISTER(reg) validate_register(reg)
#define VM_VALIDATE_CONSTANT_INDEX(idx, pool) validate_constant_index(idx, pool)
#define VM_BOUNDS_CHECK(condition, message)    \
    do                                         \
    {                                          \
        if (!(condition))                      \
            throw std::runtime_error(message); \
    } while (0)
#endif

// JSON string escaping helper
static void escape_json_string(std::ostringstream& oss, std::string_view str) {
    for (unsigned char c : str) {
        switch (c) {
            case '"':  oss << "\\\""; break;
            case '\\': oss << "\\\\"; break;
            case '\b': oss << "\\b"; break;
            case '\f': oss << "\\f"; break;
            case '\n': oss << "\\n"; break;
            case '\r': oss << "\\r"; break;
            case '\t': oss << "\\t"; break;
            default:
                if (c < 0x20) {
                    oss << "\\u00";
                    static const char* hex = "0123456789abcdef";
                    oss << hex[(c >> 4) & 0xF] << hex[c & 0xF];
                } else {
                    oss << static_cast<char>(c);
                }
                break;
        }
    }
}

// Helper function to serialize a Value to JSON string
std::string value_to_json(const Value& val, const std::vector<Value>& constant_pool) {
    std::ostringstream oss;

    switch (val.type()) {
        case ValueType::Null:
            oss << "null";
            break;
        case ValueType::Bool:
            oss << (val.as_bool() ? "true" : "false");
            break;
        case ValueType::Int:
            oss << val.as_int();
            break;
        case ValueType::Float:
            oss << val.as_float();
            break;
        case ValueType::Double:
            oss << val.as_double();
            break;
        case ValueType::Char: {
            oss << '"';
            char c = val.as_char();
            std::string s(1, c);
            escape_json_string(oss, s);
            oss << '"';
            break;
        }
        case ValueType::String: {
            oss << '"';
            escape_json_string(oss, val.as_string());
            oss << '"';
            break;
        }
        case ValueType::Object: {
            // Serialize object fields as JSON
            const auto& obj = val.as_object();

            if (auto sb = std::dynamic_pointer_cast<StringBuilderObject>(obj)) {
                oss << "{";
                oss << "\"buffer\":"
                    << value_to_json(Value::make_string(sb->buffer), constant_pool)
                    << ",\"reserved\":" << sb->reserved_capacity;
                oss << "}";
                break;
            }

            oss << "{";

            // Try to get class metadata for field names
            if (obj->class_idx >= 0 && obj->class_idx < static_cast<int>(constant_pool.size())) {
                const Value& class_val = constant_pool[obj->class_idx];
                if (class_val.type() == ValueType::Object) {
                    auto class_meta = std::dynamic_pointer_cast<ClassMetadata>(class_val.as_object());
                    // ClassMetadata has: fields[0]=name, fields[1]=fieldCount, fields[2]=methodCount, fields[3]=array of field names
                    if (class_meta && class_meta->fields.size() > 3) {
                        // Check if fields[3] contains an array of field names
                        if (class_meta->fields[3].type() == ValueType::Array) {
                            const auto& field_names = class_meta->fields[3].as_array();
                            for (size_t i = 0; i < obj->fields.size(); ++i) {
                                if (i > 0) oss << ",";
                                if (i < field_names->size() && (*field_names)[i].type() == ValueType::String) {
                                    oss << '"';
                                    escape_json_string(oss, (*field_names)[i].as_string());
                                    oss << "\":";
                                } else {
                                    oss << '"' << "field" << i << "\":";
                                }
                                oss << value_to_json(obj->fields[i], constant_pool);
                            }
                        } else {
                            // fields[3] is not an array - maybe the field names are stored differently
                            bool has_field_names = true;
                            for (size_t i = 0; i < obj->fields.size() && (3 + i) < class_meta->fields.size(); ++i) {
                                if (class_meta->fields[3 + i].type() != ValueType::String) {
                                    has_field_names = false;
                                    break;
                                }
                            }

                            if (has_field_names) {
                                for (size_t i = 0; i < obj->fields.size(); ++i) {
                                    if (i > 0) oss << ",";
                                    if ((3 + i) < class_meta->fields.size()) {
                                        oss << '"';
                                        escape_json_string(oss, class_meta->fields[3 + i].as_string());
                                        oss << "\":";
                                    } else {
                                        oss << '"' << "field" << i << "\":";
                                    }
                                    oss << value_to_json(obj->fields[i], constant_pool);
                                }
                            } else {
                                // Fallback: use generic field names
                                for (size_t i = 0; i < obj->fields.size(); ++i) {
                                    if (i > 0) oss << ",";
                                    oss << '"' << "field" << i << "\":" << value_to_json(obj->fields[i], constant_pool);
                                }
                            }
                        }
                    } else {
                        // Fallback: use generic field names
                        for (size_t i = 0; i < obj->fields.size(); ++i) {
                            if (i > 0) oss << ",";
                            oss << '"' << "field" << i << "\":" << value_to_json(obj->fields[i], constant_pool);
                        }
                    }
                }
            } else {
                // No metadata: use generic field names
                for (size_t i = 0; i < obj->fields.size(); ++i) {
                    if (i > 0) oss << ",";
                    oss << '"' << "field" << i << "\":" << value_to_json(obj->fields[i], constant_pool);
                }
            }

            oss << "}";
            break;
        }
        case ValueType::Array: {
            const auto& array = val.as_array();
            oss << "[";
            for (size_t i = 0; i < array->size(); ++i) {
                if (i > 0) oss << ",";
                oss << value_to_json((*array)[i], constant_pool);
            }
            oss << "]";
            break;
        }
        case ValueType::Map: {
            const auto& m = val.as_map();
            oss << "{";
            bool first = true;
            for (const auto& kv : *m) {
                if (!first) oss << ",";
                first = false;
                oss << '"';
                escape_json_string(oss, kv.first);
                oss << "\":";
                oss << value_to_json(kv.second, constant_pool);
            }
            oss << "}";
            break;
        }
        case ValueType::IntMap: {
            const auto& m = val.as_int_map();
            oss << "{";
            bool first = true;
            for (const auto& kv : *m) {
                if (!first) oss << ",";
                first = false;
                oss << '"' << kv.first << "\":";
                oss << value_to_json(kv.second, constant_pool);
            }
            oss << "}";
            break;
        }
        case ValueType::Set: {
            const auto& s = val.as_set();
            oss << "[";
            bool first = true;
            for (const auto& elem : *s) {
                if (!first) oss << ",";
                first = false;
                oss << value_to_json(elem, constant_pool);
            }
            oss << "]";
            break;
        }
        case ValueType::IntSet: {
            const auto& s = val.as_int_set();
            oss << "[";
            bool first = true;
            for (const auto& elem : *s) {
                if (!first) oss << ",";
                first = false;
                oss << elem;
            }
            oss << "]";
            break;
        }
        default:
            // For other types (Lambda, Iterator), use placeholder for now
            oss << '"' << "[" << static_cast<int>(val.type()) << "]" << '"';
            break;
    }

    return oss.str();
}

// VMThread Implementation

VMThread::VMThread(DoofVM& vm) : vm_(vm) {
    call_stack.emplace_back(256);
}

void VMThread::set_initial_registers(const std::vector<Value>& args) {
    if (call_stack.empty()) {
        throw std::runtime_error("Cannot set registers: call stack is empty");
    }
    auto& frame = call_stack.back();
    for (size_t i = 0; i < args.size(); ++i) {
        if (i + 1 < frame.registers.size()) {
            frame.registers[i + 1] = args[i];
        }
    }
}

void VMThread::push_frame(int function_index, int num_registers)
{
    call_stack.emplace_back(num_registers);
    call_stack.back().function_index = function_index;
}

void VMThread::pop_frame()
{
#ifndef DOMINO_VM_UNSAFE
    if (call_stack.empty())
    {
        throw std::runtime_error("Cannot pop from empty call stack");
    }
#endif
    call_stack.pop_back();
}

#ifndef DOMINO_VM_UNSAFE
void VMThread::validate_register(uint8_t reg) const
{
    if (call_stack.empty())
    {
        throw std::runtime_error("No active frame");
    }
    if (reg >= call_stack.back().registers.size())
    {
        throw std::runtime_error("Register index out of bounds: " + std::to_string(reg));
    }
}

void VMThread::validate_constant_index(int index, const std::vector<Value> &constant_pool) const
{
    if (index < 0 || index >= static_cast<int>(constant_pool.size()))
    {
        throw std::runtime_error("Constant pool index out of bounds: " + std::to_string(index));
    }
}
#endif

void VMThread::run(const std::vector<Instruction> &code,
                   const std::vector<Value> &constant_pool,
                   int entry_point)
{
    int code_size = static_cast<int>(code.size());
    
    if (call_stack.empty())
    {
        call_stack.emplace_back(256);
    }
    
    current_frame().instruction_pointer = entry_point;

#ifndef DOMINO_VM_UNSAFE
    if (vm_.is_verbose()) {
        std::cout << "[VMThread] Starting execution with " << code_size << " instructions" << std::endl;
        std::cout << "[VMThread] Call stack depth: " << call_stack.size() << std::endl;
    }
#endif

    while (!call_stack.empty())
    {
        StackFrame &frame = current_frame();
        std::vector<Value> &registers = frame.registers;
        int ip = frame.instruction_pointer;

        while (true)
        {
#ifndef DOMINO_VM_UNSAFE
            if (ip < 0 || ip >= code_size)
            {
                throw std::runtime_error("Falling off the end of code");
            }
            if (vm_.is_verbose() && ip % 10 == 0) {
                std::cout << "[VMThread] IP: " << ip << ", Call stack depth: " << call_stack.size() << std::endl;
            }
#endif

            currentInstruction_ = ip;

            if (debugMode_) {
                while (paused_) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                }
                
                if (debugState_.hasBreakpointAtInstruction(ip)) {
                    paused_ = true;
                    if (vm_.getDAPHandler()) {
                        vm_.getDAPHandler()->notifyBreakpointHit(1);
                    }
                    while (paused_) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    }
                }
                
                if (debugState_.shouldBreakOnStep(ip, static_cast<int>(call_stack.size()))) {
                    paused_ = true;
                    SourceMapEntry currentLocation = debugState_.getSourceFromInstruction(ip);
                    if (currentLocation.sourceLine != -1) {
                        debugState_.setStepFromLine(currentLocation.sourceLine, currentLocation.fileIndex);
                    }
                    if (vm_.getDAPHandler()) {
                        vm_.getDAPHandler()->notifyStepComplete(1);
                    }
                    while (paused_) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    }
                }
            }

            const Instruction &instr = code[ip];
            const Opcode op = static_cast<Opcode>(instr.opcode);

#ifndef DOMINO_VM_UNSAFE
            if (vm_.is_verbose()) {
                std::cout << "[VMThread] IP=" << ip << " " << format_instruction(instr, constant_pool) << std::endl;
            }
#endif

            switch (op)
            {
            case Opcode::EXTERN_CALL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                int name_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(name_index, constant_pool);

                const Value &name_val = constant_pool[name_index];
                const std::string &func_name = name_val.as_string();

#ifndef DOMINO_VM_UNSAFE
                if (vm_.is_verbose()) {
                    std::cout << "[VMThread] Calling external function: " << func_name << std::endl;
                }
#endif

                Value *arg_ptr = &registers[instr.a];

                auto it = vm_.extern_functions.find(func_name);
                if (it == vm_.extern_functions.end())
                {
                    throw std::runtime_error("External function not found: " + func_name);
                }
                Value result = it->second(arg_ptr);

                registers[0] = result;
                ++ip;
                break;
            }
            case Opcode::NOP:
                ++ip;
                break;

            case Opcode::HALT:
#ifndef DOMINO_VM_UNSAFE
                if (vm_.is_verbose()) {
                    std::cout << "[VMThread] HALT instruction reached at IP " << ip << std::endl;
                }
#endif
                frame.instruction_pointer = ip;
                return;

            case Opcode::MOVE:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                registers[instr.a] = registers[instr.b];
                ++ip;
                break;

            case Opcode::LOADK:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    int const_index = (static_cast<int>(instr.b) << 8) | instr.c;
                    VM_VALIDATE_CONSTANT_INDEX(const_index, constant_pool);
                    registers[instr.a] = constant_pool[const_index];
                }
                ++ip;
                break;

            case Opcode::LOADK_NULL:
                VM_VALIDATE_REGISTER(instr.a);
                registers[instr.a] = Value::make_null();
                ++ip;
                break;

            case Opcode::LOADK_INT16:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    int16_t value = instr.imm16();
                    registers[instr.a] = Value::make_int(value);
                }
                ++ip;
                break;

            case Opcode::LOADK_BOOL:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool value = instr.b != 0;
                    registers[instr.a] = Value::make_bool(value);
                }
                ++ip;
                break;

            case Opcode::LOADK_FLOAT:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    int16_t fixedPoint = instr.imm16();
                    float floatValue = static_cast<float>(fixedPoint) / 256.0f;
                    registers[instr.a] = Value::make_float(floatValue);
                }
                ++ip;
                break;

            case Opcode::LOADK_CHAR:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    char charValue = static_cast<char>(instr.b);
                    registers[instr.a] = Value::make_char(charValue);
                }
                ++ip;
                break;

            case Opcode::ADD_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    registers[instr.a] = Value::make_int(left + right);
                }
                ++ip;
                break;

            case Opcode::SUB_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    registers[instr.a] = Value::make_int(left - right);
                }
                ++ip;
                break;

            case Opcode::MUL_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    registers[instr.a] = Value::make_int(left * right);
                }
                ++ip;
                break;

            case Opcode::DIV_INT:
            {
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                int32_t left = registers[instr.b].as_int();
                int32_t right = registers[instr.c].as_int();
                VM_BOUNDS_CHECK(right != 0, "Division by zero");
                registers[instr.a] = Value::make_int(left / right);
                ++ip;
                break;
            }

            case Opcode::MOD_INT:
            {
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                int32_t left = registers[instr.b].as_int();
                int32_t right = registers[instr.c].as_int();
                VM_BOUNDS_CHECK(right != 0, "Modulo by zero");
                registers[instr.a] = Value::make_int(left % right);
                ++ip;
                break;
            }

            case Opcode::EQ_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    const Value &lv = registers[instr.b];
                    const Value &rv = registers[instr.c];
                    if (lv.type() != ValueType::Int || rv.type() != ValueType::Int) {
                        throw std::runtime_error("EQ_INT used with non-int operands");
                    }
                    registers[instr.a] = Value::make_bool(lv.as_int() == rv.as_int());
                }
                ++ip;
                break;

            case Opcode::LT_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    registers[instr.a] = Value::make_bool(left < right);
                }
                ++ip;
                break;

            case Opcode::NOT_BOOL:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                registers[instr.a] = Value::make_bool(!registers[instr.b].as_bool());
                ++ip;
                break;

            case Opcode::AND_BOOL:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                registers[instr.a] = Value::make_bool(
                    registers[instr.b].as_bool() && registers[instr.c].as_bool());
                ++ip;
                break;

            case Opcode::OR_BOOL:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                registers[instr.a] = Value::make_bool(
                    registers[instr.b].as_bool() || registers[instr.c].as_bool());
                ++ip;
                break;

            case Opcode::JMP:
            {
                int16_t offset = instr.imm16();
                ip += offset;
                break;
            }

            case Opcode::JMP_IF_TRUE:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool condition = registers[instr.a].as_bool();
                    int16_t offset = instr.imm16();
                    if (condition) ip += offset;
                    else ++ip;
                }
                break;

            case Opcode::JMP_IF_FALSE:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool condition = registers[instr.a].as_bool();
                    int16_t offset = instr.imm16();
                    if (!condition) ip += offset;
                    else ++ip;
                }
                break;

            case Opcode::ADD_FLOAT:
            case Opcode::SUB_FLOAT:
            case Opcode::MUL_FLOAT:
            case Opcode::DIV_FLOAT:
            case Opcode::ADD_DOUBLE:
            case Opcode::SUB_DOUBLE:
            case Opcode::MUL_DOUBLE:
            case Opcode::DIV_DOUBLE:
                handle_arithmetic(instr, op);
                ++ip;
                break;

            case Opcode::EQ_FLOAT:
            case Opcode::LT_FLOAT:
            case Opcode::LTE_FLOAT:
            case Opcode::EQ_DOUBLE:
            case Opcode::LT_DOUBLE:
            case Opcode::LTE_DOUBLE:
            case Opcode::EQ_STRING:
            case Opcode::LT_STRING:
            case Opcode::EQ_BOOL:
            case Opcode::LT_BOOL:
            case Opcode::EQ_OBJECT:
            case Opcode::EQ_CHAR:
            case Opcode::LT_CHAR:
                frame.instruction_pointer = ip;
                handle_comparison(instr, op);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::INT_TO_FLOAT:
            case Opcode::INT_TO_DOUBLE:
            case Opcode::FLOAT_TO_INT:
            case Opcode::DOUBLE_TO_INT:
            case Opcode::FLOAT_TO_DOUBLE:
            case Opcode::DOUBLE_TO_FLOAT:
            case Opcode::IS_NULL:
            case Opcode::GET_CLASS_IDX:
            case Opcode::TYPE_OF:
            case Opcode::INT_TO_STRING:
            case Opcode::FLOAT_TO_STRING:
            case Opcode::DOUBLE_TO_STRING:
            case Opcode::BOOL_TO_STRING:
            case Opcode::CHAR_TO_STRING:
            case Opcode::STRING_TO_INT:
            case Opcode::STRING_TO_FLOAT:
            case Opcode::STRING_TO_DOUBLE:
            case Opcode::STRING_TO_BOOL:
            case Opcode::STRING_TO_CHAR:
            case Opcode::INT_TO_BOOL:
            case Opcode::FLOAT_TO_BOOL:
            case Opcode::DOUBLE_TO_BOOL:
            case Opcode::CHAR_TO_INT:
            case Opcode::INT_TO_CHAR:
                handle_type_conversion(instr, op);
                ++ip;
                break;

            case Opcode::ADD_STRING:
            case Opcode::LENGTH_STRING:
                frame.instruction_pointer = ip;
                handle_string_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::NEW_ARRAY:
            case Opcode::GET_ARRAY:
            case Opcode::SET_ARRAY:
            case Opcode::LENGTH_ARRAY:
                frame.instruction_pointer = ip;
                handle_array_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::NEW_OBJECT:
            case Opcode::GET_FIELD:
            case Opcode::SET_FIELD:
                frame.instruction_pointer = ip;
                handle_object_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::NEW_MAP:
            case Opcode::GET_MAP:
            case Opcode::SET_MAP:
            case Opcode::HAS_KEY_MAP:
            case Opcode::DELETE_MAP:
            case Opcode::KEYS_MAP:
            case Opcode::VALUES_MAP:
            case Opcode::SIZE_MAP:
            case Opcode::CLEAR_MAP:
            case Opcode::NEW_MAP_INT:
            case Opcode::GET_MAP_INT:
            case Opcode::SET_MAP_INT:
            case Opcode::HAS_KEY_MAP_INT:
            case Opcode::DELETE_MAP_INT:
                frame.instruction_pointer = ip;
                handle_map_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::NEW_SET:
            case Opcode::ADD_SET:
            case Opcode::HAS_SET:
            case Opcode::DELETE_SET:
            case Opcode::SIZE_SET:
            case Opcode::CLEAR_SET:
            case Opcode::TO_ARRAY_SET:
            case Opcode::NEW_SET_INT:
            case Opcode::ADD_SET_INT:
            case Opcode::HAS_SET_INT:
            case Opcode::DELETE_SET_INT:
                frame.instruction_pointer = ip;
                handle_set_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::CREATE_LAMBDA:
            case Opcode::CAPTURE_VALUE:
                frame.instruction_pointer = ip;
                handle_lambda_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::INVOKE_LAMBDA:
            {
                VM_VALIDATE_REGISTER(instr.b);
                const auto &lambda = frame.registers[instr.b].as_lambda();
                
                frame.instruction_pointer = ip + 1;
                
                push_frame(-1, 256);
                StackFrame &lambda_frame = current_frame();
                lambda_frame.instruction_pointer = lambda->code_index;
                
                StackFrame &calling_frame = call_stack[call_stack.size() - 2];
                
                for (int i = 0; i < lambda->parameter_count && i < 16; ++i) {
                    if ((instr.a + i) < static_cast<int>(calling_frame.registers.size()) && 
                        (i + 1) < static_cast<int>(lambda_frame.registers.size())) {
                        lambda_frame.registers[i + 1] = calling_frame.registers[instr.a + i];
                    }
                }
                
                for (size_t i = 0; i < lambda->captured_values.size(); ++i) {
                    int target_reg = lambda->parameter_count + 1 + static_cast<int>(i);
                    if (target_reg < static_cast<int>(lambda_frame.registers.size())) {
                        lambda_frame.registers[target_reg] = lambda->captured_values[i];
                    }
                }
                
                goto outer_loop_continue;
            }

            case Opcode::CALL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                int function_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(function_index, constant_pool);

#ifndef DOMINO_VM_UNSAFE
                if (vm_.is_verbose()) {
                    std::cout << "[VMThread] Function call to index " << function_index << std::endl;
                }
#endif

                frame.instruction_pointer = ip + 1;

                const Value &func_val = constant_pool[function_index];
                std::shared_ptr<FunctionMetadata> func_obj = std::dynamic_pointer_cast<FunctionMetadata>(func_val.as_object());
#ifndef DOMINO_VM_UNSAFE
                if (!func_obj)
                {
                    throw std::runtime_error("Constant pool entry is not a FunctionMetadata object");
                }
#endif
                int entry_point = func_obj->codeIndex();
                int num_registers = func_obj->registerCount();
                int num_args = func_obj->parameterCount();

                push_frame(function_index, num_registers);
                StackFrame &callee = current_frame();
                callee.instruction_pointer = entry_point;
                callee.function_index = function_index;

                StackFrame &caller = call_stack[call_stack.size() - 2];
                for (int i = 0; i < num_args; ++i)
                {
                    if ((instr.a + i) < static_cast<int>(caller.registers.size()) && (i + 1) < static_cast<int>(callee.registers.size()))
                    {
                        callee.registers[i + 1] = caller.registers[instr.a + i];
                    }
                }

                goto outer_loop_continue;
            }

            case Opcode::RETURN:
            {
                VM_VALIDATE_REGISTER(instr.a);
                Value return_value = frame.registers[instr.a];

#ifndef DOMINO_VM_UNSAFE
                if (vm_.is_verbose()) {
                    std::cout << "[VMThread] Returning from function, call stack depth: " << call_stack.size() << std::endl;
                }
#endif

                pop_frame();

                if (!call_stack.empty())
                {
                    current_frame().registers[0] = return_value;
                }
                else
                {
                    return_value_ = return_value;
                }

                goto outer_loop_continue;
            }

            case Opcode::ITER_INIT:
            case Opcode::ITER_NEXT:
            case Opcode::ITER_VALUE:
            case Opcode::ITER_KEY:
                frame.instruction_pointer = ip;
                handle_iterator_ops(instr, op, constant_pool);
                ip = frame.instruction_pointer + 1;
                break;

            case Opcode::GET_GLOBAL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                uint16_t global_index = instr.uimm16();
                frame.registers[instr.a] = vm_.get_global(global_index);
                ++ip;
                break;
            }

            case Opcode::SET_GLOBAL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                uint16_t global_index = (static_cast<uint16_t>(instr.b) << 8) | instr.c;
                vm_.set_global(global_index, frame.registers[instr.a]);
                ++ip;
                break;
            }

            case Opcode::CLASS_TO_JSON:
            {
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                const Value &source = frame.registers[instr.b];
                std::string json_str = value_to_json(source, constant_pool);
                frame.registers[instr.a] = Value::make_string(json_str);
                ++ip;
                break;
            }

            case Opcode::CLASS_FROM_JSON:
            {
                VM_VALIDATE_REGISTER(instr.a);
                uint16_t class_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(class_index, constant_pool);
                if (frame.registers[instr.a].type() != ValueType::String) {
                    throw std::runtime_error("CLASS_FROM_JSON expects JSON string in source register");
                }
                const std::string &json_input = frame.registers[instr.a].as_string();
                json::JSONParser parser(json_input);
                json::JSONValue root = parser.parse();
                if (!root.is_object()) {
                    throw std::runtime_error("CLASS_FROM_JSON root JSON value must be object");
                }
                const Value &class_val = constant_pool[class_index];
                auto meta = std::dynamic_pointer_cast<ClassMetadata>(class_val.as_object());
                if (!meta) {
                    throw std::runtime_error("CLASS_FROM_JSON constant is not ClassMetadata");
                }
                auto obj = std::make_shared<Object>();
                obj->class_idx = class_index;
                int fieldCount = meta->fieldCount();
                obj->fields.resize(fieldCount);
                std::vector<std::string> field_names;
                if (meta->fields.size() > 3 && meta->fields[3].type() == ValueType::Array) {
                    const auto &arr = meta->fields[3].as_array();
                    field_names.reserve(arr->size());
                    for (const auto &v : *arr) {
                        if (v.type() == ValueType::String) field_names.push_back(v.as_string());
                    }
                }
                const auto &json_obj = root.as_object();
                std::function<Value(const json::JSONValue&)> convert = [&](const json::JSONValue &jv) -> Value {
                    if (jv.is_null()) return Value::make_null();
                    if (jv.is_bool()) return Value::make_bool(jv.as_bool());
                    if (jv.is_number()) {
                        double num = jv.as_number();
                        if (std::floor(num) == num && num >= INT32_MIN && num <= INT32_MAX) {
                            return Value::make_int(static_cast<int32_t>(num));
                        }
                        return Value::make_double(num);
                    }
                    if (jv.is_string()) return Value::make_string(jv.as_string());
                    if (jv.is_array()) {
                        auto arrPtr = std::make_shared<Array>();
                        for (const auto &elem : jv.as_array()) arrPtr->push_back(convert(elem));
                        return Value::make_array(arrPtr);
                    }
                    if (jv.is_object()) {
                        auto mapPtr = std::make_shared<Map>();
                        for (const auto &kv : jv.as_object()) {
                            (*mapPtr)[kv.first] = convert(kv.second);
                        }
                        return Value::make_map(mapPtr);
                    }
                    return Value::make_null();
                };
                for (int i = 0; i < fieldCount; ++i) {
                    Value fieldValue = Value::make_null();
                    if (i < static_cast<int>(field_names.size())) {
                        const std::string &fname = field_names[i];
                        auto it = json_obj.find(fname);
                        if (it != json_obj.end()) {
                            fieldValue = convert(it->second);
                        }
                    }
                    obj->fields[i] = fieldValue;
                }
                frame.registers[instr.a] = Value::make_object(obj);
                ++ip;
                break;
            }

            case Opcode::ASYNC_CALL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                int function_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(function_index, constant_pool);
                
                const Value &func_val = constant_pool[function_index];
                std::shared_ptr<FunctionMetadata> func_obj = std::dynamic_pointer_cast<FunctionMetadata>(func_val.as_object());
#ifndef DOMINO_VM_UNSAFE
                if (!func_obj)
                {
                    throw std::runtime_error("Constant pool entry is not a FunctionMetadata object");
                }
#endif
                int entry_point = func_obj->codeIndex();
                int num_args = func_obj->parameterCount();
                
                std::vector<Value> args;
                args.reserve(num_args);
                for (int i = 0; i < num_args; ++i) {
                    int reg_idx = instr.a + i;
                    if (reg_idx < static_cast<int>(frame.registers.size())) {
                        args.push_back(frame.registers[reg_idx]);
                    } else {
                        args.push_back(Value::make_null());
                    }
                }
                
                auto task = std::make_shared<doof_runtime::Task<Value>>([]() -> Value { return Value::make_null(); });
                task->state = doof_runtime::TaskState::RUNNING;
                
                auto future = std::make_shared<doof_runtime::Future<Value>>(task);
                frame.registers[instr.a] = Value::make_future(future);
                
                std::thread([vm_ref = std::ref(vm_), 
                             code = code, 
                             constants = constant_pool, 
                             entry_point, 
                             args = std::move(args), 
                             task, 
                             function_index]() mutable {
                    try {
                        // Create a new VMThread attached to the shared DoofVM
                        VMThread async_thread(vm_ref.get());
                        async_thread.set_initial_registers(args);
                        
                        // Run the thread
                        async_thread.run(code, constants, entry_point);
                        
                        task->result = async_thread.get_result();
                    } catch (const std::exception& e) {
                        std::cerr << "Async execution failed (func=" << function_index << "): " << e.what() << std::endl;
                        task->result = Value::make_null();
                    } catch (...) {
                        std::cerr << "Async execution failed with unknown error" << std::endl;
                        task->result = Value::make_null();
                    }
                    
                    {
                        std::lock_guard<std::mutex> lock(task->mutex);
                        task->state = doof_runtime::TaskState::COMPLETED;
                    }
                    task->cv.notify_all();
                }).detach();
                
                ++ip;
                break;
            }

            case Opcode::AWAIT:
            {
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                
                const Value &future_val = frame.registers[instr.b];
                if (future_val.type() != ValueType::Future) {
                    frame.registers[instr.a] = future_val;
                } else {
                    auto future = future_val.as_future();
                    try {
                        frame.registers[instr.a] = future->get();
                    } catch (const std::exception &e) {
                        throw std::runtime_error(std::string("Await failed: ") + e.what());
                    }
                }
                ++ip;
                break;
            }

            default:
                frame.instruction_pointer = ip;
                throw std::runtime_error("Unimplemented or unknown opcode: " +
                                         std::to_string(static_cast<int>(instr.opcode)));
            }
        }

    outer_loop_continue:;
    }
}

void VMThread::dump_state(std::ostream &out) const
{
    out << "=== VM THREAD STATE DUMP ===" << std::endl;
    out << " call_stack_size: " << call_stack.size() << std::endl;
    out << " current_instruction: " << currentInstruction_ << std::endl;
    out << " paused: " << (paused_ ? "true" : "false") << std::endl;

    if (call_stack.empty())
    {
        out << " call_stack: <empty>" << std::endl;
        return;
    }

    out << " call_stack:" << std::endl;
    for (size_t depth = call_stack.size(); depth-- > 0;)
    {
        const StackFrame &frame = call_stack[depth];
        out << "  frame[" << depth << "]";
        out << " ip=" << frame.instruction_pointer;
        out << " function_index=" << frame.function_index;
        out << std::endl;

        size_t printed = 0;
        for (size_t reg = 0; reg < frame.registers.size(); ++reg)
        {
            const Value &value = frame.registers[reg];
            if (value.type() == ValueType::Null)
            {
                continue;
            }
            if (printed == 0)
            {
                out << "    registers:" << std::endl;
            }
            if (printed < 64)
            {
                out << "      " << format_register(static_cast<uint8_t>(reg))
                    << " = " << value_debug_string(value) << std::endl;
            }
            ++printed;
        }
    }
}

// DoofVM Implementation

DoofVM::DoofVM()
{
    // Register built-in external functions
        register_extern_function("println", [this](Value *args) -> Value {
            std::ostringstream output;
            
            if (args->type() == ValueType::Object) {
                if (constant_pool_) {
                    output << value_to_json(*args, *constant_pool_);
                } else {
                    output << "[object]";
                }
            } else if (args->type() == ValueType::String) {
                output << args->as_string();
            } else {
                static const std::vector<Value> empty_pool;
                const std::vector<Value>& pool = constant_pool_ ? *constant_pool_ : empty_pool;
                output << value_to_json(*args, pool);
            }
            
            output << "\n";
            
            if (dapHandler_) {
                dapHandler_->sendOutput(output.str(), "stdout");
            } else {
                std::cout << output.str() << std::flush;
            }
            
            return Value::make_null();
        });

        register_extern_function("panic", [this](Value *args) -> Value {
            std::string message;
            if (args->type() == ValueType::String) {
                message = args->as_string();
            }

            const std::string output = message.empty() ? "panic" : "panic: " + message;

            if (dapHandler_) {
                dapHandler_->sendOutput(output + "\n", "stderr");
            } else {
                std::cerr << output << std::endl;
            }

            std::exit(1);
            return Value::make_null();
        });

    register_extern_function("String::substring", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::Int) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        int start = args[1].as_int();
        
        if (start < 0) start = 0;
        if (start >= static_cast<int>(str.length())) return Value::make_string("");
        
        if (args[2].type() == ValueType::Int) {
            int end = args[2].as_int();
            if (end <= start) return Value::make_string("");
            if (end > static_cast<int>(str.length())) end = str.length();
            return Value::make_string(str.substr(start, end - start));
        } else {
            return Value::make_string(str.substr(start));
        }
    });

    register_extern_function("String::indexOf", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::String) {
            return Value::make_int(-1);
        }
        
        const std::string &str = args[0].as_string();
        const std::string &search = args[1].as_string();
        
        size_t pos = str.find(search);
        return Value::make_int(pos == std::string::npos ? -1 : static_cast<int>(pos));
    });

    register_extern_function("String::replace", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String || 
            args[1].type() != ValueType::String || 
            args[2].type() != ValueType::String) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        const std::string &from = args[1].as_string();
        const std::string &to = args[2].as_string();
        
        std::string result = str;
        size_t pos = result.find(from);
        if (pos != std::string::npos) {
            result.replace(pos, from.length(), to);
        }
        return Value::make_string(result);
    });

    register_extern_function("String::toUpperCase", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        std::string result = str;
        std::transform(result.begin(), result.end(), result.begin(), ::toupper);
        return Value::make_string(result);
    });

    register_extern_function("String::toLowerCase", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        std::string result = str;
        std::transform(result.begin(), result.end(), result.begin(), ::tolower);
        return Value::make_string(result);
    });

    register_extern_function("String::split", [](Value *args) -> Value {
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::String) {
            auto empty_array = std::make_shared<Array>();
            return Value::make_array(empty_array);
        }
        
        const std::string &str = args[0].as_string();
        const std::string &separator = args[1].as_string();
        
        auto result_array = std::make_shared<Array>();
        
        if (separator.empty()) {
            for (char c : str) {
                result_array->push_back(Value::make_string(std::string(1, c)));
            }
        } else {
            size_t start = 0;
            size_t pos = str.find(separator);
            
            while (pos != std::string::npos) {
                result_array->push_back(Value::make_string(str.substr(start, pos - start)));
                start = pos + separator.length();
                pos = str.find(separator, start);
            }
            
            result_array->push_back(Value::make_string(str.substr(start)));
        }
        
        return Value::make_array(result_array);
    });

    register_extern_function("Array::push", [](Value *args) -> Value {
        if (args[0].type() != ValueType::Array) {
            return Value::make_null();
        }
        
        auto arr = args[0].as_array();
        arr->push_back(args[1]);
        return Value::make_null();
    });

    register_extern_function("Array::length", [](Value *args) -> Value {
        if (args[0].type() != ValueType::Array) {
            return Value::make_int(0);
        }
        
        auto arr = args[0].as_array();
        return Value::make_int(static_cast<int32_t>(arr->size()));
    });

    register_extern_function("Array::pop", [](Value *args) -> Value {
        if (args[0].type() != ValueType::Array) {
            return Value::make_null();
        }
        
        auto arr = args[0].as_array();
        if (arr->empty()) {
            return Value::make_null();
        }
        
        Value popped = arr->back();
        arr->pop_back();
        return popped;
    });

    auto stringBuilderClass = ensure_extern_class("StringBuilder");

    register_extern_function("StringBuilder::create", [stringBuilderClass](Value *args) -> Value {
        (void)args;
        auto sb = std::make_shared<StringBuilderObject>();
        sb->class_idx = stringBuilderClass->class_idx;
        return Value::make_object(sb);
    });

    register_extern_function("StringBuilder::createWithCapacity", [stringBuilderClass](Value *args) -> Value {
        int capacity = 0;
        if (args && args[0].type() == ValueType::Int)
        {
            capacity = args[0].as_int();
        }

        auto sb = std::make_shared<StringBuilderObject>();
        if (capacity > 0)
        {
            sb->reserve_capacity(capacity);
        }
        sb->class_idx = stringBuilderClass->class_idx;
        return Value::make_object(sb);
    });

    register_extern_function("StringBuilder::append", [stringBuilderClass](Value *args) -> Value {
        if (!args)
        {
            throw std::runtime_error("StringBuilder::append missing arguments");
        }

        auto sb = DoofVM::as_instance<StringBuilderObject>(args[0], *stringBuilderClass);
        sb->append_value(args[1]);
        return args[0];
    });

    register_extern_function("StringBuilder::toString", [stringBuilderClass](Value *args) -> Value {
        if (!args)
        {
            throw std::runtime_error("StringBuilder::toString missing arguments");
        }

        auto sb = DoofVM::as_instance<StringBuilderObject>(args[0], *stringBuilderClass);
        return Value::make_string(sb->buffer);
    });

    register_extern_function("StringBuilder::clear", [stringBuilderClass](Value *args) -> Value {
        if (!args)
        {
            throw std::runtime_error("StringBuilder::clear missing arguments");
        }

        auto sb = DoofVM::as_instance<StringBuilderObject>(args[0], *stringBuilderClass);
        sb->clear_buffer();
        return Value::make_null();
    });

    register_extern_function("StringBuilder::reserve", [stringBuilderClass](Value *args) -> Value {
        if (!args)
        {
            throw std::runtime_error("StringBuilder::reserve missing arguments");
        }

        auto sb = DoofVM::as_instance<StringBuilderObject>(args[0], *stringBuilderClass);
        if (args[1].type() == ValueType::Int)
        {
            sb->reserve_capacity(args[1].as_int());
        }
        return Value::make_null();
    });
}

void DoofVM::run_with_debug(const std::vector<Instruction> &code,
                              const std::vector<Value> &constant_pool,
                              const DebugInfo& debug_info,
                              int entry_point,
                              int global_count)
{
    // Note: Debug info is now attached to the thread, but we can set it on the main thread
    // when it's created in run().
    // For now, we just call run() and let it handle it.
    // To support debug info properly, we might need to pass it to run() or store it in DoofVM.
    // But DoofVM doesn't have debugState anymore.
    // We'll assume run() creates the thread and we can configure it there if we change the API.
    // For now, just call run.
    run(code, constant_pool, entry_point, global_count);
    
    if (main_thread_) {
        main_thread_->getDebugState().setDebugInfo(debug_info);
        main_thread_->setDebugMode(true);
    }
}

void DoofVM::run(const std::vector<Instruction> &code,
                   const std::vector<Value> &constant_pool,
                   int entry_point,
                   int global_count)
{
    constant_pool_ = &constant_pool;
    refresh_extern_class_indices();
    
    if (global_count > 0) {
        std::lock_guard<std::mutex> lock(globals_mutex_);
        globals_.resize(global_count);
        for (int i = 0; i < global_count; i++) {
            globals_[i] = Value::make_null();
        }
    }
    
    main_thread_ = std::make_shared<VMThread>(*this);
    
#ifndef DOMINO_VM_UNSAFE
    if (verbose_) {
        std::cout << "[VM] Starting main thread" << std::endl;
    }
#endif

    main_thread_->run(code, constant_pool, entry_point);
    main_return_value_ = main_thread_->get_result();
}

void DoofVM::register_extern_function(const std::string &name,
                                        std::function<Value(Value*)> func)
{
    extern_functions[name] = func;
}

DoofVM::ExternClassHandle DoofVM::ensure_extern_class(const std::string &class_name)
{
    auto existing = extern_classes_.find(class_name);
    if (existing != extern_classes_.end())
    {
        return existing->second;
    }
    return register_extern_class(class_name);
}

DoofVM::ExternClassHandle DoofVM::register_extern_class(const std::string &class_name)
{
    auto existing = extern_classes_.find(class_name);
    if (existing != extern_classes_.end())
    {
        return existing->second;
    }

    int idx = find_constant_pool_class_idx(class_name);
    if (idx < 0)
    {
        idx = next_negative_class_idx_--;
    }

    auto handle = std::make_shared<ExternClassInfo>(ExternClassInfo{class_name, idx});
    extern_classes_.emplace(class_name, handle);
    return handle;
}

int DoofVM::find_constant_pool_class_idx(const std::string &class_name) const
{
    if (!constant_pool_)
    {
        return -1;
    }

    for (size_t i = 0; i < constant_pool_->size(); ++i)
    {
        const Value &candidate = (*constant_pool_)[i];
        if (candidate.type() != ValueType::Object)
        {
            continue;
        }
        auto metadata = std::dynamic_pointer_cast<ClassMetadata>(candidate.as_object());
        if (metadata && metadata->name() == class_name)
        {
            return static_cast<int>(i);
        }
    }
    return -1;
}

void DoofVM::refresh_extern_class_indices()
{
    if (!constant_pool_)
    {
        return;
    }

    for (auto &entry : extern_classes_)
    {
        auto &handle = entry.second;
        if (!handle)
        {
            continue;
        }

        int idx = find_constant_pool_class_idx(handle->name);
        if (idx >= 0)
        {
            handle->class_idx = idx;
        }
    }
}

void DoofVM::set_global(size_t index, const Value& value) {
    std::lock_guard<std::mutex> lock(globals_mutex_);
#ifndef DOMINO_VM_UNSAFE
    if (index >= globals_.size()) {
        throw std::runtime_error("Global variable index out of bounds: " + std::to_string(index));
    }
#endif
    globals_[index] = value;
}

Value DoofVM::get_global(size_t index) const {
    std::lock_guard<std::mutex> lock(globals_mutex_);
#ifndef DOMINO_VM_UNSAFE
    if (index >= globals_.size()) {
        throw std::runtime_error("Global variable index out of bounds: " + std::to_string(index));
    }
#endif
    return globals_[index];
}

void DoofVM::dump_state(std::ostream &out) const
{
    out << "=== VM STATE DUMP ===" << std::endl;
    
    if (main_thread_) {
        main_thread_->dump_state(out);
    } else {
        out << "No main thread active." << std::endl;
    }

    std::lock_guard<std::mutex> lock(globals_mutex_);
    if (!globals_.empty())
    {
        size_t printed = 0;
        for (size_t i = 0; i < globals_.size(); ++i)
        {
            const auto &value = globals_[i];
            if (value.type() == ValueType::Null)
            {
                continue;
            }
            if (printed == 0)
            {
                out << " globals:" << std::endl;
            }
            if (printed < 64)
            {
                out << "  global[" << i << "] = " << value_debug_string(value) << std::endl;
            }
            ++printed;
        }
    }
}

void DoofVM::set_initial_registers(const std::vector<Value>& args) {
    if (main_thread_) {
        main_thread_->set_initial_registers(args);
    }
}

Value DoofVM::get_result() const {
    return main_return_value_;
}

void DoofVM::clear_call_stack()
{
    // No-op or clear main thread stack?
    // This was used for async task init in old code.
    // Now async tasks create new threads.
}

// Debug support delegation
DebugState& DoofVM::getDebugState() { 
    if (main_thread_) return main_thread_->getDebugState();
    static DebugState empty; return empty; 
}
const DebugState& DoofVM::getDebugState() const { 
    if (main_thread_) return main_thread_->getDebugState();
    static DebugState empty; return empty; 
}
bool DoofVM::isDebugMode() const { 
    return main_thread_ ? main_thread_->isDebugMode() : false; 
}
void DoofVM::setDebugMode(bool enabled) { 
    if (main_thread_) main_thread_->setDebugMode(enabled); 
}
void DoofVM::pause() { 
    if (main_thread_) main_thread_->pause(); 
}
void DoofVM::resume() { 
    if (main_thread_) main_thread_->resume(); 
}
bool DoofVM::isPaused() const { 
    return main_thread_ ? main_thread_->isPaused() : false; 
}
int DoofVM::getCurrentInstruction() const { 
    return main_thread_ ? main_thread_->getCurrentInstruction() : 0; 
}
int DoofVM::getCallDepth() const { 
    return main_thread_ ? main_thread_->getCallDepth() : 0; 
}
const StackFrame& DoofVM::getCurrentFrame() const { 
    if (main_thread_) return main_thread_->getCurrentFrame();
    throw std::runtime_error("No active frame");
}
const std::vector<StackFrame>& DoofVM::getCallStack() const { 
    if (main_thread_) return main_thread_->getCallStack();
    static std::vector<StackFrame> empty; return empty;
}

// Helper method implementations for VMThread
void VMThread::handle_arithmetic(const Instruction &instr, Opcode op)
{
    VM_VALIDATE_REGISTER(instr.a);
    VM_VALIDATE_REGISTER(instr.b);
    VM_VALIDATE_REGISTER(instr.c);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::ADD_FLOAT:
        frame.registers[instr.a] = Value::make_float(
            frame.registers[instr.b].as_float() + frame.registers[instr.c].as_float());
        break;
    case Opcode::SUB_FLOAT:
        frame.registers[instr.a] = Value::make_float(
            frame.registers[instr.b].as_float() - frame.registers[instr.c].as_float());
        break;
    case Opcode::MUL_FLOAT:
        frame.registers[instr.a] = Value::make_float(
            frame.registers[instr.b].as_float() * frame.registers[instr.c].as_float());
        break;
    case Opcode::DIV_FLOAT:
    {
        float divisor = frame.registers[instr.c].as_float();
        VM_BOUNDS_CHECK(std::abs(divisor) >= 1e-6f, "Division by zero (float)");
        frame.registers[instr.a] = Value::make_float(
            frame.registers[instr.b].as_float() / divisor);
        break;
    }
    case Opcode::ADD_DOUBLE:
        frame.registers[instr.a] = Value::make_double(
            frame.registers[instr.b].as_double() + frame.registers[instr.c].as_double());
        break;
    case Opcode::SUB_DOUBLE:
        frame.registers[instr.a] = Value::make_double(
            frame.registers[instr.b].as_double() - frame.registers[instr.c].as_double());
        break;
    case Opcode::MUL_DOUBLE:
        frame.registers[instr.a] = Value::make_double(
            frame.registers[instr.b].as_double() * frame.registers[instr.c].as_double());
        break;
    case Opcode::DIV_DOUBLE:
    {
        double divisor = frame.registers[instr.c].as_double();
        VM_BOUNDS_CHECK(std::abs(divisor) >= 1e-12, "Division by zero (double)");
        frame.registers[instr.a] = Value::make_double(
            frame.registers[instr.b].as_double() / divisor);
        break;
    }
    default:
        throw std::runtime_error("Invalid arithmetic opcode");
    }
}

void VMThread::handle_comparison(const Instruction &instr, Opcode op)
{
    VM_VALIDATE_REGISTER(instr.a);
    VM_VALIDATE_REGISTER(instr.b);
    VM_VALIDATE_REGISTER(instr.c);

    StackFrame &frame = current_frame();

       switch (op)
    {
    case Opcode::EQ_INT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_int() == frame.registers[instr.c].as_int());
        break;
    case Opcode::LT_INT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_int() < frame.registers[instr.c].as_int());
        break;
    case Opcode::EQ_FLOAT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() == frame.registers[instr.c].as_float());
        break;
    case Opcode::LT_FLOAT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() < frame.registers[instr.c].as_float());
        break;
    case Opcode::LTE_FLOAT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() <= frame.registers[instr.c].as_float());
        break;
    case Opcode::EQ_DOUBLE:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() == frame.registers[instr.c].as_double());
        break;
    case Opcode::LT_DOUBLE:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() < frame.registers[instr.c].as_double());
        break;
    case Opcode::LTE_DOUBLE:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() <= frame.registers[instr.c].as_double());
        break;
    case Opcode::EQ_STRING:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_string() == frame.registers[instr.c].as_string());
        break;
    case Opcode::LT_STRING:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_string() < frame.registers[instr.c].as_string());
        break;
    case Opcode::EQ_BOOL:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_bool() == frame.registers[instr.c].as_bool());
        break;
    case Opcode::LT_BOOL:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_bool() < frame.registers[instr.c].as_bool());
        break;
    case Opcode::EQ_OBJECT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_object() == frame.registers[instr.c].as_object());
        break;
    case Opcode::EQ_CHAR:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_char() == frame.registers[instr.c].as_char());
        break;
    case Opcode::LT_CHAR:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_char() < frame.registers[instr.c].as_char());
        break;
    default:
        throw std::runtime_error("Invalid comparison opcode");
    }
}

void VMThread::handle_type_conversion(const Instruction &instr, Opcode op)
{
    VM_VALIDATE_REGISTER(instr.a);
    VM_VALIDATE_REGISTER(instr.b);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::INT_TO_FLOAT:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        float float_val = static_cast<float>(int_val);
        frame.registers[instr.a] = Value::make_float(float_val);
        break;
    }
    case Opcode::INT_TO_DOUBLE:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        double double_val = static_cast<double>(int_val);
        frame.registers[instr.a] = Value::make_double(double_val);
        break;
    }
    case Opcode::FLOAT_TO_INT:
    {
        float float_val = frame.registers[instr.b].as_float();
        int32_t int_val = static_cast<int32_t>(float_val);
        frame.registers[instr.a] = Value::make_int(int_val);
        break;
    }
    case Opcode::DOUBLE_TO_INT:
    {
        double double_val = frame.registers[instr.b].as_double();
        int32_t int_val = static_cast<int32_t>(double_val);
        frame.registers[instr.a] = Value::make_int(int_val);
        break;
    }
    case Opcode::FLOAT_TO_DOUBLE:
    {
        float float_val = frame.registers[instr.b].as_float();
        double double_val = static_cast<double>(float_val);
        frame.registers[instr.a] = Value::make_double(double_val);
        break;
    }
    case Opcode::DOUBLE_TO_FLOAT:
    {
        double double_val = frame.registers[instr.b].as_double();
        float float_val = static_cast<float>(double_val);
        frame.registers[instr.a] = Value::make_float(float_val);
        break;
    }
    case Opcode::IS_NULL:
    {
        bool is_null = frame.registers[instr.b].is_null();
        frame.registers[instr.a] = Value::make_bool(is_null);
        break;
    }
    case Opcode::GET_CLASS_IDX:
    {
        const Value& obj = frame.registers[instr.b];
        int32_t class_idx = -1;
        if (!obj.is_null() && obj.type() == ValueType::Object) {
            const ObjectPtr obj_ptr = obj.as_object();
            class_idx = obj_ptr->class_idx;
        }
        frame.registers[instr.a] = Value::make_int(class_idx);
        break;
    }
    case Opcode::TYPE_OF:
    {
        const Value& val = frame.registers[instr.b];
        int32_t type_idx = static_cast<int32_t>(val.type());
        frame.registers[instr.a] = Value::make_int(type_idx);
        break;
    }
    case Opcode::INT_TO_STRING:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        std::string str_val = std::to_string(int_val);
        frame.registers[instr.a] = Value::make_string(str_val);
        break;
    }
    case Opcode::FLOAT_TO_STRING:
    {
        float float_val = frame.registers[instr.b].as_float();
        std::string str_val = std::to_string(float_val);
        frame.registers[instr.a] = Value::make_string(str_val);
        break;
    }
    case Opcode::DOUBLE_TO_STRING:
    {
        double double_val = frame.registers[instr.b].as_double();
        std::string str_val = std::to_string(double_val);
        frame.registers[instr.a] = Value::make_string(str_val);
        break;
    }
    case Opcode::BOOL_TO_STRING:
    {
        bool bool_val = frame.registers[instr.b].as_bool();
        std::string str_val = bool_val ? "true" : "false";
        frame.registers[instr.a] = Value::make_string(str_val);
        break;
    }
    case Opcode::CHAR_TO_STRING:
    {
        char char_val = frame.registers[instr.b].as_char();
        std::string str_val(1, char_val);
        frame.registers[instr.a] = Value::make_string(str_val);
        break;
    }
    case Opcode::STRING_TO_INT:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        try {
            int32_t int_val = std::stoi(str_val);
            frame.registers[instr.a] = Value::make_int(int_val);
        } catch (const std::exception &) {
            throw std::runtime_error("Invalid string format for int conversion: \"" + str_val + "\"");
        }
        break;
    }
    case Opcode::STRING_TO_FLOAT:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        try {
            float float_val = std::stof(str_val);
            frame.registers[instr.a] = Value::make_float(float_val);
        } catch (const std::exception &) {
            throw std::runtime_error("Invalid string format for float conversion: \"" + str_val + "\"");
        }
        break;
    }
    case Opcode::STRING_TO_DOUBLE:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        try {
            double double_val = std::stod(str_val);
            frame.registers[instr.a] = Value::make_double(double_val);
        } catch (const std::exception &) {
            throw std::runtime_error("Invalid string format for double conversion: \"" + str_val + "\"");
        }
        break;
    }
    case Opcode::STRING_TO_BOOL:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        bool bool_val = (str_val == "true");
        if (str_val != "true" && str_val != "false") {
            throw std::runtime_error("Invalid string format for bool conversion: \"" + str_val + "\" (must be \"true\" or \"false\")");
        }
        frame.registers[instr.a] = Value::make_bool(bool_val);
        break;
    }
    case Opcode::STRING_TO_CHAR:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        if (str_val.empty()) {
            throw std::runtime_error("Cannot convert empty string to char");
        }
        char char_val = str_val[0];
        frame.registers[instr.a] = Value::make_char(char_val);
        break;
    }
    case Opcode::INT_TO_BOOL:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        bool bool_val = (int_val != 0);
        frame.registers[instr.a] = Value::make_bool(bool_val);
        break;
    }
    case Opcode::FLOAT_TO_BOOL:
    {
        float float_val = frame.registers[instr.b].as_float();
        bool bool_val = (float_val != 0.0f);
        frame.registers[instr.a] = Value::make_bool(bool_val);
        break;
    }
    case Opcode::DOUBLE_TO_BOOL:
    {
        double double_val = frame.registers[instr.b].as_double();
        bool bool_val = (double_val != 0.0);
        frame.registers[instr.a] = Value::make_bool(bool_val);
        break;
    }
    case Opcode::CHAR_TO_INT:
    {
        char char_val = frame.registers[instr.b].as_char();
        int32_t int_val = static_cast<int32_t>(char_val);
        frame.registers[instr.a] = Value::make_int(int_val);
        break;
    }
    case Opcode::INT_TO_CHAR:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        if (int_val < 0 || int_val > 255) {
            throw std::runtime_error("Integer value " + std::to_string(int_val) + " is out of range for char conversion (0-255)");
        }
        char char_val = static_cast<char>(int_val);
        frame.registers[instr.a] = Value::make_char(char_val);
        break;
    }
    default:
        throw std::runtime_error("Invalid type conversion opcode");
    }
}

void VMThread::handle_string_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    VM_VALIDATE_REGISTER(instr.a);
    VM_VALIDATE_REGISTER(instr.b);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::ADD_STRING:
    {
        VM_VALIDATE_REGISTER(instr.c);
        std::string str1;
        std::string str2;
        
        const Value &val1 = frame.registers[instr.b];
        if (val1.type() == ValueType::Object) {
            str1 = value_to_json(val1, constant_pool);
        } else {
            switch (val1.type()) {
                case ValueType::String: str1 = val1.as_string(); break;
                case ValueType::Int: str1 = std::to_string(val1.as_int()); break;
                case ValueType::Float: str1 = std::to_string(val1.as_float()); break;
                case ValueType::Double: str1 = std::to_string(val1.as_double()); break;
                case ValueType::Bool: str1 = val1.as_bool() ? "true" : "false"; break;
                case ValueType::Null: str1 = "null"; break;
                default: str1 = "[object]"; break;
            }
        }
        
        const Value &val2 = frame.registers[instr.c];
        if (val2.type() == ValueType::Object) {
            str2 = value_to_json(val2, constant_pool);
        } else {
            switch (val2.type()) {
                case ValueType::String: str2 = val2.as_string(); break;
                case ValueType::Int: str2 = std::to_string(val2.as_int()); break;
                case ValueType::Float: str2 = std::to_string(val2.as_float()); break;
                case ValueType::Double: str2 = std::to_string(val2.as_double()); break;
                case ValueType::Bool: str2 = val2.as_bool() ? "true" : "false"; break;
                case ValueType::Null: str2 = "null"; break;
                default: str2 = "[object]"; break;
            }
        }
        
        std::string result = str1 + str2;
        frame.registers[instr.a] = Value::make_string(result);
        break;
    }
    case Opcode::LENGTH_STRING:
    {
        const std::string &str = frame.registers[instr.b].as_string();
        int32_t length = static_cast<int32_t>(str.length());
        frame.registers[instr.a] = Value::make_int(length);
        break;
    }
    default:
        throw std::runtime_error("Invalid string operation opcode");
    }
}

void VMThread::handle_array_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    VM_VALIDATE_REGISTER(instr.a);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::NEW_ARRAY:
    {
        int32_t size = instr.imm16();
        VM_BOUNDS_CHECK(size >= 0, "Array size cannot be negative");
        auto array = std::make_shared<Array>(size, Value::make_null());
        frame.registers[instr.a] = Value::make_array(array);
        break;
    }
    case Opcode::GET_ARRAY:
    {
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);
        int32_t index = frame.registers[instr.c].as_int();
        Value result;
        
        if (frame.registers[instr.b].type() == ValueType::String) {
            const auto &str = frame.registers[instr.b].as_string();
            VM_BOUNDS_CHECK(index >= 0 && index < static_cast<int32_t>(str.size()),
                            "String index out of bounds");
            result = Value::make_char(str[index]);
        } else {
            const auto &array = frame.registers[instr.b].as_array();
            VM_BOUNDS_CHECK(index >= 0 && index < static_cast<int32_t>(array->size()),
                            "Array index out of bounds");
            result = (*array)[index];
        }
        frame.registers[instr.a] = result;
        break;
    }
    case Opcode::SET_ARRAY:
    {
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);
        const auto &array = frame.registers[instr.a].as_array();
        int32_t index = frame.registers[instr.b].as_int();
        Value value = frame.registers[instr.c];
        VM_BOUNDS_CHECK(index >= 0 && index < static_cast<int32_t>(array->size()),
                        "Array index out of bounds");
        (*array)[index] = value;
        break;
    }
    case Opcode::LENGTH_ARRAY:
    {
        VM_VALIDATE_REGISTER(instr.b);
        const auto &array = frame.registers[instr.b].as_array();
        int32_t length = static_cast<int32_t>(array->size());
        frame.registers[instr.a] = Value::make_int(length);
        break;
    }
    default:
        throw std::runtime_error("Invalid array operation opcode");
    }
}

void VMThread::handle_object_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    VM_VALIDATE_REGISTER(instr.a);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::NEW_OBJECT:
    {
        int class_index = instr.uimm16();
        VM_VALIDATE_CONSTANT_INDEX(class_index, constant_pool);
        const Value &class_val = constant_pool[class_index];
        auto class_meta = std::dynamic_pointer_cast<ClassMetadata>(class_val.as_object());
#ifndef DOMINO_VM_UNSAFE
        if (!class_meta)
        {
            throw std::runtime_error("Constant pool entry is not a ClassMetadata object");
        }
#endif
        auto object = std::make_shared<Object>();
        object->class_idx = class_index;
        int num_fields = class_meta->fieldCount();
        object->fields.resize(num_fields, Value::make_null());
        frame.registers[instr.a] = Value::make_object(object);
        break;
    }
    case Opcode::GET_FIELD:
    {
        VM_VALIDATE_REGISTER(instr.b);
        const ObjectPtr &object = frame.registers[instr.b].as_object();
        int field_index = instr.c;
        VM_BOUNDS_CHECK(field_index >= 0 && field_index < static_cast<int>(object->fields.size()),
                        "Field index out of bounds");
        Value result = object->fields[field_index];
        frame.registers[instr.a] = result;
        break;
    }
    case Opcode::SET_FIELD:
    {
        VM_VALIDATE_REGISTER(instr.c);
        const auto &object = frame.registers[instr.a].as_object();
        int field_index = instr.b;
        Value value = frame.registers[instr.c];
        VM_BOUNDS_CHECK(field_index >= 0 && field_index < static_cast<int>(object->fields.size()),
                        "Field index out of bounds");
        object->fields[field_index] = value;
        break;
    }
    default:
        throw std::runtime_error("Invalid object operation opcode");
    }
}

void VMThread::handle_map_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    auto &frame = current_frame();

    switch (op)
    {
    case Opcode::NEW_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        frame.registers[instr.a] = Value::make_map(std::make_shared<Map>());
        break;
    }
    case Opcode::GET_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &map = frame.registers[instr.b].as_map();
        const auto &key = frame.registers[instr.c].as_string();

        auto it = map->find(key);
        frame.registers[instr.a] = (it != map->end()) ? it->second : Value::make_null();
        break;
    }
    case Opcode::SET_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &map = frame.registers[instr.a].as_map();
        const auto &key = frame.registers[instr.b].as_string();
        const auto &value = frame.registers[instr.c];

        (*map)[key] = value;
        break;
    }
    case Opcode::HAS_KEY_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &map = frame.registers[instr.b].as_map();
        const auto &key = frame.registers[instr.c].as_string();

        frame.registers[instr.a] = Value::make_bool(map->find(key) != map->end());
        break;
    }
    case Opcode::DELETE_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &map = frame.registers[instr.b].as_map();
        const auto &key = frame.registers[instr.c].as_string();

        auto erased = map->erase(key);
        frame.registers[instr.a] = Value::make_bool(erased > 0);
        break;
    }
    case Opcode::KEYS_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto &map = frame.registers[instr.b].as_map();
        auto keys_array = std::make_shared<Array>();

        for (const auto &[key, value] : *map)
        {
            keys_array->push_back(Value::make_string(key));
        }

        frame.registers[instr.a] = Value::make_array(keys_array);
        break;
    }
    case Opcode::VALUES_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto &map = frame.registers[instr.b].as_map();
        auto values_array = std::make_shared<Array>();

        for (const auto &[key, value] : *map)
        {
            values_array->push_back(value);
        }

        frame.registers[instr.a] = Value::make_array(values_array);
        break;
    }
    case Opcode::SIZE_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto &map = frame.registers[instr.b].as_map();
        frame.registers[instr.a] = Value::make_int(static_cast<int32_t>(map->size()));
        break;
    }
    case Opcode::CLEAR_MAP:
    {
        VM_VALIDATE_REGISTER(instr.a);

        auto &map = frame.registers[instr.a].as_map();
        map->clear();
        break;
    }
    case Opcode::NEW_MAP_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        frame.registers[instr.a] = Value::make_int_map(std::make_shared<IntMap>());
        break;
    }
    case Opcode::GET_MAP_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &map = frame.registers[instr.b].as_int_map();
        const auto key = frame.registers[instr.c].as_int();

        auto it = map->find(key);
        frame.registers[instr.a] = (it != map->end()) ? it->second : Value::make_null();
        break;
    }
    case Opcode::SET_MAP_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &map = frame.registers[instr.a].as_int_map();
        const auto key = frame.registers[instr.b].as_int();
        const auto &value = frame.registers[instr.c];

        (*map)[key] = value;
        break;
    }
    case Opcode::HAS_KEY_MAP_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &map = frame.registers[instr.b].as_int_map();
        const auto key = frame.registers[instr.c].as_int();

        frame.registers[instr.a] = Value::make_bool(map->find(key) != map->end());
        break;
    }
    case Opcode::DELETE_MAP_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &map = frame.registers[instr.b].as_int_map();
        const auto key = frame.registers[instr.c].as_int();

        auto erased = map->erase(key);
        frame.registers[instr.a] = Value::make_bool(erased > 0);
        break;
    }
    default:
        throw std::runtime_error("Invalid map operation opcode");
    }
}

void VMThread::handle_set_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    auto &frame = current_frame();

    switch (op)
    {
    case Opcode::NEW_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        frame.registers[instr.a] = Value::make_set(std::make_shared<Set>());
        break;
    }
    case Opcode::ADD_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &set = frame.registers[instr.b].as_set();
        const auto &value = frame.registers[instr.c];

        auto [iter, inserted] = set->insert(value);
        frame.registers[instr.a] = Value::make_bool(inserted);
        break;
    }
    case Opcode::HAS_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &set = frame.registers[instr.b].as_set();
        const auto &value = frame.registers[instr.c];

        frame.registers[instr.a] = Value::make_bool(set->find(value) != set->end());
        break;
    }
    case Opcode::DELETE_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &set = frame.registers[instr.b].as_set();
        const auto &value = frame.registers[instr.c];

        auto erased = set->erase(value);
        frame.registers[instr.a] = Value::make_bool(erased > 0);
        break;
    }
    case Opcode::SIZE_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto &value = frame.registers[instr.b];
        if (value.type() == ValueType::Set) {
            const auto &set = value.as_set();
            frame.registers[instr.a] = Value::make_int(static_cast<int32_t>(set->size()));
        } else if (value.type() == ValueType::IntSet) {
            const auto &int_set = value.as_int_set();
            frame.registers[instr.a] = Value::make_int(static_cast<int32_t>(int_set->size()));
        } else {
            throw std::runtime_error("SIZE_SET called on non-set value");
        }
        break;
    }
    case Opcode::CLEAR_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);

        auto &value = frame.registers[instr.a];
        if (value.type() == ValueType::Set) {
            auto &set = value.as_set();
            set->clear();
        } else if (value.type() == ValueType::IntSet) {
            auto &int_set = value.as_int_set();
            int_set->clear();
        } else {
            throw std::runtime_error("CLEAR_SET called on non-set value");
        }
        break;
    }
    case Opcode::TO_ARRAY_SET:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto &set = frame.registers[instr.b].as_set();
        auto array = std::make_shared<Array>();

        for (const auto &value : *set)
        {
            array->push_back(value);
        }

        frame.registers[instr.a] = Value::make_array(array);
        break;
    }
    case Opcode::NEW_SET_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        frame.registers[instr.a] = Value::make_int_set(std::make_shared<IntSet>());
        break;
    }
    case Opcode::ADD_SET_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &set = frame.registers[instr.b].as_int_set();
        const auto value = frame.registers[instr.c].as_int();

        auto [iter, inserted] = set->insert(value);
        frame.registers[instr.a] = Value::make_bool(inserted);
        break;
    }
    case Opcode::HAS_SET_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        const auto &set = frame.registers[instr.b].as_int_set();
        const auto value = frame.registers[instr.c].as_int();

        frame.registers[instr.a] = Value::make_bool(set->find(value) != set->end());
        break;
    }
    case Opcode::DELETE_SET_INT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);

        auto &set = frame.registers[instr.b].as_int_set();
        const auto value = frame.registers[instr.c].as_int();

        auto erased = set->erase(value);
        frame.registers[instr.a] = Value::make_bool(erased > 0);
        break;
    }
    default:
        throw std::runtime_error("Invalid set operation opcode");
    }
}

void VMThread::handle_lambda_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    VM_VALIDATE_REGISTER(instr.a);
    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::CREATE_LAMBDA:
    {
        int metadata_index = instr.uimm16();
        if (metadata_index >= static_cast<int>(constant_pool.size())) {
            throw std::runtime_error("Invalid function metadata index: " + std::to_string(metadata_index));
        }
        
        const Value &metadata_value = constant_pool[metadata_index];
        if (metadata_value.type() != ValueType::Object) {
            throw std::runtime_error("Expected function metadata object in constant pool");
        }
        
        auto metadata = std::dynamic_pointer_cast<FunctionMetadata>(metadata_value.as_object());
        if (!metadata) {
            throw std::runtime_error("Invalid function metadata object");
        }
        
        auto lambda = std::make_shared<Lambda>(metadata->codeIndex(), metadata->parameterCount());
        frame.registers[instr.a] = Value::make_lambda(lambda);
        break;
    }
    case Opcode::CAPTURE_VALUE:
    {
        VM_VALIDATE_REGISTER(instr.b);
        auto &lambda = frame.registers[instr.a].as_lambda();
        lambda->captured_values.push_back(frame.registers[instr.b]);
        break;
    }
    default:
        throw std::runtime_error("Invalid lambda operation opcode");
    }
}

void VMThread::handle_iterator_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::ITER_INIT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const Value &collection = frame.registers[instr.b];
        
        std::shared_ptr<Iterator> iterator;
        
        switch (collection.type()) {
            case ValueType::Array: {
                const auto& array = collection.as_array();
                iterator = std::make_shared<Iterator>(std::make_unique<ArrayIterator>(array));
                break;
            }
            case ValueType::Set: {
                const auto& set = collection.as_set();
                iterator = std::make_shared<Iterator>(std::make_unique<SetIterator>(set));
                break;
            }
            case ValueType::Map: {
                const auto& map = collection.as_map();
                iterator = std::make_shared<Iterator>(std::make_unique<MapIterator>(map));
                break;
            }
            case ValueType::IntSet: {
                const auto& int_set = collection.as_int_set();
                iterator = std::make_shared<Iterator>(std::make_unique<IntSetIterator>(int_set));
                break;
            }
            case ValueType::IntMap: {
                const auto& int_map = collection.as_int_map();
                iterator = std::make_shared<Iterator>(std::make_unique<IntMapIterator>(int_map));
                break;
            }
            default:
                throw std::runtime_error("ITER_INIT: unsupported collection type for iteration");
        }
        
        frame.registers[instr.a] = Value::make_iterator(iterator);
        break;
    }
    case Opcode::ITER_NEXT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto& iterator = frame.registers[instr.b].as_iterator();
        bool has_next = iterator->has_next();
        
        frame.registers[instr.a] = Value::make_bool(has_next);
        break;
    }
    case Opcode::ITER_VALUE:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto& iterator = frame.registers[instr.b].as_iterator();
        
        Value current_value = iterator->get_value();
        frame.registers[instr.a] = current_value;
        
        iterator->advance();
        break;
    }
    case Opcode::ITER_KEY:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto& iterator = frame.registers[instr.b].as_iterator();
        
        if (iterator->type() != Iterator::Type::Map && iterator->type() != Iterator::Type::IntMap) {
            throw std::runtime_error("ITER_KEY: operation only valid for map iterators");
        }
        
        Value current_key = iterator->get_key();
        
        frame.registers[instr.a] = current_key;
        break;
    }
    default:
        throw std::runtime_error("Invalid iterator operation opcode");
    }
}

// Legacy function for backward compatibility
void run_vm(const std::vector<Instruction> &code,
            StackFrame &frame,
            const std::vector<Value> &constant_pool)
{
    DoofVM vm;
    vm.run(code, constant_pool);
}



