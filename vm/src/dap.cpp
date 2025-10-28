#include "dap.h"
#include "vm.h"
#include "json.h"
#include "opcodes.h"
#include "value.h"
#include <sstream>
#include <iostream>
#include <thread>
#include <filesystem>
#include "dap_channel.h"
#include "json_bytecode_loader.h"

namespace {

std::string normalizePath(const std::string& path) {
    if (path.empty()) {
        return "";
    }

    try {
        std::filesystem::path fsPath(path);
        fsPath = fsPath.lexically_normal();
        std::string normalized = fsPath.generic_string();
        if (!normalized.empty()) {
            return normalized;
        }
    } catch (...) {
        // Ignore normalization errors and fall back to original path string.
    }

    return path;
}

std::string filenameFromPath(const std::string& path) {
    if (path.empty()) {
        return "";
    }

    try {
        return std::filesystem::path(path).filename().string();
    } catch (...) {
        return path;
    }
}

bool pathEndsWith(const std::string& value, const std::string& ending) {
    if (ending.empty() || value.size() < ending.size()) {
        return false;
    }
    return value.compare(value.size() - ending.size(), ending.size(), ending) == 0;
}

std::string escapeForJson(const std::string& text) {
    std::string escaped;
    escaped.reserve(text.size());

    for (unsigned char c : text) {
        switch (c) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default:
                if (c < 0x20) {
                    escaped += "\\u00";
                    constexpr char hex[] = "0123456789abcdef";
                    escaped += hex[(c >> 4) & 0xF];
                    escaped += hex[c & 0xF];
                } else {
                    escaped.push_back(static_cast<char>(c));
                }
                break;
        }
    }

    return escaped;
}

}

// DAPMessage implementations
DAPMessage::~DAPMessage() {
    delete raw_arguments;
}

DAPMessage::DAPMessage(const DAPMessage& other) 
    : seq(other.seq), type(other.type), command(other.command), 
      event(other.event), arguments(other.arguments), body(other.body),
      success(other.success), message(other.message) {
    raw_arguments = other.raw_arguments ? new json::JSONValue(*other.raw_arguments) : nullptr;
}

DAPMessage::DAPMessage(DAPMessage&& other) noexcept 
    : seq(other.seq), type(std::move(other.type)), 
      command(std::move(other.command)), event(std::move(other.event)),
      arguments(std::move(other.arguments)), body(std::move(other.body)),
      raw_arguments(other.raw_arguments), success(other.success), 
      message(std::move(other.message)) {
    other.raw_arguments = nullptr;
}

DAPMessage& DAPMessage::operator=(const DAPMessage& other) {
    if (this != &other) {
        delete raw_arguments;
        seq = other.seq;
        type = other.type;
        command = other.command;
        event = other.event;
        arguments = other.arguments;
        body = other.body;
        success = other.success;
        message = other.message;
        raw_arguments = other.raw_arguments ? new json::JSONValue(*other.raw_arguments) : nullptr;
    }
    return *this;
}

DAPMessage& DAPMessage::operator=(DAPMessage&& other) noexcept {
    if (this != &other) {
        delete raw_arguments;
        seq = other.seq;
        type = std::move(other.type);
        command = std::move(other.command);
        event = std::move(other.event);
        arguments = std::move(other.arguments);
        body = std::move(other.body);
        success = other.success;
        message = std::move(other.message);
        raw_arguments = other.raw_arguments;
        other.raw_arguments = nullptr;
    }
    return *this;
}

DAPHandler::DAPHandler(DoofVM* vm) 
    : vm_(vm), seq_counter_(1), initialized_(false), terminated_(false), 
      launched_(false), execution_started_(false), stop_on_entry_(true), 
      entry_point_(0), global_count_(0) {
}

void DAPHandler::setBytecode(const std::vector<Instruction>& code, 
                            const std::vector<Value>& constants, 
                            int entry_point, 
                            int global_count) {
    bytecode_ = code;
    constants_ = constants;  
    entry_point_ = entry_point;
    global_count_ = global_count;
}

// Allow injecting a channel. If none provided default to stdio.
void DAPHandler::run(DAPChannel *channel) {
    StdioDAPChannel fallback;
    DAPChannel *ch = channel ? channel : static_cast<DAPChannel*>(&fallback);
    std::string json;
    while (!terminated_ && ch->readMessage(json)) {
        processMessage(json);
    }
}

