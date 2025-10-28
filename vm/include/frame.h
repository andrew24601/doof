#pragma once
#include "value.h"
#include <vector>

struct Lambda; // Forward declaration

class StackFrame {
public:
    std::vector<Value> registers;
    int instruction_pointer;
    int function_index; // index in constant pool of the currently executing function
    
    StackFrame(int num_registers = 256) 
        : registers(num_registers), instruction_pointer(0), function_index(-1) {}
};
