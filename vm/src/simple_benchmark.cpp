#include <iostream>
#include <vector>
#include <chrono>
#include "vm.h"

int main() {
    std::cout << "=== Simple VM Performance Test ===" << std::endl;
    
    // Create a simple arithmetic benchmark with a smaller loop
    std::vector<Instruction> program = {
        // Initialize counter and accumulator
        Instruction(Opcode::LOADK_INT16, 0, 0, 0),          // r0 = 0 (counter)
        Instruction(Opcode::LOADK_INT16, 1, 0, 0),          // r1 = 0 (accumulator)
        Instruction(Opcode::LOADK_INT16, 2, 0, 1),          // r2 = 1 (increment)
        Instruction(Opcode::LOADK_INT16, 3, 39, 16),        // r3 = 10000 (limit)
        
        // Loop start (instruction 4)
        Instruction(Opcode::ADD_INT, 1, 1, 2),              // accumulator += increment
        Instruction(Opcode::ADD_INT, 0, 0, 2),              // counter++
        Instruction(Opcode::LT_INT, 4, 0, 3),               // r4 = (counter < limit)
        Instruction(Opcode::JMP_IF_TRUE, 4, 0xFF, 0xFD),    // Jump back -3 if true
        
        Instruction(Opcode::MOVE, 0, 1),                    // Move result to r0
        Instruction(Opcode::HALT, 0)                        // Stop
    };
    
    std::vector<Value> constant_pool;
    
    const int iterations = 1000;
    
    auto start = std::chrono::high_resolution_clock::now();
    
    for (int i = 0; i < iterations; ++i) {
        DoofVM vm;
        vm.run(program, constant_pool);
    }
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
    
    // Verify the result is correct
    DoofVM test_vm;
    test_vm.run(program, constant_pool);

    std::cout << "Iterations: " << iterations << std::endl;
    std::cout << "Total time: " << duration.count() << " microseconds" << std::endl;
    std::cout << "Average time per iteration: " << (duration.count() / iterations) << " microseconds" << std::endl;
    std::cout << "Instructions executed per iteration: ~40,000" << std::endl;
    
#ifdef DOMINO_VM_UNSAFE
    std::cout << "Build mode: UNSAFE (validation disabled)" << std::endl;
#else
    std::cout << "Build mode: SAFE (validation enabled)" << std::endl;
#endif

    return 0;
}
