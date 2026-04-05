#pragma once

#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "doof_runtime.hpp"

namespace doof_openai {

inline bool jsonIsObject(const doof::JSONValue& value) {
    return std::holds_alternative<doof::JSONValue::Object>(value.value);
}

inline bool jsonIsArray(const doof::JSONValue& value) {
    return std::holds_alternative<doof::JSONValue::Array>(value.value);
}

inline doof::JSONValue jsonObjectGet(const doof::JSONValue& value, const std::string& key) {
    if (!std::holds_alternative<doof::JSONValue::Object>(value.value)) {
        return doof::JSONValue(nullptr);
    }

    const auto& object = std::get<doof::JSONValue::Object>(value.value);
    if (object == nullptr) {
        return doof::JSONValue(nullptr);
    }

    const auto it = object->find(key);
    if (it == object->end()) {
        return doof::JSONValue(nullptr);
    }

    return it->second;
}

inline std::shared_ptr<std::vector<doof::JSONValue>> jsonArrayValues(const doof::JSONValue& value) {
    if (!std::holds_alternative<doof::JSONValue::Array>(value.value)) {
        return std::make_shared<std::vector<doof::JSONValue>>();
    }

    const auto& array = std::get<doof::JSONValue::Array>(value.value);
    if (array == nullptr) {
        return std::make_shared<std::vector<doof::JSONValue>>();
    }

    return array;
}

inline std::optional<std::string> jsonStringValue(const doof::JSONValue& value) {
    if (!std::holds_alternative<std::string>(value.value)) {
        return std::nullopt;
    }

    return std::get<std::string>(value.value);
}

} // namespace doof_openai