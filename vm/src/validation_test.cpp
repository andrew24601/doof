#include <iostream>
#include <vector>
#include "vm.h"

void test_validation() {
    std::cout << "=== Testing Validation ===" << std::endl;
    
    try {
        // Test out-of-bounds register access
        std::vector<Instruction> program = {
            Instruction(Opcode::LOADK_INT16, 255, 0, 42),  // Valid: register 255
            Instruction(Opcode::MOVE, 0, 255),             // Valid: move from register 255
            Instruction(Opcode::HALT, 0)
        };
        
        std::vector<Value> constant_pool;
        DoofVM vm;
        vm.run(program, constant_pool);
        
        std::cout << "✓ Valid register access succeeded" << std::endl;
        
    } catch (const std::exception& e) {
        std::cout << "✗ Unexpected error in valid register access: " << e.what() << std::endl;
    }
    
    try {
        // Test invalid constant pool access (should fail in safe mode)
        std::vector<Instruction> program = {
            Instruction(Opcode::LOADK, 0, 1, 0),  // Try to load constant 256 (out of bounds)
            Instruction(Opcode::HALT, 0)
        };
        
        std::vector<Value> constant_pool = { Value::make_int(42) };  // Only 1 element
        DoofVM vm;
        vm.run(program, constant_pool);
        
#ifdef DOMINO_VM_UNSAFE
        std::cout << "! Unsafe mode: invalid constant access succeeded (expected)" << std::endl;
#else
        std::cout << "✗ Invalid constant access should have failed!" << std::endl;
#endif
        
    } catch (const std::exception& e) {
#ifdef DOMINO_VM_UNSAFE
        std::cout << "✗ Unsafe mode should not validate: " << e.what() << std::endl;
#else
        std::cout << "✓ Safe mode correctly caught error: " << e.what() << std::endl;
#endif
    }
    
#ifdef DOMINO_VM_UNSAFE
    std::cout << "Build mode: UNSAFE (validation disabled)" << std::endl;
#else
    std::cout << "Build mode: SAFE (validation enabled)" << std::endl;
#endif
}

int main() {
    test_validation();
    return 0;
}
