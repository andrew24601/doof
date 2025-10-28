// Helper to extract 16-bit unsigned immediate from b and c fields
// (Assumes Instruction is defined in vm.h or included header)
// Add this method to the Instruction struct/class definition in vm.h:
//     uint16_t uimm16() const { return (static_cast<uint16_t>(b) << 8) | c; }
#include "vm.h"
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
    case Opcode::INT_TO_ENUM: return "INT_TO_ENUM";
    case Opcode::STRING_TO_ENUM: return "STRING_TO_ENUM";
    case Opcode::ENUM_TO_STRING: return "ENUM_TO_STRING";
    case Opcode::CLASS_TO_JSON: return "CLASS_TO_JSON";
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
    case Opcode::CAPTURE_VALUE:
    case Opcode::RETURN:
    case Opcode::JMP_IF_TRUE:
    case Opcode::JMP_IF_FALSE:
    case Opcode::SET_GLOBAL:
    case Opcode::GET_GLOBAL:
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

DoofVM::DoofVM()
{
    // Initialize with a main frame
    call_stack.emplace_back(256);

    // Register built-in external functions
        register_extern_function("println", [this](Value *args) -> Value {
            // Build output string
            std::ostringstream output;
            
            // Use JSON serialization for objects, simpler format for primitives
            if (args->type() == ValueType::Object) {
                // For objects, use JSON serialization
                if (constant_pool_) {
                    output << value_to_json(*args, *constant_pool_);
                } else {
                    output << "[object]";
                }
            } else if (args->type() == ValueType::String) {
                // For strings, just print the raw string (not quoted)
                output << args->as_string();
            } else {
                // For other types, use JSON serialization
                static const std::vector<Value> empty_pool;
                const std::vector<Value>& pool = constant_pool_ ? *constant_pool_ : empty_pool;
                output << value_to_json(*args, pool);
            }
            
            output << "\n"; // Add newline
            
            // Send output via DAP if available, otherwise use std::cout
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

    // Register string method external functions
    register_extern_function("String::substring", [](Value *args) -> Value {
        // args[0] = string, args[1] = start, args[2] = end (optional)
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::Int) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        int start = args[1].as_int();
        
        // Handle negative indices and bounds
        if (start < 0) start = 0;
        if (start >= static_cast<int>(str.length())) return Value::make_string("");
        
        // Check if end parameter is provided
        if (args[2].type() == ValueType::Int) {
            int end = args[2].as_int();
            if (end <= start) return Value::make_string("");
            if (end > static_cast<int>(str.length())) end = str.length();
            return Value::make_string(str.substr(start, end - start));
        } else {
            // No end parameter, substring to end
            return Value::make_string(str.substr(start));
        }
    });

    register_extern_function("String::indexOf", [](Value *args) -> Value {
        // args[0] = string, args[1] = searchValue
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::String) {
            return Value::make_int(-1);
        }
        
        const std::string &str = args[0].as_string();
        const std::string &search = args[1].as_string();
        
        size_t pos = str.find(search);
        return Value::make_int(pos == std::string::npos ? -1 : static_cast<int>(pos));
    });

    register_extern_function("String::replace", [](Value *args) -> Value {
        // args[0] = string, args[1] = from, args[2] = to
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
        // args[0] = string
        if (args[0].type() != ValueType::String) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        std::string result = str;
        std::transform(result.begin(), result.end(), result.begin(), ::toupper);
        return Value::make_string(result);
    });

    register_extern_function("String::toLowerCase", [](Value *args) -> Value {
        // args[0] = string
        if (args[0].type() != ValueType::String) {
            return Value::make_string("");
        }
        
        const std::string &str = args[0].as_string();
        std::string result = str;
        std::transform(result.begin(), result.end(), result.begin(), ::tolower);
        return Value::make_string(result);
    });

    register_extern_function("String::split", [](Value *args) -> Value {
        // args[0] = string, args[1] = separator (string)
        if (args[0].type() != ValueType::String || args[1].type() != ValueType::String) {
            auto empty_array = std::make_shared<Array>();
            return Value::make_array(empty_array);
        }
        
        const std::string &str = args[0].as_string();
        const std::string &separator = args[1].as_string();
        
        auto result_array = std::make_shared<Array>();
        
        if (separator.empty()) {
            // If separator is empty, split into individual characters
            for (char c : str) {
                result_array->push_back(Value::make_string(std::string(1, c)));
            }
        } else {
            // Split by separator
            size_t start = 0;
            size_t pos = str.find(separator);
            
            while (pos != std::string::npos) {
                result_array->push_back(Value::make_string(str.substr(start, pos - start)));
                start = pos + separator.length();
                pos = str.find(separator, start);
            }
            
            // Add the remaining part
            result_array->push_back(Value::make_string(str.substr(start)));
        }
        
        return Value::make_array(result_array);
    });

    // Register Array method external functions
    register_extern_function("Array::push", [](Value *args) -> Value {
        // args[0] = array, args[1] = element to push
        if (args[0].type() != ValueType::Array) {
            return Value::make_null();
        }
        
        auto arr = args[0].as_array();
        arr->push_back(args[1]);
        return Value::make_null(); // push() returns void
    });

    register_extern_function("Array::length", [](Value *args) -> Value {
        // args[0] = array
        if (args[0].type() != ValueType::Array) {
            return Value::make_int(0);
        }
        
        auto arr = args[0].as_array();
        return Value::make_int(static_cast<int32_t>(arr->size()));
    });

    register_extern_function("Array::pop", [](Value *args) -> Value {
        // args[0] = array
        if (args[0].type() != ValueType::Array) {
            return Value::make_null();
        }
        
        auto arr = args[0].as_array();
        if (arr->empty()) {
            return Value::make_null(); // Behavior when popping from empty array
        }
        
        Value popped = arr->back();
        arr->pop_back();
        return popped;
    });

    register_extern_function("Array::length", [](Value *args) -> Value {
        // args[0] = array
        if (args[0].type() != ValueType::Array) {
            return Value::make_int(0);
        }
        
        auto arr = args[0].as_array();
        return Value::make_int(static_cast<int>(arr->size()));
    });

    // Register StringBuilder external functions
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
    debugMode_ = true;
    debugState_.setDebugInfo(debug_info);
    run(code, constant_pool, entry_point, global_count);
}

