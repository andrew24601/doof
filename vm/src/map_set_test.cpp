#include "../include/vm.h"
#include "../include/value.h"
#include "../include/opcodes.h"
#include <iostream>
#include <vector>

int main() {
    // Test map operations
    std::cout << "Testing Map Operations:" << std::endl;

    std::vector<Instruction> map_test_code = {
        // Create new map: r1 = new Map()
        Instruction(Opcode::NEW_MAP, 1, 0, 0),
        
        // Create string keys and values
        Instruction(Opcode::LOADK, 2, 0, 0),    // r2 = "hello" (key)
        Instruction(Opcode::LOADK, 3, 0, 1),    // r3 = "world" (value)
        
        // Set map entry: r1["hello"] = "world"
        Instruction(Opcode::SET_MAP, 1, 2, 3),
        
        // Get map entry: r4 = r1["hello"]
        Instruction(Opcode::GET_MAP, 4, 1, 2),
        
        // Check if key exists: r5 = r1.has("hello")
        Instruction(Opcode::HAS_KEY_MAP, 5, 1, 2),
        
        // Get map size: r6 = r1.size()
        Instruction(Opcode::SIZE_MAP, 6, 1, 0),
        
        // Print results
        Instruction(Opcode::EXTERN_CALL, 4, 0, 2),  // println(r4) - should print "world"
        Instruction(Opcode::EXTERN_CALL, 5, 0, 2),  // println(r5) - should print true
        Instruction(Opcode::EXTERN_CALL, 6, 0, 2),  // println(r6) - should print 1
        
        Instruction(Opcode::HALT, 0, 0, 0)
    };

    std::vector<Value> map_constants = {
        Value::make_string("hello"),  // index 0
        Value::make_string("world"),  // index 1
        Value::make_string("println") // index 2
    };

    // Test set operations
    std::cout << "\nTesting Set Operations:" << std::endl;

    std::vector<Instruction> set_test_code = {
        // Create new set: r1 = new Set()
        Instruction(Opcode::NEW_SET, 1, 0, 0),
        
        // Create values to add
        Instruction(Opcode::LOADK, 2, 0, 0),    // r2 = "apple"
        Instruction(Opcode::LOADK, 3, 0, 1),    // r3 = "banana"
        
        // Add elements: r8 = r1.add("apple")  -- use r8 for return value
        Instruction(Opcode::ADD_SET, 8, 1, 2),
        
        // Add elements: r9 = r1.add("banana")  -- use r9 for return value
        Instruction(Opcode::ADD_SET, 9, 1, 3),
        
        // Check if element exists: r4 = r1.has("apple")
        Instruction(Opcode::HAS_SET, 4, 1, 2),
        
        // Check if element exists: r5 = r1.has("cherry") 
        Instruction(Opcode::LOADK, 6, 0, 2),    // r6 = "cherry"
        Instruction(Opcode::HAS_SET, 5, 1, 6),
        
        // Get set size: r7 = r1.size()
        Instruction(Opcode::SIZE_SET, 7, 1, 0),
        
        // Print results
        Instruction(Opcode::EXTERN_CALL, 4, 0, 3),  // println(r4) - should print true
        Instruction(Opcode::EXTERN_CALL, 5, 0, 3),  // println(r5) - should print false
        Instruction(Opcode::EXTERN_CALL, 7, 0, 3),  // println(r7) - should print 2
        
        Instruction(Opcode::HALT, 0, 0, 0)
    };

    std::vector<Value> set_constants = {
        Value::make_string("apple"),   // index 0
        Value::make_string("banana"),  // index 1
        Value::make_string("cherry"),  // index 2
        Value::make_string("println")  // index 3
    };

    try {
        DoofVM vm;
        vm.set_verbose(true);
        
        std::cout << "\n=== Running Map Test ===" << std::endl;
        vm.run(map_test_code, map_constants, 0);
        
        std::cout << "\n=== Running Set Test ===" << std::endl; 
        vm.run(set_test_code, set_constants, 0);
        
        std::cout << "\n=== All tests completed successfully! ===" << std::endl;
        
    } catch (const std::exception& e) {
        std::cerr << "Test failed: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
