// Domino value type
#pragma once
#include <variant>
#include <memory>
#include <vector>
#include <string>
#include <cstdint>
#include <stdexcept>
#include <optional>

// Forward declarations for object and array types
struct Object;
struct Lambda;
class Iterator;
using ObjectPtr = std::shared_ptr<Object>;
using LambdaPtr = std::shared_ptr<Lambda>;
using IteratorPtr = std::shared_ptr<Iterator>;
using Array = std::vector<class Value>;
using ArrayPtr = std::shared_ptr<Array>;

// Forward declarations for map and set types
#include <map>
#include <unordered_set>
#include "doof_runtime.h"

// Forward declare Value class for hash and equality
class Value;

// Hash and equality functors for Value (needed for Set)
struct ValueHash {
    std::size_t operator()(const Value& v) const;
};

struct ValueEqual {
    bool operator()(const Value& a, const Value& b) const;
};

// Original string-keyed types (for backward compatibility)
using Map = std::map<std::string, Value>;
using MapPtr = std::shared_ptr<Map>;
using Set = std::unordered_set<Value, ValueHash, ValueEqual>;
using SetPtr = std::shared_ptr<Set>;

// New integer-keyed types
using IntMap = std::map<int32_t, Value>;
using IntMapPtr = std::shared_ptr<IntMap>;
using IntSet = std::unordered_set<int32_t>;
using IntSetPtr = std::shared_ptr<IntSet>;

// Future type
using FuturePtr = std::shared_ptr<doof_runtime::Future<Value>>;

enum class ValueType {
    Null,
    Bool,
    Int,
    Float,
    Double,
    Char,
    String,
    Object,
    Array,
    Lambda,
    Map,
    Set,
    IntMap,
    IntSet,
    Iterator,
    Future
};

class Value {
public:
    using Storage = std::variant<
        std::monostate,   // Null
        bool,
        int32_t,
        float,
        double,
        char,
        std::string,
        ObjectPtr,
        ArrayPtr,
        LambdaPtr,
        MapPtr,
        SetPtr,
        IntMapPtr,
        IntSetPtr,
        IteratorPtr,
        FuturePtr
    >;

    // Constructors
    Value() : value_(std::monostate{}) {}
    Value(std::nullptr_t) : value_(std::monostate{}) {}
    Value(bool b) : value_(b) {}
    Value(int32_t i) : value_(i) {}
    Value(float f) : value_(f) {}
    Value(double d) : value_(d) {}
    Value(char c) : value_(c) {}
    Value(const std::string& s) : value_(s) {}
    Value(std::string&& s) : value_(std::move(s)) {}
    Value(const char* s) : value_(std::string(s)) {}
    Value(const ObjectPtr& o) : value_(o) {}
    Value(const ArrayPtr& a) : value_(a) {}
    Value(const LambdaPtr& l) : value_(l) {}
    Value(const MapPtr& m) : value_(m) {}
    Value(const SetPtr& s) : value_(s) {}
    Value(const IntMapPtr& im) : value_(im) {}
    Value(const IntSetPtr& is) : value_(is) {}
    Value(const IteratorPtr& it) : value_(it) {}
    Value(const FuturePtr& f) : value_(f) {}

    // Copy/move
    Value(const Value&) = default;
    Value(Value&&) noexcept = default;
    Value& operator=(const Value&) = default;
    Value& operator=(Value&&) noexcept = default;

    // Type
    ValueType type() const {
        switch (value_.index()) {
            case 0: return ValueType::Null;
            case 1: return ValueType::Bool;
            case 2: return ValueType::Int;
            case 3: return ValueType::Float;
            case 4: return ValueType::Double;
            case 5: return ValueType::Char;
            case 6: return ValueType::String;
            case 7: return ValueType::Object;
            case 8: return ValueType::Array;
            case 9: return ValueType::Lambda;
            case 10: return ValueType::Map;
            case 11: return ValueType::Set;
            case 12: return ValueType::IntMap;
            case 13: return ValueType::IntSet;
            case 14: return ValueType::Iterator;
            case 15: return ValueType::Future;
            default: throw std::logic_error("Invalid Value variant index");
        }
    }

