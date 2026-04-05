#pragma once

#include <cstdint>
#include <memory>
#include <regex>
#include <string>
#include <utility>
#include <vector>

#include "doof_runtime.hpp"

struct NativeRegexCapture {
    bool found;
    std::string text;
    int32_t start;
    int32_t end;
};

class NativeRegexSearchResult {
public:
    NativeRegexSearchResult(bool found, std::string text, int32_t start, int32_t end,
                            std::vector<NativeRegexCapture> captures)
        : found_(found), text_(std::move(text)), start_(start), end_(end), captures_(std::move(captures)) {}

    bool found() const {
        return found_;
    }

    std::string text() const {
        return text_;
    }

    int32_t start() const {
        return start_;
    }

    int32_t end() const {
        return end_;
    }

    int32_t captureCount() const {
        return static_cast<int32_t>(captures_.size());
    }

    bool captureFound(int32_t index) const {
        const auto* capture = captureAt(index);
        return capture != nullptr && capture->found;
    }

    std::string captureText(int32_t index) const {
        const auto* capture = captureAt(index);
        if (capture == nullptr || !capture->found) {
            return "";
        }
        return capture->text;
    }

    int32_t captureStart(int32_t index) const {
        const auto* capture = captureAt(index);
        if (capture == nullptr || !capture->found) {
            return -1;
        }
        return capture->start;
    }

    int32_t captureEnd(int32_t index) const {
        const auto* capture = captureAt(index);
        if (capture == nullptr || !capture->found) {
            return -1;
        }
        return capture->end;
    }

private:
    const NativeRegexCapture* captureAt(int32_t index) const {
        if (index <= 0 || index > static_cast<int32_t>(captures_.size())) {
            return nullptr;
        }
        return &captures_[static_cast<std::size_t>(index - 1)];
    }

    bool found_;
    std::string text_;
    int32_t start_;
    int32_t end_;
    std::vector<NativeRegexCapture> captures_;
};

class NativeRegex {
public:
    static doof::Result<std::shared_ptr<NativeRegex>, std::string> compile(const std::string& pattern, bool ignoreCase) {
        auto flags = std::regex_constants::ECMAScript;
        if (ignoreCase) {
            flags = static_cast<std::regex_constants::syntax_option_type>(flags | std::regex_constants::icase);
        }

        try {
            return doof::Result<std::shared_ptr<NativeRegex>, std::string>::success(
                std::shared_ptr<NativeRegex>(new NativeRegex(std::regex(pattern, flags)))
            );
        } catch (const std::regex_error& error) {
            return doof::Result<std::shared_ptr<NativeRegex>, std::string>::failure(error.what());
        }
    }

    bool matches(const std::string& text) const {
        return std::regex_match(text, regex_);
    }

    bool search(const std::string& text) const {
        return std::regex_search(text, regex_);
    }

    std::shared_ptr<NativeRegexSearchResult> find(const std::string& text) const {
        std::smatch match;
        if (!std::regex_search(text, match, regex_)) {
            return std::make_shared<NativeRegexSearchResult>(false, "", -1, -1, std::vector<NativeRegexCapture>{});
        }

        std::vector<NativeRegexCapture> captures;
        captures.reserve(match.size() > 0 ? match.size() - 1 : 0);
        for (std::size_t index = 1; index < match.size(); ++index) {
            if (!match[index].matched) {
                captures.push_back(NativeRegexCapture{false, "", -1, -1});
                continue;
            }

            const int32_t captureStart = static_cast<int32_t>(match.position(index));
            const int32_t captureEnd = captureStart + static_cast<int32_t>(match.length(index));
            captures.push_back(NativeRegexCapture{true, match.str(index), captureStart, captureEnd});
        }

        const int32_t start = static_cast<int32_t>(match.position(0));
        const int32_t end = start + static_cast<int32_t>(match.length(0));
        return std::make_shared<NativeRegexSearchResult>(true, match.str(0), start, end, std::move(captures));
    }

    std::string replaceAll(const std::string& text, const std::string& replacement) const {
        return std::regex_replace(text, regex_, replacement);
    }

    std::string replaceFirst(const std::string& text, const std::string& replacement) const {
        return std::regex_replace(text, regex_, replacement, std::regex_constants::format_first_only);
    }

private:
    explicit NativeRegex(std::regex regex)
        : regex_(std::move(regex)) {}

    std::regex regex_;
};