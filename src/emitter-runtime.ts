/**
 * Runtime support library content generation.
 *
 * Produces the contents of `doof_runtime.hpp` — a single C++ header
 * providing foundational types and utilities for transpiled Doof code.
 */

// ============================================================================
// Public API
// ============================================================================

/**
 * Return the full contents of the doof_runtime.hpp header.
 */
export function generateRuntimeHeader(): string {
    return RUNTIME_HEADER
        .replace("__DOOF_JSON_SUPPORT__", JSON_RUNTIME_SUPPORT)
        .replace("__DOOF_JSON_TO_STRING_OVERLOAD__", JSON_TO_STRING_OVERLOAD);
}

// ============================================================================
// Header content
// ============================================================================

const RUNTIME_HEADER = `#pragma once

// doof_runtime.hpp — Runtime support for transpiled Doof code
// Generated — do not edit manually.

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <condition_variable>
#include <cmath>
#include <functional>
#include <future>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <limits>
#include <sstream>
#include <string>
#include <thread>
#include <tuple>
#include <type_traits>
#include <typeinfo>
#include <utility>
#include <unordered_map>
#include <variant>
#include <vector>

namespace doof {

// ============================================================================
// Panic — unrecoverable error
// ============================================================================

[[noreturn]] inline void panic(const std::string& msg) {
    std::cerr << "panic: " << msg << std::endl;
    std::abort();
}

[[noreturn]] inline void panic_at(const char* file, int32_t line, const std::string& msg) {
    panic(std::string(file) + ":" + std::to_string(line) + ": " + msg);
}

[[noreturn]] inline void unreachable() {
#if defined(_MSC_VER)
    __assume(false);
    std::abort();
#elif defined(__GNUC__) || defined(__clang__)
    __builtin_unreachable();
#else
    std::abort();
#endif
}

inline void assert_(bool condition, const std::string& message) {
    if (!condition) {
        panic("Assertion failed: " + message);
    }
}

inline void assert_at(const char* file, int32_t line, bool condition, const std::string& message) {
    if (!condition) {
        panic_at(file, line, "Assertion failed: " + message);
    }
}

[[noreturn]] inline void panic_ordered_collection_invariant(
    const char* collection,
    const char* context,
    const std::string& detail
) {
    std::ostringstream message;
    message << collection << " invariant failed";
    if (context && context[0] != '\\0') {
        message << " in " << context;
    }
    message << ": " << detail;
    panic(message.str());
}

// ============================================================================
// Ordered collections — insertion-order preserving Map/Set runtime types
// ============================================================================

template <typename K, typename V>
class ordered_map {
public:
    using value_type = std::pair<K, V>;
    using storage_type = std::vector<value_type>;
    using iterator = typename storage_type::iterator;
    using const_iterator = typename storage_type::const_iterator;
    using size_type = typename storage_type::size_type;

    ordered_map() = default;

    ordered_map(std::initializer_list<value_type> init) {
        for (const auto& entry : init) {
            insert_or_assign(entry.first, entry.second);
        }
        validate_invariants("ordered_map::initializer_list");
    }

    ordered_map(const ordered_map& other)
        : entries_(other.entries_) {
        rebuild_index();
        validate_invariants("ordered_map::copy_ctor");
    }

    ordered_map& operator=(const ordered_map& other) {
        if (this != &other) {
            entries_ = other.entries_;
            rebuild_index();
            validate_invariants("ordered_map::copy_assign");
        }
        return *this;
    }

    ordered_map(ordered_map&&) = default;
    ordered_map& operator=(ordered_map&&) = default;

    iterator begin() {
        validate_invariants("ordered_map::begin");
        return entries_.begin();
    }
    iterator end() {
        validate_invariants("ordered_map::end");
        return entries_.end();
    }
    const_iterator begin() const {
        validate_invariants("ordered_map::begin const");
        return entries_.begin();
    }
    const_iterator end() const {
        validate_invariants("ordered_map::end const");
        return entries_.end();
    }
    const_iterator cbegin() const {
        validate_invariants("ordered_map::cbegin");
        return entries_.cbegin();
    }
    const_iterator cend() const {
        validate_invariants("ordered_map::cend");
        return entries_.cend();
    }

    [[nodiscard]] bool empty() const { return entries_.empty(); }
    [[nodiscard]] size_type size() const { return entries_.size(); }

    iterator find(const K& key) {
        validate_invariants("ordered_map::find");
        const auto pos = index_.find(key);
        if (pos == index_.end()) {
            return entries_.end();
        }
        return entries_.begin() + static_cast<typename storage_type::difference_type>(pos->second);
    }

    const_iterator find(const K& key) const {
        validate_invariants("ordered_map::find const");
        const auto pos = index_.find(key);
        if (pos == index_.end()) {
            return entries_.end();
        }
        return entries_.begin() + static_cast<typename storage_type::difference_type>(pos->second);
    }

    [[nodiscard]] size_type count(const K& key) const {
        validate_invariants("ordered_map::count");
        return index_.count(key);
    }

    V& operator[](const K& key) {
        validate_invariants("ordered_map::operator[] pre");
        const auto pos = index_.find(key);
        if (pos != index_.end()) {
            return entries_[pos->second].second;
        }

        index_[key] = entries_.size();
        entries_.push_back(value_type{key, V{}});
        validate_invariants("ordered_map::operator[] post");
        return entries_.back().second;
    }

    void insert_or_assign(const K& key, const V& value) {
        validate_invariants("ordered_map::insert_or_assign pre");
        const auto pos = index_.find(key);
        if (pos != index_.end()) {
            entries_[pos->second].second = value;
            validate_invariants("ordered_map::insert_or_assign update");
            return;
        }

        index_[key] = entries_.size();
        entries_.push_back(value_type{key, value});
        validate_invariants("ordered_map::insert_or_assign insert");
    }

    size_type erase(const K& key) {
        validate_invariants("ordered_map::erase pre");
        const auto pos = index_.find(key);
        if (pos == index_.end()) {
            return 0;
        }

        const auto index = pos->second;
        index_.erase(pos);
        entries_.erase(entries_.begin() + static_cast<typename storage_type::difference_type>(index));
        for (size_type current = index; current < entries_.size(); ++current) {
            index_[entries_[current].first] = current;
        }
        validate_invariants("ordered_map::erase post");
        return 1;
    }

    void validate_invariants(const char* context = "ordered_map") const {
#if defined(DOOF_RUNTIME_VALIDATE_ORDERED_COLLECTIONS)
        if (index_.size() != entries_.size()) {
            panic_ordered_collection_invariant("ordered_map", context, "index size does not match entry count");
        }
        for (size_type index = 0; index < entries_.size(); ++index) {
            const auto pos = index_.find(entries_[index].first);
            if (pos == index_.end()) {
                panic_ordered_collection_invariant("ordered_map", context, "entry key missing from index");
            }
            if (pos->second != index) {
                panic_ordered_collection_invariant("ordered_map", context, "entry key mapped to stale position");
            }
        }
        for (const auto& [key, index] : index_) {
            if (index >= entries_.size()) {
                panic_ordered_collection_invariant("ordered_map", context, "index points past end of entries");
            }
            if (!(entries_[index].first == key)) {
                panic_ordered_collection_invariant("ordered_map", context, "index points at mismatched entry key");
            }
        }
#else
        (void)context;
#endif
    }

private:
    void rebuild_index() {
        index_.clear();
        for (size_type index = 0; index < entries_.size(); ++index) {
            index_[entries_[index].first] = index;
        }
    }

    storage_type entries_;
    std::unordered_map<K, size_type> index_;
};

template <typename K, typename V>
ordered_map(std::initializer_list<std::pair<K, V>>) -> ordered_map<K, V>;

template <typename T>
class ordered_set {
public:
    using value_type = T;
    using storage_type = std::vector<T>;
    using iterator = typename storage_type::iterator;
    using const_iterator = typename storage_type::const_iterator;
    using size_type = typename storage_type::size_type;

    ordered_set() = default;

    ordered_set(std::initializer_list<T> init) {
        for (const auto& value : init) {
            insert(value);
        }
        validate_invariants("ordered_set::initializer_list");
    }

    ordered_set(const ordered_set& other)
        : values_(other.values_) {
        rebuild_index();
        validate_invariants("ordered_set::copy_ctor");
    }

    ordered_set& operator=(const ordered_set& other) {
        if (this != &other) {
            values_ = other.values_;
            rebuild_index();
            validate_invariants("ordered_set::copy_assign");
        }
        return *this;
    }

    ordered_set(ordered_set&&) = default;
    ordered_set& operator=(ordered_set&&) = default;

    iterator begin() {
        validate_invariants("ordered_set::begin");
        return values_.begin();
    }
    iterator end() {
        validate_invariants("ordered_set::end");
        return values_.end();
    }
    const_iterator begin() const {
        validate_invariants("ordered_set::begin const");
        return values_.begin();
    }
    const_iterator end() const {
        validate_invariants("ordered_set::end const");
        return values_.end();
    }
    const_iterator cbegin() const {
        validate_invariants("ordered_set::cbegin");
        return values_.cbegin();
    }
    const_iterator cend() const {
        validate_invariants("ordered_set::cend");
        return values_.cend();
    }

    [[nodiscard]] bool empty() const { return values_.empty(); }
    [[nodiscard]] size_type size() const { return values_.size(); }

    iterator find(const T& value) {
        validate_invariants("ordered_set::find");
        const auto pos = index_.find(value);
        if (pos == index_.end()) {
            return values_.end();
        }
        return values_.begin() + static_cast<typename storage_type::difference_type>(pos->second);
    }

    const_iterator find(const T& value) const {
        validate_invariants("ordered_set::find const");
        const auto pos = index_.find(value);
        if (pos == index_.end()) {
            return values_.end();
        }
        return values_.begin() + static_cast<typename storage_type::difference_type>(pos->second);
    }

    [[nodiscard]] size_type count(const T& value) const {
        validate_invariants("ordered_set::count");
        return index_.count(value);
    }

    bool insert(const T& value) {
        validate_invariants("ordered_set::insert pre");
        if (index_.count(value) > 0) {
            return false;
        }

        index_[value] = values_.size();
        values_.push_back(value);
        validate_invariants("ordered_set::insert post");
        return true;
    }

    size_type erase(const T& value) {
        validate_invariants("ordered_set::erase pre");
        const auto pos = index_.find(value);
        if (pos == index_.end()) {
            return 0;
        }

        const auto index = pos->second;
        index_.erase(pos);
        values_.erase(values_.begin() + static_cast<typename storage_type::difference_type>(index));
        for (size_type current = index; current < values_.size(); ++current) {
            index_[values_[current]] = current;
        }
        validate_invariants("ordered_set::erase post");
        return 1;
    }

    void validate_invariants(const char* context = "ordered_set") const {
#if defined(DOOF_RUNTIME_VALIDATE_ORDERED_COLLECTIONS)
        if (index_.size() != values_.size()) {
            panic_ordered_collection_invariant("ordered_set", context, "index size does not match value count");
        }
        for (size_type index = 0; index < values_.size(); ++index) {
            const auto pos = index_.find(values_[index]);
            if (pos == index_.end()) {
                panic_ordered_collection_invariant("ordered_set", context, "value missing from index");
            }
            if (pos->second != index) {
                panic_ordered_collection_invariant("ordered_set", context, "value mapped to stale position");
            }
        }
        for (const auto& [value, index] : index_) {
            if (index >= values_.size()) {
                panic_ordered_collection_invariant("ordered_set", context, "index points past end of values");
            }
            if (!(values_[index] == value)) {
                panic_ordered_collection_invariant("ordered_set", context, "index points at mismatched value");
            }
        }
#else
        (void)context;
#endif
    }

private:
    void rebuild_index() {
        index_.clear();
        for (size_type index = 0; index < values_.size(); ++index) {
            index_[values_[index]] = index;
        }
    }

    storage_type values_;
    std::unordered_map<T, size_type> index_;
};

template <typename T>
ordered_set(std::initializer_list<T>) -> ordered_set<T>;

// ============================================================================
// Result<T, E> — variant-based error handling
// ============================================================================

template <typename T, typename E>
struct Result {
    std::variant<T, E> _data;

    bool isSuccess() const { return _data.index() == 0; }
    bool isFailure() const { return _data.index() == 1; }

    T& value() { return std::get<0>(_data); }
    const T& value() const { return std::get<0>(_data); }

    E& error() { return std::get<1>(_data); }
    const E& error() const { return std::get<1>(_data); }

    static Result success(T val) { return Result{std::variant<T, E>{std::in_place_index<0>, std::move(val)}}; }
    static Result failure(E err) { return Result{std::variant<T, E>{std::in_place_index<1>, std::move(err)}}; }
};

template <typename E>
struct Result<void, E> {
    std::variant<std::monostate, E> _data;

    bool isSuccess() const { return _data.index() == 0; }
    bool isFailure() const { return _data.index() == 1; }

    void value() const { (void)std::get<0>(_data); }

    E& error() { return std::get<1>(_data); }
    const E& error() const { return std::get<1>(_data); }

    static Result success() { return Result{std::variant<std::monostate, E>{std::in_place_index<0>, std::monostate{}}}; }
    static Result failure(E err) { return Result{std::variant<std::monostate, E>{std::in_place_index<1>, std::move(err)}}; }
};

template <typename Target, typename Source>
inline std::optional<Target> checked_numeric_as(Source value) {
    static_assert(std::is_arithmetic_v<Target>, "checked_numeric_as target must be numeric");
    static_assert(std::is_arithmetic_v<Source>, "checked_numeric_as source must be numeric");

    if constexpr (std::is_same_v<Target, Source>) {
        return value;
    } else if constexpr (std::is_integral_v<Source> && std::is_integral_v<Target>) {
        if constexpr (std::is_signed_v<Source> == std::is_signed_v<Target>) {
            if constexpr (std::numeric_limits<Target>::digits >= std::numeric_limits<Source>::digits) {
                return static_cast<Target>(value);
            } else {
                if (value < static_cast<Source>(std::numeric_limits<Target>::lowest())
                    || value > static_cast<Source>(std::numeric_limits<Target>::max())) {
                    return std::nullopt;
                }
            }
        } else if constexpr (std::is_signed_v<Source>) {
            if (value < 0) return std::nullopt;
            using UnsignedSource = std::make_unsigned_t<Source>;
            if (static_cast<UnsignedSource>(value) > std::numeric_limits<Target>::max()) {
                return std::nullopt;
            }
        } else {
            using UnsignedTarget = std::make_unsigned_t<Target>;
            if (value > static_cast<UnsignedTarget>(std::numeric_limits<Target>::max())) {
                return std::nullopt;
            }
        }
        return static_cast<Target>(value);
    } else if constexpr (std::is_floating_point_v<Source> && std::is_integral_v<Target>) {
        if (!std::isfinite(value) || std::trunc(value) != value) return std::nullopt;
        if (value < static_cast<Source>(std::numeric_limits<Target>::lowest())
            || value > static_cast<Source>(std::numeric_limits<Target>::max())) {
            return std::nullopt;
        }
        return static_cast<Target>(value);
    } else if constexpr (std::is_integral_v<Source> && std::is_floating_point_v<Target>) {
        const auto narrowed = static_cast<Target>(value);
        if (!std::isfinite(narrowed)) return std::nullopt;
        if (static_cast<Source>(narrowed) != value) return std::nullopt;
        return narrowed;
    } else {
        if constexpr (sizeof(Target) >= sizeof(Source)) {
            return static_cast<Target>(value);
        }

        const auto narrowed = static_cast<Target>(value);
        if (std::isnan(value)) {
            return std::isnan(narrowed) ? std::optional<Target>(narrowed) : std::nullopt;
        }
        if (!std::isfinite(value)) {
            return (std::isinf(narrowed) && ((value > 0) == (narrowed > 0)))
                ? std::optional<Target>(narrowed)
                : std::nullopt;
        }
        if (static_cast<Source>(narrowed) != value) return std::nullopt;
        return narrowed;
    }
}

// ============================================================================
// ParseError — builtin parse failure classification
// ============================================================================

enum class ParseError {
    InvalidFormat,
    Overflow,
    Underflow,
    EmptyInput,
};

inline const char* ParseError_name(ParseError value) {
    switch (value) {
        case ParseError::InvalidFormat: return "InvalidFormat";
        case ParseError::Overflow: return "Overflow";
        case ParseError::Underflow: return "Underflow";
        case ParseError::EmptyInput: return "EmptyInput";
        default: return "InvalidFormat";
    }
}

inline std::optional<ParseError> ParseError_fromName(std::string_view value) {
    if (value == "InvalidFormat") return ParseError::InvalidFormat;
    if (value == "Overflow") return ParseError::Overflow;
    if (value == "Underflow") return ParseError::Underflow;
    if (value == "EmptyInput") return ParseError::EmptyInput;
    return std::nullopt;
}

inline std::optional<ParseError> ParseError_fromValue(int32_t value) {
    switch (static_cast<ParseError>(value)) {
        case ParseError::InvalidFormat: return ParseError::InvalidFormat;
        case ParseError::Overflow: return ParseError::Overflow;
        case ParseError::Underflow: return ParseError::Underflow;
        case ParseError::EmptyInput: return ParseError::EmptyInput;
        default: return std::nullopt;
    }
}

// ============================================================================
// JsonValue — first-class JSON runtime value
// ============================================================================

struct JsonValue;

using JsonArray = std::shared_ptr<std::vector<JsonValue>>;
using JsonObject = std::shared_ptr<ordered_map<std::string, JsonValue>>;
using JsonStorage = std::variant<std::monostate, bool, int32_t, int64_t, float, double, std::string, JsonArray, JsonObject>;

struct JsonValue : JsonStorage {
    using JsonStorage::JsonStorage;

    JsonValue() : JsonStorage(std::monostate{}) {}
    JsonValue(std::nullptr_t) : JsonStorage(std::monostate{}) {}
    JsonValue(const char* v) : JsonStorage(std::string(v)) {}
};

template <typename T>
inline JsonValue json_value(T&& value) {
    return JsonValue(std::forward<T>(value));
}

inline const JsonStorage& json_storage(const JsonValue& value) {
    return static_cast<const JsonStorage&>(value);
}

inline JsonStorage& json_storage(JsonValue& value) {
    return static_cast<JsonStorage&>(value);
}

inline bool json_is_null(const JsonValue& value) {
    return std::holds_alternative<std::monostate>(json_storage(value));
}

inline bool json_is_boolean(const JsonValue& value) {
    return std::holds_alternative<bool>(json_storage(value));
}

inline bool json_is_number(const JsonValue& value) {
    return std::holds_alternative<int32_t>(json_storage(value))
        || std::holds_alternative<int64_t>(json_storage(value))
        || std::holds_alternative<float>(json_storage(value))
        || std::holds_alternative<double>(json_storage(value));
}

inline bool json_is_string(const JsonValue& value) {
    return std::holds_alternative<std::string>(json_storage(value));
}

inline bool json_is_array(const JsonValue& value) {
    return std::holds_alternative<JsonArray>(json_storage(value));
}

inline bool json_is_object(const JsonValue& value) {
    return std::holds_alternative<JsonObject>(json_storage(value));
}

inline const char* json_type_name(const JsonValue& value) {
    if (json_is_null(value)) return "null";
    if (json_is_boolean(value)) return "boolean";
    if (json_is_number(value)) return "number";
    if (json_is_string(value)) return "string";
    if (json_is_array(value)) return "array";
    if (json_is_object(value)) return "object";
    return "unknown";
}

inline const JsonArray::element_type* json_as_array(const JsonValue& value) {
    const auto* array = std::get_if<JsonArray>(&json_storage(value));
    if (array == nullptr || !*array) return nullptr;
    return array->get();
}

inline const JsonObject::element_type* json_as_object(const JsonValue& value) {
    const auto* object = std::get_if<JsonObject>(&json_storage(value));
    if (object == nullptr || !*object) return nullptr;
    return object->get();
}

inline JsonValue json_error(int32_t code, std::string message) {
    auto object = std::make_shared<ordered_map<std::string, JsonValue>>();
    (*object)["code"] = json_value(code);
    (*object)["message"] = json_value(std::move(message));
    return json_value(std::move(object));
}

inline bool json_as_bool(const JsonValue& value) {
    const auto* result = std::get_if<bool>(&json_storage(value));
    if (result == nullptr) panic("Expected JSON boolean");
    return *result;
}

inline int32_t json_as_int(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return *result;
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return static_cast<int32_t>(*result);
    if (const auto* result = std::get_if<float>(&json_storage(value))) return static_cast<int32_t>(*result);
    if (const auto* result = std::get_if<double>(&json_storage(value))) return static_cast<int32_t>(*result);
    panic("Expected JSON number");
}

inline int64_t json_as_long(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return *result;
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return *result;
    if (const auto* result = std::get_if<float>(&json_storage(value))) return static_cast<int64_t>(*result);
    if (const auto* result = std::get_if<double>(&json_storage(value))) return static_cast<int64_t>(*result);
    panic("Expected JSON number");
}

inline float json_as_float(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return static_cast<float>(*result);
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return static_cast<float>(*result);
    if (const auto* result = std::get_if<float>(&json_storage(value))) return *result;
    if (const auto* result = std::get_if<double>(&json_storage(value))) return static_cast<float>(*result);
    panic("Expected JSON number");
}

inline double json_as_double(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return static_cast<double>(*result);
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return static_cast<double>(*result);
    if (const auto* result = std::get_if<float>(&json_storage(value))) return static_cast<double>(*result);
    if (const auto* result = std::get_if<double>(&json_storage(value))) return *result;
    panic("Expected JSON number");
}

inline const std::string& json_as_string(const JsonValue& value) {
    const auto* result = std::get_if<std::string>(&json_storage(value));
    if (result == nullptr) panic("Expected JSON string");
    return *result;
}

inline bool json_is_lenient_boolean(const JsonValue& value) {
    if (json_is_boolean(value) || json_is_number(value)) return true;
    if (!json_is_string(value)) return false;
    std::string lowered = json_as_string(value);
    std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return lowered == "true" || lowered == "false" || lowered == "1" || lowered == "0";
}

inline bool json_is_lenient_number(const JsonValue& value) {
    return json_is_number(value) || json_is_boolean(value);
}

inline bool json_is_lenient_string(const JsonValue& value) {
    return json_is_null(value) || json_is_string(value) || json_is_boolean(value) || json_is_number(value);
}

inline bool json_as_bool_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value);
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return *result != 0;
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return *result != 0;
    if (const auto* result = std::get_if<float>(&json_storage(value))) return *result != 0.0f;
    if (const auto* result = std::get_if<double>(&json_storage(value))) return *result != 0.0;
    if (json_is_string(value)) {
        std::string lowered = json_as_string(value);
        std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (lowered == "true" || lowered == "1") return true;
        if (lowered == "false" || lowered == "0") return false;
    }
    panic("Expected lenient JSON boolean");
}

inline int32_t json_as_int_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value) ? 1 : 0;
    return json_as_int(value);
}

inline int64_t json_as_long_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value) ? 1 : 0;
    return json_as_long(value);
}

inline float json_as_float_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value) ? 1.0f : 0.0f;
    return json_as_float(value);
}

inline double json_as_double_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value) ? 1.0 : 0.0;
    return json_as_double(value);
}

inline std::string json_as_string_lenient(const JsonValue& value) {
    if (json_is_null(value)) return std::string();
    if (json_is_string(value)) return json_as_string(value);
    if (json_is_boolean(value)) return json_as_bool(value) ? "true" : "false";
    if (const auto* result = std::get_if<int32_t>(&json_storage(value))) return std::to_string(*result);
    if (const auto* result = std::get_if<int64_t>(&json_storage(value))) return std::to_string(*result);
    if (const auto* result = std::get_if<float>(&json_storage(value))) {
        std::ostringstream oss;
        oss << *result;
        return oss.str();
    }
    if (const auto* result = std::get_if<double>(&json_storage(value))) {
        std::ostringstream oss;
        oss << *result;
        return oss.str();
    }
    panic("Expected lenient JSON string");
}

__DOOF_JSON_SUPPORT__

// ============================================================================
// String utilities
// ============================================================================

// Convert any streamable value to string
template <typename T>
inline std::string to_string(const T& val) {
    if constexpr (std::is_same_v<T, std::string>) {
        return val;
    } else if constexpr (std::is_same_v<T, const char*>) {
        return std::string(val);
    } else if constexpr (std::is_same_v<T, bool>) {
        return val ? "true" : "false";
    } else if constexpr (std::is_same_v<T, uint8_t>) {
        return std::to_string(static_cast<uint32_t>(val));
    } else if constexpr (std::is_same_v<T, char32_t>) {
        // Simple ASCII conversion for now
        std::string result;
        result += static_cast<char>(val);
        return result;
    } else {
        std::ostringstream oss;
        oss << val;
        return oss.str();
    }
}

template <typename T>
inline std::string to_string(const std::shared_ptr<std::vector<T>>& val) {
    if (!val) return "null";
    std::string result = "[";
    for (size_t i = 0; i < val->size(); ++i) {
        if (i > 0) result += ", ";
        result += to_string((*val)[i]);
    }
    result += "]";
    return result;
}

template <typename K, typename V>
inline std::string to_string(const std::shared_ptr<ordered_map<K, V>>& val) {
    if (!val) return "null";
    std::string result = "{";
    bool first = true;
    for (const auto& entry : *val) {
        if (!first) result += ", ";
        first = false;
        result += to_string(entry.first) + ": " + to_string(entry.second);
    }
    result += "}";
    return result;
}

template <typename T>
inline std::string to_string(const std::shared_ptr<ordered_set<T>>& val) {
    if (!val) return "null";
    std::string result = "{";
    bool first = true;
    for (const auto& item : *val) {
        if (!first) result += ", ";
        first = false;
        result += to_string(item);
    }
    result += "}";
    return result;
}

template <typename... Ts, std::size_t... Is>
inline std::string tuple_to_string_impl(const std::tuple<Ts...>& val, std::index_sequence<Is...>) {
    std::string result = "(";
    ((result += (Is == 0 ? "" : ", ") + to_string(std::get<Is>(val))), ...);
    result += ")";
    return result;
}

template <typename... Ts>
inline std::string to_string(const std::tuple<Ts...>& val) {
    return tuple_to_string_impl(val, std::index_sequence_for<Ts...>{});
}

template <typename T, typename E>
inline std::string to_string(const Result<T, E>& val) {
    if (val.isSuccess()) {
        return "Success(" + to_string(val.value()) + ")";
    }
    return "Failure(" + to_string(val.error()) + ")";
}

template <typename E>
inline std::string to_string(const Result<void, E>& val) {
    if (val.isSuccess()) {
        return "Success()";
    }
    return "Failure(" + to_string(val.error()) + ")";
}

template <typename T>
inline std::string to_string(const std::optional<T>& val) {
    return val.has_value() ? to_string(*val) : std::string("null");
}

inline std::string to_string(std::monostate) {
    return "null";
}

template <typename... Ts>
inline std::string to_string(const std::variant<Ts...>& val) {
    return std::visit([](const auto& inner) -> std::string {
        using Inner = std::decay_t<decltype(inner)>;
        if constexpr (std::is_same_v<Inner, std::monostate>) {
            return std::string("null");
        }
        return to_string(inner);
    }, val);
}

inline std::string to_string(ParseError val) {
    return ParseError_name(val);
}

__DOOF_JSON_TO_STRING_OVERLOAD__

// Variadic string concatenation for string interpolation
inline std::string concat() { return ""; }

template <typename T>
inline std::string concat(const T& val) {
    return to_string(val);
}

template <typename T, typename... Args>
inline std::string concat(const T& first, const Args&... rest) {
    return to_string(first) + concat(rest...);
}

inline bool string_has_outer_whitespace(const std::string& s) {
    if (s.empty()) return false;
    const auto first = static_cast<unsigned char>(s.front());
    const auto last = static_cast<unsigned char>(s.back());
    return std::isspace(first) || std::isspace(last);
}

inline Result<int32_t, ParseError> parse_int(const std::string& s) {
    if (s.empty()) return Result<int32_t, ParseError>::failure(ParseError::EmptyInput);
    if (string_has_outer_whitespace(s)) return Result<int32_t, ParseError>::failure(ParseError::InvalidFormat);

    errno = 0;
    char* end = nullptr;
    const long long value = std::strtoll(s.c_str(), &end, 10);
    if (end == s.c_str() || (end != nullptr && *end != 0)) {
        return Result<int32_t, ParseError>::failure(ParseError::InvalidFormat);
    }
    if (errno == ERANGE || value > std::numeric_limits<int32_t>::max()) {
        return Result<int32_t, ParseError>::failure(ParseError::Overflow);
    }
    if (errno == ERANGE || value < std::numeric_limits<int32_t>::min()) {
        return Result<int32_t, ParseError>::failure(ParseError::Underflow);
    }
    return Result<int32_t, ParseError>::success(static_cast<int32_t>(value));
}

inline Result<uint8_t, ParseError> parse_byte(const std::string& s) {
    const auto parsed = parse_int(s);
    if (parsed.isFailure()) {
        return Result<uint8_t, ParseError>::failure(parsed.error());
    }

    const int32_t value = parsed.value();
    if (value < 0) {
        return Result<uint8_t, ParseError>::failure(ParseError::Underflow);
    }
    if (value > 255) {
        return Result<uint8_t, ParseError>::failure(ParseError::Overflow);
    }

    return Result<uint8_t, ParseError>::success(static_cast<uint8_t>(value));
}

inline Result<int64_t, ParseError> parse_long(const std::string& s) {
    if (s.empty()) return Result<int64_t, ParseError>::failure(ParseError::EmptyInput);
    if (string_has_outer_whitespace(s)) return Result<int64_t, ParseError>::failure(ParseError::InvalidFormat);

    errno = 0;
    char* end = nullptr;
    const long long value = std::strtoll(s.c_str(), &end, 10);
    if (end == s.c_str() || (end != nullptr && *end != 0)) {
        return Result<int64_t, ParseError>::failure(ParseError::InvalidFormat);
    }
    if (errno == ERANGE) {
        return Result<int64_t, ParseError>::failure(value < 0 ? ParseError::Underflow : ParseError::Overflow);
    }
    return Result<int64_t, ParseError>::success(static_cast<int64_t>(value));
}

inline Result<float, ParseError> parse_float(const std::string& s) {
    if (s.empty()) return Result<float, ParseError>::failure(ParseError::EmptyInput);
    if (string_has_outer_whitespace(s)) return Result<float, ParseError>::failure(ParseError::InvalidFormat);

    errno = 0;
    char* end = nullptr;
    const float value = std::strtof(s.c_str(), &end);
    if (end == s.c_str() || (end != nullptr && *end != 0)) {
        return Result<float, ParseError>::failure(ParseError::InvalidFormat);
    }
    if (errno == ERANGE) {
        return Result<float, ParseError>::failure(value == 0.0f ? ParseError::Underflow : ParseError::Overflow);
    }
    return Result<float, ParseError>::success(value);
}

inline Result<double, ParseError> parse_double(const std::string& s) {
    if (s.empty()) return Result<double, ParseError>::failure(ParseError::EmptyInput);
    if (string_has_outer_whitespace(s)) return Result<double, ParseError>::failure(ParseError::InvalidFormat);

    errno = 0;
    char* end = nullptr;
    const double value = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || (end != nullptr && *end != 0)) {
        return Result<double, ParseError>::failure(ParseError::InvalidFormat);
    }
    if (errno == ERANGE) {
        return Result<double, ParseError>::failure(value == 0.0 ? ParseError::Underflow : ParseError::Overflow);
    }
    return Result<double, ParseError>::success(value);
}

// ============================================================================
// String methods
// ============================================================================

inline int32_t string_indexOf(const std::string& s, const std::string& search) {
    auto pos = s.find(search);
    return pos == std::string::npos ? -1 : static_cast<int32_t>(pos);
}

inline bool string_contains(const std::string& s, const std::string& search) {
    return s.find(search) != std::string::npos;
}

inline bool string_startsWith(const std::string& s, const std::string& prefix) {
    return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

inline bool string_endsWith(const std::string& s, const std::string& suffix) {
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

inline std::string string_substring(const std::string& s, int32_t start, int32_t end) {
    if (start < 0) start = 0;
    if (end > static_cast<int32_t>(s.size())) end = static_cast<int32_t>(s.size());
    if (start >= end) return "";
    return s.substr(static_cast<size_t>(start), static_cast<size_t>(end - start));
}

inline std::string string_slice(const std::string& s, int32_t start) {
    if (start < 0) start = 0;
    if (start >= static_cast<int32_t>(s.size())) return "";
    return s.substr(static_cast<size_t>(start));
}

inline std::string string_padStart(const std::string& s, int32_t length, char fill) {
    if (length <= static_cast<int32_t>(s.size())) return s;
    return std::string(static_cast<size_t>(length - static_cast<int32_t>(s.size())), fill) + s;
}

inline std::string string_trim(const std::string& s) {
    auto start = s.find_first_not_of(" \\t\\n\\r\\f\\v");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \\t\\n\\r\\f\\v");
    return s.substr(start, end - start + 1);
}

inline std::string string_trimStart(const std::string& s) {
    auto start = s.find_first_not_of(" \\t\\n\\r\\f\\v");
    if (start == std::string::npos) return "";
    return s.substr(start);
}

inline std::string string_trimEnd(const std::string& s) {
    auto end = s.find_last_not_of(" \\t\\n\\r\\f\\v");
    if (end == std::string::npos) return "";
    return s.substr(0, end + 1);
}

inline std::string string_trimEnd(const std::string& s, char fill) {
    auto end = s.find_last_not_of(fill);
    if (end == std::string::npos) return "";
    return s.substr(0, end + 1);
}

inline std::string string_toUpperCase(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::toupper(c); });
    return result;
}

inline std::string string_toLowerCase(const std::string& s) {
    std::string result = s;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return result;
}

inline std::string string_replace(const std::string& s, const std::string& search, const std::string& replacement) {
    if (search.empty()) return s;
    auto pos = s.find(search);
    if (pos == std::string::npos) return s;
    std::string result = s;
    result.replace(pos, search.size(), replacement);
    return result;
}

inline std::string string_replaceAll(const std::string& s, const std::string& search, const std::string& replacement) {
    if (search.empty()) return s;
    std::string result = s;
    size_t pos = 0;
    while ((pos = result.find(search, pos)) != std::string::npos) {
        result.replace(pos, search.size(), replacement);
        pos += replacement.size();
    }
    return result;
}

inline std::shared_ptr<std::vector<std::string>> string_split(const std::string& s, const std::string& delimiter) {
    auto result = std::make_shared<std::vector<std::string>>();
    if (delimiter.empty()) {
        for (char c : s) result->push_back(std::string(1, c));
        return result;
    }
    size_t start = 0;
    size_t pos;
    while ((pos = s.find(delimiter, start)) != std::string::npos) {
        result->push_back(s.substr(start, pos - start));
        start = pos + delimiter.size();
    }
    result->push_back(s.substr(start));
    return result;
}

inline std::string string_charAt(const std::string& s, int32_t index) {
    if (index < 0 || index >= static_cast<int32_t>(s.size())) return "";
    return std::string(1, s[static_cast<size_t>(index)]);
}

inline std::string string_repeat(const std::string& s, int32_t count) {
    if (count <= 0) return "";
    std::string result;
    result.reserve(s.size() * static_cast<size_t>(count));
    for (int32_t i = 0; i < count; ++i) result += s;
    return result;
}

// ============================================================================
// Collection helpers
// ============================================================================

// Wrap a value in a shared_ptr (used for collection literals with CTAD)
template <typename T>
std::shared_ptr<std::decay_t<T>> share(T&& val) {
    return std::make_shared<std::decay_t<T>>(std::forward<T>(val));
}

template <typename T>
T& array_at(const std::shared_ptr<std::vector<T>>& arr, int32_t index, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to index null array");
    }
    if (index < 0 || index >= static_cast<int32_t>(arr->size())) {
        panic_at(file, line, "Index out of bounds: " + to_string(index));
    }
    return (*arr)[static_cast<size_t>(index)];
}

template <typename T>
void array_require_min_size(const std::shared_ptr<std::vector<T>>& arr, int32_t count, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to destructure null array");
    }
    const auto size = static_cast<int32_t>(arr->size());
    if (size < count) {
        panic_at(file, line, "Array destructuring expected at least " + to_string(count) + " elements, got " + to_string(size));
    }
}

template <typename T>
Result<T, std::string> array_pop(const std::shared_ptr<std::vector<T>>& arr) {
    if (!arr) {
        return Result<T, std::string>::failure("Attempted to pop from null array");
    }
    if (arr->empty()) {
        return Result<T, std::string>::failure("Attempted to pop from empty array");
    }
    T value = arr->back();
    arr->pop_back();
    return Result<T, std::string>::success(std::move(value));
}

template <typename T>
bool array_contains(const std::shared_ptr<std::vector<T>>& arr, const T& element, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to search null array");
    }
    return std::find(arr->begin(), arr->end(), element) != arr->end();
}

template <typename T>
int32_t array_indexOf(const std::shared_ptr<std::vector<T>>& arr, const T& element, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to search null array");
    }
    const auto size = static_cast<int32_t>(arr->size());
    for (int32_t i = 0; i < size; i++) {
        if ((*arr)[static_cast<size_t>(i)] == element) {
            return i;
        }
    }
    return -1;
}

template <typename T, typename Predicate>
bool array_some(const std::shared_ptr<std::vector<T>>& arr, const Predicate& predicate, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to iterate null array in some()");
    }
    for (const auto& item : *arr) {
        if (std::invoke(predicate, item)) {
            return true;
        }
    }
    return false;
}

template <typename T, typename Predicate>
bool array_every(const std::shared_ptr<std::vector<T>>& arr, const Predicate& predicate, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to iterate null array in every()");
    }
    for (const auto& item : *arr) {
        if (!std::invoke(predicate, item)) {
            return false;
        }
    }
    return true;
}

template <typename T, typename Predicate>
std::shared_ptr<std::vector<T>> array_filter(const std::shared_ptr<std::vector<T>>& arr, const Predicate& predicate, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to iterate null array in filter()");
    }
    auto result = std::make_shared<std::vector<T>>();
    result->reserve(arr->size());
    for (const auto& item : *arr) {
        if (std::invoke(predicate, item)) {
            result->push_back(item);
        }
    }
    return result;
}

template <typename T, typename Mapper>
auto array_map(const std::shared_ptr<std::vector<T>>& arr, const Mapper& mapper, const char* file, int32_t line)
    -> std::shared_ptr<std::vector<std::decay_t<decltype(std::invoke(mapper, std::declval<const T&>()))>>> {
    if (!arr) {
        panic_at(file, line, "Attempted to iterate null array in map()");
    }
    using U = std::decay_t<decltype(std::invoke(mapper, std::declval<const T&>()))>;
    auto result = std::make_shared<std::vector<U>>();
    result->reserve(arr->size());
    for (const auto& item : *arr) {
        result->push_back(std::invoke(mapper, item));
    }
    return result;
}

template <typename T>
std::shared_ptr<std::vector<T>> array_slice(const std::shared_ptr<std::vector<T>>& arr, int32_t start, int32_t end, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to slice null array");
    }

    const int32_t size = static_cast<int32_t>(arr->size());
    if (start < 0) start = 0;
    if (end < 0) end = 0;
    if (start > size) start = size;
    if (end > size) end = size;
    if (start >= end) {
        return std::make_shared<std::vector<T>>();
    }

    using Diff = typename std::vector<T>::difference_type;
    return std::make_shared<std::vector<T>>(
        arr->begin() + static_cast<Diff>(start),
        arr->begin() + static_cast<Diff>(end)
    );
}

template <typename T>
std::shared_ptr<std::vector<T>> array_buildReadonly(const std::shared_ptr<std::vector<T>>& arr, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to buildReadonly from null array");
    }
    // Move-drain: transfer contents to a new allocation; original vector is left empty.
    auto result = std::make_shared<std::vector<T>>(std::move(*arr));
    return result;
}

template <typename T>
std::shared_ptr<std::vector<T>> array_cloneMutable(const std::shared_ptr<std::vector<T>>& arr, const char* file, int32_t line) {
    if (!arr) {
        panic_at(file, line, "Attempted to cloneMutable from null array");
    }
    return std::make_shared<std::vector<T>>(*arr);
}

// Map helpers — bridge Doof's Map methods to ordered_map
template <typename K, typename V>
doof::Result<V, std::string> map_get(const std::shared_ptr<ordered_map<K, V>>& m, const K& key, const char* file, int32_t line) {
    if (!m) {
        panic_at(file, line, "Attempted to access null map");
    }
    m->validate_invariants("map_get");
    auto it = m->find(key);
    if (it != m->end()) return doof::Result<V, std::string>::success(it->second);
    return doof::Result<V, std::string>::failure("Map key not found");
}

template <typename K, typename V>
V& map_at(const std::shared_ptr<ordered_map<K, V>>& m, const K& key, const char* file, int32_t line) {
    if (!m) {
        panic_at(file, line, "Attempted to index null map");
    }
    m->validate_invariants("map_at");
    auto it = m->find(key);
    if (it == m->end()) {
        panic_at(file, line, "Map key not found");
    }
    return it->second;
}

template <typename K, typename V>
V& map_index(const std::shared_ptr<ordered_map<K, V>>& m, const K& key, const char* file, int32_t line) {
    if (!m) {
        panic_at(file, line, "Attempted to index null map");
    }
    m->validate_invariants("map_index");
    return (*m)[key];
}

template <typename K, typename V>
std::shared_ptr<std::vector<K>> map_keys(const std::shared_ptr<ordered_map<K, V>>& m, const char* file, int32_t line) {
    if (!m) {
        panic_at(file, line, "Attempted to read keys from null map");
    }
    m->validate_invariants("map_keys");
    auto result = std::make_shared<std::vector<K>>();
    result->reserve(m->size());
    for (const auto& [k, v] : *m) result->push_back(k);
    return result;
}

template <typename K, typename V>
std::shared_ptr<std::vector<V>> map_values(const std::shared_ptr<ordered_map<K, V>>& m, const char* file, int32_t line) {
    if (!m) {
        panic_at(file, line, "Attempted to read values from null map");
    }
    m->validate_invariants("map_values");
    auto result = std::make_shared<std::vector<V>>();
    result->reserve(m->size());
    for (const auto& [k, v] : *m) result->push_back(v);
    return result;
}

template <typename T>
std::shared_ptr<std::vector<T>> set_values(const std::shared_ptr<ordered_set<T>>& s, const char* file, int32_t line) {
    if (!s) {
        panic_at(file, line, "Attempted to read values from null set");
    }
    s->validate_invariants("set_values");
    auto result = std::make_shared<std::vector<T>>();
    result->reserve(s->size());
    for (const auto& value : *s) result->push_back(value);
    return result;
}

// ============================================================================
// Print utilities
// ============================================================================

template <typename T>
inline void println(const T& val) {
    if constexpr (std::is_same_v<T, std::string>) {
        std::cout << val << std::endl;
    } else if constexpr (std::is_same_v<T, const char*>) {
        std::cout << val << std::endl;
    } else {
        std::cout << to_string(val) << std::endl;
    }
}

inline void println() {
    std::cout << std::endl;
}

template <typename T>
inline void print(const T& val) {
    if constexpr (std::is_same_v<T, std::string>) {
        std::cout << val;
    } else if constexpr (std::is_same_v<T, const char*>) {
        std::cout << val;
    } else {
        std::cout << to_string(val);
    }
}

// ============================================================================
// Range utilities
// ============================================================================

struct Range {
    int32_t start_;
    int32_t end_;
    bool inclusive_;

    struct Iterator {
        int32_t current;
        int32_t end_;
        bool inclusive_;
        bool reverse_;

        int32_t operator*() const { return current; }
        Iterator& operator++() {
            if (reverse_) { --current; } else { ++current; }
            return *this;
        }
        bool operator!=(const Iterator& other) const {
            return current != other.current;
        }
    };

    Iterator begin() const {
        bool rev = start_ > end_;
        // For reversed ranges, produce zero iterations
        if (rev) return Iterator{start_, end_, inclusive_, rev};
        return Iterator{start_, end_, inclusive_, rev};
    }
    Iterator end() const {
        bool rev = start_ > end_;
        if (rev) return Iterator{start_, end_, inclusive_, rev};  // begin == end → zero iterations
        return Iterator{inclusive_ ? end_ + 1 : end_, end_, inclusive_, rev};
    }
};

inline Range range(int32_t start, int32_t end) {
    return Range{start, end, true};
}

inline Range range_exclusive(int32_t start, int32_t end) {
    return Range{start, end, false};
}

// ============================================================================
// Promise<T> — async result wrapper
// ============================================================================

template <typename T>
class Promise {
    std::shared_future<T> future_;
public:
    explicit Promise(std::future<T>&& f) : future_(f.share()) {}
    explicit Promise(std::shared_future<T> f) : future_(std::move(f)) {}

    doof::Result<T, std::string> get() const {
        try {
            return doof::Result<T, std::string>::success(future_.get());
        } catch (const std::exception& e) {
            return doof::Result<T, std::string>::failure(std::string(e.what()));
        } catch (...) {
            return doof::Result<T, std::string>::failure(std::string("unknown error"));
        }
    }
};

// Specialization for void
template <>
class Promise<void> {
    std::shared_future<void> future_;
public:
    explicit Promise(std::future<void>&& f) : future_(f.share()) {}
    explicit Promise(std::shared_future<void> f) : future_(std::move(f)) {}

    doof::Result<int32_t, std::string> get() const {
        try {
            future_.get();
            return doof::Result<int32_t, std::string>::success(0);
        } catch (const std::exception& e) {
            return doof::Result<int32_t, std::string>::failure(std::string(e.what()));
        } catch (...) {
            return doof::Result<int32_t, std::string>::failure(std::string("unknown error"));
        }
    }
};

// ============================================================================
// async_call — submit work to thread pool (uses std::async)
// ============================================================================

template <typename F>
auto async_call(F&& f) -> doof::Promise<decltype(f())> {
    auto fut = std::async(std::launch::async, std::forward<F>(f));
    return doof::Promise<decltype(f())>(std::move(fut));
}

// ============================================================================
// Actor<T> — single-threaded message queue actor
// ============================================================================

template <typename T>
class Actor : public std::enable_shared_from_this<Actor<T>> {
    std::unique_ptr<T> instance_;
    std::thread thread_;
    std::queue<std::function<void()>> mailbox_;
    std::mutex mutex_;
    std::condition_variable cv_;
    bool stopped_ = false;

    void run() {
        while (true) {
            std::function<void()> task;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                cv_.wait(lock, [this] { return !mailbox_.empty() || stopped_; });
                if (stopped_ && mailbox_.empty()) return;
                task = std::move(mailbox_.front());
                mailbox_.pop();
            }
            task();
        }
    }

public:
    template <typename... Args>
    explicit Actor(Args&&... args)
        : instance_(std::make_unique<T>(std::forward<Args>(args)...)) {
        thread_ = std::thread(&Actor::run, this);
    }

    // Synchronous call — enqueue and block until complete
    template <typename R, typename F>
    R call_sync(F&& f) {
        if constexpr (std::is_void_v<R>) {
            std::promise<void> prom;
            auto fut = prom.get_future();
            {
                std::lock_guard<std::mutex> lock(mutex_);
                mailbox_.push([this, f = std::forward<F>(f), &prom]() {
                    try {
                        f(*instance_);
                        prom.set_value();
                    } catch (...) {
                        prom.set_exception(std::current_exception());
                    }
                });
            }
            cv_.notify_one();
            return fut.get();
        } else {
            std::promise<R> prom;
            auto fut = prom.get_future();
            {
                std::lock_guard<std::mutex> lock(mutex_);
                mailbox_.push([this, f = std::forward<F>(f), &prom]() {
                    try {
                        prom.set_value(f(*instance_));
                    } catch (...) {
                        prom.set_exception(std::current_exception());
                    }
                });
            }
            cv_.notify_one();
            return fut.get();
        }
    }

    // Asynchronous call — enqueue and return a Promise
    template <typename R, typename F>
    doof::Promise<R> call_async(F&& f) {
        auto prom = std::make_shared<std::promise<R>>();
        auto fut = prom->get_future();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if constexpr (std::is_void_v<R>) {
                mailbox_.push([this, f = std::forward<F>(f), prom]() {
                    try {
                        f(*instance_);
                        prom->set_value();
                    } catch (...) {
                        prom->set_exception(std::current_exception());
                    }
                });
            } else {
                mailbox_.push([this, f = std::forward<F>(f), prom]() {
                    try {
                        prom->set_value(f(*instance_));
                    } catch (...) {
                        prom->set_exception(std::current_exception());
                    }
                });
            }
        }
        cv_.notify_one();
        return doof::Promise<R>(std::move(fut));
    }

    // Stop the actor — drain the queue and join the thread
    void stop() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            stopped_ = true;
        }
        cv_.notify_one();
        if (thread_.joinable()) thread_.join();
    }

    ~Actor() {
        stop();
    }
};

} // namespace doof

// ============================================================================
// Metadata reflection types (outside namespace for class-scoped usage)
// ============================================================================

namespace doof {

/** Per-method reflection entry with an invoke lambda. */
template <typename T>
struct MethodReflection {
    std::string name;
    std::string description;
    doof::JsonValue inputSchema;
    doof::JsonValue outputSchema;
    std::function<doof::Result<doof::JsonValue, doof::JsonValue>(std::shared_ptr<T>, const doof::JsonValue&)> invoke;
};

/** Structured metadata for a class — contains name, description, methods, and schema $defs. */
template <typename T>
struct ClassMetadata {
    std::string name;
    std::string description;
    std::shared_ptr<std::vector<doof::MethodReflection<T>>> methods;
    std::optional<doof::JsonValue> defs;

    doof::Result<doof::JsonValue, doof::JsonValue> invoke(
        std::shared_ptr<T> instance,
        const std::string& methodName,
        const doof::JsonValue& params
    ) const {
        if (methods != nullptr) {
            for (const auto& method : *methods) {
                if (method.name == methodName) {
                    return method.invoke(std::move(instance), params);
                }
            }
        }
        return doof::Result<doof::JsonValue, doof::JsonValue>::failure(doof::json_error(400, std::string("Unknown method: ") + methodName));
    }
};

} // namespace doof

// ============================================================================
// Line coverage (activated with -DDOOF_COVERAGE)
// ============================================================================

#ifdef DOOF_COVERAGE
#include <unordered_set>

namespace doof {
namespace coverage {

struct LineHit {
    int module_id;
    int line;
    bool operator==(const LineHit& o) const noexcept {
        return module_id == o.module_id && line == o.line;
    }
};

struct LineHitHash {
    std::size_t operator()(const LineHit& h) const noexcept {
        return std::hash<long long>{}(
            (static_cast<long long>(h.module_id) << 32) |
            static_cast<unsigned int>(static_cast<unsigned>(h.line)));
    }
};

inline std::unordered_set<LineHit, LineHitHash> _coverage_hits;
inline std::mutex _coverage_hits_mutex;
inline std::once_flag _coverage_registration_once;

inline void _cov_dump();

inline void _cov_ensure_registered() {
    std::call_once(_coverage_registration_once, []() {
        std::atexit(_cov_dump);
    });
}

inline void cov_mark(int module_id, int line) {
    _cov_ensure_registered();
    std::lock_guard<std::mutex> lock(_coverage_hits_mutex);
    _coverage_hits.insert(LineHit{module_id, line});
}

inline void _cov_dump() {
    std::lock_guard<std::mutex> lock(_coverage_hits_mutex);
    for (const auto& h : _coverage_hits) {
        std::cout << "__COV__ " << h.module_id << " " << h.line << "\\n";
    }
    std::cout.flush();
}

} // namespace coverage
} // namespace doof
#endif
`;