void DoofVM::run(const std::vector<Instruction> &code,
                   const std::vector<Value> &constant_pool,
                   int entry_point,
                   int global_count)
{
    // Store constant pool pointer for use in extern functions
    constant_pool_ = &constant_pool;
    refresh_extern_class_indices();
    
    int code_size = static_cast<int>(code.size());
    
    // Initialize global variables
    if (global_count > 0) {
        globals_.resize(global_count);
        // Initialize all globals to null
        for (int i = 0; i < global_count; i++) {
            globals_[i] = Value::make_null();
        }
    }
    
    if (call_stack.empty())
    {
        call_stack.emplace_back(256);
    }
    
    // Set the entry point for main program execution
    // Global initialization is now handled properly in bytecode generation
    current_frame().instruction_pointer = entry_point;

#ifndef DOMINO_VM_UNSAFE
    if (verbose_) {
        std::cout << "[VM] Starting execution with " << code_size << " instructions" << std::endl;
        std::cout << "[VM] Call stack depth: " << call_stack.size() << std::endl;
    }
#endif

    while (!call_stack.empty())
    {
        StackFrame &frame = current_frame();
        std::vector<Value> &registers = frame.registers;
        int ip = frame.instruction_pointer;

        // Tight execution loop with local instruction pointer
        while (true)
        {
#ifndef DOMINO_VM_UNSAFE
            if (ip < 0 || ip >= code_size)
            {
                throw std::runtime_error("Falling off the end of code");
            }
            if (verbose_ && ip % 10 == 0) { // Log every 10th instruction to avoid spam
                std::cout << "[VM] IP: " << ip << ", Call stack depth: " << call_stack.size() << std::endl;
            }
#endif

            currentInstruction_ = ip;

            // Debug support
            if (debugMode_) {
                
                // Check if execution is paused (for entry point pause or other reasons)
                while (paused_) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                }
                
                // Check for breakpoints
                if (debugState_.hasBreakpointAtInstruction(ip)) {
                    paused_ = true;
                    
                    // Notify DAP handler about breakpoint hit
                    if (dapHandler_) {
                        dapHandler_->notifyBreakpointHit(1); // threadId = 1
                    }
                    
                    // Wait for debugger to resume execution
                    while (paused_) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    }
                }
                
                // Check for stepping
                if (debugState_.shouldBreakOnStep(ip, static_cast<int>(call_stack.size()))) {
                    paused_ = true;
                    
                    // Update step-from line to current location for next step
                    SourceMapEntry currentLocation = debugState_.getSourceFromInstruction(ip);
                    if (currentLocation.sourceLine != -1) {
                        debugState_.setStepFromLine(currentLocation.sourceLine, currentLocation.fileIndex);
                    }
                    
                    // Notify DAP handler about step completion
                    if (dapHandler_) {
                        dapHandler_->notifyStepComplete(1); // threadId = 1
                    }
                    
                    // Wait for debugger to resume execution
                    while (paused_) {
                        std::this_thread::sleep_for(std::chrono::milliseconds(10));
                    }
                }
            }

            const Instruction &instr = code[ip];
            const Opcode op = static_cast<Opcode>(instr.opcode);

#ifndef DOMINO_VM_UNSAFE
            if (verbose_) {
                std::cout << "[VM] IP=" << ip << " " << format_instruction(instr, constant_pool) << std::endl;
            }
#endif

            switch (op)
            {
            case Opcode::EXTERN_CALL:
            {
                VM_VALIDATE_REGISTER(instr.a); // 'a' = first argument register (by convention)
                int name_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(name_index, constant_pool);

                // Get function name from constant pool
                const Value &name_val = constant_pool[name_index];
                const std::string &func_name = name_val.as_string();

#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] Calling external function: " << func_name << std::endl;
                }
#endif

                // get ptr to arguments
                Value *arg_ptr = &registers[instr.a];

                // Lookup and call the external function
                auto it = extern_functions.find(func_name);
                if (it == extern_functions.end())
                {
                    throw std::runtime_error("External function not found: " + func_name);
                }
                Value result = it->second(arg_ptr);

                // Store result in register 0 (by convention)
                registers[0] = result;

                ++ip;
                break;
            }
            case Opcode::NOP:
                ++ip;
                break;

            case Opcode::HALT:
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] HALT instruction reached at IP " << ip << std::endl;
                }
