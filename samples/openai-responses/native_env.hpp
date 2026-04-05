#pragma once

#include <cstdlib>
#include <string>

class NativeEnv {
public:
    std::string get(const std::string& name) const {
        const char* value = std::getenv(name.c_str());
        if (value == nullptr) {
            return std::string();
        }
        return std::string(value);
    }
};