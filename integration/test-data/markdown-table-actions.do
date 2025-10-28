// Markdown table action conclusion column (=)
function main(): int {
    let x: int = 3;
    let z: int = 0;

    | x         | = |
    | ---       | --- |
    | 1         | println("one"); |
    | 2, 3      | println("two-or-three"); z = 1; println(z); |
    |           | println("default"); |

    return 0;
}
