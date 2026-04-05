#pragma once

#include <arpa/inet.h>
#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <netinet/in.h>
#include <string>
#include <string_view>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <utility>
#include <vector>

namespace {

constexpr std::size_t kClientReadTimeoutSeconds = 5;

std::string toLowerCopy(std::string_view text) {
    std::string lower;
    lower.reserve(text.size());
    for (const unsigned char ch : text) {
        lower.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lower;
}

std::string trimCopy(std::string_view text) {
    std::size_t start = 0;
    while (start < text.size() && std::isspace(static_cast<unsigned char>(text[start]))) {
        start += 1;
    }

    std::size_t end = text.size();
    while (end > start && std::isspace(static_cast<unsigned char>(text[end - 1]))) {
        end -= 1;
    }

    return std::string(text.substr(start, end - start));
}

bool headerValueHasToken(std::string_view value, std::string_view token) {
    std::string remaining = toLowerCopy(value);
    const std::string target = toLowerCopy(token);

    std::size_t start = 0;
    while (start <= remaining.size()) {
        const std::size_t end = remaining.find(',', start);
        const std::string entry = trimCopy(std::string_view(remaining).substr(start, end == std::string::npos ? remaining.size() - start : end - start));
        if (entry == target) {
            return true;
        }
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }

    return false;
}

std::string headerValue(const std::string& headers, std::string_view name) {
    const auto linesStart = headers.find("\r\n");
    if (linesStart == std::string::npos) {
        return std::string();
    }

    const std::string target = toLowerCopy(name);
    std::size_t lineStart = linesStart + 2;
    while (lineStart <= headers.size()) {
        const std::size_t lineEnd = headers.find("\r\n", lineStart);
        const std::size_t sliceEnd = lineEnd == std::string::npos ? headers.size() : lineEnd;
        const std::string_view line(headers.data() + lineStart, sliceEnd - lineStart);
        if (line.empty()) {
            break;
        }

        const std::size_t separator = line.find(':');
        if (separator != std::string::npos) {
            const std::string currentName = toLowerCopy(trimCopy(line.substr(0, separator)));
            if (currentName == target) {
                return trimCopy(line.substr(separator + 1));
            }
        }

        if (lineEnd == std::string::npos) {
            break;
        }
        lineStart = lineEnd + 2;
    }

    return std::string();
}

std::string requestVersion(const std::string& headerText) {
    const std::size_t lineEnd = headerText.find("\r\n");
    const std::string_view requestLine(headerText.data(), lineEnd == std::string::npos ? headerText.size() : lineEnd);
    const std::size_t firstSpace = requestLine.find(' ');
    if (firstSpace == std::string::npos) {
        return std::string();
    }
    const std::size_t secondSpace = requestLine.find(' ', firstSpace + 1);
    if (secondSpace == std::string::npos || secondSpace + 1 >= requestLine.size()) {
        return std::string();
    }
    return trimCopy(requestLine.substr(secondSpace + 1));
}

bool requestWantsKeepAlive(const std::string& headerText) {
    const std::string version = requestVersion(headerText);
    const std::string connection = headerValue(headerText, "connection");
    if (version == "HTTP/1.1") {
        return !headerValueHasToken(connection, "close");
    }
    if (version == "HTTP/1.0") {
        return headerValueHasToken(connection, "keep-alive");
    }
    return false;
}

std::size_t parseContentLength(const std::string& headers) {
    const std::string lengthText = headerValue(headers, "content-length");
    if (lengthText.empty()) {
        return 0;
    }

    char* end = nullptr;
    const unsigned long parsed = std::strtoul(lengthText.c_str(), &end, 10);
    if (end == lengthText.c_str() || (end != nullptr && *end != '\0')) {
        return 0;
    }
    return static_cast<std::size_t>(parsed);
}

std::string statusText(int32_t status) {
    switch (status) {
        case 200:
            return "OK";
        case 400:
            return "Bad Request";
        case 404:
            return "Not Found";
        case 405:
            return "Method Not Allowed";
        default:
            return "Internal Server Error";
    }
}

void writeAll(int clientFd, const std::string& data) {
    std::size_t written = 0;
    while (written < data.size()) {
        const ssize_t count = ::send(clientFd, data.data() + written, data.size() - written, 0);
        if (count <= 0) {
            return;
        }
        written += static_cast<std::size_t>(count);
    }
}

struct NativeConnection {
    explicit NativeConnection(int clientFd) : clientFd(clientFd) {}

    ~NativeConnection() {
        close();
    }

    void close() {
        if (clientFd >= 0) {
            ::shutdown(clientFd, SHUT_RDWR);
            ::close(clientFd);
            clientFd = -1;
        }
    }

    bool isOpen() const {
        return clientFd >= 0;
    }

    int clientFd;
};

enum class ReadHttpResultKind {
    success,
    badRequest,
    closed,
    timeout,
};

struct ReadHttpResult {
    ReadHttpResultKind kind;
    std::string headerText;
    std::vector<std::uint8_t> bodyBytes;
};

} // namespace

struct NativeRequest {
    std::string headerText;

