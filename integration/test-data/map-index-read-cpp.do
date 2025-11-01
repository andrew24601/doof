// Demonstrates map index read side-effects in C++ (insertion) vs VM (no insertion)

function main(): int {
    let m: Map<string, int> = {};
    let v = m["missing"]; // C++ inserts default; VM should not
    println(string(m.size) + " " + (m.has("missing") ? "1" : "0"));
    return 0;
}
