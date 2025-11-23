#include "doof_runtime.h"

namespace doof_runtime {

// ==================== Async Runtime Implementation ====================

void TaskBase::run() {
    TaskState expected = TaskState::PENDING;
    if (state.compare_exchange_strong(expected, TaskState::RUNNING)) {
        execute();
        {
            std::lock_guard<std::mutex> lock(mutex);
            state = TaskState::COMPLETED;
        }
        cv.notify_all();
    }
}

void TaskBase::wait() {
    std::unique_lock<std::mutex> lock(mutex);
    cv.wait(lock, [this]{ return state == TaskState::COMPLETED; });
}

ThreadPool& ThreadPool::instance() {
    static ThreadPool pool(std::thread::hardware_concurrency());
    return pool;
}

ThreadPool::ThreadPool(size_t threads) {
    for(size_t i = 0; i < threads; ++i)
        workers.emplace_back([this] { worker_loop(); });
}

ThreadPool::~ThreadPool() {
    {
        std::unique_lock<std::mutex> lock(queue_mutex);
        stop = true;
    }
    queue_cv.notify_all();
    for(std::thread &worker: workers)
        worker.join();
}

void ThreadPool::submit(std::shared_ptr<TaskBase> task) {
    {
        std::lock_guard<std::mutex> lock(queue_mutex);
        queue.push_back(task);
    }
    queue_cv.notify_one();
}

void ThreadPool::worker_loop() {
    while(true) {
        std::shared_ptr<TaskBase> task;
        {
            std::unique_lock<std::mutex> lock(queue_mutex);
            queue_cv.wait(lock, [this]{ return stop || !queue.empty(); });
            if(stop && queue.empty()) return;
            if (queue.empty()) continue; // Spurious wake
            task = queue.front();
            queue.pop_front();
        }
        task->run();
    }
}

// ==================== String Helper Functions ====================

std::string string_to_lower(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

std::string string_to_upper(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(), ::toupper);
    return result;
}

std::string string_replace(const std::string& str, const std::string& from, const std::string& to) {
    std::string result = str;
    size_t pos = result.find(from);
    if (pos != std::string::npos) {
        result.replace(pos, from.length(), to);
    }
    return result;
}

std::shared_ptr<std::vector<std::string>> string_split(const std::string& str, const std::string& separator) {
    auto result = std::make_shared<std::vector<std::string>>();
    
    if (separator.empty()) {
        // If separator is empty, split into individual characters
        for (char c : str) {
            result->push_back(std::string(1, c));
        }
    } else {
        // Split by separator
        size_t start = 0;
        size_t pos = str.find(separator);
        
        while (pos != std::string::npos) {
            result->push_back(str.substr(start, pos - start));
            start = pos + separator.length();
            pos = str.find(separator, start);
        }
        
        // Add the remaining part
        result->push_back(str.substr(start));
    }
    
    return result;
}

std::shared_ptr<std::vector<std::string>> string_split(const std::string& str, char separator) {
    // Convert char to string and delegate to the main implementation
    return string_split(str, std::string(1, separator));
}

std::string json_encode(const std::string& str) {
    std::string result = "\"";
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (c < 0x20) {
                    result += "\\u";
                    result += "0123456789abcdef"[(c >> 12) & 0xF];
                    result += "0123456789abcdef"[(c >> 8) & 0xF];
                    result += "0123456789abcdef"[(c >> 4) & 0xF];
                    result += "0123456789abcdef"[c & 0xF];
                } else {
                    result += c;
                }
                break;
        }
    }
    result += "\"";
    return result;
}

// ==================== Type Conversion Functions ====================

int string_to_int(const std::string& str) {
    if (str.empty()) {
        std::cerr << "panic: cannot convert empty string to int" << std::endl;
        std::exit(1);
    }
    
    // Remove leading/trailing whitespace
    std::string trimmed = str;
    trimmed.erase(trimmed.begin(), std::find_if(trimmed.begin(), trimmed.end(), [](unsigned char ch) {
        return !std::isspace(ch);
    }));
    trimmed.erase(std::find_if(trimmed.rbegin(), trimmed.rend(), [](unsigned char ch) {
        return !std::isspace(ch);
    }).base(), trimmed.end());
    
    if (trimmed.empty()) {
        std::cerr << "panic: cannot convert whitespace-only string to int" << std::endl;
        std::exit(1);
    }
    
    try {
        size_t pos;
        int result = std::stoi(trimmed, &pos);
        
        // Check if entire string was consumed
        if (pos != trimmed.length()) {
            std::cerr << "panic: invalid integer string: '" << str << "'" << std::endl;
            std::exit(1);
        }
        
        return result;
    } catch (const std::exception&) {
        std::cerr << "panic: invalid integer string: '" << str << "'" << std::endl;
        std::exit(1);
    }
}

