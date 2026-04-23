#pragma once

#include <cstdint>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "./vendor/httplib.h"

namespace {

std::string buildRequestLine(const httplib::Request& request) {
    std::string target = request.target.empty() ? request.path : request.target;
    if (target.empty()) {
        target = "/";
    }
    std::string version = request.version.empty() ? "HTTP/1.1" : request.version;
    return request.method + " " + target + " " + version;
}

std::string buildHeaderText(const httplib::Request& request) {
    std::string text = buildRequestLine(request);
    for (const auto& entry : request.headers) {
        text += "\r\n";
        text += entry.first;
        text += ": ";
        text += entry.second;
    }
    return text;
}

struct PendingResponse {
    int32_t status = 200;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    bool ready = false;
};

struct PendingRequest {
    std::string headerText;
    std::string body;
    std::mutex mutex;
    std::condition_variable ready;
    PendingResponse response;
};

} // namespace

struct NativeRequest {
    std::string headerText;
    std::string body;

    explicit NativeRequest(std::shared_ptr<PendingRequest> pending)
        : headerText(pending->headerText),
          body(pending->body),
          pending_(std::move(pending)),
          status_(200) {}

    // Test/direct construction: create a NativeRequest from header and body strings
    explicit NativeRequest(std::string headerText, std::string bodyText)
        : headerText(std::move(headerText)),
          body(std::move(bodyText)),
          pending_(nullptr),
          status_(200) {}

    std::string bodyText() const {
        return body;
    }

    void setStatus(int32_t status) {
        status_ = status;
    }

    void addHeader(std::string name, std::string value) {
        responseHeaders_.emplace_back(std::move(name), std::move(value));
    }

    void send(const std::string& body) {
        if (!pending_) {
            return;
        }

        {
            std::lock_guard<std::mutex> lock(pending_->mutex);
            pending_->response.status = status_;
            pending_->response.headers = responseHeaders_;
            pending_->response.body = body;
            pending_->response.ready = true;
        }
        pending_->ready.notify_one();
    }

private:
    std::shared_ptr<PendingRequest> pending_;
    std::vector<std::pair<std::string, std::string>> responseHeaders_;
    int32_t status_;
};

struct NativeHttpServer {
    int32_t port;

    explicit NativeHttpServer(int32_t port)
        : port(port), ready_(false) {
        server_.set_pre_routing_handler([this](const httplib::Request& request, httplib::Response& response) {
            auto pending = std::make_shared<PendingRequest>();
            pending->headerText = buildHeaderText(request);
            pending->body = request.body;

            {
                std::lock_guard<std::mutex> lock(queueMutex_);
                requests_.push(pending);
            }
            queueReady_.notify_one();

            std::unique_lock<std::mutex> lock(pending->mutex);
            pending->ready.wait(lock, [&pending] {
                return pending->response.ready;
            });

            response.status = static_cast<int>(pending->response.status);
            for (const auto& [name, value] : pending->response.headers) {
                response.set_header(name, value);
            }
            response.body = pending->response.body;
            return httplib::Server::HandlerResponse::Handled;
        });

        if (!server_.bind_to_port("0.0.0.0", static_cast<int>(port))) {
            error_ = "cpp-httplib failed to bind port";
            return;
        }

        ready_ = true;
        listenThread_ = std::thread([this] {
            if (!server_.listen_after_bind()) {
                std::lock_guard<std::mutex> lock(queueMutex_);
                if (!shuttingDown_ && error_.empty()) {
                    error_ = "cpp-httplib listen loop exited unexpectedly";
                }
            }
        });
        server_.wait_until_ready();
    }

    ~NativeHttpServer() {
        {
            std::lock_guard<std::mutex> lock(queueMutex_);
            shuttingDown_ = true;
        }
        queueReady_.notify_all();
        server_.stop();
        if (listenThread_.joinable()) {
            listenThread_.join();
        }
    }

    bool isReady() const {
        return ready_;
    }

    std::string errorMessage() const {
        return error_;
    }

    std::shared_ptr<NativeRequest> nextRequest() {
        std::unique_lock<std::mutex> lock(queueMutex_);
        queueReady_.wait(lock, [this] {
            return shuttingDown_ || !requests_.empty();
        });

        if (requests_.empty()) {
            auto pending = std::make_shared<PendingRequest>();
            pending->headerText = "GET / HTTP/1.1";
            return std::make_shared<NativeRequest>(std::move(pending));
        }

        auto pending = requests_.front();
        requests_.pop();
        return std::make_shared<NativeRequest>(std::move(pending));
    }

private:
    httplib::Server server_;
    bool ready_;
    std::string error_;
    bool shuttingDown_ = false;
    std::thread listenThread_;
    std::mutex queueMutex_;
    std::condition_variable queueReady_;
    std::queue<std::shared_ptr<PendingRequest>> requests_;
};