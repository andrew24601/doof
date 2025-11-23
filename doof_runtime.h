#ifndef DOOF_RUNTIME_H
#define DOOF_RUNTIME_H

#include <iostream>
#include <sstream>
#include <string>
#include <map>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <memory>
#include <stdexcept>
#include <fstream>
#include <variant>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <charconv>
#include <cassert>
#include <utility>
#include <type_traits>
#include <cstring>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <queue>
#include <atomic>
#include <future>
#include <optional>

namespace doof_runtime {

// ==================== Async Runtime ====================

enum class TaskState { PENDING, RUNNING, COMPLETED };

struct TaskBase {
    std::atomic<TaskState> state{TaskState::PENDING};
    std::mutex mutex;
    std::condition_variable cv;
    
    virtual void execute() = 0;
    virtual ~TaskBase() = default;

    void run();
    void wait();
};

template<typename T>
struct Task : TaskBase {
    std::function<T()> func;
    std::optional<T> result;

    Task(std::function<T()> f) : func(std::move(f)) {}

    void execute() override {
        result = func();
    }
};

// Specialization for void
template<>
struct Task<void> : TaskBase {
    std::function<void()> func;

    Task(std::function<void()> f) : func(std::move(f)) {}

    void execute() override {
        func();
    }
};

class ThreadPool {
    std::vector<std::thread> workers;
    std::deque<std::shared_ptr<TaskBase>> queue;
    std::mutex queue_mutex;
    std::condition_variable queue_cv;
    bool stop = false;

    void worker_loop();

public:
    static ThreadPool& instance();

    ThreadPool(size_t threads);
    ~ThreadPool();

    void submit(std::shared_ptr<TaskBase> task);
};

template<typename T>
class Future {
    std::shared_ptr<Task<T>> task;

public:
    Future(std::shared_ptr<Task<T>> t) : task(t) {}

    T get() {
        task->run(); // Try to inline
        task->wait();
        return *task->result;
    }
    
    bool isReady() {
        return task->state == TaskState::COMPLETED;
    }
    
    void wait() {
        task->wait();
    }
};

// Specialization for void
template<>
class Future<void> {
    std::shared_ptr<Task<void>> task;

public:
    Future(std::shared_ptr<Task<void>> t) : task(t) {}

    void get() {
        task->run();
        task->wait();
    }
    
    bool isReady() {
        return task->state == TaskState::COMPLETED;
    }
    
    void wait() {
        task->wait();
    }
};

template <typename T>
class Captured {
public:
    struct Holder {
        Holder() = default;

        template <typename U>
        explicit Holder(U&& initial)
            : value(std::forward<U>(initial)) {}

        template <typename... Args>
        explicit Holder(std::in_place_t, Args&&... args)
            : value(std::forward<Args>(args)...) {}

        T value{};
    };

    Captured()
        : storage_(std::make_shared<Holder>()) {}

    explicit Captured(const T& value)
        : storage_(std::make_shared<Holder>(value)) {}

    explicit Captured(T&& value)
        : storage_(std::make_shared<Holder>(std::move(value))) {}

    Captured(const Captured&) = default;
    Captured(Captured&&) noexcept = default;
    Captured& operator=(const Captured&) = default;
    Captured& operator=(Captured&&) noexcept = default;

    Captured& operator=(const T& value) {
        set(value);
        return *this;
    }

    Captured& operator=(T&& value) {
        set(std::move(value));
        return *this;
    }

    const T& get() const {
        return storage_->value;
    }

    T& get() {
        return storage_->value;
    }

    void set(const T& value) {
        storage_->value = value;
    }

    void set(T&& value) {
        storage_->value = std::move(value);
    }

    operator T() const {
        return storage_->value;
    }

    template <typename U = T>
    auto operator->() {
        return forwardArrow(storage_->value, 0);
    }

    template <typename U = T>
    auto operator->() const {
        return forwardArrow(storage_->value, 0);
    }

    T& operator*() {
        return storage_->value;
    }

