#pragma once

#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "doof_runtime.hpp"

namespace doof_openai {

inline bool jsonIsObject(const doof::JsonValue& value) {
    return std::holds_alternative<doof::JsonValue::Object>(value.value);
}

inline bool jsonIsArray(const doof::JsonValue& value) {
    return std::holds_alternative<doof::JsonValue::Array>(value.value);
}

inline doof::JsonValue jsonObjectGet(const doof::JsonValue& value, const std::string& key) {
    if (!std::holds_alternative<doof::JsonValue::Object>(value.value)) {
        return doof::JsonValue(nullptr);
    }

    const auto& object = std::get<doof::JsonValue::Object>(value.value);
    if (object == nullptr) {
        return doof::JsonValue(nullptr);
    }

    const auto it = object->find(key);
    if (it == object->end()) {
        return doof::JsonValue(nullptr);
    }

    return it->second;
}

inline std::shared_ptr<std::vector<doof::JsonValue>> jsonArrayValues(const doof::JsonValue& value) {
    if (!std::holds_alternative<doof::JsonValue::Array>(value.value)) {
        return std::make_shared<std::vector<doof::JsonValue>>();
    }

    const auto& array = std::get<doof::JsonValue::Array>(value.value);
    if (array == nullptr) {
        return std::make_shared<std::vector<doof::JsonValue>>();
    }

    return array;
}

inline std::optional<std::string> jsonStringValue(const doof::JsonValue& value) {
    if (!std::holds_alternative<std::string>(value.value)) {
        return std::nullopt;
    }

    return std::get<std::string>(value.value);
}

} // namespace doof_openai