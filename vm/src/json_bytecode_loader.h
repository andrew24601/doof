#pragma once
#include <vector>
#include <string>
#include "debug.h"
#include "vm.h"
#include "json.h"

class JSONBytecodeLoader {
public:
    struct LoadedBytecode {
        std::vector<Instruction> instructions;
        std::vector<Value> constants;
        int entryPoint;
        int globalCount;
        DebugInfo debugInfo;
        bool hasDebugInfo = false;
    };

    static LoadedBytecode load_from_file(const std::string &filename);
    static LoadedBytecode load_from_string(const std::string &content);
private:
    static LoadedBytecode load_from_json(const json::JSONObject &root);
    static std::vector<Value> load_constants(const json::JSONArray &constants_array);
    static std::vector<Instruction> load_instructions(const json::JSONArray &instructions_array);
    static DebugInfo load_debug_info(const json::JSONObject &debug_obj);
};
