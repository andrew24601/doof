// Demonstrates C++ vs VM behavior for non-null assertion on null

function main(): int {
    let s: string | null = null;
    let x = s!; // C++ asserts; VM currently passes through with no output
    return 0;
}
