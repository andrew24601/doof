// Markdown table range boundary test: inclusive vs exclusive
function main(): int {
    let score: int = 60;
    let grade: string = "";

    | score   | =grade |
    | ---     | ---    |
    | 60..69  | "D"    |
    | 0..<60  | "F"    |

    println(grade); // expect D

    score = 59;
    grade = "";

    | score   | =grade |
    | ---     | ---    |
    | 60..69  | "D"    |
    | 0..<60  | "F"    |

    println(grade); // expect F
    return 0;
}
