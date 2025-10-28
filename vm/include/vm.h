#pragma once
#include <iosfwd>
#include "opcodes.h"
#include "frame.h"
#include "value.h"
#include "debug.h"
#include <vector>
#include <stack>
#include <unordered_map>
#include <functional>
#include <memory>
#include <type_traits>
#include <utility>
#include <stdexcept>

// Forward declaration
class DAPHandler;

class DoofVM {
public:
    struct ExternClassInfo {
        std::string name;
        int class_idx;
    };
    using ExternClassHandle = std::shared_ptr<ExternClassInfo>;

    DoofVM();
    
    // Run VM with given bytecode and constant pool
    void run(const std::vector<Instruction>& code, 
             const std::vector<Value>& constant_pool,
             int entry_point = 0,
             int global_count = 0);
    
    // Run VM with debug support
    void run_with_debug(const std::vector<Instruction>& code, 
                       const std::vector<Value>& constant_pool,
                       const DebugInfo& debug_info,
                       int entry_point = 0,
                       int global_count = 0);
    
    // Get the top frame's return value
    Value get_result() const;
    
    // Register external functions
    void register_extern_function(const std::string& name, 
                                  std::function<Value(Value*)> func);

    ExternClassHandle ensure_extern_class(const std::string& class_name);

    template <typename T>
    static std::shared_ptr<T> as_instance(const Value& receiver, const ExternClassInfo& info) {
        if (receiver.type() != ValueType::Object) {
            throw std::runtime_error("Extern method called with non-object receiver");
        }
        const auto& obj = receiver.as_object();
        if (obj->class_idx != info.class_idx) {
            throw std::runtime_error("Extern method receiver class mismatch");
        }
        auto typed = std::dynamic_pointer_cast<T>(obj);
        if (!typed) {
            throw std::runtime_error("Extern method receiver dynamic cast failed");
        }
        return typed;
    }

    template <typename T>
    static Value wrap_extern_object(const ExternClassHandle& handle, const std::shared_ptr<T>& object) {
        static_assert(std::is_base_of_v<Object, T>, "Extern wrapper must derive from Object");
        if (!object) {
            return Value::make_null();
        }
        object->class_idx = handle->class_idx;
        ObjectPtr base = object;
        return Value::make_object(base);
    }

    template <typename T, typename... Args>
    static Value make_extern_object(const ExternClassHandle& handle, Args&&... args) {
        static_assert(std::is_base_of_v<Object, T>, "Extern wrapper must derive from Object");
        auto instance = std::make_shared<T>(std::forward<Args>(args)...);
        instance->class_idx = handle->class_idx;
        ObjectPtr base = instance;
        return Value::make_object(base);
    }
    
    // Global variable management
    void set_globals_size(size_t size) { globals_.resize(size); }
    void set_global(size_t index, const Value& value);
    Value get_global(size_t index) const;
    
    // Debug support
    DebugState& getDebugState() { return debugState_; }
    const DebugState& getDebugState() const { return debugState_; }
    bool isDebugMode() const { return debugMode_; }
    void setDebugMode(bool enabled) { debugMode_ = enabled; }
    
    // DAP support
    void setDAPHandler(class DAPHandler* handler) { dapHandler_ = handler; }
    class DAPHandler* getDAPHandler() const { return dapHandler_; }
    
    // Execution control for debugging
    void pause() { paused_ = true; }
    void resume() { paused_ = false; }
    bool isPaused() const { return paused_; }
    
    // Current execution state
    int getCurrentInstruction() const { return currentInstruction_; }
    int getCallDepth() const { return static_cast<int>(call_stack.size()); }
    
    // Access current frame for debugging
    const StackFrame& getCurrentFrame() const { return call_stack.empty() ? call_stack[0] : call_stack.back(); }
    const std::vector<StackFrame>& getCallStack() const { return call_stack; }
    
#ifndef DOMINO_VM_UNSAFE
    // Enable/disable verbose output for debugging
    void set_verbose(bool verbose) { verbose_ = verbose; }
    bool is_verbose() const { return verbose_; }
#else
    // No-op in unsafe mode for performance
    void set_verbose(bool) {}
    bool is_verbose() const { return false; }
#endif

    void dump_state(std::ostream& out) const;
    
private:
    std::vector<StackFrame> call_stack;
    std::unordered_map<std::string, std::function<Value(Value*)>> extern_functions;
    std::unordered_map<std::string, ExternClassHandle> extern_classes_;
    int next_negative_class_idx_ = -2;
    Value main_return_value_;  // Store return value from main function
    std::vector<Value> globals_;  // Global variable storage for static fields
    const std::vector<Value>* constant_pool_ = nullptr;  // Pointer to constant pool for JSON serialization
    
    // Debug support
    DebugState debugState_;
    bool debugMode_ = false;
    bool paused_ = false;
    int currentInstruction_ = 0;
    
    // DAP support
    class DAPHandler* dapHandler_ = nullptr;
    
#ifndef DOMINO_VM_UNSAFE
    bool verbose_ = false;
#endif
    
    // Helper methods for opcodes (non-critical operations)
    void handle_arithmetic(const Instruction& instr, Opcode op);
    void handle_comparison(const Instruction& instr, Opcode op);
    void handle_type_conversion(const Instruction& instr, Opcode op);
    void handle_string_ops(const Instruction& instr, Opcode op);
    void handle_array_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    void handle_object_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    void handle_lambda_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    void handle_map_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    void handle_set_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    void handle_iterator_ops(const Instruction& instr, Opcode op, const std::vector<Value>& constant_pool);
    
    // Utility methods
    inline StackFrame& current_frame() {
#ifdef DOMINO_VM_UNSAFE
        return call_stack.back();
#else
        if (call_stack.empty()) {
            throw std::runtime_error("Call stack is empty");
        }
        return call_stack.back();
#endif
    }
    
    void push_frame(int function_index, int num_registers = 256);
    void pop_frame();
    
#ifndef DOMINO_VM_UNSAFE
    void validate_register(uint8_t reg) const;
    void validate_constant_index(int index, const std::vector<Value>& constant_pool) const;
#endif

    ExternClassHandle register_extern_class(const std::string& class_name);
    int find_constant_pool_class_idx(const std::string& class_name) const;
    void refresh_extern_class_indices();
};
