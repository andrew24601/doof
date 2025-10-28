// Test break and continue in loops

// Continue in for loop

// Break in for loop

// Continue in while loop

// Break in nested loop

function main(): int {
    let result = "";
    for (let i = 0; i < 10; i++) {
        if (i % 2 == 0) {
            continue;
        }
        result = result + i;
    }
    result = result + "|";
    for (let j = 0; j < 10; j++) {
        if (j > 3) {
            break;
        }
        result = result + j;
    }
    result = result + "|";
    let k = 0;
    while (k < 10) {
        k++;
        if (k % 3 == 0) {
            continue;
        }
        result = result + k;
    }
    result = result + "|";
    for (let outer = 0; outer < 3; outer++) {
        for (let inner = 0; inner < 3; inner++) {
            if (inner == 1) {
                break;
            }
            result = result + outer + inner;
        }
    }
    println(result);
    return 0;
}