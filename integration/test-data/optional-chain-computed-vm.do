// Demonstrates optional chaining with computed index in VM backend

function main(): int {
    let a: Array<int> | null = [10, 20];
    let i = 1;
    let x = a?.[i] ?? -1;
    println(x);
    return 0;
}
