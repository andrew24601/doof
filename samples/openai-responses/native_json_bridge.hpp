#pragma once

#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "doof_runtime.hpp"

namespace doof_openai {

inline bool jsonIsNull(const doof::JsonValue& value) {
    return doof::json_is_null(value);
}

inline bool jsonIsObject(const doof::JsonValue& value) {
    return doof::json_is_object(value);
}

inline bool jsonIsArray(const doof::JsonValue& value) {
    return doof::json_is_array(value);
}

inline doof::JsonValue jsonObjectGet(const doof::JsonValue& value, const std::string& key) {
    const auto* object = doof::json_as_object(value);
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
    const auto* array = doof::json_as_array(value);
    if (array == nullptr) {
        return std::make_shared<std::vector<doof::JsonValue>>();
    }

    return std::make_shared<std::vector<doof::JsonValue>>(*array);
}

inline std::optional<std::string> jsonStringValue(const doof::JsonValue& value) {
    if (!doof::json_is_string(value)) {
        return std::nullopt;
    }

    return std::get<std::string>(doof::json_storage(value));
}

} // namespace doof_openai
