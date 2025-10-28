// Markdown-like rule table integration test
// Ensures parser + validator desugar tables into executable if/else chains

function main(): int {
    let x: int = 2;
    let y: int = -1;

    // Rule table with comparison condition and declaration conclusion
    | x | =y |
    | --- | --- |
    | 1 | 10 |
    | 2, 3 | 20 |
    |  | 0 |

    println(y);
    return 0;
}
