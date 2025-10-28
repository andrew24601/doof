#pragma once
#include <iostream>
#include <sstream>
#include <variant>
#include <memory>
#include <vector>
#include <string>
#include <map>
#include <unordered_set>

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
