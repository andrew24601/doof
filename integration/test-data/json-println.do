class foo {
    x: int;
    y: int;
}

function main(): void {
    const y:foo = {x: 10, y: 12};
    const x = 12;
    println("Hello world!");
    println(y);
    println("How are you? " + y);
}