#endif
                frame.instruction_pointer = ip;
                return;

            case Opcode::MOVE:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                registers[instr.a] = registers[instr.b];
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] MOVE: R" << static_cast<int>(instr.a) << " = R" << static_cast<int>(instr.b) << std::endl;
                }
#endif
                ++ip;
                break;

            case Opcode::LOADK:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    int const_index = (static_cast<int>(instr.b) << 8) | instr.c;
                    VM_VALIDATE_CONSTANT_INDEX(const_index, constant_pool);
                    registers[instr.a] = constant_pool[const_index];
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LOADK: R" << static_cast<int>(instr.a) << " = constant[" << const_index << "]" << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            case Opcode::LOADK_NULL:
                VM_VALIDATE_REGISTER(instr.a);
                registers[instr.a] = Value::make_null();
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] LOADK_NULL: R" << static_cast<int>(instr.a) << " = null" << std::endl;
                }
#endif
                ++ip;
                break;

            case Opcode::LOADK_INT16:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    int16_t value = instr.imm16();
                    registers[instr.a] = Value::make_int(value);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LOADK_INT16: R" << static_cast<int>(instr.a) << " = " << value << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            case Opcode::LOADK_BOOL:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool value = instr.b != 0;
                    registers[instr.a] = Value::make_bool(value);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LOADK_BOOL: R" << static_cast<int>(instr.a) << " = " << (value ? "true" : "false") << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            case Opcode::LOADK_FLOAT:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    // Decode 16-bit fixed-point value as 8.8 format (8 integer, 8 fractional bits)
                    int16_t fixedPoint = instr.imm16();
                    float floatValue = static_cast<float>(fixedPoint) / 256.0f;
                    registers[instr.a] = Value::make_float(floatValue);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LOADK_FLOAT: R" << static_cast<int>(instr.a) << " = " << floatValue << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            case Opcode::LOADK_CHAR:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    char charValue = static_cast<char>(instr.b);
                    registers[instr.a] = Value::make_char(charValue);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LOADK_CHAR: R" << static_cast<int>(instr.a) << " = '" << charValue << "'" << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            // Inline common arithmetic operations for maximum performance
            case Opcode::ADD_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    int32_t result = left + right;
                    registers[instr.a] = Value::make_int(result);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] ADD_INT: " << left << " + " << right << " = " << result << std::endl;
                    }
#endif
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
                    int32_t result = left - right;
                    registers[instr.a] = Value::make_int(result);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] SUB_INT: " << left << " - " << right << " = " << result << std::endl;
                    }
#endif
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
                    int32_t result = left * right;
                    registers[instr.a] = Value::make_int(result);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] MUL_INT: " << left << " * " << right << " = " << result << std::endl;
                    }
#endif
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
                int32_t result = left / right;
                registers[instr.a] = Value::make_int(result);
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] DIV_INT: " << left << " / " << right << " = " << result << std::endl;
                }
#endif
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
                int32_t result = left % right;
                registers[instr.a] = Value::make_int(result);
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] MOD_INT: " << left << " % " << right << " = " << result << std::endl;
                }
#endif
                ++ip;
                break;
            }

            // Inline comparison operations for performance
            case Opcode::EQ_INT:
                VM_VALIDATE_REGISTER(instr.a);
                VM_VALIDATE_REGISTER(instr.b);
                VM_VALIDATE_REGISTER(instr.c);
                {
                    int32_t left = registers[instr.b].as_int();
                    int32_t right = registers[instr.c].as_int();
                    bool result = left == right;
                    registers[instr.a] = Value::make_bool(result);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] EQ_INT: " << left << " == " << right << " = " << (result ? "true" : "false") << std::endl;
                    }
#endif
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
                    bool result = left < right;
                    registers[instr.a] = Value::make_bool(result);
#ifndef DOMINO_VM_UNSAFE
                    if (verbose_) {
                        std::cout << "[VM] LT_INT: " << left << " < " << right << " = " << (result ? "true" : "false") << std::endl;
                    }
#endif
                }
                ++ip;
                break;

            // Inline boolean operations for performance
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

            // Control flow operations - critical for performance
            case Opcode::JMP:
            {
                int16_t offset = instr.imm16();
                int new_ip = ip + offset;
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] JMP: IP " << ip << " -> " << new_ip << " (offset " << offset << ")" << std::endl;
                }