    // Type-safe accessors (throws std::bad_variant_access if wrong type)
    bool as_bool() const { return std::get<bool>(value_); }
    int32_t as_int() const { return std::get<int32_t>(value_); }
    float as_float() const { return std::get<float>(value_); }
    double as_double() const { return std::get<double>(value_); }
    char as_char() const { return std::get<char>(value_); }
    const std::string& as_string() const { return std::get<std::string>(value_); }
    const ObjectPtr& as_object() const { return std::get<ObjectPtr>(value_); }
    const ArrayPtr& as_array() const { return std::get<ArrayPtr>(value_); }
    const LambdaPtr& as_lambda() const { return std::get<LambdaPtr>(value_); }
    const MapPtr& as_map() const { return std::get<MapPtr>(value_); }
    const SetPtr& as_set() const { return std::get<SetPtr>(value_); }
    const IntMapPtr& as_int_map() const { return std::get<IntMapPtr>(value_); }
    const IntSetPtr& as_int_set() const { return std::get<IntSetPtr>(value_); }
    const IteratorPtr& as_iterator() const { return std::get<IteratorPtr>(value_); }
    const FuturePtr& as_future() const { return std::get<FuturePtr>(value_); }

    // Null check
    bool is_null() const { return std::holds_alternative<std::monostate>(value_); }

    // Convenience static constructors
    static Value make_null() { return Value(); }
    static Value make_bool(bool b) { return Value(b); }
    static Value make_int(int32_t i) { return Value(i); }
    static Value make_float(float f) { return Value(f); }
    static Value make_double(double d) { return Value(d); }
    static Value make_char(char c) { return Value(c); }
    static Value make_string(const std::string& s) { return Value(s); }
    static Value make_object(const ObjectPtr& o) { return Value(o); }
    static Value make_array(const ArrayPtr& a) { return Value(a); }
    static Value make_lambda(const LambdaPtr& l) { return Value(l); }
    static Value make_map(const MapPtr& m) { return Value(m); }
    static Value make_set(const SetPtr& s) { return Value(s); }
    static Value make_int_map(const IntMapPtr& im) { return Value(im); }
    static Value make_int_set(const IntSetPtr& is) { return Value(is); }
    static Value make_iterator(const IteratorPtr& it) { return Value(it); }
    static Value make_future(const FuturePtr& f) { return Value(f); }

    // Equality
    bool operator==(const Value& other) const { return value_ == other.value_; }
    bool operator!=(const Value& other) const { return !(*this == other); }

private:
    Storage value_;
};

// Example object base (expand as needed)
struct Object {
    std::vector<Value> fields;
    int class_idx = -1; // index in constant pool for class metadata (negative for externs without metadata)
    virtual ~Object() = default;
};

struct FunctionMetadata : public Object {
    int parameterCount() const {
        return fields[0].as_int();
    }

    int registerCount() const {
        return fields[1].as_int();
    }

    int codeIndex() const {
        return fields[2].as_int();
    }

    std::string name() const {
        return fields[3].as_string();
    }
};

struct ClassMetadata : public Object {
    const std::string& name() const {
        return fields[0].as_string();
    }

    int fieldCount() const {
        return fields[1].as_int();
    }

    int methodCount() const {
        return fields[2].as_int();
    }
};

// Forward declaration for StackFrame to avoid circular dependency
class StackFrame;

struct Lambda {
    int code_index;                    // Index into bytecode where lambda starts
    int parameter_count;               // Number of parameters lambda expects

    // Captured values copied from the enclosing scope
    std::vector<Value> captured_values;

    Lambda(int code_idx, int param_count)
        : code_index(code_idx), parameter_count(param_count) {}
};

// Implementation of ValueHash and ValueEqual functors
inline std::size_t ValueHash::operator()(const Value& v) const {
    switch (v.type()) {
        case ValueType::Null: return 0;
        case ValueType::Bool: return std::hash<bool>{}(v.as_bool());
        case ValueType::Int: return std::hash<int32_t>{}(v.as_int());
        case ValueType::Float: return std::hash<float>{}(v.as_float());
        case ValueType::Double: return std::hash<double>{}(v.as_double());
        case ValueType::Char: return std::hash<char>{}(v.as_char());
        case ValueType::String: return std::hash<std::string>{}(v.as_string());
        // Object/Array/Lambda/Map/Set: use pointer hash for identity-based hashing
        case ValueType::Object: return std::hash<const void*>{}(v.as_object().get());
        case ValueType::Array: return std::hash<const void*>{}(v.as_array().get());
        case ValueType::Lambda: return std::hash<const void*>{}(v.as_lambda().get());
        case ValueType::Map: return std::hash<const void*>{}(v.as_map().get());
        case ValueType::Set: return std::hash<const void*>{}(v.as_set().get());
        case ValueType::IntMap: return std::hash<const void*>{}(v.as_int_map().get());
        case ValueType::IntSet: return std::hash<const void*>{}(v.as_int_set().get());
        case ValueType::Future: return std::hash<const void*>{}(v.as_future().get());
        default: return 0;
    }
}

inline bool ValueEqual::operator()(const Value& a, const Value& b) const {
    return a == b; // Use existing Value equality
}
