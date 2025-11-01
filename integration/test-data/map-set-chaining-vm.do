// Demonstrates VM map.set chaining return semantics (returns the map)

function main(): int {
    let m: Map<string, int> = {};
    let r = m.set("a", 1).set("b", 2);
    println(r.size);
    return 0;
}
