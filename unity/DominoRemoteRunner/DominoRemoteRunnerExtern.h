#pragma once

#include <string>

#include "remote_runner.h"

class DominoRemoteRunnerNative {
public:
    static bool start(unsigned short port) {
        return drr_start_listener(port);
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

    static void emitEvent(const std::string& eventName) {
        drr_emit_event(eventName.c_str(), "");
    }
};
