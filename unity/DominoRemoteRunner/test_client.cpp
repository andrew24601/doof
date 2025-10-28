#include "remote_runner.h"
#include "DoofRemoteRunnerNative.h"

#include <arpa/inet.h>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <iostream>
#include <mutex>
#include <netinet/in.h>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {

struct Event {
    std::string name;
    std::string payload;
};

std::mutex g_event_mutex;
std::condition_variable g_event_cv;
std::vector<Event> g_events;

void log_event(const char* event_name, const char* payload) {
    std::lock_guard<std::mutex> lock(g_event_mutex);
    g_events.push_back(Event{event_name ? event_name : "", payload ? payload : ""});
    g_event_cv.notify_all();
}

bool wait_for_event_after(size_t index,
                          const std::string& expected,
                          std::chrono::milliseconds timeout,
                          Event* out_event = nullptr) {
    auto deadline = std::chrono::steady_clock::now() + timeout;
    std::unique_lock<std::mutex> lock(g_event_mutex);
    bool found = g_event_cv.wait_until(lock, deadline, [&]() {
        if (g_events.size() <= index) {
            return false;
        }
        for (size_t i = index; i < g_events.size(); ++i) {
            if (g_events[i].name == expected) {
                if (out_event) {
                    *out_event = g_events[i];
                }
                return true;
            }
        }
        return false;
    });
    return found;
}

unsigned short acquire_available_port() {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        return 0;
    }
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        ::close(fd);
        return 0;
    }
    socklen_t len = sizeof(addr);
    if (::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len) < 0) {
        ::close(fd);
        return 0;
    }
    unsigned short port = ntohs(addr.sin_port);
    ::close(fd);
    return port;
}

bool connect_and_disconnect(unsigned short port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        return false;
    }
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(port);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        ::close(fd);
        return false;
    }
    // Give the server a brief moment to register the connection before closing.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    ::shutdown(fd, SHUT_RDWR);
    ::close(fd);
    return true;
}

} // namespace

static void event_callback(const char* event_name, const char* payload) {
    std::cout << "[event] " << (event_name ? event_name : "")
              << (payload && payload[0] ? std::string(" -> ") + payload : std::string())
              << std::endl;
    log_event(event_name, payload);
}

int main() {
    drr_register_event_callback(event_callback);

    drr_emit_event("bootstrap", "test_client starting");

    unsigned short port = acquire_available_port();
    if (port == 0) {
        std::cerr << "Failed to acquire available port" << std::endl;
        return 1;
    }

    size_t index = 0;
    if (!drr_start_listener(port)) {
        std::cerr << "Failed to start listener" << std::endl;
        return 1;
    }

    std::cout << "Listener started on port " << port << std::endl;

    if (!wait_for_event_after(index, "listener_started", std::chrono::seconds(2))) {
        std::cerr << "listener_started event not received" << std::endl;
        drr_stop_listener();
        return 1;
    }
    {
        std::lock_guard<std::mutex> lock(g_event_mutex);
        index = g_events.size();
    }

    if (!connect_and_disconnect(port)) {
        std::cerr << "Failed to connect test client socket" << std::endl;
        drr_stop_listener();
        return 1;
    }

    Event connected_event;
    if (!wait_for_event_after(index, "connected", std::chrono::seconds(2), &connected_event)) {
        std::cerr << "connected event not received" << std::endl;
        drr_stop_listener();
        return 1;
    }
    if (connected_event.payload != "1") {
        std::cerr << "Unexpected connected payload: " << connected_event.payload << std::endl;
        drr_stop_listener();
        return 1;
    }
    bool is_connected_flag = drr_is_connected();
    std::cout << "Connected? " << (is_connected_flag ? "yes" : "no") << std::endl;
    if (!is_connected_flag) {
        std::cerr << "Expected drr_is_connected() to report true after connected event" << std::endl;
        drr_stop_listener();
        return 1;
    }
    {
        std::lock_guard<std::mutex> lock(g_event_mutex);
        index = g_events.size();
    }

    Event disconnected_event;
    if (!wait_for_event_after(index, "disconnected", std::chrono::seconds(4), &disconnected_event)) {
        std::cerr << "disconnected event not received" << std::endl;
        drr_stop_listener();
        return 1;
    }
    if (disconnected_event.payload != "0") {
        std::cerr << "Unexpected disconnected payload: " << disconnected_event.payload << std::endl;
        drr_stop_listener();
        return 1;
    }
    if (drr_is_connected()) {
        std::cerr << "Expected drr_is_connected() to report false after disconnection" << std::endl;
        drr_stop_listener();
        return 1;
    }

    if (DoofRemoteRunnerNative::hasPendingEvents()) {
        std::cerr << "Expected no pending Doof events initially" << std::endl;
        drr_stop_listener();
        return 1;
    }
    if (DoofRemoteRunnerNative::waitNextEvent(50)) {
        std::cerr << "waitNextEvent should have timed out with no events" << std::endl;
        drr_stop_listener();
        return 1;
    }
    DoofRemoteRunnerNative::queueUnityEvent("unity_event", "payload_from_unity");
    if (!DoofRemoteRunnerNative::hasPendingEvents()) {
        std::cerr << "Expected pending Doof event after queueUnityEvent" << std::endl;
        drr_stop_listener();
        return 1;
    }
    if (!DoofRemoteRunnerNative::waitNextEvent(500)) {
        std::cerr << "waitNextEvent did not return true for queued event" << std::endl;
        drr_stop_listener();
        return 1;
    }
    std::string lastName = DoofRemoteRunnerNative::lastEventName();
    std::string lastPayload = DoofRemoteRunnerNative::lastEventPayload();
    if (lastName != "unity_event" || lastPayload != "payload_from_unity") {
        std::cerr << "Unexpected Doof event content: name='" << lastName
                  << "' payload='" << lastPayload << "'" << std::endl;
        drr_stop_listener();
        return 1;
    }

    {
        std::lock_guard<std::mutex> lock(g_event_mutex);
        index = g_events.size();
    }
    std::cout << "Stopping listener" << std::endl;
    drr_stop_listener();
    if (!wait_for_event_after(index, "listener_stopped", std::chrono::seconds(2))) {
        std::cerr << "listener_stopped event not received" << std::endl;
        return 1;
    }

    drr_emit_event("shutdown", "test_client complete");
    std::cout << "Done." << std::endl;
    return 0;
}