#endif
                ip = new_ip;
                break;
            }

            case Opcode::JMP_IF_TRUE:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool condition = registers[instr.a].as_bool();
                    int16_t offset = instr.imm16();
                    if (condition)
                    {
                        int new_ip = ip + offset;
#ifndef DOMINO_VM_UNSAFE
                        if (verbose_) {
                            std::cout << "[VM] JMP_IF_TRUE: condition true, IP " << ip << " -> " << new_ip << " (offset " << offset << ")" << std::endl;
                        }
#endif
                        ip = new_ip;
                    }
                    else
                    {
#ifndef DOMINO_VM_UNSAFE
                        if (verbose_) {
                            std::cout << "[VM] JMP_IF_TRUE: condition false, continuing to IP " << (ip + 1) << std::endl;
                        }
#endif
                        ++ip;
                    }
                }
                break;

            case Opcode::JMP_IF_FALSE:
                VM_VALIDATE_REGISTER(instr.a);
                {
                    bool condition = registers[instr.a].as_bool();
                    int16_t offset = instr.imm16();
                    if (!condition)
                    {
                        int new_ip = ip + offset;
#ifndef DOMINO_VM_UNSAFE
                        if (verbose_) {
                            std::cout << "[VM] JMP_IF_FALSE: condition false, IP " << ip << " -> " << new_ip << " (offset " << offset << ")" << std::endl;
                        }
#endif
                        ip = new_ip;
                    }
                    else
                    {
#ifndef DOMINO_VM_UNSAFE
                        if (verbose_) {
                            std::cout << "[VM] JMP_IF_FALSE: condition true, continuing to IP " << (ip + 1) << std::endl;
                        }
#endif
                        ++ip;
                    }
                }
                break;

            // Less common operations use helper functions
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
                handle_string_ops(instr, op);
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
                
                // Save return address in current frame
                frame.instruction_pointer = ip + 1;
                
                // Create new frame for lambda execution
                push_frame(-1, 256); // -1 indicates lambda call
                StackFrame &lambda_frame = current_frame();
                lambda_frame.instruction_pointer = lambda->code_index;
                
                // Get calling frame safely after push_frame (frame reference may be invalidated by vector reallocation)
                StackFrame &calling_frame = call_stack[call_stack.size() - 2]; // calling frame is second-to-last
                
                // Copy arguments - assuming they start at register instr.a
                for (int i = 0; i < lambda->parameter_count && i < 16; ++i) {
                    if ((instr.a + i) < static_cast<int>(calling_frame.registers.size()) && 
                        (i + 1) < static_cast<int>(lambda_frame.registers.size())) {
                        lambda_frame.registers[i + 1] = calling_frame.registers[instr.a + i];
                    }
                }
                
                // Set up captured values for escaping lambdas (placed after parameters)
                for (size_t i = 0; i < lambda->captured_values.size(); ++i) {
                    int target_reg = lambda->parameter_count + 1 + static_cast<int>(i);
                    if (target_reg < static_cast<int>(lambda_frame.registers.size())) {
                        lambda_frame.registers[target_reg] = lambda->captured_values[i];
                    }
                }
                
                // Lambda calls change the call stack, break out to outer loop
                goto outer_loop_continue;
            }

            case Opcode::CALL:
            {
                VM_VALIDATE_REGISTER(instr.a); // 'a' = first argument register (by convention)
                int function_index = instr.uimm16();
                VM_VALIDATE_CONSTANT_INDEX(function_index, constant_pool);

#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] Function call to index " << function_index << std::endl;
                }
#endif

                // Save return address
                frame.instruction_pointer = ip + 1;

                // Extract function metadata from constant pool
                // Use FunctionMetadata to extract function info
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

                // Push new frame for the function call
                push_frame(function_index, num_registers);
                StackFrame &callee = current_frame();
                callee.instruction_pointer = entry_point;
                callee.function_index = function_index;

                // Copy arguments from caller to callee registers
                // Get caller frame reference after push_frame (frame reference may be invalidated by vector reallocation)
                StackFrame &caller = call_stack[call_stack.size() - 2];
                for (int i = 0; i < num_args; ++i)
                {
                    // Arguments are copied to registers R1, R2, R3, etc. (R0 is reserved for return value)
                    if ((instr.a + i) < static_cast<int>(caller.registers.size()) && (i + 1) < static_cast<int>(callee.registers.size()))
                    {
                        callee.registers[i + 1] = caller.registers[instr.a + i];
                    }
                }

                // Function calls may change the call stack, break out to outer loop
                goto outer_loop_continue;
            }

            case Opcode::RETURN:
            {
                VM_VALIDATE_REGISTER(instr.a);
                Value return_value = frame.registers[instr.a];

#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] Returning from function, call stack depth: " << call_stack.size() << std::endl;
                }
#endif

                pop_frame();

                if (!call_stack.empty())
                {
                    // Store return value in the calling frame's register 0
                    current_frame().registers[0] = return_value;
                }

                // Return may change the call stack, break out to outer loop
                goto outer_loop_continue;
            }

            // Iterator operations
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
                
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] GET_GLOBAL r" << static_cast<int>(instr.a) 
                             << ", " << global_index << std::endl;
                }
