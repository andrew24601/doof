// Simple abstraction for DAP transport so we can reuse DAPHandler over stdio or a socket.
#pragma once
#include <string>

class DAPChannel {
public:
    virtual ~DAPChannel() = default;
    // Blocks until a full framed DAP message JSON payload is read or returns false on EOF/connection close.
    virtual bool readMessage(std::string &outJson) = 0;
    // Writes a JSON payload with Content-Length framing.
    virtual void writeMessage(const std::string &json) = 0;
};

// A stdio channel that just uses stdin/stdout (fallback for existing behavior)
class StdioDAPChannel : public DAPChannel {
public:
    bool readMessage(std::string &outJson) override;
    void writeMessage(const std::string &json) override;
};
