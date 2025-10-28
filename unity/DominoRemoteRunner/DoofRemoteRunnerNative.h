#pragma once

#include <string>

#include "remote_runner.h"

class DoofRemoteRunnerNative {
public:
    static bool start(int port) {
        if (port < 0) {
            port = 0;
        }
        if (port > 65535) {
            port = 65535;
        }
        return drr_start_listener(static_cast<unsigned short>(port));
    }

    static void stop() {
        drr_stop_listener();
    }

    static bool isConnected() {
        return drr_is_connected();
    }

    static void emitEvent(const std::string& eventName, const std::string& payload) {
        drr_emit_event(eventName.c_str(), payload.c_str());
    }

    static bool waitNextEvent(int timeoutMillis) {
        return drr_wait_next_doof_event(timeoutMillis);
    }

    static bool hasPendingEvents() {
        return drr_has_pending_doof_events();
    }

    static std::string lastEventName() {
        const char* value = drr_last_doof_event_name();
        return value ? std::string(value) : std::string();
    }

    static std::string lastEventPayload() {
        const char* value = drr_last_doof_event_payload();
        return value ? std::string(value) : std::string();
    }
};
