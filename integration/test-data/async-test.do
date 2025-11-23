// Async/Await Integration Test

async function calculate(x: int): int {
    return x * 2;
}

async function add(a: int, b: int): int {
    return a + b;
}

function main(): void {
    let f1 = async calculate(10);
    let f2 = async add(5, 7);

    let r1 = await f1;
    let r2 = await f2;

    println(r1); // Expected: 20
    println(r2); // Expected: 12
    
    if (r1 == 20 && r2 == 12) {
        println("Async test passed");
    } else {
        println("Async test failed");
    }
}
