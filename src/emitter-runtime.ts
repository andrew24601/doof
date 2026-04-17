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
#include <type_traits>
#include <typeinfo>
#include <unordered_map>
#include <unordered_set>
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

struct JsonValue {
    using Array = std::shared_ptr<std::vector<JsonValue>>;
    using Object = std::shared_ptr<std::unordered_map<std::string, JsonValue>>;
    using Storage = std::variant<std::monostate, bool, int32_t, int64_t, float, double, std::string, Array, Object>;

    Storage value;

    JsonValue() : value(std::monostate{}) {}
    JsonValue(std::nullptr_t) : value(std::monostate{}) {}
    JsonValue(bool v) : value(v) {}
    JsonValue(int32_t v) : value(v) {}
    JsonValue(int64_t v) : value(v) {}
    JsonValue(float v) : value(v) {}
    JsonValue(double v) : value(v) {}
    JsonValue(const std::string& v) : value(v) {}
    JsonValue(std::string&& v) : value(std::move(v)) {}
    JsonValue(const char* v) : value(std::string(v)) {}
    JsonValue(const Array& v) : value(v) {}
    JsonValue(Array&& v) : value(std::move(v)) {}
    JsonValue(const Object& v) : value(v) {}
    JsonValue(Object&& v) : value(std::move(v)) {}

    bool isNull() const { return std::holds_alternative<std::monostate>(value); }
};

inline bool json_is_boolean(const JsonValue& value) {
    return std::holds_alternative<bool>(value.value);
}

inline bool json_is_number(const JsonValue& value) {
    return std::holds_alternative<int32_t>(value.value)
        || std::holds_alternative<int64_t>(value.value)
        || std::holds_alternative<float>(value.value)
        || std::holds_alternative<double>(value.value);
}

inline bool json_is_string(const JsonValue& value) {
    return std::holds_alternative<std::string>(value.value);
}

inline bool json_is_array(const JsonValue& value) {
    return std::holds_alternative<JsonValue::Array>(value.value);
}

inline bool json_is_object(const JsonValue& value) {
    return std::holds_alternative<JsonValue::Object>(value.value);
}

inline const char* json_type_name(const JsonValue& value) {
    if (value.isNull()) return "null";
    if (json_is_boolean(value)) return "boolean";
    if (json_is_number(value)) return "number";
    if (json_is_string(value)) return "string";
    if (json_is_array(value)) return "array";
    if (json_is_object(value)) return "object";
    return "unknown";
}

inline const JsonValue::Array::element_type* json_as_array(const JsonValue& value) {
    const auto* array = std::get_if<JsonValue::Array>(&value.value);
    if (array == nullptr || !*array) return nullptr;
    return array->get();
}

inline const JsonValue::Object::element_type* json_as_object(const JsonValue& value) {
    const auto* object = std::get_if<JsonValue::Object>(&value.value);
    if (object == nullptr || !*object) return nullptr;
    return object->get();
}

inline JsonValue json_error(int32_t code, std::string message) {
    auto object = std::make_shared<std::unordered_map<std::string, JsonValue>>();
    (*object)["code"] = JsonValue(code);
    (*object)["message"] = JsonValue(std::move(message));
    return JsonValue(std::move(object));
}

inline bool json_as_bool(const JsonValue& value) {
    const auto* result = std::get_if<bool>(&value.value);
    if (result == nullptr) panic("Expected JSON boolean");
    return *result;
}

inline int32_t json_as_int(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&value.value)) return *result;
    if (const auto* result = std::get_if<int64_t>(&value.value)) return static_cast<int32_t>(*result);
    if (const auto* result = std::get_if<float>(&value.value)) return static_cast<int32_t>(*result);
    if (const auto* result = std::get_if<double>(&value.value)) return static_cast<int32_t>(*result);
    panic("Expected JSON number");
}

inline int64_t json_as_long(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&value.value)) return *result;
    if (const auto* result = std::get_if<int64_t>(&value.value)) return *result;
    if (const auto* result = std::get_if<float>(&value.value)) return static_cast<int64_t>(*result);
    if (const auto* result = std::get_if<double>(&value.value)) return static_cast<int64_t>(*result);
    panic("Expected JSON number");
}

inline float json_as_float(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&value.value)) return static_cast<float>(*result);
    if (const auto* result = std::get_if<int64_t>(&value.value)) return static_cast<float>(*result);
    if (const auto* result = std::get_if<float>(&value.value)) return *result;
    if (const auto* result = std::get_if<double>(&value.value)) return static_cast<float>(*result);
    panic("Expected JSON number");
}

