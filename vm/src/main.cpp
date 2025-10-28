#include <iostream>
#include <vector>
#include "vm.h"

void testgen()
{
    std::vector<Instruction> code = {
        Instruction(Opcode::LOADK_INT16, 1, 0, 5),
        Instruction(Opcode::LOADK, 2, 0, 0),
        Instruction(Opcode::INT_TO_DOUBLE, 4, 1, 0),
        Instruction(Opcode::ADD_DOUBLE, 3, 4, 2),
        Instruction(Opcode::EXTERN_CALL, 3, 0, 1),
        Instruction(Opcode::LOADK_NULL, 0, 0, 0),
        Instruction(Opcode::RETURN, 0, 0, 0),
        Instruction(Opcode::HALT, 0, 0, 0)};

    std::vector<Value> constant_pool = {
        Value::make_double(3.14),
        Value::make_string("println")};

    DoofVM vm;
    vm.run(code, constant_pool);
}

int main()
{
    std::cout << "Doof VM Complete Test Suite" << std::endl;
    std::cout << "=============================" << std::endl;

    try
    {
        testgen();

        std::cout << "All tests completed!" << std::endl;
    }
    catch (const std::exception &e)
    {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }

    return 0;
}
