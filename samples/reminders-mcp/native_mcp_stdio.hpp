#pragma once

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

struct NativeMcpRequest {
    std::string kind;
    std::string requestIdJson;
    std::string method;
    std::string toolName;
    std::string argsJson;
    std::string protocolVersion;
    int32_t errorCode = 0;
    std::string errorMessage;

    bool hasRequestId() const {
        return !requestIdJson.empty();
    }
};

namespace doof_mcp_detail {

using json = nlohmann::json;

inline std::string trim_copy(std::string value) {
    auto notSpace = [](unsigned char ch) { return !std::isspace(ch); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), notSpace));
    value.erase(std::find_if(value.rbegin(), value.rend(), notSpace).base(), value.end());
    return value;
}

inline std::string lower_copy(std::string_view value) {
    std::string result;
    result.reserve(value.size());
    for (const unsigned char ch : value) {
        result.push_back(static_cast<char>(std::tolower(ch)));
    }
    return result;
}

inline NativeMcpRequest make_eof_request() {
    NativeMcpRequest request;
    request.kind = "eof";
    return request;
}

inline NativeMcpRequest make_error_request(int32_t code, std::string message, std::string requestIdJson = {}) {
    NativeMcpRequest request;
    request.kind = "parse-error";
    request.requestIdJson = std::move(requestIdJson);
    request.errorCode = code;
    request.errorMessage = std::move(message);
    return request;
}

inline bool read_frame(std::istream& input, std::string& body, bool& reachedEof, std::string& error) {
    reachedEof = false;
    error.clear();

    std::string line;
    while (true) {
        if (!std::getline(input, line)) {
            reachedEof = true;
            return false;
        }

        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        if (!line.empty()) {
            break;
        }
    }

    const std::string trimmedFirstLine = trim_copy(line);
    if (!trimmedFirstLine.empty()) {
        const char firstChar = trimmedFirstLine.front();
        if (firstChar == '{' || firstChar == '[') {
            body = line;
            return true;
        }
    }

    std::size_t contentLength = 0;
    bool foundLength = false;

    while (true) {
        const auto separator = line.find(':');
        if (separator == std::string::npos) {
            error = "Invalid MCP header: " + line;
            return false;
        }

        const std::string name = lower_copy(trim_copy(line.substr(0, separator)));
        const std::string value = trim_copy(line.substr(separator + 1));
        if (name == "content-length") {
            try {
                contentLength = static_cast<std::size_t>(std::stoul(value));
                foundLength = true;
            } catch (...) {
                error = "Invalid Content-Length header";
                return false;
            }
        }

        if (!std::getline(input, line)) {
            error = "Unexpected end of stream while reading MCP headers";
            return false;
        }

        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        if (line.empty()) {
            break;
        }
    }

    if (!foundLength) {
        error = "Missing Content-Length header";
        return false;
    }

    body.assign(contentLength, '\0');
    input.read(body.data(), static_cast<std::streamsize>(contentLength));
    if (input.gcount() != static_cast<std::streamsize>(contentLength)) {
      error = "Unexpected end of stream while reading MCP body";
      return false;
    }

    return true;
}

inline NativeMcpRequest parse_request(const std::string& body) {
    const json parsed = json::parse(body, nullptr, false);
    if (parsed.is_discarded()) {
        return make_error_request(-32700, "Invalid JSON in MCP request");
    }

    if (!parsed.is_object()) {
        return make_error_request(-32600, "MCP request must be a JSON object");
    }

    if (!parsed.contains("jsonrpc") || parsed["jsonrpc"] != "2.0") {
        return make_error_request(-32600, "MCP request must declare jsonrpc 2.0");
    }

    NativeMcpRequest request;
    if (parsed.contains("id")) {
        request.requestIdJson = parsed["id"].dump();
    }

    if (parsed.contains("method") && parsed["method"].is_string()) {
        request.method = parsed["method"].get<std::string>();
    }

    if (request.method.empty()) {
        return make_error_request(-32600, "MCP request is missing a string method", request.requestIdJson);
    }

    const bool isNotification = !parsed.contains("id");
    if (isNotification) {
        request.kind = request.method == "notifications/initialized" ? "initialized-notification" : "notification";
        return request;
    }

    if (request.method == "initialize") {
        request.kind = "initialize";
        if (parsed.contains("params") && parsed["params"].is_object()) {
            request.protocolVersion = parsed["params"].value("protocolVersion", "");
        }
        return request;
    }

    if (request.method == "tools/list") {
        request.kind = "tools-list";
        return request;
    }

    if (request.method == "tools/call") {
        request.kind = "tools-call";
        if (!parsed.contains("params") || !parsed["params"].is_object()) {
            return make_error_request(-32602, "tools/call requires an object params field", request.requestIdJson);
        }

        const json& params = parsed["params"];
        if (!params.contains("name") || !params["name"].is_string()) {
            return make_error_request(-32602, "tools/call requires a string params.name", request.requestIdJson);
        }

        request.toolName = params["name"].get<std::string>();
        if (params.contains("arguments")) {
            request.argsJson = params["arguments"].dump();
        } else {
            request.argsJson = "{}";
        }
        return request;
    }

    request.kind = "unknown-request";
    return request;
}

inline json parse_json_fragment(const std::string& text) {
    const json parsed = json::parse(text, nullptr, false);
    if (parsed.is_discarded()) {
        return text;
    }
    return parsed;
}

inline void write_message(const json& payload) {
    const std::string encoded = payload.dump();
    std::cout << encoded << '\n';
    std::cout.flush();
}

} // namespace doof_mcp_detail

class NativeMcpServer {
public:
    NativeMcpServer() = default;

    bool isOpen() const {
        return open_;
    }

    std::shared_ptr<NativeMcpRequest> nextRequest() {
        if (!open_) {
            return std::make_shared<NativeMcpRequest>(doof_mcp_detail::make_eof_request());
        }

        std::string body;
        std::string error;
        bool reachedEof = false;
        if (!doof_mcp_detail::read_frame(std::cin, body, reachedEof, error)) {
            if (reachedEof) {
                open_ = false;
                return std::make_shared<NativeMcpRequest>(doof_mcp_detail::make_eof_request());
            }

            open_ = std::cin.good();
            return std::make_shared<NativeMcpRequest>(doof_mcp_detail::make_error_request(-32700, error));
        }

        return std::make_shared<NativeMcpRequest>(doof_mcp_detail::parse_request(body));
    }

    void sendResult(const std::string& requestIdJson, const std::string& resultJson) const {
        if (requestIdJson.empty()) {
            return;
        }

        doof_mcp_detail::json response = {
            {"jsonrpc", "2.0"},
            {"id", doof_mcp_detail::parse_json_fragment(requestIdJson)},
            {"result", doof_mcp_detail::parse_json_fragment(resultJson)},
        };
        doof_mcp_detail::write_message(response);
    }

    void sendError(const std::string& requestIdJson, int32_t code, const std::string& message) const {
        doof_mcp_detail::json response = {
            {"jsonrpc", "2.0"},
            {"id", requestIdJson.empty() ? doof_mcp_detail::json(nullptr) : doof_mcp_detail::parse_json_fragment(requestIdJson)},
            {"error", {
                {"code", code},
                {"message", message},
            }},
        };
        doof_mcp_detail::write_message(response);
    }

    void log(const std::string& message) const {
        std::cerr << "[doof-reminders-mcp] " << message << std::endl;
    }

private:
    bool open_ = true;
};