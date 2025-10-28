#include "json_bytecode_loader.h"
#include <fstream>
#include <stdexcept>
#include <iostream>

JSONBytecodeLoader::LoadedBytecode JSONBytecodeLoader::load_from_file(const std::string &filename) {
    std::ifstream f(filename);
    if (!f) throw std::runtime_error("Failed to open file: " + filename);
    std::string content((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return load_from_string(content);
}

JSONBytecodeLoader::LoadedBytecode JSONBytecodeLoader::load_from_string(const std::string &content) {
    json::JSONParser parser(content);
    json::JSONValue root = parser.parse();
    if (!root.is_object()) throw std::runtime_error("Invalid bytecode format: root must be object");
    return load_from_json(root.as_object());
}

JSONBytecodeLoader::LoadedBytecode JSONBytecodeLoader::load_from_json(const json::JSONObject &root) {
    LoadedBytecode result;
    if (!json::has_key(root, "version")) throw std::runtime_error("Missing 'version'");
    std::string version = json::get_string(root, "version", "bytecode");
    if (version != "1.0.0") {
        std::cerr << "Warning: Bytecode version " << version << " may not be fully supported" << std::endl;
    }
    if (json::has_key(root, "constants")) {
        result.constants = load_constants(json::get_array(root, "constants", "bytecode"));
    }
    if (!json::has_key(root, "instructions")) throw std::runtime_error("Missing 'instructions'");
    result.instructions = load_instructions(json::get_array(root, "instructions", "bytecode"));
    result.entryPoint = json::get_int(root, "entryPoint", "bytecode");
    result.globalCount = 0;
    try { result.globalCount = json::get_int(root, "globalCount", "bytecode"); } catch(...) {}
    if (result.entryPoint < 0 || result.entryPoint >= (int)result.instructions.size()) throw std::runtime_error("Invalid entry point");
    if (json::has_key(root, "debug")) {
        try {
            result.debugInfo = load_debug_info(json::get_object(root, "debug", "bytecode"));
            result.hasDebugInfo = true;
        } catch (const std::exception &e) {
            std::cerr << "Warning: debug info load failed: " << e.what() << std::endl;
        }
    }
    return result;
}

std::vector<Value> JSONBytecodeLoader::load_constants(const json::JSONArray &constants_array) {
    std::vector<Value> constants;
    constants.reserve(constants_array.size());
    for (size_t i=0;i<constants_array.size();++i) {
        const auto &constant = constants_array[i];
        if (!constant.is_object()) throw std::runtime_error("Constant not object");
        const auto &co = constant.as_object();
        std::string type = json::get_string(co, "type", "constant");
        if (type=="null") constants.push_back(Value::make_null());
        else if (type=="bool") constants.push_back(Value::make_bool(json::get_bool(co, "value", "constant")));
        else if (type=="int") constants.push_back(Value::make_int(json::get_int(co, "value", "constant")));
        else if (type=="float") constants.push_back(Value::make_float((float)json::get_double(co, "value", "constant")));
        else if (type=="double") constants.push_back(Value::make_double(json::get_double(co, "value", "constant")));
        else if (type=="string") constants.push_back(Value::make_string(json::get_string(co, "value", "constant")));
        else if (type=="function") {
            const auto &value_obj = json::get_object(co, "value", "function constant");
            auto metadata = std::make_shared<FunctionMetadata>();
            metadata->class_idx = -1;
            metadata->fields.resize(4);
            metadata->fields[0] = Value::make_int(json::get_int(value_obj, "parameterCount", "function constant"));
            metadata->fields[1] = Value::make_int(json::get_int(value_obj, "registerCount", "function constant"));
            metadata->fields[2] = Value::make_int(json::get_int(value_obj, "codeIndex", "function constant"));
            metadata->fields[3] = Value::make_string(json::get_string(value_obj, "name", "function constant"));
            constants.push_back(Value::make_object(metadata));
        }
        else if (type=="class") {
            const auto &value_obj = json::get_object(co, "value", "class constant");
            auto metadata = std::make_shared<ClassMetadata>();
            metadata->class_idx = -1;
            metadata->fields.resize(4); // Need 4 fields: name, fieldCount, methodCount, and fields array
            metadata->fields[0] = Value::make_string(json::get_string(value_obj, "name", "class constant"));
            metadata->fields[1] = Value::make_int(json::get_int(value_obj, "fieldCount", "class constant"));
            metadata->fields[2] = Value::make_int(json::get_int(value_obj, "methodCount", "class constant"));
            
            // Load field names array if present
            if (json::has_key(value_obj, "fields")) {
                const auto &fields_arr = json::get_array(value_obj, "fields", "class constant");
                auto field_names = std::make_shared<Array>();
                for (size_t i = 0; i < fields_arr.size(); ++i) {
                    if (fields_arr[i].is_string()) {
                        field_names->push_back(Value::make_string(fields_arr[i].as_string()));
                    }
                }
                metadata->fields[3] = Value::make_array(field_names);
            } else {
                // If no fields array, create empty one
                metadata->fields[3] = Value::make_array(std::make_shared<Array>());
            }
            
            constants.push_back(Value::make_object(metadata));
        } else {
            throw std::runtime_error("Unsupported constant type: " + type);
        }
    }
    return constants;
}

std::vector<Instruction> JSONBytecodeLoader::load_instructions(const json::JSONArray &instructions_array) {
    std::vector<Instruction> instructions; instructions.reserve(instructions_array.size());
    for (size_t i=0;i<instructions_array.size();++i) {
        const auto &instr = instructions_array[i];
        if (!instr.is_object()) throw std::runtime_error("Instruction not object");
        const auto &io = instr.as_object();
        int opcode = json::get_int(io, "opcode", "instruction");
        int a = json::get_int(io, "a", "instruction");
        int b = json::get_int(io, "b", "instruction");
        int c = json::get_int(io, "c", "instruction");
        instructions.emplace_back((Opcode)opcode,(uint8_t)a,(uint8_t)b,(uint8_t)c);
    }
    return instructions;
}

DebugInfo JSONBytecodeLoader::load_debug_info(const json::JSONObject &debug_obj) {
    DebugInfo info;
    if (json::has_key(debug_obj, "sourceMap")) {
        const auto &arr = json::get_array(debug_obj, "sourceMap", "debug");
        for (size_t i=0;i<arr.size();++i) {
            const auto &o = arr[i].as_object();
            SourceMapEntry e; e.instructionIndex=json::get_int(o,"instructionIndex","sm"); e.sourceLine=json::get_int(o,"sourceLine","sm"); e.sourceColumn=json::get_int(o,"sourceColumn","sm"); e.fileIndex=json::get_int(o,"fileIndex","sm"); info.sourceMap.push_back(e);
        }
    }
    if (json::has_key(debug_obj, "functions")) {
        const auto &arr = json::get_array(debug_obj, "functions", "debug");
        for (size_t i=0;i<arr.size();++i) {
            const auto &o = arr[i].as_object();
            DebugFunctionInfo f; f.name=json::get_string(o,"name","fn"); f.startInstruction=json::get_int(o,"startInstruction","fn"); f.endInstruction=json::get_int(o,"endInstruction","fn"); f.fileIndex=json::get_int(o,"fileIndex","fn"); f.sourceLine=json::get_int(o,"sourceLine","fn"); f.sourceColumn=json::get_int(o,"sourceColumn","fn"); f.parameterCount=json::get_int(o,"parameterCount","fn"); f.localVariableCount=json::get_int(o,"localVariableCount","fn"); info.functions.push_back(f);
        }
    }
    if (json::has_key(debug_obj, "variables")) {
        const auto &arr = json::get_array(debug_obj, "variables", "debug");
        for (size_t i=0;i<arr.size();++i) {
            const auto &o = arr[i].as_object();
            DebugVariableInfo v; v.name=json::get_string(o,"name","var"); v.type=json::get_string(o,"type","var"); v.startInstruction=json::get_int(o,"startInstruction","var"); v.endInstruction=json::get_int(o,"endInstruction","var"); const auto &loc = json::get_object(o,"location","var"); std::string lt=json::get_string(loc,"type","loc"); if (lt=="register") v.location.type=VariableLocationType::Register; else if (lt=="global") v.location.type=VariableLocationType::Global; else if (lt=="constant") v.location.type=VariableLocationType::Constant; v.location.index=json::get_int(loc,"index","loc"); info.variables.push_back(v);
        }
    }
    if (json::has_key(debug_obj, "files")) {
        const auto &arr = json::get_array(debug_obj, "files", "debug");
        for (size_t i=0;i<arr.size();++i) {
            const auto &o = arr[i].as_object();
            DebugFileInfo f; f.path=json::get_string(o,"path","file"); if (json::has_key(o,"content")) f.content=json::get_string(o,"content","file"); info.files.push_back(f);
        }
    }
    return info;
}
