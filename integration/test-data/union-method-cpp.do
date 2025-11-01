// Demonstrates union method dispatch support in C++ backend

class A {
    name(): string { return "A"; }
}

class B {
    name(): string { return "B"; }
}

function main(): int {
    let u: A | B = A {};
    println(u.name());
    u = B {};
    println(u.name());
    return 0;
}