inline double json_as_double(const JsonValue& value) {
    if (const auto* result = std::get_if<int32_t>(&value.value)) return static_cast<double>(*result);
    if (const auto* result = std::get_if<int64_t>(&value.value)) return static_cast<double>(*result);
    if (const auto* result = std::get_if<float>(&value.value)) return static_cast<double>(*result);
    if (const auto* result = std::get_if<double>(&value.value)) return *result;
    panic("Expected JSON number");
}

inline const std::string& json_as_string(const JsonValue& value) {
    const auto* result = std::get_if<std::string>(&value.value);
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
    return value.isNull() || json_is_string(value) || json_is_boolean(value) || json_is_number(value);
}

inline bool json_as_bool_lenient(const JsonValue& value) {
    if (json_is_boolean(value)) return json_as_bool(value);
    if (const auto* result = std::get_if<int32_t>(&value.value)) return *result != 0;
    if (const auto* result = std::get_if<int64_t>(&value.value)) return *result != 0;
    if (const auto* result = std::get_if<float>(&value.value)) return *result != 0.0f;
    if (const auto* result = std::get_if<double>(&value.value)) return *result != 0.0;
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
    if (value.isNull()) return std::string();
    if (json_is_string(value)) return json_as_string(value);
    if (json_is_boolean(value)) return json_as_bool(value) ? "true" : "false";
    if (const auto* result = std::get_if<int32_t>(&value.value)) return std::to_string(*result);
    if (const auto* result = std::get_if<int64_t>(&value.value)) return std::to_string(*result);
    if (const auto* result = std::get_if<float>(&value.value)) {
        std::ostringstream oss;
        oss << *result;
        return oss.str();
    }
    if (const auto* result = std::get_if<double>(&value.value)) {
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
inline std::string to_string(const std::shared_ptr<std::unordered_map<K, V>>& val) {
    if (!val) return "null";
    std::vector<std::string> entries;
    entries.reserve(val->size());
    for (const auto& entry : *val) {
        entries.push_back(to_string(entry.first) + ": " + to_string(entry.second));
    }
    std::sort(entries.begin(), entries.end());

    std::string result = "{";
    for (size_t i = 0; i < entries.size(); ++i) {
        if (i > 0) result += ", ";
        result += entries[i];
    }
    result += "}";
    return result;
}

template <typename T>
inline std::string to_string(const std::shared_ptr<std::unordered_set<T>>& val) {
    if (!val) return "null";
    std::vector<std::string> items;
    items.reserve(val->size());
    for (const auto& item : *val) {
        items.push_back(to_string(item));
    }
    std::sort(items.begin(), items.end());

    std::string result = "{";
    for (size_t i = 0; i < items.size(); ++i) {
        if (i > 0) result += ", ";
        result += items[i];
    }
    result += "}";
    return result;
}

template <typename T>
inline std::string to_string(const std::optional<T>& val) {
    return val.has_value() ? to_string(*val) : std::string("null");
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
T& array_at(const std::shared_ptr<std::vector<T>>& arr, int32_t index) {
    if (!arr) {
        panic("Attempted to index null array");
    }
    if (index < 0 || index >= static_cast<int32_t>(arr->size())) {
        panic("Index out of bounds: " + to_string(index));
    }
    return (*arr)[static_cast<size_t>(index)];
}

template <typename T>
void array_require_min_size(const std::shared_ptr<std::vector<T>>& arr, int32_t count) {
    if (!arr) {
        panic("Attempted to destructure null array");
    }
    const auto size = static_cast<int32_t>(arr->size());
    if (size < count) {
        panic("Array destructuring expected at least " + to_string(count) + " elements, got " + to_string(size));
    }
}

template <typename T>
void array_pop(const std::shared_ptr<std::vector<T>>& arr) {
    if (!arr) {
        panic("Attempted to pop from null array");
    }
    if (arr->empty()) {
        panic("Attempted to pop from empty array");
    }
    arr->pop_back();
}

template <typename T>
bool array_contains(const std::shared_ptr<std::vector<T>>& arr, const T& element) {
    if (!arr) {
        panic("Attempted to search null array");
    }
    return std::find(arr->begin(), arr->end(), element) != arr->end();
}

template <typename T>
std::shared_ptr<std::vector<T>> array_slice(const std::shared_ptr<std::vector<T>>& arr, int32_t start, int32_t end) {
    if (!arr) {
        panic("Attempted to slice null array");
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

// Map helpers — bridge Doof's Map methods to std::unordered_map
template <typename K, typename V>
std::optional<V> map_get(const std::shared_ptr<std::unordered_map<K, V>>& m, const K& key) {
    auto it = m->find(key);
    if (it != m->end()) return it->second;
    return std::nullopt;
}

template <typename K, typename V>
V& map_at(const std::shared_ptr<std::unordered_map<K, V>>& m, const K& key) {
    if (!m) {
        panic("Attempted to index null map");
    }
    auto it = m->find(key);
    if (it == m->end()) {
        panic("Map key not found");
    }
    return it->second;
}

template <typename K, typename V>
V& map_index(const std::shared_ptr<std::unordered_map<K, V>>& m, const K& key) {
    if (!m) {
        panic("Attempted to index null map");
    }
    return (*m)[key];
}

template <typename K, typename V>
std::shared_ptr<std::vector<K>> map_keys(const std::shared_ptr<std::unordered_map<K, V>>& m) {
    auto result = std::make_shared<std::vector<K>>();
    result->reserve(m->size());
    for (const auto& [k, v] : *m) result->push_back(k);
    return result;
}

template <typename K, typename V>
std::shared_ptr<std::vector<V>> map_values(const std::shared_ptr<std::unordered_map<K, V>>& m) {
    auto result = std::make_shared<std::vector<V>>();
    result->reserve(m->size());
    for (const auto& [k, v] : *m) result->push_back(v);
    return result;
}

template <typename T>
std::shared_ptr<std::vector<T>> set_values(const std::shared_ptr<std::unordered_set<T>>& s) {
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
`;

const JSON_TO_STRING_OVERLOAD = `inline std::string to_string(const JsonValue& value) {
    return JSON::stringify(value);
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
        } else if constexpr (std::is_same_v<T, JsonValue::Array>) {
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
    }, value.value);
}

struct Parser {
    const std::string& text;
    size_t index = 0;

    [[nodiscard]] bool at_end() const {
        return index >= text.size();
    }

    [[nodiscard]] char peek() const {
        return at_end() ? '\0' : text[index];
    }

    void skip_whitespace() {
        while (!at_end() && std::isspace(static_cast<unsigned char>(text[index]))) {
            ++index;
        }
    }

    [[nodiscard]] std::string error(const std::string& message) const {
        size_t line = 1;
        size_t column = 1;
        for (size_t cursor = 0; cursor < index && cursor < text.size(); ++cursor) {
            if (text[cursor] == '\n') {
                ++line;
                column = 1;
            } else {
                ++column;
            }
        }
        return message + " at line " + std::to_string(line) + ", column " + std::to_string(column);
    }

    Result<JsonValue, std::string> parse_document() {
        skip_whitespace();
        auto value = parse_value();
        if (value.isFailure()) {
            return value;
        }
        skip_whitespace();
        if (!at_end()) {
            return Result<JsonValue, std::string>::failure(error("Unexpected trailing characters"));
        }
        return value;
    }

    Result<JsonValue, std::string> parse_value() {
        if (at_end()) {
            return Result<JsonValue, std::string>::failure(error("Unexpected end of JSON input"));
        }
        switch (peek()) {
            case 'n': return parse_null();
            case 't': return parse_true();
            case 'f': return parse_false();
            case '"': {
                auto parsed = parse_string();
                if (parsed.isFailure()) {
                    return Result<JsonValue, std::string>::failure(parsed.error());
                }
                return Result<JsonValue, std::string>::success(JsonValue(std::move(parsed.value())));
            }
            case '[': return parse_array();
            case '{': return parse_object();
            default:
                if (peek() == '-' || is_digit(peek())) {
                    return parse_number();
                }
                return Result<JsonValue, std::string>::failure(error("Unexpected character in JSON input"));
        }
    }

    Result<JsonValue, std::string> parse_null() {
        if (text.compare(index, 4, "null") != 0) {
            return Result<JsonValue, std::string>::failure(error("Invalid token"));
        }
        index += 4;
        return Result<JsonValue, std::string>::success(JsonValue(nullptr));
    }

    Result<JsonValue, std::string> parse_true() {
        if (text.compare(index, 4, "true") != 0) {
            return Result<JsonValue, std::string>::failure(error("Invalid token"));
        }
        index += 4;
        return Result<JsonValue, std::string>::success(JsonValue(true));
    }

    Result<JsonValue, std::string> parse_false() {
        if (text.compare(index, 5, "false") != 0) {
            return Result<JsonValue, std::string>::failure(error("Invalid token"));
        }
        index += 5;
        return Result<JsonValue, std::string>::success(JsonValue(false));
    }

    Result<std::string, std::string> parse_string() {
        if (peek() != '"') {
            return Result<std::string, std::string>::failure(error("Expected JSON string"));
        }
        ++index;
        std::string out;
        while (!at_end()) {
            const unsigned char ch = static_cast<unsigned char>(text[index++]);
            if (ch == '"') {
                return Result<std::string, std::string>::success(std::move(out));
            }
            if (ch == '\\') {
                if (at_end()) {
                    return Result<std::string, std::string>::failure(error("Unterminated escape sequence"));
                }
                const char escape = text[index++];
                switch (escape) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    case 'u': {
                        auto codepoint = parse_unicode_escape();
                        if (codepoint.isFailure()) {
                            return Result<std::string, std::string>::failure(codepoint.error());
                        }
                        append_codepoint_utf8(out, codepoint.value());
                        break;
                    }
                    default:
                        return Result<std::string, std::string>::failure(error("Invalid escape sequence"));
                }
                continue;
            }
            if (ch < 0x20) {
                return Result<std::string, std::string>::failure(error("Unescaped control character in string"));
            }
            out.push_back(static_cast<char>(ch));
        }
        return Result<std::string, std::string>::failure(error("Unterminated string literal"));
    }

    Result<uint32_t, std::string> parse_unicode_escape() {
        uint32_t codepoint = 0;
        for (int i = 0; i < 4; ++i) {
            if (at_end()) {
                return Result<uint32_t, std::string>::failure(error("Incomplete unicode escape"));
            }
            const int value = hex_value(text[index++]);
            if (value < 0) {
                return Result<uint32_t, std::string>::failure(error("Invalid unicode escape"));
            }
            codepoint = (codepoint << 4) | static_cast<uint32_t>(value);
        }

        if (codepoint >= 0xD800 && codepoint <= 0xDBFF) {
            if (index + 1 >= text.size() || text[index] != '\\' || text[index + 1] != 'u') {
                return Result<uint32_t, std::string>::failure(error("Expected unicode low surrogate"));
            }
            index += 2;
            uint32_t low = 0;
            for (int i = 0; i < 4; ++i) {
                if (at_end()) {
                    return Result<uint32_t, std::string>::failure(error("Incomplete unicode escape"));
                }
                const int value = hex_value(text[index++]);
                if (value < 0) {
                    return Result<uint32_t, std::string>::failure(error("Invalid unicode escape"));
                }
                low = (low << 4) | static_cast<uint32_t>(value);
            }
            if (low < 0xDC00 || low > 0xDFFF) {
                return Result<uint32_t, std::string>::failure(error("Invalid unicode low surrogate"));
            }
            codepoint = 0x10000 + ((codepoint - 0xD800) << 10) + (low - 0xDC00);
        } else if (codepoint >= 0xDC00 && codepoint <= 0xDFFF) {
            return Result<uint32_t, std::string>::failure(error("Unexpected unicode low surrogate"));
        }

        return Result<uint32_t, std::string>::success(codepoint);
    }

    Result<JsonValue, std::string> parse_array() {
        ++index;
        skip_whitespace();
        auto result = std::make_shared<std::vector<JsonValue>>();
        if (peek() == ']') {
            ++index;
            return Result<JsonValue, std::string>::success(JsonValue(std::move(result)));
        }
        while (true) {
            auto item = parse_value();
            if (item.isFailure()) {
                return item;
            }
            result->push_back(std::move(item.value()));
            skip_whitespace();
            if (peek() == ']') {
                ++index;
                break;
            }
            if (peek() != ',') {
                return Result<JsonValue, std::string>::failure(error("Expected ',' or ']'"));
            }
            ++index;
            skip_whitespace();
        }
        return Result<JsonValue, std::string>::success(JsonValue(std::move(result)));
    }

    Result<JsonValue, std::string> parse_object() {
        ++index;
        skip_whitespace();
        auto result = std::make_shared<std::unordered_map<std::string, JsonValue>>();
        if (peek() == '}') {
            ++index;
            return Result<JsonValue, std::string>::success(JsonValue(std::move(result)));
        }
        while (true) {
            auto key = parse_string();
            if (key.isFailure()) {
                return Result<JsonValue, std::string>::failure(key.error());
            }
            skip_whitespace();
            if (peek() != ':') {
                return Result<JsonValue, std::string>::failure(error("Expected ':' after object key"));
            }
            ++index;
            skip_whitespace();
            auto value = parse_value();
            if (value.isFailure()) {
                return value;
            }
            (*result)[std::move(key.value())] = std::move(value.value());
            skip_whitespace();
            if (peek() == '}') {
                ++index;
                break;
            }
            if (peek() != ',') {
                return Result<JsonValue, std::string>::failure(error("Expected ',' or '}'"));
            }
            ++index;
            skip_whitespace();
        }
        return Result<JsonValue, std::string>::success(JsonValue(std::move(result)));
    }

    Result<JsonValue, std::string> parse_number() {
        const size_t start = index;
        if (peek() == '-') {
            ++index;
            if (at_end()) {
                return Result<JsonValue, std::string>::failure(error("Invalid JSON number"));
            }
        }

        if (peek() == '0') {
            ++index;
            if (!at_end() && is_digit(peek())) {
                return Result<JsonValue, std::string>::failure(error("Leading zeros are not allowed in JSON numbers"));
            }
        } else {
            if (!is_digit(peek())) {
                return Result<JsonValue, std::string>::failure(error("Invalid JSON number"));
            }
            while (!at_end() && is_digit(peek())) {
                ++index;
            }
        }

        bool is_float = false;
        if (!at_end() && peek() == '.') {
            is_float = true;
            ++index;
            if (at_end() || !is_digit(peek())) {
                return Result<JsonValue, std::string>::failure(error("Invalid JSON number"));
            }
            while (!at_end() && is_digit(peek())) {
                ++index;
            }
        }

        if (!at_end() && (peek() == 'e' || peek() == 'E')) {
            is_float = true;
            ++index;
            if (!at_end() && (peek() == '+' || peek() == '-')) {
                ++index;
            }
            if (at_end() || !is_digit(peek())) {
                return Result<JsonValue, std::string>::failure(error("Invalid JSON number exponent"));
            }
            while (!at_end() && is_digit(peek())) {
                ++index;
            }
        }

        const std::string token = text.substr(start, index - start);
        if (is_float) {
            return parse_float_number(token);
        }
        return parse_integer_number(token);
    }

    Result<JsonValue, std::string> parse_float_number(const std::string& token) {
        errno = 0;
        char* end = nullptr;
        const double value = std::strtod(token.c_str(), &end);
        if (end == token.c_str() || (end != nullptr && *end != 0)) {
            return Result<JsonValue, std::string>::failure(error("Invalid JSON number"));
        }
        if (errno == ERANGE || !std::isfinite(value)) {
            return Result<JsonValue, std::string>::failure(error("JSON number out of range"));
        }
        return Result<JsonValue, std::string>::success(JsonValue(value));
    }

    Result<JsonValue, std::string> parse_integer_number(const std::string& token) {
        if (!token.empty() && token.front() == '-') {
            errno = 0;
            char* end = nullptr;
            const long long value = std::strtoll(token.c_str(), &end, 10);
            if (end != nullptr && *end == 0 && errno != ERANGE) {
                if (value >= std::numeric_limits<int32_t>::min() && value <= std::numeric_limits<int32_t>::max()) {
                    return Result<JsonValue, std::string>::success(JsonValue(static_cast<int32_t>(value)));
                }
                return Result<JsonValue, std::string>::success(JsonValue(static_cast<int64_t>(value)));
            }
        } else {
            errno = 0;
            char* end = nullptr;
            const unsigned long long value = std::strtoull(token.c_str(), &end, 10);
            if (end != nullptr && *end == 0 && errno != ERANGE) {
                if (value <= static_cast<unsigned long long>(std::numeric_limits<int32_t>::max())) {
                    return Result<JsonValue, std::string>::success(JsonValue(static_cast<int32_t>(value)));
                }
                if (value <= static_cast<unsigned long long>(std::numeric_limits<int64_t>::max())) {
                    return Result<JsonValue, std::string>::success(JsonValue(static_cast<int64_t>(value)));
                }
            }
        }
        return parse_float_number(token);
    }
};

} // namespace json_detail

struct JSON {
    static Result<JsonValue, std::string> parse(const std::string& text) {
        return json_detail::Parser{text}.parse_document();
    }

    static std::string stringify(const JsonValue& value) {
        std::string out;
        json_detail::append_stringified(out, value);
        return out;
    }
};

inline JsonValue json_parse_or_panic(const std::string& text) {
    auto result = JSON::parse(text);
    if (result.isFailure()) {
        panic("Invalid embedded JSON: " + result.error());
    }
    return std::move(result.value());
}`;
