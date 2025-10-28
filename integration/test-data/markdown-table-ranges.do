// Markdown table ranges test: inclusive and exclusive
function main(): int {
    let score: int = 85;
    let grade: string = "";

    // Alignment markers accepted but ignored by codegen
    | score   | =grade |
    | :---    | ---:   |
    | 90..100 | "A"    |
    | 80..89  | "B"    |
    | 70..79  | "C"    |
    | 60..69  | "D"    |
    | 0..<60  | "F"    |

    println(grade);
    return 0;
}
