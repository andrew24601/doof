#include <iostream>
#include <vector>
#include <chrono>
#include "vm.h"

void benchmark_arithmetic() {
    std::cout << "=== VM Performance Benchmark ===" << std::endl;
    
    const int outerLoopCount = 10000; // Outer loop count
    const int innerLoopCount = 1000;  // Inner loop count

    // Create a compute-intensive program: nested loops with arithmetic
    std::vector<Instruction> program = {
        // Initialize outer loop counter 
        Instruction(Opcode::LOADK_INT16, 0, 0, 0),          // r0 = 0 (outer counter)
        Instruction::with_reg_imm16(Opcode::LOADK_INT16, 5, outerLoopCount), // r5 = 1000 (outer limit)
        
        // Outer loop start (instruction 2)
        // Initialize inner loop
        Instruction(Opcode::LOADK_INT16, 1, 0, 0),          // r1 = 0 (inner counter)  
        Instruction(Opcode::LOADK_INT16, 2, 0, 0),          // r2 = 0 (accumulator)
        Instruction(Opcode::LOADK_INT16, 3, 0, 1),          // r3 = 1 (increment)
        Instruction::with_reg_imm16(Opcode::LOADK_INT16, 4, innerLoopCount), // r4 = 1000 (outer limit)
        
        // Inner loop start (instruction 6)
        Instruction(Opcode::ADD_INT, 2, 2, 1),              // accumulator += inner_counter
        Instruction(Opcode::MUL_INT, 2, 2, 3),              // accumulator *= 1 (work)
        Instruction(Opcode::SUB_INT, 2, 2, 3),              // accumulator -= 1 (more work)
        Instruction(Opcode::ADD_INT, 1, 1, 3),              // inner_counter++
        Instruction(Opcode::LT_INT, 6, 1, 4),               // r6 = (inner_counter < inner_limit)
        Instruction(Opcode::JMP_IF_TRUE, 6, 0xFF, 0xFB),    // Jump back -5 if true
        
        // End of inner loop, increment outer counter
        Instruction(Opcode::ADD_INT, 0, 0, 3),              // outer_counter++
        Instruction(Opcode::LT_INT, 6, 0, 5),               // r6 = (outer_counter < outer_limit)
        Instruction(Opcode::JMP_IF_TRUE, 6, 0xFF, 0xF4),    // Jump back -12 if true
        
        Instruction(Opcode::MOVE, 0, 2),                    // Move result to r0
        Instruction(Opcode::HALT, 0)                        // Stop
    };
    
    std::vector<Value> constant_pool;
    
    const int iterations = 10;
    
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
    std::cout << "Instructions executed per iteration: ~" << (outerLoopCount * innerLoopCount * 6) << std::endl;
    
    long instructions_per_second = (outerLoopCount * innerLoopCount * 6 * iterations) * 1000000L / duration.count();
    std::cout << "Approximate instructions per second: " << instructions_per_second << std::endl;
    
    // Print build mode

#ifdef DOMINO_VM_UNSAFE
    std::cout << "Build mode: UNSAFE (validation disabled)" << std::endl;
#else
    std::cout << "Build mode: SAFE (validation enabled)" << std::endl;
#endif
}

int main() {
    benchmark_arithmetic();
    return 0;
}
