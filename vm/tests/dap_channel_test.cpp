#include "dap.h"
#include "dap_channel.h"
#include "vm.h"
#include "json_bytecode_loader.h"
#include <iostream>
#include <string>
#include <vector>

class CollectingDAPChannel : public DAPChannel {
public:
    bool readMessage(std::string &outJson) override {
        (void)outJson;
        return false;
    }

    void writeMessage(const std::string &json) override {
        messages.push_back(json);
    }

    std::vector<std::string> messages;
};

int main() {
    DoofVM vm;
    DAPHandler handler(&vm);
    CollectingDAPChannel channel;
    handler.setOutputChannel(&channel);

    handler.sendEvent("initialized");
    handler.sendResponse(1, "initialize", true);

    if (channel.messages.size() != 2) {
        std::cerr << "Expected 2 messages, got " << channel.messages.size() << std::endl;
        return 1;
    }

    const std::string &eventMessage = channel.messages[0];
    if (eventMessage.find("\"event\":\"initialized\"") == std::string::npos) {
        std::cerr << "First message is not the initialized event: " << eventMessage << std::endl;
        return 1;
    }

    if (eventMessage.find("Content-Length") != std::string::npos) {
        std::cerr << "Event message should not contain Content-Length framing: " << eventMessage << std::endl;
        return 1;
    }

    const std::string &responseMessage = channel.messages[1];
    if (responseMessage.find("\"command\":\"initialize\"") == std::string::npos ||
        responseMessage.find("\"success\":true") == std::string::npos) {
        std::cerr << "Response message missing expected fields: " << responseMessage << std::endl;
        return 1;
    }

    vm.setDAPHandler(&handler);
    handler.notifyBreakpointHit(1);
    handler.notifyStepComplete(1);

    if (channel.messages.size() != 4) {
        std::cerr << "Expected 4 messages after notifications, got " << channel.messages.size() << std::endl;
        return 1;
    }

    const std::string &breakpointEvent = channel.messages[2];
    if (breakpointEvent.find("\"reason\":\"breakpoint\"") == std::string::npos ||
        breakpointEvent.find("\"threadId\":1") == std::string::npos) {
        std::cerr << "Breakpoint event missing expected fields: " << breakpointEvent << std::endl;
        return 1;
    }

    if (breakpointEvent.find("Content-Length") != std::string::npos) {
        std::cerr << "Breakpoint event should not contain Content-Length framing: " << breakpointEvent << std::endl;
        return 1;
    }

    const std::string &stepEvent = channel.messages[3];
    if (stepEvent.find("\"reason\":\"step\"") == std::string::npos ||
        stepEvent.find("\"threadId\":1") == std::string::npos) {
        std::cerr << "Step event missing expected fields: " << stepEvent << std::endl;
        return 1;
    }

    channel.messages.clear();

    DebugInfo debugInfo;
    DebugFileInfo fileMain;
    fileMain.path = "src/main.do";
    debugInfo.files.push_back(fileMain);
    DebugFileInfo fileHelper;
    fileHelper.path = "src/helper.do";
    debugInfo.files.push_back(fileHelper);

    SourceMapEntry entry{};
    entry.instructionIndex = 0;
    entry.sourceLine = 10;
    entry.sourceColumn = 1;
    entry.fileIndex = 0;
    debugInfo.sourceMap.push_back(entry);

    vm.getDebugState().setDebugInfo(debugInfo);

    const std::string verifiedRequest = R"({"seq":100,"type":"request","command":"setBreakpoints","arguments":{"source":{"path":"/workspace/project/src/main.do"},"breakpoints":[{"line":10}]}})";
    handler.processMessage(verifiedRequest);

    if (channel.messages.size() != 1) {
        std::cerr << "Expected a single response for verified breakpoint, got " << channel.messages.size() << std::endl;
        return 1;
    }

    const std::string &verifiedResponse = channel.messages.back();
    if (verifiedResponse.find("\"command\":\"setBreakpoints\"") == std::string::npos ||
        verifiedResponse.find("\"verified\":true") == std::string::npos) {
        std::cerr << "Verified breakpoint response missing expected fields: " << verifiedResponse << std::endl;
        return 1;
    }

    channel.messages.clear();

    const std::string unresolvedRequest = R"({"seq":101,"type":"request","command":"setBreakpoints","arguments":{"source":{"path":"/workspace/project/src/other.do"},"breakpoints":[{"line":10}]}})";
    handler.processMessage(unresolvedRequest);

    if (channel.messages.size() != 2) {
        std::cerr << "Expected output event plus response for unresolved breakpoint, got " << channel.messages.size() << std::endl;
        return 1;
    }

    const std::string &warningEvent = channel.messages[0];
    if (warningEvent.find("\"event\":\"output\"") == std::string::npos ||
        warningEvent.find("unresolved breakpoint") == std::string::npos) {
        std::cerr << "Unresolved breakpoint warning missing expected fields: " << warningEvent << std::endl;
        return 1;
    }

        const std::string &unverifiedResponse = channel.messages[1];
        if (unverifiedResponse.find("\"verified\":false") == std::string::npos ||
                unverifiedResponse.find("\"message\"") == std::string::npos) {
                std::cerr << "Unverified breakpoint response missing expected fields: " << unverifiedResponse << std::endl;
                return 1;
        }

        channel.messages.clear();

        const std::string sampleBytecode = R"({
    "version": "1.0.0",
    "metadata": {
        "sourceFile": "main",
        "generatedAt": "2025-09-28T03:09:37.297Z",
        "doofVersion": "0.1.0"
    },
    "constants": [
        { "type": "string", "value": "Hello world!" },
        { "type": "string", "value": "println" },
        {
            "type": "function",
            "value": {
                "name": "main",
                "parameterCount": 0,
                "registerCount": 3,
                "codeIndex": 2,
                "returnType": { "kind": "primitive", "type": "void" }
            }
        }
    ],
    "functions": [
        {
            "name": "main",
            "parameterCount": 0,
            "registerCount": 3,
            "codeIndex": 2,
            "constantIndex": 2
        }
    ],
    "classes": [],
    "entryPoint": 0,
    "globalCount": 0,
    "instructions": [
        { "opcode": 161, "a": 1, "b": 0, "c": 2 },
        { "opcode": 1,   "a": 0, "b": 0, "c": 0 },
        { "opcode": 17,  "a": 2, "b": 0, "c": 0 },
        { "opcode": 163, "a": 2, "b": 0, "c": 1 },
        { "opcode": 16,  "a": 1, "b": 0, "c": 0 },
        { "opcode": 18,  "a": 0, "b": 0, "c": 0 },
        { "opcode": 162, "a": 0, "b": 0, "c": 0 }
    ],
    "debug": {
        "sourceMap": [
            { "instructionIndex": 2, "sourceLine": 2, "sourceColumn": 13, "fileIndex": 0 },
            { "instructionIndex": 3, "sourceLine": 2, "sourceColumn": 13, "fileIndex": 0 }
        ],
        "functions": [
            {
                "name": "main",
                "startInstruction": 2,
                "endInstruction": 6,
                "fileIndex": 0,
                "sourceLine": 1,
                "sourceColumn": 10,
                "parameterCount": 0,
                "localVariableCount": 0
            }
        ],
        "variables": [],
        "scopes": [],
        "files": [ { "path": "main.do" } ]
    }
})";

        auto loaded = JSONBytecodeLoader::load_from_string(sampleBytecode);

        if (loaded.constants.size() != 3) {
                std::cerr << "Expected 3 constants, got " << loaded.constants.size() << std::endl;
                return 1;
        }

        const Value &functionConstant = loaded.constants[2];
        if (functionConstant.type() != ValueType::Object) {
                std::cerr << "Function constant not materialised as object" << std::endl;
                return 1;
        }

        auto metadata = std::dynamic_pointer_cast<FunctionMetadata>(functionConstant.as_object());
        if (!metadata) {
                std::cerr << "Function constant is not FunctionMetadata" << std::endl;
                return 1;
        }

        if (metadata->codeIndex() != 2 || metadata->parameterCount() != 0 || metadata->registerCount() != 3) {
                std::cerr << "Function metadata has unexpected values" << std::endl;
                return 1;
        }

        try {
                DoofVM vm2;
                vm2.run_with_debug(loaded.instructions, loaded.constants, loaded.debugInfo, loaded.entryPoint, loaded.globalCount);
        } catch (const std::exception &ex) {
                std::cerr << "VM execution from JSON failed: " << ex.what() << std::endl;
                return 1;
        }

    std::cout << "dap_channel_test passed" << std::endl;
    return 0;
}