#endif
                
                frame.registers[instr.a] = get_global(global_index);
                ++ip;
                break;
            }

            case Opcode::SET_GLOBAL:
            {
                VM_VALIDATE_REGISTER(instr.a);
                uint16_t global_index = (static_cast<uint16_t>(instr.b) << 8) | instr.c;
                
#ifndef DOMINO_VM_UNSAFE
                if (verbose_) {
                    std::cout << "[VM] SET_GLOBAL " << global_index 
                             << ", r" << static_cast<int>(instr.a) << std::endl;
                }
#endif
                
                set_global(global_index, frame.registers[instr.a]);
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

void DoofVM::handle_arithmetic(const Instruction &instr, Opcode op)
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

void DoofVM::handle_comparison(const Instruction &instr, Opcode op)
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
        // IEEE 754 strict equality - no epsilon-based comparison
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() == frame.registers[instr.c].as_float());
        break;
    case Opcode::LT_FLOAT:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() < frame.registers[instr.c].as_float());
        break;
    case Opcode::LTE_FLOAT:
        // Retained for correct NaN handling - NaN comparisons always return false
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_float() <= frame.registers[instr.c].as_float());
        break;
    case Opcode::EQ_DOUBLE:
        // IEEE 754 strict equality - no epsilon-based comparison
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() == frame.registers[instr.c].as_double());
        break;
    case Opcode::LT_DOUBLE:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() < frame.registers[instr.c].as_double());
        break;
    case Opcode::LTE_DOUBLE:
        // Retained for correct NaN handling - NaN comparisons always return false
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_double() <= frame.registers[instr.c].as_double());
        break;
    case Opcode::EQ_STRING:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_string() == frame.registers[instr.c].as_string());
        break;
    case Opcode::LT_STRING:
        // Lexicographic string comparison
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_string() < frame.registers[instr.c].as_string());
        break;
    case Opcode::EQ_BOOL:
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_bool() == frame.registers[instr.c].as_bool());
        break;
    case Opcode::LT_BOOL:
        // Boolean comparison: false < true
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
        // Character comparison: lexicographic order
        frame.registers[instr.a] = Value::make_bool(
            frame.registers[instr.b].as_char() < frame.registers[instr.c].as_char());
        break;
    default:
        throw std::runtime_error("Invalid comparison opcode");
    }
}

void DoofVM::handle_type_conversion(const Instruction &instr, Opcode op)
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] INT_TO_FLOAT: converted " << int_val << " to " << float_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::INT_TO_DOUBLE:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        double double_val = static_cast<double>(int_val);
        frame.registers[instr.a] = Value::make_double(double_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] INT_TO_DOUBLE: converted " << int_val << " to " << double_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::FLOAT_TO_INT:
    {
        float float_val = frame.registers[instr.b].as_float();
        int32_t int_val = static_cast<int32_t>(float_val);
        frame.registers[instr.a] = Value::make_int(int_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] FLOAT_TO_INT: converted " << float_val << " to " << int_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::DOUBLE_TO_INT:
    {
        double double_val = frame.registers[instr.b].as_double();
        int32_t int_val = static_cast<int32_t>(double_val);
        frame.registers[instr.a] = Value::make_int(int_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] DOUBLE_TO_INT: converted " << double_val << " to " << int_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::FLOAT_TO_DOUBLE:
    {
        float float_val = frame.registers[instr.b].as_float();
        double double_val = static_cast<double>(float_val);
        frame.registers[instr.a] = Value::make_double(double_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] FLOAT_TO_DOUBLE: converted " << float_val << " to " << double_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::DOUBLE_TO_FLOAT:
    {
        double double_val = frame.registers[instr.b].as_double();
        float float_val = static_cast<float>(double_val);
        frame.registers[instr.a] = Value::make_float(float_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] DOUBLE_TO_FLOAT: converted " << double_val << " to " << float_val << std::endl;
        }
#endif
        break;
    }
    case Opcode::IS_NULL:
    {
        bool is_null = frame.registers[instr.b].is_null();
        frame.registers[instr.a] = Value::make_bool(is_null);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] IS_NULL: result " << (is_null ? "true" : "false") << std::endl;
        }
#endif
        break;
    }
    case Opcode::GET_CLASS_IDX:
    {
        const Value& obj = frame.registers[instr.b];
        
        // Return the class index for objects, -1 for everything else
        int32_t class_idx = -1;
        if (!obj.is_null() && obj.type() == ValueType::Object) {
            const ObjectPtr obj_ptr = obj.as_object();
            class_idx = obj_ptr->class_idx;
        }
        
        frame.registers[instr.a] = Value::make_int(class_idx);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] GET_CLASS_IDX: object class_idx = " << class_idx << std::endl;
        }
#endif
        break;
    }
    case Opcode::TYPE_OF:
    {
        const Value& val = frame.registers[instr.b];
        int32_t type_idx = static_cast<int32_t>(val.type());
        frame.registers[instr.a] = Value::make_int(type_idx);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] TYPE_OF: value type = " << type_idx << std::endl;
        }
