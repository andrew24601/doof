#include "error-handling.h"
#include "doof_runtime.h"

int safeDivision(int x, int y) {
    if ((y == 0)) {
        (std::cerr << "panic: " << "Division by zero error" << std::endl, std::exit(1), 0);
    }
    return (x / y);
}

void validateInput(int value) {
    if ((value < 0)) {
        (std::cerr << "panic: " << "Negative values not allowed" << std::endl, std::exit(1), 0);
    }
}

int main() {
    int result1 = safeDivision(10, 2);
    std::cout << "Safe division result: 5" << std::endl;
    validateInput(5);
    std::cout << "Input validation passed" << std::endl;
    int result2 = safeDivision(10, 0);
    std::cout << "This should never be reached" << std::endl;
    return 0;
}

