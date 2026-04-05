// apple_intelligence_bridge.hpp — C++ bridge to Apple Intelligence (macOS 26+)
//
// Calls through to Apple's FoundationModels framework via a Swift
// implementation (apple_intelligence_impl.swift) for on-device text
// generation using Apple Intelligence.
//
// The Swift layer exposes plain C functions (via @_cdecl) that this
// header-only C++ class calls into.  String ownership follows a simple
// convention: the Swift side strdup()'s the result, the C++ side copies
// it into a std::string and then calls ai_free_string().
//
// Requirements:
//   - macOS 26.0+ (Tahoe) with FoundationModels framework
//   - Apple Silicon (M1 or later)
//   - Apple Intelligence enabled in System Settings
//
// Build:
//   cd samples/apple-intelligence && ./build.sh

#pragma once

#include <cstdlib>
#include <memory>
#include <string>
#include "doof_runtime.hpp"

// ── C functions implemented in Swift (apple_intelligence_impl.swift) ─────
//
// Each function returns a malloc'd C string on success.
// On failure it returns nullptr and writes a malloc'd error string
// into *outError.  The caller must ai_free_string() every non-null
// pointer it receives.
extern "C" {
    char* ai_compose(const char* prompt, char** outError);
    char* ai_rewrite(const char* text, const char* style, char** outError);
    char* ai_summarize(const char* text, char** outError);
    void  ai_free_string(char* str);
}

// ── Helper: convert a C-function result pair into doof::Result ───────────
namespace detail {
    inline doof::Result<std::string, std::string>
    wrap_ai_result(char* raw, char* error) {
        if (raw) {
            std::string s(raw);
            ai_free_string(raw);
            return doof::Result<std::string, std::string>::success(std::move(s));
        }
        std::string e(error ? error : "unknown Apple Intelligence error");
        if (error) ai_free_string(error);
        return doof::Result<std::string, std::string>::failure(std::move(e));
    }
} // namespace detail

class AppleIntelligence {
public:
    AppleIntelligence() = default;

    /// Compose new text from a prompt using on-device Apple Intelligence.
    doof::Result<std::string, std::string> compose(const std::string& prompt) const {
        char* error = nullptr;
        char* result = ai_compose(prompt.c_str(), &error);
        return detail::wrap_ai_result(result, error);
    }

    /// Rewrite existing text in a specified style using Apple Intelligence.
    doof::Result<std::string, std::string> rewrite(
        const std::string& text,
        const std::string& style
    ) const {
        char* error = nullptr;
        char* result = ai_rewrite(text.c_str(), style.c_str(), &error);
        return detail::wrap_ai_result(result, error);
    }

    /// Summarize text into a shorter form using Apple Intelligence.
    doof::Result<std::string, std::string> summarize(const std::string& text) const {
        char* error = nullptr;
        char* result = ai_summarize(text.c_str(), &error);
        return detail::wrap_ai_result(result, error);
    }
};