    explicit NativeRequest(std::string headerText, std::string bodyText)
        : headerText(std::move(headerText)),
          bodyBytes_(bodyText.begin(), bodyText.end()),
          status_(200),
          keepAliveRequested_(false) {}

    explicit NativeRequest(
        std::string headerText,
        std::vector<std::uint8_t> bodyBytes,
        std::shared_ptr<NativeConnection> connection,
        bool keepAliveRequested)
        : headerText(std::move(headerText)),
          bodyBytes_(std::move(bodyBytes)),
          connection_(std::move(connection)),
          status_(200),
          keepAliveRequested_(keepAliveRequested) {}

    std::string bodyText() const {
        return std::string(bodyBytes_.begin(), bodyBytes_.end());
    }

    void setStatus(int32_t status) {
        status_ = status;
    }

    void addHeader(std::string name, std::string value) {
        responseHeaders_.emplace_back(std::move(name), std::move(value));
    }

    void send(const std::string& body) {
        if (!connection_ || !connection_->isOpen()) {
            return;
        }

        const bool closeAfterSend = responseWantsClose() || !keepAliveRequested_;
        std::string response = "HTTP/1.1 " + std::to_string(status_) + " " + statusText(status_) + "\r\n";
        for (const auto& [name, value] : responseHeaders_) {
            const std::string lowerName = toLowerCopy(name);
            if (lowerName == "content-length" || lowerName == "connection") {
                continue;
            }
            response += name + ": " + value + "\r\n";
        }
        response += "Content-Length: " + std::to_string(body.size()) + "\r\n";
        response += closeAfterSend ? "Connection: close\r\n" : "Connection: keep-alive\r\n";
        response += "\r\n";
        response += body;

        writeAll(connection_->clientFd, response);
        if (closeAfterSend) {
            connection_->close();
        }
    }

private:
    std::vector<std::uint8_t> bodyBytes_;
    std::shared_ptr<NativeConnection> connection_;
    std::vector<std::pair<std::string, std::string>> responseHeaders_;
    int32_t status_;
    bool keepAliveRequested_;

    bool responseWantsClose() const {
        for (const auto& [name, value] : responseHeaders_) {
            if (toLowerCopy(name) == "connection" && headerValueHasToken(value, "close")) {
                return true;
            }
        }
        return false;
    }
};

struct NativeHttpServer {
    int32_t port;

    explicit NativeHttpServer(int32_t port)
        : port(port), serverFd_(-1), ready_(false) {
        openSocket();
    }

    ~NativeHttpServer() {
        if (serverFd_ >= 0) {
            ::close(serverFd_);
        }
    }

    bool isReady() const {
        return ready_;
    }

    std::string errorMessage() const {
        return error_;
    }

    std::shared_ptr<NativeRequest> nextRequest() {
        for (;;) {
            if (!currentConnection_ || !currentConnection_->isOpen()) {
                currentConnection_ = acceptConnection();
                if (!currentConnection_) {
                    continue;
                }
            }

            ReadHttpResult request = readHttpMessage(currentConnection_->clientFd);
            if (request.kind == ReadHttpResultKind::success) {
                return std::make_shared<NativeRequest>(
                    std::move(request.headerText),
                    std::move(request.bodyBytes),
                    currentConnection_,
                    requestWantsKeepAlive(request.headerText));
            }

            if (request.kind == ReadHttpResultKind::badRequest) {
                sendResponse(currentConnection_->clientFd, 400, {{"Content-Type", "text/plain; charset=utf-8"}}, "Bad Request\n", false);
            }

            if (currentConnection_) {
                currentConnection_->close();
                currentConnection_.reset();
            }

            if (request.kind == ReadHttpResultKind::closed || request.kind == ReadHttpResultKind::timeout || request.kind == ReadHttpResultKind::badRequest) {
                continue;
            }
        }
    }

private:
    int serverFd_;
    bool ready_;
    std::string error_;
    std::shared_ptr<NativeConnection> currentConnection_;

    void openSocket() {
        serverFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (serverFd_ < 0) {
            error_ = std::string("socket() failed: ") + std::strerror(errno);
            return;
        }

        int reuse = 1;
        if (::setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse)) != 0) {
            error_ = std::string("setsockopt() failed: ") + std::strerror(errno);
            ::close(serverFd_);
            serverFd_ = -1;
            return;
        }

