// Demonstrates map index read not inserting in VM

function main(): int {
    let m: Map<string, int> = {};
    let v = m["missing"]; // VM should not insert on read
    println(string(m.size) + " " + (m.has("missing") ? "1" : "0"));
    return 0;
}
