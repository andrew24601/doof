// Demonstrates instance field increment support in C++ backend

class C {
    i: int = 1;
}

function main(): int {
    let c = C {};
    c.i++;
    println(c.i);
    return 0;
}