float string_to_float(const std::string& str) {
    if (str.empty()) {
        std::cerr << "panic: cannot convert empty string to float" << std::endl;
        std::exit(1);
    }
    
    // Remove leading/trailing whitespace
    std::string trimmed = str;
    trimmed.erase(trimmed.begin(), std::find_if(trimmed.begin(), trimmed.end(), [](unsigned char ch) {
        return !std::isspace(ch);
    }));
    trimmed.erase(std::find_if(trimmed.rbegin(), trimmed.rend(), [](unsigned char ch) {
        return !std::isspace(ch);
    }).base(), trimmed.end());
    
    if (trimmed.empty()) {
        std::cerr << "panic: cannot convert whitespace-only string to float" << std::endl;
        std::exit(1);
    }
    
    try {
        size_t pos;
        float result = std::stof(trimmed, &pos);
        
        // Check if entire string was consumed
        if (pos != trimmed.length()) {
            std::cerr << "panic: invalid float string: '" << str << "'" << std::endl;
            std::exit(1);
        }
        
        return result;
    } catch (const std::exception&) {
        std::cerr << "panic: invalid float string: '" << str << "'" << std::endl;
        std::exit(1);
    }
}

double string_to_double(const std::string& str) {
    if (str.empty()) {
        std::cerr << "panic: cannot convert empty string to double" << std::endl;
        std::exit(1);
    }
    
    // Remove leading/trailing whitespace
    std::string trimmed = str;
    trimmed.erase(trimmed.begin(), std::find_if(trimmed.begin(), trimmed.end(), [](unsigned char ch) {
        return !std::isspace(ch);
    }));
    trimmed.erase(std::find_if(trimmed.rbegin(), trimmed.rend(), [](unsigned char ch) {
        return !std::isspace(ch);
    }).base(), trimmed.end());
    
    if (trimmed.empty()) {
        std::cerr << "panic: cannot convert whitespace-only string to double" << std::endl;
        std::exit(1);
    }
    
    try {
        size_t pos;
        double result = std::stod(trimmed, &pos);
        
        // Check if entire string was consumed
        if (pos != trimmed.length()) {
            std::cerr << "panic: invalid double string: '" << str << "'" << std::endl;
            std::exit(1);
        }
        
        return result;
    } catch (const std::exception&) {
        std::cerr << "panic: invalid double string: '" << str << "'" << std::endl;
        std::exit(1);
    }
}

bool string_to_bool(const std::string& str) {
    if (str == "true") {
        return true;
    } else if (str == "false") {
        return false;
    } else if (str == "1") {
        return true;
    } else if (str == "0") {
        return false;
    } else {
        std::cerr << "panic: invalid bool string: '" << str << "' (must be 'true', 'false', '1', or '0')" << std::endl;
        std::exit(1);
    }
}

std::string bool_to_string(bool value) {
    return value ? "true" : "false";
}

// ==================== Math Functions ====================

namespace Math {
    // Mathematical constants
    const double PI = 3.14159265358979323846;
    const double E = 2.71828182845904523536;
    
    // Basic functions
    double abs(double x) { return std::abs(x); }
    double pow(double base, double exp) { return std::pow(base, exp); }
    double sqrt(double x) { return std::sqrt(x); }
    double min(double a, double b) { return std::min(a, b); }
    double max(double a, double b) { return std::max(a, b); }
    
    // Trigonometric functions
    double sin(double x) { return std::sin(x); }
    double cos(double x) { return std::cos(x); }
    double tan(double x) { return std::tan(x); }
    double asin(double x) { return std::asin(x); }
    double acos(double x) { return std::acos(x); }
    double atan(double x) { return std::atan(x); }
    double atan2(double y, double x) { return std::atan2(y, x); }
    
    // Exponential and logarithmic
    double exp(double x) { return std::exp(x); }
    double log(double x) { return std::log(x); }
    double log10(double x) { return std::log10(x); }
    
    // Rounding functions
    double floor(double x) { return std::floor(x); }
    double ceil(double x) { return std::ceil(x); }
    double round(double x) { return std::round(x); }
    
    // Additional functions
    double fmod(double a, double b) { return std::fmod(a, b); }
    double hypot(double a, double b) { return std::hypot(a, b); }
}

} // namespace doof_runtime
