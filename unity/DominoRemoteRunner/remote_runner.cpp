#include "remote_runner.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <string>
#include <utility>

#include "DoofRemoteRunnerNative.h"
#include "../../vm/include/doof_vm_c.h"
#include "../../vm/include/vm_glue_helpers.h"

static std::atomic<bool> g_running{false};
static std::atomic<bool> g_connected{false};

static std::atomic<drr_event_callback> g_event_callback{nullptr};

struct DoofQueuedEvent {
    std::string name;
    std::string payload;
};

static std::mutex g_doof_event_mutex;
static std::condition_variable g_doof_event_cv;
static std::deque<DoofQueuedEvent> g_doof_event_queue;
static DoofQueuedEvent g_last_doof_event;
static bool g_have_last_doof_event = false;

namespace {

void register_remote_runner_externs(DoofVM* vm, void* /*user_data*/) {
    if (!vm) {
        return;
    }

    vm->ensure_extern_class("DoofRemoteRunnerNative");

    vm->register_extern_function("DoofRemoteRunnerNative::start", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::start", args, [&]() -> Value {
            const int port = DoofVMGlue::expect_int(args, 0, "DoofRemoteRunnerNative::start", "port");
            const bool result = DoofRemoteRunnerNative::start(port);
            return Value::make_bool(result);
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::stop", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::stop", args, [&]() -> Value {
            DoofRemoteRunnerNative::stop();
            return Value::make_null();
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::isConnected", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::isConnected", args, [&]() -> Value {
            const bool connected = DoofRemoteRunnerNative::isConnected();
            return Value::make_bool(connected);
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::emitEvent", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::emitEvent", args, [&]() -> Value {
            const std::string& eventName = DoofVMGlue::expect_string(args,
                                                                       0,
                                                                       "DoofRemoteRunnerNative::emitEvent",
                                                                       "eventName");
            const std::string& payload = DoofVMGlue::expect_string(args,
                                                                     1,
                                                                     "DoofRemoteRunnerNative::emitEvent",
                                                                     "payload");
            DoofRemoteRunnerNative::emitEvent(eventName, payload);
            return Value::make_null();
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::waitNextEvent", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::waitNextEvent", args, [&]() -> Value {
            const int timeout = DoofVMGlue::expect_int(args,
                                                         0,
                                                         "DoofRemoteRunnerNative::waitNextEvent",
                                                         "timeoutMillis");
            const bool result = DoofRemoteRunnerNative::waitNextEvent(timeout);
            return Value::make_bool(result);
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::hasPendingEvents", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::hasPendingEvents", args, [&]() -> Value {
            const bool result = DoofRemoteRunnerNative::hasPendingEvents();
            return Value::make_bool(result);
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::lastEventName", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::lastEventName", args, [&]() -> Value {
            const std::string name = DoofRemoteRunnerNative::lastEventName();
            return Value::make_string(name);
        });
    });

    vm->register_extern_function("DoofRemoteRunnerNative::lastEventPayload", [](Value* args) -> Value {
        return DoofVMGlue::dispatch("DoofRemoteRunnerNative::lastEventPayload", args, [&]() -> Value {
            const std::string payload = DoofRemoteRunnerNative::lastEventPayload();
            return Value::make_string(payload);
        });
    });
}

void ensure_vm_initializer_installed() {
    static std::once_flag once;
    std::call_once(once, []() {
        doof_vm_set_vm_initializer(register_remote_runner_externs, nullptr);
    });
}

void enqueue_doof_event(const std::string& name, const std::string& payload) {
    {
        std::lock_guard<std::mutex> lock(g_doof_event_mutex);
        g_doof_event_queue.push_back(DoofQueuedEvent{name, payload});
    }
    g_doof_event_cv.notify_one();
}

bool wait_for_doof_event(int timeout_millis) {
    std::unique_lock<std::mutex> lock(g_doof_event_mutex);
    auto has_event = []() { return !g_doof_event_queue.empty(); };
    if (timeout_millis < 0) {
        g_doof_event_cv.wait(lock, has_event);
    } else {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_millis);
        if (!g_doof_event_cv.wait_until(lock, deadline, has_event)) {
            return false;
        }
    }
    g_last_doof_event = std::move(g_doof_event_queue.front());
    g_doof_event_queue.pop_front();
    g_have_last_doof_event = true;
    return true;
}

bool has_pending_doof_events_locked() {
    std::lock_guard<std::mutex> lock(g_doof_event_mutex);
    return !g_doof_event_queue.empty();
}

const char* last_doof_event_name_locked() {
    std::lock_guard<std::mutex> lock(g_doof_event_mutex);
    if (!g_have_last_doof_event) {
        return "";
    }
    return g_last_doof_event.name.c_str();
}

const char* last_doof_event_payload_locked() {
    std::lock_guard<std::mutex> lock(g_doof_event_mutex);
    if (!g_have_last_doof_event) {
        return "";
    }
    return g_last_doof_event.payload.c_str();
}

} // namespace

static void emit_event(const char* event_name, const char* payload) {
    auto callback = g_event_callback.load(std::memory_order_acquire);
    if (callback) {
        callback(event_name ? event_name : "", payload ? payload : "");
    }
}

static void handle_remote_server_event(doof_vm_remote_server_event_t event,
                                       int active_connections,
                                       void* /*user_data*/) {
    char count_buffer[32];
    std::snprintf(count_buffer, sizeof(count_buffer), "%d", active_connections);
    switch (event) {
        case DOOF_VM_REMOTE_SERVER_EVENT_CONNECTED:
            g_connected.store(true, std::memory_order_release);
            emit_event("connected", count_buffer);
            break;
        case DOOF_VM_REMOTE_SERVER_EVENT_DISCONNECTED: {
            bool has_active = active_connections > 0;
            g_connected.store(has_active, std::memory_order_release);
            emit_event("disconnected", count_buffer);
            break;
        }
        default:
            break;
    }
}

extern "C" bool drr_start_listener(unsigned short port) {
    ensure_vm_initializer_installed();

    bool expected = false;
    if (!g_running.compare_exchange_strong(expected, true)) {
        return false;
    }

    g_connected.store(false, std::memory_order_release);

    char* error_ptr = nullptr;
    int result = doof_vm_start_remote_server(static_cast<int>(port),
                                               &error_ptr,
                                               handle_remote_server_event,
                                               nullptr);
    if (result != 0) {
        std::string message = error_ptr ? std::string(error_ptr) : std::string("unknown");
        if (error_ptr) {
            doof_vm_free_string(error_ptr);
        }
        emit_event("listener_error", message.c_str());
        g_running.store(false, std::memory_order_release);
        return false;
    }

    char port_buffer[16];
    std::snprintf(port_buffer, sizeof(port_buffer), "%hu", port);
    emit_event("listener_started", port_buffer);

    return true;
}

extern "C" void drr_stop_listener(void) {
    if (!g_running.exchange(false)) {
        return;
    }

    doof_vm_stop_remote_server();

    emit_event("listener_stopped", nullptr);
    g_connected.store(false, std::memory_order_release);
}

extern "C" bool drr_is_connected(void) {
    return g_connected.load(std::memory_order_acquire);
}

extern "C" void drr_register_event_callback(drr_event_callback callback) {
    g_event_callback.store(callback, std::memory_order_release);
}

extern "C" void drr_emit_event(const char* event_name, const char* payload) {
    emit_event(event_name, payload);
}

extern "C" void drr_queue_doof_event(const char* event_name, const char* payload) {
    const std::string name = event_name ? std::string(event_name) : std::string();
    const std::string data = payload ? std::string(payload) : std::string();
    enqueue_doof_event(name, data);
}

extern "C" bool drr_wait_next_doof_event(int timeout_millis) {
    return wait_for_doof_event(timeout_millis);
}

extern "C" bool drr_has_pending_doof_events(void) {
    return has_pending_doof_events_locked();
}

extern "C" const char* drr_last_doof_event_name(void) {
    return last_doof_event_name_locked();
}

extern "C" const char* drr_last_doof_event_payload(void) {
    return last_doof_event_payload_locked();
}

// Back-compat wrappers with Domino names
extern "C" void drr_queue_domino_event(const char* event_name, const char* payload) {
    drr_queue_doof_event(event_name, payload);
}

extern "C" bool drr_wait_next_domino_event(int timeout_millis) {
    return drr_wait_next_doof_event(timeout_millis);
}

extern "C" bool drr_has_pending_domino_events(void) {
    return drr_has_pending_doof_events();
}

extern "C" const char* drr_last_domino_event_name(void) {
    return drr_last_doof_event_name();
}

extern "C" const char* drr_last_domino_event_payload(void) {
    return drr_last_doof_event_payload();
}