#endif
        break;
    }
    case Opcode::INT_TO_STRING:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        std::string str_val = std::to_string(int_val);
        frame.registers[instr.a] = Value::make_string(str_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] INT_TO_STRING: converted " << int_val << " to \"" << str_val << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::FLOAT_TO_STRING:
    {
        float float_val = frame.registers[instr.b].as_float();
        std::string str_val = std::to_string(float_val);
        frame.registers[instr.a] = Value::make_string(str_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] FLOAT_TO_STRING: converted " << float_val << " to \"" << str_val << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::DOUBLE_TO_STRING:
    {
        double double_val = frame.registers[instr.b].as_double();
        std::string str_val = std::to_string(double_val);
        frame.registers[instr.a] = Value::make_string(str_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] DOUBLE_TO_STRING: converted " << double_val << " to \"" << str_val << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::BOOL_TO_STRING:
    {
        bool bool_val = frame.registers[instr.b].as_bool();
        std::string str_val = bool_val ? "true" : "false";
        frame.registers[instr.a] = Value::make_string(str_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] BOOL_TO_STRING: converted " << (bool_val ? "true" : "false") << " to \"" << str_val << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::CHAR_TO_STRING:
    {
        char char_val = frame.registers[instr.b].as_char();
        std::string str_val(1, char_val);
        frame.registers[instr.a] = Value::make_string(str_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] CHAR_TO_STRING: converted '" << char_val << "' to \"" << str_val << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::STRING_TO_INT:
    {
        const std::string &str_val = frame.registers[instr.b].as_string();
        try {
            int32_t int_val = std::stoi(str_val);
            frame.registers[instr.a] = Value::make_int(int_val);
#ifndef DOMINO_VM_UNSAFE
            if (verbose_) {
                std::cout << "[VM] STRING_TO_INT: converted \"" << str_val << "\" to " << int_val << std::endl;
            }
#endif
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
#ifndef DOMINO_VM_UNSAFE
            if (verbose_) {
                std::cout << "[VM] STRING_TO_FLOAT: converted \"" << str_val << "\" to " << float_val << std::endl;
            }
#endif
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
#ifndef DOMINO_VM_UNSAFE
            if (verbose_) {
                std::cout << "[VM] STRING_TO_DOUBLE: converted \"" << str_val << "\" to " << double_val << std::endl;
            }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] STRING_TO_BOOL: converted \"" << str_val << "\" to " << (bool_val ? "true" : "false") << std::endl;
        }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] STRING_TO_CHAR: converted \"" << str_val << "\" to '" << char_val << "'" << std::endl;
        }
#endif
        break;
    }
    case Opcode::INT_TO_BOOL:
    {
        int32_t int_val = frame.registers[instr.b].as_int();
        bool bool_val = (int_val != 0);
        frame.registers[instr.a] = Value::make_bool(bool_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] INT_TO_BOOL: converted " << int_val << " to " << (bool_val ? "true" : "false") << std::endl;
        }
#endif
        break;
    }
    case Opcode::FLOAT_TO_BOOL:
    {
        float float_val = frame.registers[instr.b].as_float();
        bool bool_val = (float_val != 0.0f);
        frame.registers[instr.a] = Value::make_bool(bool_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] FLOAT_TO_BOOL: converted " << float_val << " to " << (bool_val ? "true" : "false") << std::endl;
        }
#endif
        break;
    }
    case Opcode::DOUBLE_TO_BOOL:
    {
        double double_val = frame.registers[instr.b].as_double();
        bool bool_val = (double_val != 0.0);
        frame.registers[instr.a] = Value::make_bool(bool_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] DOUBLE_TO_BOOL: converted " << double_val << " to " << (bool_val ? "true" : "false") << std::endl;
        }
#endif
        break;
    }
    case Opcode::CHAR_TO_INT:
    {
        char char_val = frame.registers[instr.b].as_char();
        int32_t int_val = static_cast<int32_t>(char_val);
        frame.registers[instr.a] = Value::make_int(int_val);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] CHAR_TO_INT: converted '" << char_val << "' to " << int_val << std::endl;
        }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] INT_TO_CHAR: converted " << int_val << " to '" << char_val << "'" << std::endl;
        }
#endif
        break;
    }
    default:
        throw std::runtime_error("Invalid type conversion opcode");
    }
}

void DoofVM::handle_string_ops(const Instruction &instr, Opcode op)
{
    VM_VALIDATE_REGISTER(instr.a);
    VM_VALIDATE_REGISTER(instr.b);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::ADD_STRING:
    {
        VM_VALIDATE_REGISTER(instr.c);
        // Convert both operands to strings, handling different types
        std::string str1;
        std::string str2;
        
        // Convert first operand
        const Value &val1 = frame.registers[instr.b];
        if (val1.type() == ValueType::Object && constant_pool_) {
            str1 = value_to_json(val1, *constant_pool_);
        } else {
            switch (val1.type()) {
                case ValueType::String:
                    str1 = val1.as_string();
                    break;
                case ValueType::Int:
                    str1 = std::to_string(val1.as_int());
                    break;
                case ValueType::Float:
                    str1 = std::to_string(val1.as_float());
                    break;
                case ValueType::Double:
                    str1 = std::to_string(val1.as_double());
                    break;
                case ValueType::Bool:
                    str1 = val1.as_bool() ? "true" : "false";
                    break;
                case ValueType::Null:
                    str1 = "null";
                    break;
                default:
                    str1 = "[object]";
                    break;
            }
        }
        
        // Convert second operand
        const Value &val2 = frame.registers[instr.c];
        if (val2.type() == ValueType::Object && constant_pool_) {
            str2 = value_to_json(val2, *constant_pool_);
        } else {
            switch (val2.type()) {
                case ValueType::String:
                    str2 = val2.as_string();
                    break;
                case ValueType::Int:
                    str2 = std::to_string(val2.as_int());
                    break;
                case ValueType::Float:
                    str2 = std::to_string(val2.as_float());
                    break;
                case ValueType::Double:
                    str2 = std::to_string(val2.as_double());
                    break;
                case ValueType::Bool:
                    str2 = val2.as_bool() ? "true" : "false";
                    break;
                case ValueType::Null:
                    str2 = "null";
                    break;
                default:
                    str2 = "[object]";
                    break;
            }
        }
        
        std::string result = str1 + str2;
        frame.registers[instr.a] = Value::make_string(result);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] ADD_STRING: \"" << str1 << "\" + \"" << str2 << "\" = \"" << result << "\"" << std::endl;
        }