void DAPHandler::processMessage(const std::string& message) {
    try {
        DAPMessage msg = parseMessage(message);
        
        if (msg.type == "request") {
            if (msg.command == "initialize") {
                handleInitialize(msg);
            } else if (msg.command == "launch") {
                handleLaunch(msg);
            } else if (msg.command == "disconnect") {
                handleDisconnect(msg);
            } else if (msg.command == "setBreakpoints") {
                handleSetBreakpoints(msg);
            } else if (msg.command == "continue") {
                handleContinue(msg);
            } else if (msg.command == "next") {
                handleNext(msg);
            } else if (msg.command == "stepIn") {
                handleStepIn(msg);
            } else if (msg.command == "stepOut") {
                handleStepOut(msg);
            } else if (msg.command == "pause") {
                handlePause(msg);
            } else if (msg.command == "threads") {
                handleThreads(msg);
            } else if (msg.command == "stackTrace") {
                handleStackTrace(msg);
            } else if (msg.command == "scopes") {
                handleScopes(msg);
            } else if (msg.command == "variables") {
                handleVariables(msg);
            } else if (msg.command == "evaluate") {
                handleEvaluate(msg);
            } else if (msg.command == "configurationDone") {
                handleConfigurationDone(msg);
            } else if (msg.command == "uploadBytecode") {
                // Expect arguments.bytecode (string containing JSON)
                if (!msg.raw_arguments) {
                    sendResponse(msg.seq, "uploadBytecode", false, {}, "No arguments");
                    return;
                }
                try {
                    const auto &args = msg.raw_arguments->as_object();
                    if (args.find("bytecode") == args.end() || !args.at("bytecode").is_string()) {
                        sendResponse(msg.seq, "uploadBytecode", false, {}, "Missing bytecode string");
                        return;
                    }
                    std::string bc = args.at("bytecode").as_string();

                    auto loaded = JSONBytecodeLoader::load_from_string(bc);
                    if (loaded.hasDebugInfo) {
                        vm_->setDebugMode(true);
                        vm_->getDebugState().setDebugInfo(loaded.debugInfo);
                    }
                    setBytecode(loaded.instructions, loaded.constants, loaded.entryPoint, loaded.globalCount);
                    DAPBody body;
                    body["status"] = "ok";
                    body["instructions"] = DAPBodyValue::raw(std::to_string(loaded.instructions.size()));
                    sendResponse(msg.seq, "uploadBytecode", true, body);
                } catch (const std::exception &ex) {
                    sendResponse(msg.seq, "uploadBytecode", false, {}, std::string("Load failed: ")+ex.what());
                }
            } else {
                sendResponse(msg.seq, msg.command, false, {}, "Command not supported: " + msg.command);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "DAP Error: " << e.what() << std::endl;
    }
}

void DAPHandler::handleInitialize(const DAPMessage& msg) {
    DAPBody capabilities;
    capabilities["supportsConfigurationDoneRequest"] = DAPBodyValue::raw("true");
    capabilities["supportsFunctionBreakpoints"] = DAPBodyValue::raw("false");
    capabilities["supportsConditionalBreakpoints"] = DAPBodyValue::raw("false");
    capabilities["supportsHitConditionalBreakpoints"] = DAPBodyValue::raw("false");
    capabilities["supportsEvaluateForHovers"] = DAPBodyValue::raw("false");
    capabilities["supportsStepBack"] = DAPBodyValue::raw("false");
    capabilities["supportsSetVariable"] = DAPBodyValue::raw("false");
    capabilities["supportsRestartFrame"] = DAPBodyValue::raw("false");
    capabilities["supportsGotoTargetsRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsStepInTargetsRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsCompletionsRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsModulesRequest"] = DAPBodyValue::raw("false");
    capabilities["additionalModuleColumns"] = DAPBodyValue::raw("[]");
    capabilities["supportedChecksumAlgorithms"] = DAPBodyValue::raw("[]");
    capabilities["supportsRestartRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsExceptionOptions"] = DAPBodyValue::raw("false");
    capabilities["supportsValueFormattingOptions"] = DAPBodyValue::raw("false");
    capabilities["supportsExceptionInfoRequest"] = DAPBodyValue::raw("false");
    capabilities["supportTerminateDebuggee"] = DAPBodyValue::raw("true");
    capabilities["supportSuspendDebuggee"] = DAPBodyValue::raw("true");
    capabilities["supportsDelayedStackTraceLoading"] = DAPBodyValue::raw("false");
    capabilities["supportsLoadedSourcesRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsLogPoints"] = DAPBodyValue::raw("false");
    capabilities["supportsTerminateThreadsRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsSetExpression"] = DAPBodyValue::raw("false");
    capabilities["supportsTerminateRequest"] = DAPBodyValue::raw("true");
    capabilities["supportsDataBreakpoints"] = DAPBodyValue::raw("false");
    capabilities["supportsReadMemoryRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsWriteMemoryRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsDisassembleRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsCancelRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsBreakpointLocationsRequest"] = DAPBodyValue::raw("false");
    capabilities["supportsClipboardContext"] = DAPBodyValue::raw("false");
    
    sendResponse(msg.seq, "initialize", true, capabilities);
    initialized_ = true;
    
    // Send initialized event
    sendEvent("initialized");
}

void DAPHandler::handleLaunch(const DAPMessage& msg) {
    if (bytecode_.empty()) {
        sendResponse(msg.seq, "launch", false, {}, "No bytecode loaded");
        return;
    }
    
    // Store stopOnEntry setting for later use
    stop_on_entry_ = true; // Default to true
    if (msg.raw_arguments) {
        const auto& args_obj = msg.raw_arguments->as_object();
        if (args_obj.find("stopOnEntry") != args_obj.end()) {
            const auto& stop_val = args_obj.at("stopOnEntry");
            if (stop_val.is_bool()) {
                stop_on_entry_ = stop_val.as_bool();
            }
        }
    }
    
    sendResponse(msg.seq, "launch", true);
    launched_ = true;
    
    // Send process event to indicate we're ready
    DAPBody process_body;
    process_body["name"] = "doof-vm";
    process_body["systemProcessId"] = DAPBodyValue::raw("1");
    process_body["isLocalProcess"] = DAPBodyValue::raw("true");
    process_body["startMethod"] = "launch";
    sendEvent("process", process_body);
    
    // Set up VM for debugging and ALWAYS pause at entry
    // This eliminates race conditions with breakpoint setting
    vm_->setDebugMode(true);
    vm_->pause();
    
    // Always send stopped event - the adapter will handle auto-continue if needed
    std::ostringstream body_json;
    body_json << "{\"reason\":\"entry\",\"threadId\":1,\"allThreadsStopped\":true}";
    
    DAPMessage event;
    event.seq = seq_counter_++;
    event.type = "event";
    event.event = "stopped";
    
    // Send the event with proper JSON body
    std::ostringstream json;
    json << "{";
    json << "\"seq\":" << event.seq << ",";
    json << "\"type\":\"event\",";
    json << "\"event\":\"stopped\",";
    json << "\"body\":" << body_json.str();
    json << "}";
    
    std::string content = json.str();
    if (output_channel_) {
        output_channel_->writeMessage(content);
    } else {
        std::cout << "Content-Length: " << content.length() << "\r\n\r\n" << content << std::flush;
    }
}

void DAPHandler::handleConfigurationDone(const DAPMessage& msg) {
    sendResponse(msg.seq, "configurationDone", true);
    
    // Configuration is done - VM is ready to receive continue commands
    // VM execution will start when the first continue command is received
    // The adapter will automatically send continue if stopOnEntry was false
}

void DAPHandler::handleDisconnect(const DAPMessage& msg) {
    sendResponse(msg.seq, "disconnect", true);
    terminated_ = true;
}

void DAPHandler::handleSetBreakpoints(const DAPMessage& msg) {
    try {
        if (!msg.raw_arguments) {
            sendResponse(msg.seq, "setBreakpoints", false, {}, "No arguments provided in breakpoint request");
            return;
        }
        

        
        const auto& args_obj = msg.raw_arguments->as_object();
        

        
        // Check if source and lines exist
        if (args_obj.find("source") == args_obj.end() || args_obj.find("breakpoints") == args_obj.end()) {
            std::cerr << "[DEBUG] SetBreakpoints: Missing source or breakpoints field" << std::endl;
            sendResponse(msg.seq, "setBreakpoints", false, {}, "Missing source or breakpoints in breakpoint request");
            return;
        }
        
        // Get source file path (VSCode sends this as an object with 'path' field)
        const auto& source_obj = args_obj.at("source");
        std::string source_path;
        if (source_obj.is_object()) {
            const auto& source_map = source_obj.as_object();
            if (source_map.find("path") != source_map.end()) {
                source_path = source_map.at("path").as_string();
            }
        }
        
        // Get line numbers (VSCode sends this as an array of objects with 'line' field)
        std::vector<int> lines;
        const auto& breakpoints_array = args_obj.at("breakpoints");

        if (breakpoints_array.is_array()) {
            const auto& bp_vec = breakpoints_array.as_array();
            for (const auto& bp_val : bp_vec) {
                if (bp_val.is_object()) {
                    const auto& bp_obj = bp_val.as_object();
                    if (bp_obj.find("line") != bp_obj.end() && bp_obj.at("line").is_number()) {
                        int line = static_cast<int>(bp_obj.at("line").as_number());
                        lines.push_back(line);

                    }
                }
            }
        }
        
        const bool hasDebugInfo = vm_->getDebugState().hasDebugInfo();
        int fileIndex = 0;
        bool fileIndexResolved = false;

        if (hasDebugInfo && !source_path.empty()) {
            const auto& debugInfo = vm_->getDebugState().getDebugInfo();
            std::string normalizedSource = normalizePath(source_path);

            if (!normalizedSource.empty()) {
                for (size_t idx = 0; idx < debugInfo.files.size(); ++idx) {
                    const std::string candidate = normalizePath(debugInfo.files[idx].path);
                    if (!candidate.empty() && (candidate == normalizedSource ||
                                               pathEndsWith(normalizedSource, candidate) ||
                                               pathEndsWith(candidate, normalizedSource))) {
                        fileIndex = static_cast<int>(idx);
                        fileIndexResolved = true;
                        break;
                    }
                }

                if (!fileIndexResolved) {
                    const std::string requestedName = filenameFromPath(normalizedSource);
                    for (size_t idx = 0; idx < debugInfo.files.size(); ++idx) {
                        if (filenameFromPath(debugInfo.files[idx].path) == requestedName) {
                            fileIndex = static_cast<int>(idx);
                            fileIndexResolved = true;
                            break;
                        }
                    }
                }

                if (!fileIndexResolved && debugInfo.files.size() == 1) {
                    fileIndex = 0;
                    fileIndexResolved = true;
                }
            }
        }

        vm_->getDebugState().clearBreakpoints();

        std::ostringstream breakpoints_json;
        breakpoints_json << "[";
        bool first = true;
        bool warnedUnverified = false;

        for (int line : lines) {
            int bpId = -1;
            bool verified = false;

            if (hasDebugInfo && fileIndexResolved) {
                bpId = vm_->getDebugState().addBreakpoint(line, fileIndex);
                verified = bpId != -1;
            }

            if (!first) {
                breakpoints_json << ",";
            }

            breakpoints_json << "{";
            if (bpId != -1) {
                breakpoints_json << "\"id\":" << bpId << ",";
            }
            breakpoints_json << "\"verified\":" << (verified ? "true" : "false") << ",";
            breakpoints_json << "\"line\":" << line;

            if (!verified) {
                std::string reason = "Debugger: unresolved breakpoint at " + (source_path.empty() ? std::string("<unknown>") : source_path) + ":" + std::to_string(line);
                breakpoints_json << ",\"message\":\"" << escapeForJson(reason) << "\"";
                if (!warnedUnverified) {
                    sendOutput(reason + "\n", "stderr");
                    warnedUnverified = true;
                }
            }

            breakpoints_json << "}";
            first = false;
        }

        breakpoints_json << "]";

    DAPBody response_body;
    response_body["breakpoints"] = DAPBodyValue::raw(breakpoints_json.str());
        sendResponse(msg.seq, "setBreakpoints", true, response_body);
        
    } catch (const std::exception& e) {
        sendResponse(msg.seq, "setBreakpoints", false, {}, "Error setting breakpoints: " + std::string(e.what()));
    }
}

void DAPHandler::handleContinue(const DAPMessage& msg) {
    vm_->resume();
    vm_->getDebugState().setStepMode(StepMode::None);
    sendResponse(msg.seq, "continue", true);
    
    // Start VM execution if this is the first continue
    if (!execution_started_) {
        execution_started_ = true;
        
        // Start VM execution in a separate thread
        std::thread vm_thread([this]() {
            try {
                if (vm_->getDebugState().hasDebugInfo()) {
                    vm_->run_with_debug(bytecode_, constants_, vm_->getDebugState().getDebugInfo(), 
                                       entry_point_, global_count_);
                } else {
                    vm_->run(bytecode_, constants_, entry_point_, global_count_);
                }
                
                // Send terminated event when VM finishes
                sendEvent("terminated");
                
            } catch (const std::exception& e) {
                DAPBody output_body;
                output_body["category"] = "stderr";
                output_body["output"] = std::string("VM Error: ") + e.what() + "\n";
                sendEvent("output", output_body);
                
                sendEvent("terminated");
            }
        });
        
        vm_thread.detach(); // Let the VM run independently
    }
}

void DAPHandler::handleNext(const DAPMessage& msg) {
    // Set the current line as the step-from line
    int currentInstr = vm_->getCurrentInstruction();
    SourceMapEntry currentLocation = vm_->getDebugState().getSourceFromInstruction(currentInstr);
    
    vm_->getDebugState().setStepFromLine(currentLocation.sourceLine, currentLocation.fileIndex);
    
    vm_->getDebugState().setStepMode(StepMode::StepOver);
    vm_->getDebugState().setStepOverDepth(vm_->getCallDepth());
    vm_->resume();
    sendResponse(msg.seq, "next", true);
}

void DAPHandler::handleStepIn(const DAPMessage& msg) {
    // Set the current line as the step-from line
    SourceMapEntry currentLocation = vm_->getDebugState().getSourceFromInstruction(vm_->getCurrentInstruction());
    vm_->getDebugState().setStepFromLine(currentLocation.sourceLine, currentLocation.fileIndex);
    
    vm_->getDebugState().setStepMode(StepMode::StepIn);
    vm_->resume();
    sendResponse(msg.seq, "stepIn", true);
}

void DAPHandler::handleStepOut(const DAPMessage& msg) {
    // Set the current line as the step-from line  
    SourceMapEntry currentLocation = vm_->getDebugState().getSourceFromInstruction(vm_->getCurrentInstruction());
    vm_->getDebugState().setStepFromLine(currentLocation.sourceLine, currentLocation.fileIndex);
    
    vm_->getDebugState().setStepMode(StepMode::StepOut);
    vm_->getDebugState().setStepOutDepth(vm_->getCallDepth());
    vm_->resume();
    sendResponse(msg.seq, "stepOut", true);
}

void DAPHandler::handlePause(const DAPMessage& msg) {
    vm_->pause();
    sendResponse(msg.seq, "pause", true);
}

void DAPHandler::handleThreads(const DAPMessage& msg) {
    // Simple single-threaded response
    DAPBody response_body;
    response_body["threads"] = DAPBodyValue::raw(R"([{"id": 1, "name": "main"}])");
    sendResponse(msg.seq, "threads", true, response_body);
}

void DAPHandler::handleStackTrace(const DAPMessage& msg) {
    std::ostringstream stackFrames;
    
    if (vm_->getDebugState().hasDebugInfo()) {
        const auto& debugInfo = vm_->getDebugState().getDebugInfo();
        int currentInstruction = vm_->getCurrentInstruction();
        
        // Get source location for current instruction
        auto sourceEntry = vm_->getDebugState().getSourceFromInstruction(currentInstruction);
        
        // Get function information
        const auto* functionInfo = vm_->getDebugState().getFunctionAtInstruction(currentInstruction);
        
        // Find the source file path from debug info
        std::string sourcePath = "unknown";
        if (sourceEntry.fileIndex >= 0 && sourceEntry.fileIndex < static_cast<int>(debugInfo.files.size())) {
            sourcePath = debugInfo.files[sourceEntry.fileIndex].path;
        } else if (!debugInfo.files.empty()) {
            // Fallback: use first file in debug info if no specific mapping found
            sourcePath = debugInfo.files[0].path;
        }
        
        std::string filename = sourcePath.substr(sourcePath.find_last_of("/\\") + 1);
        
        // Build stack frame JSON
        stackFrames << "[{";
        stackFrames << "\"id\":1,";
        stackFrames << "\"name\":\"" << (functionInfo ? functionInfo->name : "main") << "\",";
        stackFrames << "\"source\":{\"name\":\"" << filename << "\",\"path\":\"" << sourcePath << "\"},";
        stackFrames << "\"line\":" << (sourceEntry.sourceLine > 0 ? sourceEntry.sourceLine : 1) << ",";
        stackFrames << "\"column\":" << (sourceEntry.sourceColumn > 0 ? sourceEntry.sourceColumn : 1);
        stackFrames << "}]";
    } else {
        // Fallback when no debug info available - generic source info
        stackFrames << "[{";
        stackFrames << "\"id\":1,";
        stackFrames << "\"name\":\"main\",";
        stackFrames << "\"source\":{\"name\":\"unknown\",\"path\":\"unknown\"},";
        stackFrames << "\"line\":1,";
        stackFrames << "\"column\":1";
        stackFrames << "}]";
    }
    
    DAPBody response_body;
    response_body["stackFrames"] = DAPBodyValue::raw(stackFrames.str());
    response_body["totalFrames"] = DAPBodyValue::raw("1");
    sendResponse(msg.seq, "stackTrace", true, response_body);
}

void DAPHandler::handleScopes(const DAPMessage& msg) {
    // Build scopes for the current frame
    std::ostringstream scopes_json;
    scopes_json << "[";
    
    // Add locals scope
    scopes_json << "{";
    scopes_json << "\"name\":\"Locals\",";
    scopes_json << "\"variablesReference\":1,";  // Reference ID for variables request
    scopes_json << "\"expensive\":false";
    scopes_json << "}";
    
    scopes_json << "]";
    
    DAPBody response_body;
    response_body["scopes"] = DAPBodyValue::raw(scopes_json.str());
    sendResponse(msg.seq, "scopes", true, response_body);
}

void DAPHandler::handleVariables(const DAPMessage& msg) {
    // Parse variablesReference from the message
    int variablesReference = 1; // Default to main scope
    if (msg.raw_arguments) {
        const auto& args_obj = msg.raw_arguments->as_object();
        if (args_obj.find("variablesReference") != args_obj.end()) {
            variablesReference = static_cast<int>(args_obj.at("variablesReference").as_number());
        }
    }
    
    std::ostringstream variables_json;
    variables_json << "[";
    
    if (variablesReference == 1) {
        // Main scope variables - reset array references for consistency
        array_references_.clear();
        next_variable_reference_ = 2;
        
        int currentInstruction = vm_->getCurrentInstruction();
        std::vector<DebugVariableInfo> variables = vm_->getDebugState().getVariablesInScope(currentInstruction);
        


    
    bool first = true;
    for (const auto& varInfo : variables) {
        if (!first) variables_json << ",";
        first = false;
            
            // Get the actual value from VM registers
            Value varValue;
            bool hasValue = false;
            
            if (!vm_->getCallStack().empty()) {
                const StackFrame& frame = vm_->getCurrentFrame();
                if (varInfo.location.type == VariableLocationType::Register && 
                    varInfo.location.index >= 0 && 
                    varInfo.location.index < frame.registers.size()) {
                    varValue = frame.registers[varInfo.location.index];
                    hasValue = true;
                }
            }
            
            variables_json << "{";
            variables_json << "\"name\":\"" << varInfo.name << "\",";
            variables_json << "\"type\":\"" << varInfo.type << "\",";
            
            // Check if this is an array type
            bool isArray = varInfo.type.find("[]") != std::string::npos;
            int variableRef = 0;
            
            if (isArray && hasValue && varValue.type() == ValueType::Array) {
                // Generate a unique variable reference for this array
                variableRef = next_variable_reference_++;
                array_references_[variableRef] = {varInfo.location.index, varInfo.name, 
                                                  varInfo.type.substr(0, varInfo.type.find("[]"))};
            }
            
            variables_json << "\"variablesReference\":" << variableRef << ",";
            
            if (hasValue) {
                // Convert value to string for display
                std::string valueStr = valueToString(varValue);
                variables_json << "\"value\":\"" << valueStr << "\"";
            } else {
                variables_json << "\"value\":\"<unavailable>\"";
            }
            
            variables_json << "}";
        }
    } else if (array_references_.find(variablesReference) != array_references_.end()) {
        // Array element variables
        const ArrayReference& arrayRef = array_references_[variablesReference];

        
        if (!vm_->getCallStack().empty()) {
            const StackFrame& frame = vm_->getCurrentFrame();
            if (arrayRef.register_index >= 0 && arrayRef.register_index < frame.registers.size()) {
                const Value& arrayValue = frame.registers[arrayRef.register_index];
                if (arrayValue.type() == ValueType::Array) {
                    const auto& array = arrayValue.as_array();
                    for (size_t i = 0; i < array->size(); ++i) {
                        if (i > 0) variables_json << ",";
                        variables_json << "{";
                        variables_json << "\"name\":\"[" << i << "]\",";
                        variables_json << "\"type\":\"" << arrayRef.element_type << "\",";
                        variables_json << "\"variablesReference\":0,";
                        variables_json << "\"value\":\"" << valueToString((*array)[i]) << "\"";
                        variables_json << "}";
                    }
                }
            }
        }
    }
    
    variables_json << "]";
    
    DAPBody response_body;
    response_body["variables"] = DAPBodyValue::raw(variables_json.str());
    sendResponse(msg.seq, "variables", true, response_body);
}

void DAPHandler::handleEvaluate(const DAPMessage& msg) {
    // TODO: Evaluate expression in VM context
    sendResponse(msg.seq, "evaluate", false, {}, "Expression evaluation not implemented");
}

void DAPHandler::sendResponse(int request_seq, const std::string& command, bool success, 
                             const DAPBody& body,
                             const std::string& error_message) {
    DAPMessage response;
    response.seq = seq_counter_++;
    response.request_seq = request_seq; // Store the original request sequence
    response.type = "response";
    response.command = command;
    response.success = success;
    response.body = body;
    if (!success) {
        response.message = error_message;
    }
    
    sendMessage(response);
}

void DAPHandler::sendEvent(const std::string& event, 
                          const DAPBody& body) {
    DAPMessage event_msg;
    event_msg.seq = seq_counter_++;
    event_msg.type = "event";
    event_msg.event = event;
    event_msg.body = body;
    
    sendMessage(event_msg);
}

void DAPHandler::sendOutput(const std::string& output, const std::string& category) {
    DAPBody output_body;
    output_body["category"] = category;
    output_body["output"] = output;
    sendEvent("output", output_body);
}

DAPMessage DAPHandler::parseMessage(const std::string& json_str) {
    try {
        json::JSONParser parser(json_str);
        json::JSONValue root = parser.parse();
        
        if (!root.is_object()) {
            throw std::runtime_error("DAP message must be JSON object");
        }
        
        const auto& obj = root.as_object();
        DAPMessage msg;
        
        msg.seq = json::get_int(obj, "seq", "DAP message");
        msg.type = json::get_string(obj, "type", "DAP message");
        
        if (json::has_key(obj, "command")) {
            msg.command = json::get_string(obj, "command", "DAP message");
        }
        
        if (json::has_key(obj, "event")) {
            msg.event = json::get_string(obj, "event", "DAP message");
        }
        
        // Parse arguments if present
        if (json::has_key(obj, "arguments")) {
            const auto& args_obj = json::get_object(obj, "arguments", "DAP message");
            
            // Store raw arguments for complex structures  
            msg.raw_arguments = new json::JSONValue(args_obj);
            
            // Also parse simple values for backward compatibility
            for (const auto& pair : args_obj) {
                if (pair.second.is_string()) {
                    msg.arguments[pair.first] = pair.second.as_string();
                } else if (pair.second.is_number()) {
                    msg.arguments[pair.first] = std::to_string(pair.second.as_number());
                } else if (pair.second.is_bool()) {
                    msg.arguments[pair.first] = pair.second.as_bool() ? "true" : "false";
                }
            }
        }
        
        return msg;
    } catch (const std::exception& e) {
        std::cerr << "Error parsing DAP message: " << e.what() << std::endl;
        // Return error message
        DAPMessage error_msg;
        error_msg.seq = 0;
        error_msg.type = "error";
        return error_msg;
    }
}

std::string DAPHandler::createMessage(const DAPMessage& msg) {
    std::ostringstream json;
    json << "{";
    json << "\"seq\":" << msg.seq << ",";
    json << "\"type\":\"" << msg.type << "\"";
    
    if (!msg.command.empty()) {
        json << ",\"command\":\"" << msg.command << "\"";
    }

    if (!msg.event.empty()) {
        json << ",\"event\":\"" << msg.event << "\"";
    }

    if (msg.type == "response") {
        json << ",\"request_seq\":" << msg.request_seq;
        json << ",\"success\":" << (msg.success ? "true" : "false");
        if (!msg.success && !msg.message.empty()) {
            json << ",\"message\":\"" << escapeForJson(msg.message) << "\"";
        }
    }

    if (!msg.body.empty()) {
        json << ",\"body\":{";
        bool first = true;
        for (const auto& entry : msg.body) {
            if (!first) {
                json << ",";
            }
            json << "\"" << entry.first << "\":";
            if (entry.second.isRawJson) {
                json << entry.second.value;
            } else {
                json << "\"" << escapeForJson(entry.second.value) << "\"";
            }
            first = false;
        }
        json << "}";
    }
    
    json << "}";
    return json.str();
}

void DAPHandler::sendMessage(const DAPMessage& msg) {
    std::string json_content = createMessage(msg);
    if (output_channel_) {
        output_channel_->writeMessage(json_content);
    } else {
        std::cout << "Content-Length: " << json_content.length() << "\r\n\r\n" << json_content << std::flush;
    }
}

std::string DAPHandler::valueToString(const Value& value) {
    switch (value.type()) {
        case ValueType::Null:
            return "null";
        case ValueType::Bool:
            return value.as_bool() ? "true" : "false";
        case ValueType::Int:
            return std::to_string(value.as_int());
        case ValueType::Float:
            return std::to_string(value.as_float());
        case ValueType::Double:
            return std::to_string(value.as_double());
        case ValueType::Char:
            return "'" + std::string(1, value.as_char()) + "'";
        case ValueType::String: {
            // Don't add quotes here - they cause JSON parsing issues in the variables view
            // The DAP protocol expects the raw value, not a quoted string
            std::string str = value.as_string();
            // Escape any quotes that are actually in the string content
            std::string escaped;
            for (char c : str) {
                if (c == '"') {
                    escaped += "\\\"";
                } else if (c == '\\') {
                    escaped += "\\\\";
                } else {
                    escaped += c;
                }
            }
            return escaped;
        }
        case ValueType::Object:
            return "<object>";
        case ValueType::Array:
            return "<array[" + std::to_string(value.as_array()->size()) + "]>";
        case ValueType::Lambda:
            return "<lambda>";
        case ValueType::Map:
            return "<map[" + std::to_string(value.as_map()->size()) + "]>";
        case ValueType::Set:
            return "<set[" + std::to_string(value.as_set()->size()) + "]>";
        case ValueType::IntMap:
            return "<intmap[" + std::to_string(value.as_int_map()->size()) + "]>";
        case ValueType::IntSet:
            return "<intset[" + std::to_string(value.as_int_set()->size()) + "]>";
        case ValueType::Iterator:
            return "<iterator>";
        default:
            return "<unknown>";
    }
}

void DAPHandler::notifyBreakpointHit(int threadId) {

    
    // Send stopped event to indicate we've hit a breakpoint
    std::ostringstream body_json;
    body_json << "{\"reason\":\"breakpoint\",\"threadId\":" << threadId << ",\"allThreadsStopped\":true}";
    
    DAPMessage event;
    event.seq = seq_counter_++;
    event.type = "event";
    event.event = "stopped";
    
    // Send the event with proper JSON body
    std::ostringstream json;
    json << "{";
    json << "\"seq\":" << event.seq << ",";
    json << "\"type\":\"event\",";
    json << "\"event\":\"stopped\",";
    json << "\"body\":" << body_json.str();
    json << "}";
    
    std::string content = json.str();
    if (output_channel_) {
        output_channel_->writeMessage(content);
    } else {
        std::cout << "Content-Length: " << content.length() << "\r\n\r\n" << content << std::flush;
    }
}

void DAPHandler::notifyStepComplete(int threadId) {
    // Send stopped event to indicate step has completed
    std::ostringstream body_json;
    body_json << "{\"reason\":\"step\",\"threadId\":" << threadId << ",\"allThreadsStopped\":true}";
    
    DAPMessage event;
    event.seq = seq_counter_++;
    event.type = "event";
    event.event = "stopped";
    
    // Send the event with proper JSON body
    std::ostringstream json;
    json << "{";
    json << "\"seq\":" << event.seq << ",";
    json << "\"type\":\"event\",";
    json << "\"event\":\"stopped\",";
    json << "\"body\":" << body_json.str();
    json << "}";
    
    std::string content = json.str();
    if (output_channel_) {
        output_channel_->writeMessage(content);
    } else {
        std::cout << "Content-Length: " << content.length() << "\r\n\r\n" << content << std::flush;
    }
}