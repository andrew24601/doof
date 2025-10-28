#pragma once

#include <string>
#include <unordered_map>
#include <functional>
#include <iostream>
#include <vector>
#include <utility>

// Forward declarations
class DoofVM;
struct DebugInfo;
struct Instruction;
class Value;

// Forward declaration for JSON
namespace json {
    class JSONValue;
}

struct DAPBodyValue {
    std::string value;
    bool isRawJson;

    DAPBodyValue() : value(), isRawJson(false) {}
    DAPBodyValue(const char* text) : value(text), isRawJson(false) {}
    DAPBodyValue(std::string text, bool raw = false)
        : value(std::move(text)), isRawJson(raw) {}

    static DAPBodyValue raw(std::string text) {
        return DAPBodyValue(std::move(text), true);
    }
};

using DAPBody = std::unordered_map<std::string, DAPBodyValue>;

// DAP message types
struct DAPMessage {
    int seq;
    int request_seq = 0; // For responses - the seq of the request being responded to
    std::string type; // "request", "response", "event"
    std::string command; // For requests and responses
    std::string event; // For events
    std::unordered_map<std::string, std::string> arguments;
    DAPBody body;
    json::JSONValue* raw_arguments = nullptr; // Raw JSON for complex structures
    bool success = true;
    std::string message; // Error message if success = false
    
    // Constructor
    DAPMessage() = default;
    
    // Destructor to clean up raw_arguments
    ~DAPMessage();
    
    // Copy constructor
    DAPMessage(const DAPMessage& other);
    
    // Move constructor
    DAPMessage(DAPMessage&& other) noexcept;
    
    // Assignment operators
    DAPMessage& operator=(const DAPMessage& other);
    DAPMessage& operator=(DAPMessage&& other) noexcept;
};

// Simple DAP protocol handler
class DAPHandler {
public:
    DAPHandler(DoofVM* vm);
    
    // Set bytecode for execution
    void setBytecode(const std::vector<Instruction>& code, 
                    const std::vector<Value>& constants, 
                    int entry_point, 
                    int global_count);
    
    // Main DAP loop using provided channel (nullptr -> stdio fallback)
    void run(class DAPChannel* channel = nullptr);

    // Set an explicit output channel (used when run() invoked without one but we still want redirected output)
    void setOutputChannel(class DAPChannel* channel) { output_channel_ = channel; }
    
    // Process a single DAP message
    void processMessage(const std::string& message);
    
    // Send response
    void sendResponse(int request_seq, const std::string& command, bool success, 
                     const DAPBody& body = {},
                     const std::string& error_message = "");
    
    // Send event
    void sendEvent(const std::string& event, 
                  const DAPBody& body = {});
    
    // Send output event (for println redirection)
    void sendOutput(const std::string& output, const std::string& category = "stdout");
    
    // Notify about breakpoint hits (called by VM)
    void notifyBreakpointHit(int threadId = 1);
    
    // Notify about step completion (called by VM)
    void notifyStepComplete(int threadId = 1);

private:
    DoofVM* vm_;
    int seq_counter_;
    bool initialized_;
    bool terminated_;
    bool launched_;
    bool execution_started_;
    bool stop_on_entry_;
    
    // Bytecode storage
    std::vector<Instruction> bytecode_;
    std::vector<Value> constants_;
    int entry_point_;
    int global_count_;
    
    // Variable reference tracking for array expansion
    struct ArrayReference {
        int register_index;
        std::string name;
        std::string element_type;
    };
    std::unordered_map<int, ArrayReference> array_references_;
    int next_variable_reference_ = 2; // Start at 2, since 1 is reserved for main scope
    
    // Request handlers
    void handleInitialize(const DAPMessage& msg);
    void handleLaunch(const DAPMessage& msg);
    void handleConfigurationDone(const DAPMessage& msg);
    void handleDisconnect(const DAPMessage& msg);
    void handleSetBreakpoints(const DAPMessage& msg);
    void handleContinue(const DAPMessage& msg);
    void handleNext(const DAPMessage& msg);
    void handleStepIn(const DAPMessage& msg);
    void handleStepOut(const DAPMessage& msg);
    void handlePause(const DAPMessage& msg);
    void handleThreads(const DAPMessage& msg);
    void handleStackTrace(const DAPMessage& msg);
    void handleScopes(const DAPMessage& msg);
    void handleVariables(const DAPMessage& msg);
    void handleEvaluate(const DAPMessage& msg);
    
    // Utility functions
    DAPMessage parseMessage(const std::string& json);
    std::string createMessage(const DAPMessage& msg);
    void sendMessage(const DAPMessage& msg);
    
    // Debug event callbacks
    void onBreakpoint(int instructionIndex);
    void onStep(int instructionIndex);
    void onPause(int instructionIndex);
    void onTerminate();
    void onOutput(const std::string& text, const std::string& category = "stdout");
    
    // Helper methods
    std::string valueToString(const Value& value);

    // Optional channel for sending messages
    class DAPChannel* output_channel_ = nullptr;
};