#endif
        break;
    }
    case Opcode::LENGTH_STRING:
    {
        const std::string &str = frame.registers[instr.b].as_string();
        int32_t length = static_cast<int32_t>(str.length());
        frame.registers[instr.a] = Value::make_int(length);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] LENGTH_STRING: \"" << str << "\" has length " << length << std::endl;
        }
#endif
        break;
    }
    default:
        throw std::runtime_error("Invalid string operation opcode");
    }
}

void DoofVM::handle_array_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] NEW_ARRAY: created array of size " << size << std::endl;
        }
#endif
        break;
    }
    case Opcode::GET_ARRAY:
    {
        VM_VALIDATE_REGISTER(instr.b);
        VM_VALIDATE_REGISTER(instr.c);
        int32_t index = frame.registers[instr.c].as_int();
        Value result;
        
        // Check if the object is a string or an array
        if (frame.registers[instr.b].type() == ValueType::String) {
            // String character access returns a single char value
            const auto &str = frame.registers[instr.b].as_string();
            VM_BOUNDS_CHECK(index >= 0 && index < static_cast<int32_t>(str.size()),
                            "String index out of bounds");
            result = Value::make_char(str[index]);
        } else {
            // Array element access
            const auto &array = frame.registers[instr.b].as_array();
            VM_BOUNDS_CHECK(index >= 0 && index < static_cast<int32_t>(array->size()),
                            "Array index out of bounds");
            result = (*array)[index];
        }
        frame.registers[instr.a] = result;
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] GET_ARRAY: array[" << index << "] -> ";
            switch (result.type()) {
                case ValueType::Null: std::cout << "null"; break;
                case ValueType::Bool: std::cout << (result.as_bool() ? "true" : "false"); break;
                case ValueType::Int: std::cout << result.as_int(); break;
                case ValueType::Float: std::cout << result.as_float(); break;
                case ValueType::Double: std::cout << result.as_double(); break;
                case ValueType::Char: std::cout << "'" << result.as_char() << "'"; break;
                case ValueType::String: std::cout << "\"" << result.as_string() << "\""; break;
                case ValueType::Object: std::cout << "[object]"; break;
                case ValueType::Array: std::cout << "[array]"; break;
                case ValueType::Lambda: std::cout << "[lambda]"; break;
                case ValueType::Map: std::cout << "[map]"; break;
                case ValueType::Set: std::cout << "[set]"; break;
                case ValueType::IntMap: std::cout << "[intmap]"; break;
                case ValueType::IntSet: std::cout << "[intset]"; break;
                case ValueType::Iterator: std::cout << "[iterator]"; break;
            }
            std::cout << std::endl;
        }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] SET_ARRAY: array[" << index << "] = ";
            switch (value.type()) {
                case ValueType::Null: std::cout << "null"; break;
                case ValueType::Bool: std::cout << (value.as_bool() ? "true" : "false"); break;
                case ValueType::Int: std::cout << value.as_int(); break;
                case ValueType::Float: std::cout << value.as_float(); break;
                case ValueType::Double: std::cout << value.as_double(); break;
                case ValueType::Char: std::cout << "'" << value.as_char() << "'"; break;
                case ValueType::String: std::cout << "\"" << value.as_string() << "\""; break;
                case ValueType::Object: std::cout << "[object]"; break;
                case ValueType::Array: std::cout << "[array]"; break;
                case ValueType::Lambda: std::cout << "[lambda]"; break;
                case ValueType::Map: std::cout << "[map]"; break;
                case ValueType::Set: std::cout << "[set]"; break;
                case ValueType::IntMap: std::cout << "[intmap]"; break;
                case ValueType::IntSet: std::cout << "[intset]"; break;
                case ValueType::Iterator: std::cout << "[iterator]"; break;
            }
            std::cout << std::endl;
        }
#endif
        break;
    }
    case Opcode::LENGTH_ARRAY:
    {
        VM_VALIDATE_REGISTER(instr.b);
        const auto &array = frame.registers[instr.b].as_array();
        int32_t length = static_cast<int32_t>(array->size());
        frame.registers[instr.a] = Value::make_int(length);
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] LENGTH_ARRAY: array has length " << length << std::endl;
        }
#endif
        break;
    }
    default:
        throw std::runtime_error("Invalid array operation opcode");
    }
}

void DoofVM::handle_object_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    VM_VALIDATE_REGISTER(instr.a);

    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::NEW_OBJECT:
    {
        int class_index = instr.uimm16();
        VM_VALIDATE_CONSTANT_INDEX(class_index, constant_pool);
        // Use ClassMetadata from the constant pool
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] NEW_OBJECT: created object with " << num_fields << " fields" << std::endl;
        }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] GET_FIELD: object.field[" << field_index << "] -> ";
            switch (result.type()) {
                case ValueType::Null: std::cout << "null"; break;
                case ValueType::Bool: std::cout << (result.as_bool() ? "true" : "false"); break;
                case ValueType::Int: std::cout << result.as_int(); break;
                case ValueType::Float: std::cout << result.as_float(); break;
                case ValueType::Double: std::cout << result.as_double(); break;
                case ValueType::Char: std::cout << "'" << result.as_char() << "'"; break;
                case ValueType::String: std::cout << "\"" << result.as_string() << "\""; break;
                case ValueType::Object: std::cout << "[object]"; break;
                case ValueType::Array: std::cout << "[array]"; break;
                case ValueType::Lambda: std::cout << "[lambda]"; break;
                case ValueType::Map: std::cout << "[map]"; break;
                case ValueType::Set: std::cout << "[set]"; break;
                case ValueType::IntMap: std::cout << "[intmap]"; break;
                case ValueType::IntSet: std::cout << "[intset]"; break;
                case ValueType::Iterator: std::cout << "[iterator]"; break;
            }
            std::cout << std::endl;
        }