const JSON_TO_STRING_OVERLOAD = `inline std::string to_string(const JsonValue& value) {
    std::string out;
    json_detail::append_stringified(out, value);
    return out;
}`;

const JSON_RUNTIME_SUPPORT = String.raw`namespace json_detail {

inline bool is_digit(char ch) {
    return ch >= '0' && ch <= '9';
}

inline int hex_value(char ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return 10 + (ch - 'a');
    if (ch >= 'A' && ch <= 'F') return 10 + (ch - 'A');
    return -1;
}

inline void append_codepoint_utf8(std::string& out, uint32_t codepoint) {
    if (codepoint <= 0x7F) {
        out.push_back(static_cast<char>(codepoint));
        return;
    }
    if (codepoint <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | ((codepoint >> 6) & 0x1F)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        return;
    }
    if (codepoint <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | ((codepoint >> 12) & 0x0F)));
        out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
        return;
    }
    out.push_back(static_cast<char>(0xF0 | ((codepoint >> 18) & 0x07)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
}

inline void append_escaped_string(std::string& out, const std::string& value) {
    static constexpr char HEX[] = "0123456789abcdef";
    out.push_back('"');
    for (unsigned char ch : value) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch < 0x20) {
                    out += "\\u00";
                    out.push_back(HEX[(ch >> 4) & 0x0F]);
                    out.push_back(HEX[ch & 0x0F]);
                } else {
                    out.push_back(static_cast<char>(ch));
                }
                break;
        }
    }
    out.push_back('"');
}

inline std::string format_float(double value) {
    if (!std::isfinite(value)) {
        return "null";
    }
    std::ostringstream out;
    out.precision(std::numeric_limits<double>::max_digits10);
    out << value;
    return out.str();
}

inline void append_stringified(std::string& out, const JsonValue& value) {
    std::visit([&out](const auto& inner) {
        using T = std::decay_t<decltype(inner)>;
        if constexpr (std::is_same_v<T, std::monostate>) {
            out += "null";
        } else if constexpr (std::is_same_v<T, bool>) {
            out += inner ? "true" : "false";
        } else if constexpr (std::is_same_v<T, int32_t>
            || std::is_same_v<T, int64_t>) {
            out += std::to_string(inner);
        } else if constexpr (std::is_same_v<T, float>
            || std::is_same_v<T, double>) {
            out += format_float(static_cast<double>(inner));
        } else if constexpr (std::is_same_v<T, std::string>) {
            append_escaped_string(out, inner);
        } else if constexpr (std::is_same_v<T, JsonArray>) {
            out.push_back('[');
            if (inner != nullptr) {
                for (size_t index = 0; index < inner->size(); ++index) {
                    if (index > 0) out.push_back(',');
                    append_stringified(out, (*inner)[index]);
                }
            }
            out.push_back(']');
        } else {
            out.push_back('{');
            if (inner != nullptr) {
                bool first = true;
                for (const auto& [key, item] : *inner) {
                    if (!first) out.push_back(',');
                    first = false;
                    append_escaped_string(out, key);
                    out.push_back(':');
                    append_stringified(out, item);
                }
            }
            out.push_back('}');
        }
    }, json_storage(value));
}

} // namespace json_detail`;
