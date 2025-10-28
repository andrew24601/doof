// Integration test validating mutable lambda captures via wrapper objects

function updateCapturedLocal(): void {
    let localCounter: int = 5;

    const apply = ():int => {
        localCounter += 3;
        return localCounter;
    };

    println(localCounter);
    println(apply());
    println(localCounter);
}

function makeIncrementer(start: int): (): int {
    let current: int = start;
    return => {
        current++;
        return current;
    };
}

function main(): int {
    updateCapturedLocal();

    let increment = makeIncrementer(10);
    println(increment());
    println(increment());

    return 0;
}