#endif
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
#ifndef DOMINO_VM_UNSAFE
        if (verbose_) {
            std::cout << "[VM] SET_FIELD: object.field[" << field_index << "] = ";
            switch (value.type()) {
                case ValueType::Null: std::cout << "null"; break;
                case ValueType::Bool: std::cout << (value.as_bool() ? "true" : "false"); break;
                case ValueType::Int: std::cout << value.as_int(); break;
                case ValueType::Float: std::cout << value.as_float(); break;
                case ValueType::Double: std::cout << value.as_double(); break;
                case ValueType::Char: std::cout << "'" << value.as_char() << "'"; break;
                case ValueType::String: std::cout << "\"" << value.as_string() << "\""; break;
                case ValueType::Object: std::cout << "[object]"; break;
                case ValueType::Array: std::cout << "[array]"; break;
                case ValueType::Lambda: std::cout << "[lambda]"; break;
                case ValueType::Map: std::cout << "[map]"; break;
                case ValueType::Set: std::cout << "[set]"; break;
                case ValueType::IntMap: std::cout << "[intmap]"; break;
                case ValueType::IntSet: std::cout << "[intset]"; break;
                case ValueType::Iterator: std::cout << "[iterator]"; break;
            }
            std::cout << std::endl;
        }
#endif
        break;
    }
    default:
        throw std::runtime_error("Invalid object operation opcode");
    }
}

void DoofVM::handle_map_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
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

void DoofVM::handle_set_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
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

void DoofVM::push_frame(int function_index, int num_registers)
{
    call_stack.emplace_back(num_registers);
    call_stack.back().function_index = function_index;
}

void DoofVM::pop_frame()
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
void DoofVM::validate_register(uint8_t reg) const
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

void DoofVM::validate_constant_index(int index, const std::vector<Value> &constant_pool) const
{
    if (index < 0 || index >= static_cast<int>(constant_pool.size()))
    {
        throw std::runtime_error("Constant pool index out of bounds: " + std::to_string(index));
    }
}
#endif

void DoofVM::handle_lambda_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
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
        
        // Create lambda with metadata from constant pool
        auto lambda = std::make_shared<Lambda>(metadata->codeIndex(), metadata->parameterCount());
        frame.registers[instr.a] = Value::make_lambda(lambda);
        break;
    }
    case Opcode::CAPTURE_VALUE:
    {
        VM_VALIDATE_REGISTER(instr.b);
        auto &lambda = frame.registers[instr.a].as_lambda();

        // Add value capture (survives parent frame destruction)
        lambda->captured_values.push_back(frame.registers[instr.b]);
        break;
    }
    default:
        throw std::runtime_error("Invalid lambda operation opcode");
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

// (Removed old/dead signature)
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

void DoofVM::handle_iterator_ops(const Instruction &instr, Opcode op, const std::vector<Value> &constant_pool)
{
    StackFrame &frame = current_frame();

    switch (op)
    {
    case Opcode::ITER_INIT:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const Value &collection = frame.registers[instr.b];
        
        // Create appropriate iterator based on collection type
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
        
        // Do NOT advance the iterator here - ITER_VALUE should get the current element
        // The iterator will be advanced after ITER_VALUE is called
        break;
    }
    case Opcode::ITER_VALUE:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto& iterator = frame.registers[instr.b].as_iterator();
        
        // Get current value
        Value current_value = iterator->get_value();
        frame.registers[instr.a] = current_value;
        
        // Advance the iterator after getting the value
        iterator->advance();
        break;
    }
    case Opcode::ITER_KEY:
    {
        VM_VALIDATE_REGISTER(instr.a);
        VM_VALIDATE_REGISTER(instr.b);

        const auto& iterator = frame.registers[instr.b].as_iterator();
        
        // Only map iterators support keys
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

void DoofVM::set_global(size_t index, const Value& value) {
#ifndef DOMINO_VM_UNSAFE
    if (index >= globals_.size()) {
        throw std::runtime_error("Global variable index out of bounds: " + std::to_string(index));
    }
#endif
    globals_[index] = value;
}

Value DoofVM::get_global(size_t index) const {
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
    out << " call_stack_size: " << call_stack.size() << std::endl;
    out << " current_instruction: " << currentInstruction_ << std::endl;
    out << " paused: " << (paused_ ? "true" : "false") << std::endl;

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
        if (printed == 0)
        {
            out << " globals: <all null>" << std::endl;
        }
        else if (printed > 64)
        {
            out << "  ... (" << (printed - 64) << " more globals not shown)" << std::endl;
        }
    }

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

        if (printed == 0)
        {
            out << "    registers: <all null>" << std::endl;
        }
        else if (printed > 64)
        {
            out << "    ... (" << (printed - 64) << " more registers not shown)" << std::endl;
        }
    }
}