        sockaddr_in addr {};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<uint16_t>(port));
        addr.sin_addr.s_addr = htonl(INADDR_ANY);

        if (::bind(serverFd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            error_ = std::string("bind() failed: ") + std::strerror(errno);
            ::close(serverFd_);
            serverFd_ = -1;
            return;
        }

        if (::listen(serverFd_, 16) != 0) {
            error_ = std::string("listen() failed: ") + std::strerror(errno);
            ::close(serverFd_);
            serverFd_ = -1;
            return;
        }

        ready_ = true;
    }

    std::shared_ptr<NativeConnection> acceptConnection() {
        for (;;) {
            sockaddr_in clientAddr {};
            socklen_t clientLen = sizeof(clientAddr);
            const int clientFd = ::accept(serverFd_, reinterpret_cast<sockaddr*>(&clientAddr), &clientLen);
            if (clientFd < 0) {
                if (errno == EINTR) {
                    continue;
                }
                error_ = std::string("accept() failed: ") + std::strerror(errno);
                return nullptr;
            }

            const timeval timeout {
                static_cast<decltype(timeval::tv_sec)>(kClientReadTimeoutSeconds),
                0,
            };
            if (::setsockopt(clientFd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) != 0) {
                error_ = std::string("setsockopt(SO_RCVTIMEO) failed: ") + std::strerror(errno);
                ::close(clientFd);
                return nullptr;
            }

            return std::make_shared<NativeConnection>(clientFd);
        }
    }

    static ReadHttpResult readHttpMessage(int clientFd) {
        constexpr std::size_t kChunkSize = 4096;
        constexpr std::size_t kMaxHeaderBytes = 64 * 1024;
        char buffer[kChunkSize];
        std::string received;
        std::size_t headerEnd = std::string::npos;

        while (headerEnd == std::string::npos) {
            const ssize_t count = ::recv(clientFd, buffer, sizeof(buffer), 0);
            if (count == 0) {
                return {ReadHttpResultKind::closed, {}, {}};
            }
            if (count < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) {
                    return {ReadHttpResultKind::timeout, {}, {}};
                }
                if (errno == EINTR) {
                    continue;
                }
                return {ReadHttpResultKind::badRequest, {}, {}};
            }

            received.append(buffer, static_cast<std::size_t>(count));
            if (received.size() > kMaxHeaderBytes) {
                return {ReadHttpResultKind::badRequest, {}, {}};
            }

            headerEnd = received.find("\r\n\r\n");
        }

        std::string headerText = received.substr(0, headerEnd);
        const std::size_t bodyStart = headerEnd + 4;
        const std::size_t contentLength = parseContentLength(headerText);
        std::vector<std::uint8_t> bodyBytes;

        if (bodyStart < received.size()) {
            bodyBytes.insert(bodyBytes.end(), received.begin() + static_cast<std::ptrdiff_t>(bodyStart), received.end());
        }

        if (bodyBytes.size() > contentLength) {
            bodyBytes.resize(contentLength);
        }

        while (bodyBytes.size() < contentLength) {
            const ssize_t count = ::recv(clientFd, buffer, sizeof(buffer), 0);
            if (count == 0) {
                return {ReadHttpResultKind::closed, {}, {}};
            }
            if (count < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) {
                    return {ReadHttpResultKind::timeout, {}, {}};
                }
                if (errno == EINTR) {
                    continue;
                }
                return {ReadHttpResultKind::badRequest, {}, {}};
            }

            const auto* bytes = reinterpret_cast<const std::uint8_t*>(buffer);
            bodyBytes.insert(bodyBytes.end(), bytes, bytes + static_cast<std::size_t>(count));
            if (bodyBytes.size() > contentLength) {
                bodyBytes.resize(contentLength);
            }
        }

        return {ReadHttpResultKind::success, std::move(headerText), std::move(bodyBytes)};
    }

    static void sendResponse(
        int clientFd,
        int32_t status,
        const std::vector<std::pair<std::string, std::string>>& headers,
        const std::string& body,
        bool keepAlive) {
        std::string response = "HTTP/1.1 " + std::to_string(status) + " " + statusText(status) + "\r\n";
        for (const auto& [name, value] : headers) {
            response += name + ": " + value + "\r\n";
        }
        response += "Content-Length: " + std::to_string(body.size()) + "\r\n";
        response += keepAlive ? "Connection: keep-alive\r\n" : "Connection: close\r\n";
        response += "\r\n";
        response += body;
        writeAll(clientFd, response);
    }
};