    const T& operator*() const {
        return storage_->value;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator+=(const U& rhs) {
        storage_->value += rhs;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator-=(const U& rhs) {
        storage_->value -= rhs;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator*=(const U& rhs) {
        storage_->value *= rhs;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator/=(const U& rhs) {
        storage_->value /= rhs;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_integral_v<U>, Captured&> operator%=(const U& rhs) {
        storage_->value %= rhs;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator++() {
        ++storage_->value;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, U> operator++(int) {
        U temp = storage_->value;
        ++storage_->value;
        return temp;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, Captured&> operator--() {
        --storage_->value;
        return *this;
    }

    template <typename U = T>
    std::enable_if_t<std::is_arithmetic_v<U>, U> operator--(int) {
        U temp = storage_->value;
        --storage_->value;
        return temp;
    }

private:
    template <typename U>
    static auto forwardArrow(U& value, int) -> decltype(value.operator->()) {
        return value.operator->();
    }

    template <typename U>
    static U* forwardArrow(U& value, long) {
        return &value;
    }

    std::shared_ptr<Holder> storage_;
};

// ==================== StringBuilder Implementation ====================

/**
 * Efficient string builder using std::string with append overloads
 * Optimized for template literal compilation and predictable string building
 */
class StringBuilder : public std::enable_shared_from_this<StringBuilder> {
private:
    std::string buf_;

public:
    StringBuilder() = default;
    explicit StringBuilder(size_t reserveSize) { buf_.reserve(reserveSize); }

    std::shared_ptr<StringBuilder> reserve(size_t n) { buf_.reserve(n); return shared_from_this(); }
    std::shared_ptr<StringBuilder> clear() { buf_.clear(); return shared_from_this(); }

    // String-friendly overloads
    std::shared_ptr<StringBuilder> append(const std::string& s) { buf_.append(s); return shared_from_this(); }
    std::shared_ptr<StringBuilder> append(const char* s) { buf_.append(s); return shared_from_this(); }
    std::shared_ptr<StringBuilder> append(char c) { buf_.push_back(c); return shared_from_this(); }

    // Numeric/bool overloads using efficient conversion
    std::shared_ptr<StringBuilder> append(int v) { 
        #ifdef __cpp_lib_to_chars
            char buffer[32];
            auto [ptr, ec] = std::to_chars(buffer, buffer + 32, v);
            if (ec == std::errc{}) {
                buf_.append(buffer, ptr - buffer);
            } else {
                buf_.append(std::to_string(v));
            }
        #else
            buf_.append(std::to_string(v)); 
        #endif
        return shared_from_this(); 
    }
    
    std::shared_ptr<StringBuilder> append(long v) { 
        #ifdef __cpp_lib_to_chars
            char buffer[32];
            auto [ptr, ec] = std::to_chars(buffer, buffer + 32, v);
            if (ec == std::errc{}) {
                buf_.append(buffer, ptr - buffer);
            } else {
                buf_.append(std::to_string(v));
            }
        #else
            buf_.append(std::to_string(v)); 
        #endif
        return shared_from_this(); 
    }
    
    std::shared_ptr<StringBuilder> append(double v) { 
        #ifdef __cpp_lib_to_chars
            char buffer[64];
            auto [ptr, ec] = std::to_chars(buffer, buffer + 64, v, std::chars_format::general);
            if (ec == std::errc{}) {
                buf_.append(buffer, ptr - buffer);
            } else {
                buf_.append(std::to_string(v));
            }
        #else
            buf_.append(std::to_string(v)); 
        #endif
        return shared_from_this(); 
    }
    
    std::shared_ptr<StringBuilder> append(float v) { 
        #ifdef __cpp_lib_to_chars
            char buffer[64];
            auto [ptr, ec] = std::to_chars(buffer, buffer + 64, v, std::chars_format::general);
            if (ec == std::errc{}) {
                buf_.append(buffer, ptr - buffer);
            } else {
                buf_.append(std::to_string(v));
            }
        #else
            buf_.append(std::to_string(v)); 
        #endif
        return shared_from_this(); 
    }
    
    std::shared_ptr<StringBuilder> append(bool v) { buf_.append(v ? "true" : "false"); return shared_from_this(); }

    // Generic fallback for types with _toJSON or operator<< support
    template <typename T, 
              typename = std::enable_if_t<!std::is_same_v<std::decay_t<T>, std::string> && 
                                         !std::is_arithmetic_v<std::decay_t<T>> &&
                                         !std::is_same_v<std::decay_t<T>, bool>>>
    std::shared_ptr<StringBuilder> append(const T& v) {
        // Prefer _toJSON method if available (for generated classes/structs)
        if constexpr (std::is_invocable_v<decltype(&T::_toJSON), const T&, std::ostream&>) {
            std::ostringstream oss;
            v._toJSON(oss);
            buf_.append(oss.str());
            return shared_from_this();
        } 
        // Fallback to toString method if available
        else if constexpr (std::is_convertible_v<decltype(std::declval<const T&>().toString()), std::string>) {
            buf_.append(v.toString());
            return shared_from_this();
        } 
        // Fallback to operator<< 
        else {
            std::ostringstream oss;
            oss << v;
            buf_.append(oss.str());
            return shared_from_this();
        }
    }

    std::string toString() const { return buf_; }
    std::string toText() const { return buf_; }  // Alias for domino compatibility
    
    // Stream directly to ostream for println optimization
    void streamInto(std::ostream& os) const { os << buf_; }
    
    size_t size() const { return buf_.size(); }
    bool empty() const { return buf_.empty(); }
};

// ==================== Core I/O Functions ====================

/**
 * Print any value to stdout with a newline
 */
template<typename T>
void println(const T& value) {
    std::cout << value << std::endl;
}

// ==================== String Helper Functions ====================

/**
 * Convert string to lowercase
 */
std::string string_to_lower(const std::string& str);

/**
 * Convert string to uppercase
 */
std::string string_to_upper(const std::string& str);

/**
 * Replace first occurrence of substring in string
 */
std::string string_replace(const std::string& str, const std::string& from, const std::string& to);

/**
 * Split string by separator into array of strings
 */
std::shared_ptr<std::vector<std::string>> string_split(const std::string& str, const std::string& separator);

/**
 * Split string by character separator into array of strings
 */
std::shared_ptr<std::vector<std::string>> string_split(const std::string& str, char separator);

/**
 * Encode string for JSON output (escapes quotes, backslashes, etc.)
 */
std::string json_encode(const std::string& str);

// ==================== Type Conversion Functions ====================

/**
 * Convert string to int, panics if not a valid integer
 */
int string_to_int(const std::string& str);

/**
 * Convert string to float, panics if not a valid float
 */
float string_to_float(const std::string& str);

/**
 * Convert string to double, panics if not a valid double
 */
double string_to_double(const std::string& str);

/**
 * Convert string to bool, accepts only "true", "false", "1", "0" (case-sensitive)
 * Panics for any other input
 */
bool string_to_bool(const std::string& str);

/**
 * Convert bool to string ("true" or "false")
 */
std::string bool_to_string(bool value);

/**
 * Convert class instance to JSON string representation
 */
template<typename T>
std::string class_to_json_string(const std::shared_ptr<T>& obj) {
    if (!obj) {
        return "null";
    }
    std::ostringstream oss;
    oss << *obj;
    return oss.str();
}

/**
 * Validate and convert integer to enum value
 * Panics if the integer is not a valid enum value
 */
template<typename EnumType>
EnumType validate_enum_int(int value) {
    // This function needs to be specialized for each enum type
    // The specializations will be generated by the transpiler
    throw std::runtime_error("Enum validation not implemented for this type");
}

/**
 * Validate and convert string to enum value  
 * Panics if the string is not a valid enum backing value
 */
template<typename EnumType>
EnumType validate_enum_string(const std::string& value) {
    // This function needs to be specialized for each enum type
    // The specializations will be generated by the transpiler
    throw std::runtime_error("Enum validation not implemented for this type");
}

// ==================== Array Helper Functions ====================

/**
 * Pop and return last element from vector
 * Throws runtime_error if vector is empty
 */
template<typename T>
T array_pop(std::vector<T>& arr) {
    if (arr.empty()) {
        throw std::runtime_error("Cannot pop from empty array");
    }
    T value = arr.back();
    arr.pop_back();
    return value;
}

// ==================== Map Helper Functions ====================

/**
 * Get all keys from map as shared_ptr<vector>
 */
template<typename K, typename V>
std::shared_ptr<std::vector<K>> map_keys(const std::map<K, V>& map) {
    auto keys = std::make_shared<std::vector<K>>();
    keys->reserve(map.size());
    for (const auto& pair : map) {
        keys->push_back(pair.first);
    }
    return keys;
}

/**
 * Get all values from map as shared_ptr<vector>
 */
template<typename K, typename V>
std::shared_ptr<std::vector<V>> map_values(const std::map<K, V>& map) {
    auto values = std::make_shared<std::vector<V>>();
    values->reserve(map.size());
    for (const auto& pair : map) {
        values->push_back(pair.second);
    }
    return values;
}

// ==================== Math Functions ====================
// Note: Most math functions are forwarded to std::cmath
// These are just convenience wrappers for consistency

namespace Math {
    // Basic functions
    double abs(double x);
    double pow(double base, double exp);
    double sqrt(double x);
    double min(double a, double b);
    double max(double a, double b);
    
    // Trigonometric functions
    double sin(double x);
    double cos(double x);
    double tan(double x);
    double asin(double x);
    double acos(double x);
    double atan(double x);
    double atan2(double y, double x);
    
    // Exponential and logarithmic
    double exp(double x);
    double log(double x);
    double log10(double x);
    
    // Rounding functions
    double floor(double x);
    double ceil(double x);
    double round(double x);
    
    // Additional functions
    double fmod(double a, double b);
    double hypot(double a, double b);
    
    // Mathematical constants
    extern const double PI;
    extern const double E;
}

// ==================== JSON Helper Functions ====================
namespace json {

// High-performance open-addressing hash set for string interning
class StringPool {
    struct Entry {
        std::string str;
        bool occupied = false;
        Entry() = default;
        Entry(std::string&& s) : str(std::move(s)), occupied(true) {}
    };
    std::vector<Entry> table_;
    size_t count_ = 0;
    static constexpr float kMaxLoad = 0.7f;
    static constexpr size_t kInitSize = 4096;

    static uint32_t hash_sv(std::string_view sv) {
        // FNV-1a 32-bit, bytewise, using unsigned char* for speed
        uint32_t h = 2166136261u;
        const unsigned char* data = reinterpret_cast<const unsigned char*>(sv.data());
        size_t len = sv.size();
        for (size_t i = 0; i < len; ++i) {
            h = (h ^ data[i]) * 16777619u;
        }
        return h;
    }
    void rehash(size_t newcap) {
        std::vector<Entry> old = std::move(table_);
        table_.resize(newcap);
        for (auto& e : table_) e.occupied = false;
        count_ = 0;
        for (auto& e : old) {
            if (!e.occupied) continue;
            intern(e.str);
        }
    }
    void maybe_grow() {
        if (count_ + 1 > table_.size() * kMaxLoad) {
            rehash(table_.empty() ? kInitSize : table_.size() * 2);
        }
    }
public:
    StringPool() { table_.resize(kInitSize); }
    const std::string& intern(std::string_view sv) {
        maybe_grow();
        size_t mask = table_.size() - 1;
        uint32_t h = hash_sv(sv);
        size_t idx = h & mask;
        while (true) {
            Entry& e = table_[idx];
            if (!e.occupied) {
                e.str = std::string(sv);
                e.occupied = true;
                ++count_;
                return e.str;
            }
            if (e.str.size() == sv.size() && std::memcmp(e.str.data(), sv.data(), sv.size()) == 0) {
                return e.str;
            }
            idx = (idx + 1) & mask;
        }
    }
    const std::string& intern(const std::string& s) { return intern(std::string_view(s)); }
    const std::string& intern(const std::string& source, size_t start, size_t length) { return intern(std::string_view(source).substr(start, length)); }
    void clear() { for (auto& e : table_) e.occupied = false; count_ = 0; }
    size_t size() const { return count_; }
    bool empty() const { return count_ == 0; }
};

// Forward declarations
class JSONValue;
using JSONArray = std::vector<JSONValue>;
using JSONObject = std::map<std::string, JSONValue>;

// Null type for JSON null values
struct JSONNull {
    bool operator==(const JSONNull&) const { return true; }
    bool operator!=(const JSONNull&) const { return false; }
};

// JSONValue class that can hold all JSON types using std::variant
class JSONValue {
private:
    std::variant<JSONNull, bool, double, std::string, JSONArray, JSONObject> value_;

public:
    // Constructors
    JSONValue() : value_(JSONNull{}) {}
    JSONValue(std::nullptr_t) : value_(JSONNull{}) {}
    JSONValue(bool b) : value_(b) {}
    JSONValue(int i) : value_(static_cast<double>(i)) {}
    JSONValue(long l) : value_(static_cast<double>(l)) {}
    JSONValue(long long ll) : value_(static_cast<double>(ll)) {}
    JSONValue(float f) : value_(static_cast<double>(f)) {}
    JSONValue(double d) : value_(d) {}
    JSONValue(const char* s) : value_(std::string(s)) {}
    JSONValue(const std::string& s) : value_(s) {}
    JSONValue(std::string&& s) : value_(std::move(s)) {}
    JSONValue(const JSONArray& arr) : value_(arr) {}
    JSONValue(JSONArray&& arr) : value_(std::move(arr)) {}
    JSONValue(const JSONObject& obj) : value_(obj) {}
    JSONValue(JSONObject&& obj) : value_(std::move(obj)) {}
    
    // Copy and move constructors
    JSONValue(const JSONValue& other) = default;
    JSONValue(JSONValue&& other) = default;
    
    // Assignment operators
    JSONValue& operator=(const JSONValue& other) = default;
    JSONValue& operator=(JSONValue&& other) = default;

    // Type checking methods
    bool is_null() const { return std::holds_alternative<JSONNull>(value_); }
    bool is_bool() const { return std::holds_alternative<bool>(value_); }
    bool is_number() const { return std::holds_alternative<double>(value_); }
    bool is_string() const { return std::holds_alternative<std::string>(value_); }
    bool is_array() const { return std::holds_alternative<JSONArray>(value_); }
    bool is_object() const { return std::holds_alternative<JSONObject>(value_); }

    // Type getters with bounds checking
    bool as_bool() const {
        if (!is_bool()) throw std::runtime_error("JSONValue is not a boolean");
        return std::get<bool>(value_);
    }
    
    double as_number() const {
        if (!is_number()) throw std::runtime_error("JSONValue is not a number");
        return std::get<double>(value_);
    }
    
    int as_int() const {
        if (!is_number()) throw std::runtime_error("JSONValue is not a number");
        return static_cast<int>(std::get<double>(value_));
    }
    
    const std::string& as_string() const {
        if (!is_string()) throw std::runtime_error("JSONValue is not a string");
        return std::get<std::string>(value_);
    }
    
    const JSONArray& as_array() const {
        if (!is_array()) throw std::runtime_error("JSONValue is not an array");
        return std::get<JSONArray>(value_);
    }
    
    JSONArray& as_array() {
        if (!is_array()) throw std::runtime_error("JSONValue is not an array");
        return std::get<JSONArray>(value_);
    }
    
    const JSONObject& as_object() const {
        if (!is_object()) throw std::runtime_error("JSONValue is not an object");
        return std::get<JSONObject>(value_);
    }
    
    JSONObject& as_object() {
        if (!is_object()) throw std::runtime_error("JSONValue is not an object");
        return std::get<JSONObject>(value_);
    }

    // Array access operators
    JSONValue& operator[](size_t index) {
        if (!is_array()) {
            value_ = JSONArray{};
        }
        auto& arr = std::get<JSONArray>(value_);
        if (index >= arr.size()) {
            arr.resize(index + 1);
        }
        return arr[index];
    }
    
    const JSONValue& operator[](size_t index) const {
        if (!is_array()) throw std::runtime_error("JSONValue is not an array");
        const auto& arr = std::get<JSONArray>(value_);
        if (index >= arr.size()) throw std::out_of_range("Array index out of bounds");
        return arr[index];
    }

    // Object access operators
    JSONValue& operator[](const std::string& key) {
        if (!is_object()) {
            value_ = JSONObject{};
        }
        return std::get<JSONObject>(value_)[key];
    }
    
    JSONValue& operator[](const char* key) {
        return (*this)[std::string(key)];
    }
    
    const JSONValue& operator[](const std::string& key) const {
        if (!is_object()) throw std::runtime_error("JSONValue is not an object");
        const auto& obj = std::get<JSONObject>(value_);
        auto it = obj.find(key);
        if (it == obj.end()) throw std::out_of_range("Object key not found");
        return it->second;
    }
    
    const JSONValue& operator[](const char* key) const {
        return (*this)[std::string(key)];
    }

    // Object utility methods
    bool has_key(const std::string& key) const {
        if (!is_object()) return false;
        const auto& obj = std::get<JSONObject>(value_);
        return obj.find(key) != obj.end();
    }
    
    size_t size() const {
        if (is_array()) return std::get<JSONArray>(value_).size();
        if (is_object()) return std::get<JSONObject>(value_).size();
        if (is_string()) return std::get<std::string>(value_).size();
        return 0;
    }
    
    bool empty() const {
        return size() == 0;
    }

    // Serialization to JSON string
    std::string to_string() const {
        std::ostringstream oss;
        serialize(oss, false, 0);
        return oss.str();
    }

    // Pretty print with indentation
    std::string to_pretty_string(int indent = 0) const {
        std::ostringstream oss;
        serialize(oss, true, indent);
        return oss.str();
    }

private:
    static void escape_string(std::ostringstream& oss, std::string_view str) {
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
                        // Escape other control characters as \u00XX
                        oss << "\\u";
                        oss << "00";
                        oss << "0123456789abcdef"[(c >> 4) & 0xf];
                        oss << "0123456789abcdef"[c & 0xf];
                    } else {
                        oss << static_cast<char>(c);
                    }
                    break;
            }
        }
    }
    void serialize(std::ostringstream& oss, bool pretty, int indent) const {
        const std::string indent_str(indent * 2, ' ');
        const std::string next_indent_str((indent + 1) * 2, ' ');
        std::visit([&](const auto& val) {
            using T = std::decay_t<decltype(val)>;
            if constexpr (std::is_same_v<T, JSONNull>) {
                oss << "null";
            } else if constexpr (std::is_same_v<T, bool>) {
                oss << (val ? "true" : "false");
            } else if constexpr (std::is_same_v<T, double>) {
                oss << val;
            } else if constexpr (std::is_same_v<T, std::string>) {
                oss << '"';
                escape_string(oss, val);
                oss << '"';
            } else if constexpr (std::is_same_v<T, JSONArray>) {
                if (val.empty()) {
                    oss << "[]";
                    return;
                }
                if (pretty) {
                    oss << "[\n";
                    for (size_t i = 0; i < val.size(); ++i) {
                        if (i > 0) oss << ",\n";
                        oss << next_indent_str;
                        val[i].serialize(oss, true, indent + 1);
                    }
                    oss << "\n" << indent_str << "]";
                } else {
                    oss << '[';
                    for (size_t i = 0; i < val.size(); ++i) {
                        if (i > 0) oss << ',';
                        val[i].serialize(oss, false, 0);
                    }
                    oss << ']';
                }
            } else if constexpr (std::is_same_v<T, JSONObject>) {
                if (val.empty()) {
                    oss << "{}";
                    return;
                }
                if (pretty) {
                    oss << "{\n";
                    bool first = true;
                    for (const auto& [key, value] : val) {
                        if (!first) oss << ",\n";
                        first = false;
                        oss << next_indent_str << '"';
                        escape_string(oss, key);
                        oss << "\": ";
                        value.serialize(oss, true, indent + 1);
                    }
                    oss << "\n" << indent_str << "}";
                } else {
                    oss << '{';
                    bool first = true;
                    for (const auto& [key, value] : val) {
                        if (!first) oss << ',';
                        first = false;
                        oss << '"';
                        escape_string(oss, key);
                        oss << "\":";
                        value.serialize(oss, false, 0);
                    }
                    oss << '}';
                }
            }
        }, value_);
    }
public:
    // Equality operators
    bool operator==(const JSONValue& other) const {
        return value_ == other.value_;
    }
    
    bool operator!=(const JSONValue& other) const {
        return !(*this == other);
    }

private:
};

// Simple JSON parser with built-in string interning
class JSONParser {
private:
    std::string json_;
    size_t pos_;
    StringPool string_pool_;

public:
    explicit JSONParser(const std::string& json) 
        : json_(json), pos_(0) {}

    JSONValue parse() {
        skip_whitespace();
        JSONValue result = parse_value();
        skip_whitespace();
        if (pos_ < json_.size()) {
            throw std::runtime_error("Unexpected characters after JSON value");
        }
        return result;
    }

    // Get string pool statistics
    size_t get_interned_string_count() const {
        return string_pool_.size();
    }

private:
    void skip_whitespace() {
        while (pos_ < json_.size() && std::isspace(json_[pos_])) {
            ++pos_;
        }
    }

    char current_char() const {
        return pos_ < json_.size() ? json_[pos_] : '\0';
    }

    char advance() {
        return pos_ < json_.size() ? json_[pos_++] : '\0';
    }

    JSONValue parse_value() {
        skip_whitespace();
        char c = current_char();
        
        switch (c) {
            case 'n': return parse_null();
            case 't':
            case 'f': return parse_bool();
            case '"': return parse_string();
            case '[': return parse_array();
            case '{': return parse_object();
            case '-':
            case '0': case '1': case '2': case '3': case '4':
            case '5': case '6': case '7': case '8': case '9':
                return parse_number();
            default:
                throw std::runtime_error("Unexpected character in JSON");
        }
    }

    JSONValue parse_null() {
        if (json_.substr(pos_, 4) == "null") {
            pos_ += 4;
            return JSONValue(nullptr);
        }
        throw std::runtime_error("Invalid null value");
    }

    JSONValue parse_bool() {
        if (json_.substr(pos_, 4) == "true") {
            pos_ += 4;
            return JSONValue(true);
        }
        if (json_.substr(pos_, 5) == "false") {
            pos_ += 5;
            return JSONValue(false);
        }
        throw std::runtime_error("Invalid boolean value");
    }

    JSONValue parse_string() {
        if (advance() != '"') {
            throw std::runtime_error("Expected '\"' at start of string");
        }
        
        size_t start_pos = pos_;
        
        // Fast path: scan for closing quote and check for escape sequences
        while (pos_ < json_.size() && json_[pos_] != '"' && json_[pos_] != '\\') {
            pos_++;
        }
        
        if (pos_ < json_.size() && json_[pos_] == '"') {
            // No escape sequences - use fast substring approach
            std::string result = json_.substr(start_pos, pos_ - start_pos);
            advance(); // consume closing quote
            return JSONValue(std::move(result));
        }
        
        // Slow path: has escape sequences, pre-allocate and build character by character
        pos_ = start_pos; // Reset position
        size_t remaining_length = 0;
        
        // Estimate remaining length to the closing quote
        for (size_t scan_pos = pos_; scan_pos < json_.size(); scan_pos++) {
            if (json_[scan_pos] == '"') {
                remaining_length = scan_pos - pos_;
                break;
            }
        }
        
        std::string result;
        result.reserve(remaining_length); // Pre-allocate to avoid reallocations
        
        while (pos_ < json_.size() && current_char() != '"') {
            char c = advance();
            if (c == '\\') {
                if (pos_ >= json_.size()) {
                    throw std::runtime_error("Unterminated escape sequence");
                }
                char escaped = advance();
                switch (escaped) {
                    case '"': result += '"'; break;
                    case '\\': result += '\\'; break;
                    case '/': result += '/'; break;
                    case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break;
                    case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break;
                    case 't': result += '\t'; break;
                    case 'u': {
                        // Unicode escape sequence
                        if (pos_ + 4 > json_.size()) {
                            throw std::runtime_error("Invalid unicode escape sequence");
                        }
                        std::string hex = json_.substr(pos_, 4);
                        pos_ += 4;
                        int codepoint = std::stoi(hex, nullptr, 16);
                        if (codepoint <= 0x7F) {
                            result += static_cast<char>(codepoint);
                        } else {
                            // For simplicity, we'll just add the literal \uXXXX
                            result += "\\u" + hex;
                        }
                        break;
                    }
                    default:
                        throw std::runtime_error("Invalid escape sequence");
                }
            } else {
                result += c;
            }
        }
        
        if (current_char() != '"') {
            throw std::runtime_error("Unterminated string");
        }
        advance(); // consume closing quote
        
        return JSONValue(result);
    }

    JSONValue parse_number() {
        size_t start = pos_;
        
        if (current_char() == '-') advance();
        
        if (current_char() == '0') {
            advance();
        } else if (std::isdigit(current_char())) {
            while (std::isdigit(current_char())) advance();
        } else {
            throw std::runtime_error("Invalid number format");
        }
        
        if (current_char() == '.') {
            advance();
            if (!std::isdigit(current_char())) {
                throw std::runtime_error("Invalid number format");
            }
            while (std::isdigit(current_char())) advance();
        }
        
        if (current_char() == 'e' || current_char() == 'E') {
            advance();
            if (current_char() == '+' || current_char() == '-') advance();
            if (!std::isdigit(current_char())) {
                throw std::runtime_error("Invalid number format");
            }
            while (std::isdigit(current_char())) advance();
        }
        
        std::string number_str = json_.substr(start, pos_ - start);
        return JSONValue(std::stod(number_str));
    }

    JSONValue parse_array() {
        advance(); // consume '['
        skip_whitespace();
        
        JSONArray result;
        
        if (current_char() == ']') {
            advance();
            return JSONValue(result);
        }
        
        while (true) {
            result.push_back(parse_value());
            skip_whitespace();
            
            char c = current_char();
            if (c == ']') {
                advance();
                break;
            } else if (c == ',') {
                advance();
                skip_whitespace();
            } else {
                throw std::runtime_error("Expected ',' or ']' in array");
            }
        }
        
        return JSONValue(result);
    }

    // Parse a JSON object key: fast path (no escapes) goes straight to string pool, slow path falls back to parse_string
    const std::string& parse_key() {
        if (advance() != '"') {
            throw std::runtime_error("Expected '\"' at start of key");
        }
        size_t start_pos = pos_;
        // Fast path: scan for closing quote and check for escape sequences
        while (pos_ < json_.size() && json_[pos_] != '"' && json_[pos_] != '\\') {
            pos_++;
        }
        if (pos_ < json_.size() && json_[pos_] == '"') {
            // No escape sequences - intern directly from string_view
            std::string_view key_sv = std::string_view(json_).substr(start_pos, pos_ - start_pos);
            advance(); // consume closing quote
            return string_pool_.intern(key_sv);
        }
        // Slow path: fallback to parse_string, then intern
        pos_ = start_pos - 1; // rewind to before opening quote
        JSONValue key_value = parse_string();
        return string_pool_.intern(key_value.as_string());
    }

    JSONValue parse_object() {
        advance(); // consume '{'
        skip_whitespace();
        JSONObject result;
        if (current_char() == '}') {
            advance();
            return JSONValue(result);
        }
        while (true) {
            skip_whitespace();
            if (current_char() != '"') {
                throw std::runtime_error("Expected string key in object");
            }
            // Use parse_key for efficient key parsing and interning
            const std::string& key = parse_key();
            skip_whitespace();
            if (current_char() != ':') {
                throw std::runtime_error("Expected ':' after object key");
            }
            advance();
            JSONValue value = parse_value();
            result[key] = value;
            skip_whitespace();
            char c = current_char();
            if (c == '}') {
                advance();
                break;
            } else if (c == ',') {
                advance();
            } else {
                throw std::runtime_error("Expected ',' or '}' in object");
            }
        }
        return JSONValue(result);
    }
};

// Convenience functions
inline JSONValue parse(const std::string& json_string) {
    JSONParser parser(json_string);
    return parser.parse();
}

// Stream operators
inline std::ostream& operator<<(std::ostream& os, const JSONValue& json) {
    return os << json.to_string();
}

// --- JSON field access helpers for better error messages ---
    inline bool has_key(const JSONObject& obj, const std::string& key) {
        return obj.find(key) != obj.end();
    }

    inline int get_int(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required int field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_int();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not an int";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }
    inline double get_double(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required double field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_number();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not a double";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }
    inline std::string get_string(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required string field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_string();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not a string";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }
    inline bool get_bool(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required bool field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_bool();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not a bool";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }
    inline const JSONArray& get_array(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required array field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_array();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not an array";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }
    inline const JSONObject& get_object(const JSONObject& obj, const std::string& key, const char* context = nullptr) {
        auto it = obj.find(key);
        if (it == obj.end() || it->second.is_null()) {
            std::string msg = "Missing required object field '" + key + "'";
            if (context) msg += " in " + std::string(context);
            throw std::runtime_error(msg);
        }
        try {
            return it->second.as_object();
        } catch (const std::exception& e) {
            std::string msg = "Field '" + key + "' is not an object";
            if (context) msg += " in " + std::string(context);
            msg += ": ";
            msg += e.what();
            throw std::runtime_error(msg);
        }
    }

} // namespace json


} // namespace doof_runtime

// ==================== Global Array Printing Support ====================
// These need to be in global namespace for proper ADL (Argument Dependent Lookup)

/**
 * Print std::vector as JSON array
 */
template<typename T>
std::ostream& operator<<(std::ostream& os, const std::vector<T>& vec) {
    os << "[";
    for (size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) os << ",";
        if constexpr (std::is_same_v<T, std::string>) {
            os << doof_runtime::json_encode(vec[i]);
        } else if constexpr (std::is_same_v<T, bool>) {
            os << (vec[i] ? "true" : "false");
        } else {
            os << vec[i];
        }
    }
    os << "]";
    return os;
}

/**
 * Print std::array as JSON array
 */
template<typename T, size_t N>
std::ostream& operator<<(std::ostream& os, const std::array<T, N>& arr) {
    os << "[";
    for (size_t i = 0; i < N; ++i) {
        if (i > 0) os << ",";
        if constexpr (std::is_same_v<T, std::string>) {
            os << doof_runtime::json_encode(arr[i]);
        } else if constexpr (std::is_same_v<T, bool>) {
            os << (arr[i] ? "true" : "false");
        } else {
            os << arr[i];
        }
    }
    os << "]";
    return os;
}

/**
 * Print std::shared_ptr<std::vector<T>> as JSON array  
 */
template<typename T>
std::ostream& operator<<(std::ostream& os, const std::shared_ptr<std::vector<T>>& vec_ptr) {
    if (vec_ptr) {
        return os << *vec_ptr;
    } else {
        return os << "null";
    }
}

// -------------------- Map printing as JSON --------------------
// std::map<std::string, V> -> JSON object
template<typename V>
std::ostream& operator<<(std::ostream& os, const std::map<std::string, V>& m) {
    os << "{";
    bool first = true;
    for (const auto& kv : m) {
        if (!first) os << ",";
        first = false;
        os << doof_runtime::json_encode(kv.first) << ":";
        if constexpr (std::is_same_v<V, std::string>) {
            os << doof_runtime::json_encode(kv.second);
        } else if constexpr (std::is_same_v<V, bool>) {
            os << (kv.second ? "true" : "false");
        } else {
            os << kv.second;
        }
    }
    os << "}";
    return os;
}

// Generic std::map<K,V> (non-string keys): JSON array of {"key":..., "value":...}
template<typename K, typename V>
std::ostream& operator<<(std::ostream& os, const std::map<K, V>& m) {
    os << "[";
    bool first = true;
    for (const auto& kv : m) {
        if (!first) os << ",";
        first = false;
        os << "{\"key\":";
        if constexpr (std::is_same_v<K, std::string>) {
            os << doof_runtime::json_encode(kv.first);
        } else if constexpr (std::is_same_v<K, bool>) {
            os << (kv.first ? "true" : "false");
        } else {
            os << kv.first;
        }
        os << ",\"value\":";
        if constexpr (std::is_same_v<V, std::string>) {
            os << doof_runtime::json_encode(kv.second);
        } else if constexpr (std::is_same_v<V, bool>) {
            os << (kv.second ? "true" : "false");
        } else {
            os << kv.second;
        }
        os << "}";
    }
    os << "]";
    return os;
}

// std::unordered_map<std::string, V> -> JSON object
template<typename V>
std::ostream& operator<<(std::ostream& os, const std::unordered_map<std::string, V>& m) {
    os << "{";
    bool first = true;
    for (const auto& kv : m) {
        if (!first) os << ",";
        first = false;
        os << doof_runtime::json_encode(kv.first) << ":";
        if constexpr (std::is_same_v<V, std::string>) {
            os << doof_runtime::json_encode(kv.second);
        } else if constexpr (std::is_same_v<V, bool>) {
            os << (kv.second ? "true" : "false");
        } else {
            os << kv.second;
        }
    }
    os << "}";
    return os;
}

// Generic std::unordered_map<K,V> (non-string keys): JSON array of {key,value}
template<typename K, typename V>
std::ostream& operator<<(std::ostream& os, const std::unordered_map<K, V>& m) {
    os << "[";
    bool first = true;
    for (const auto& kv : m) {
        if (!first) os << ",";
        first = false;
        os << "{\"key\":";
        if constexpr (std::is_same_v<K, std::string>) {
            os << doof_runtime::json_encode(kv.first);
        } else if constexpr (std::is_same_v<K, bool>) {
            os << (kv.first ? "true" : "false");
        } else {
            os << kv.first;
        }
        os << ",\"value\":";
        if constexpr (std::is_same_v<V, std::string>) {
            os << doof_runtime::json_encode(kv.second);
        } else if constexpr (std::is_same_v<V, bool>) {
            os << (kv.second ? "true" : "false");
        } else {
            os << kv.second;
        }
        os << "}";
    }
    os << "]";
    return os;
}

// -------------------- Set printing as JSON array --------------------
template<typename T>
std::ostream& operator<<(std::ostream& os, const std::unordered_set<T>& s) {
    os << "[";
    bool first = true;
    for (const auto& element : s) {
        if (!first) os << ",";
        first = false;
        if constexpr (std::is_same_v<T, std::string>) {
            os << doof_runtime::json_encode(element);
        } else if constexpr (std::is_same_v<T, bool>) {
            os << (element ? "true" : "false");
        } else {
            os << element;
        }
    }
    os << "]";
    return os;
}

template<typename T>
std::ostream& operator<<(std::ostream& os, const std::set<T>& s) {
    os << "[";
    bool first = true;
    for (const auto& element : s) {
        if (!first) os << ",";
        first = false;
        if constexpr (std::is_same_v<T, std::string>) {
            os << doof_runtime::json_encode(element);
        } else if constexpr (std::is_same_v<T, bool>) {
            os << (element ? "true" : "false");
        } else {
            os << element;
        }
    }
    os << "]";
    return os;
}

#endif // DOOF_RUNTIME_H
