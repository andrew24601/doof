#pragma once

#include "vm.h"
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>

namespace DoofVMGlue {

inline void ensure_arguments(Value *args, std::string_view method_label) {
    if (!args) {
        throw std::runtime_error(std::string(method_label) + " missing arguments");
    }
}

inline std::string argument_error(std::string_view method_label,
                                  std::string_view parameter_name,
                                  size_t index,
                                  std::string_view expected) {
    std::string message;
    message.reserve(method_label.size() + parameter_name.size() + expected.size() + 48);
    message.append(method_label);
    message.append(" expected argument '");
    message.append(parameter_name);
    message.append("' (index ");
    message.append(std::to_string(index));
    message.append(") to be ");
    message.append(expected);
    return message;
}

inline const Value &expect_argument(Value *args,
                                    size_t index,
                                    std::string_view method_label,
                                    std::string_view parameter_name) {
    ensure_arguments(args, method_label);
    return args[index];
}

template <typename Fn>
inline Value dispatch(std::string_view method_label,
                      Value *args,
                      Fn &&fn) {
    ensure_arguments(args, method_label);
    try {
        return std::forward<Fn>(fn)();
    } catch (const std::exception &error) {
        throw std::runtime_error(std::string(method_label) + " failed: " + error.what());
    }
}

inline bool expect_bool(Value *args,
                        size_t index,
                        std::string_view method_label,
                        std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Bool) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "bool"));
    }
    return value.as_bool();
}

inline int32_t expect_int(Value *args,
                          size_t index,
                          std::string_view method_label,
                          std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Int) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "int"));
    }
    return value.as_int();
}

inline float expect_float(Value *args,
                          size_t index,
                          std::string_view method_label,
                          std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Float) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "float"));
    }
    return value.as_float();
}

inline double expect_double(Value *args,
                            size_t index,
                            std::string_view method_label,
                            std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Double) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "double"));
    }
    return value.as_double();
}

inline char expect_char(Value *args,
                        size_t index,
                        std::string_view method_label,
                        std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Char) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "char"));
    }
    return value.as_char();
}

inline const std::string &expect_string(Value *args,
                                        size_t index,
                                        std::string_view method_label,
                                        std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::String) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "string"));
    }
    return value.as_string();
}

template <typename T>
inline std::shared_ptr<T> expect_object(Value *args,
                                        size_t index,
                                        const DoofVM::ExternClassHandle &handle,
                                        std::string_view method_label,
                                        std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.type() != ValueType::Object) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "object"));
    }
    return DoofVM::as_instance<T>(value, *handle);
}

template <typename T>
inline std::shared_ptr<T> expect_optional_object(Value *args,
                                                 size_t index,
                                                 const DoofVM::ExternClassHandle &handle,
                                                 std::string_view method_label,
                                                 std::string_view parameter_name) {
    const Value &value = expect_argument(args, index, method_label, parameter_name);
    if (value.is_null()) {
        return nullptr;
    }
    if (value.type() != ValueType::Object) {
        throw std::runtime_error(argument_error(method_label, parameter_name, index, "object"));
    }
    return DoofVM::as_instance<T>(value, *handle);
}

} // namespace DoofVMGlue
