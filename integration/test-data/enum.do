enum Color {
    Red = "r",
    Green = "g",
    Blue = "b"
}

enum Number {
    One = 1,
    Two,
    Three,
    Four
}

class Combo {
    color: Color;
    number: Number;
}

function main() {
    const r = Color.Red;
    const g: Color = .Green;
    const b: Color = Color.Blue;

    const o = Number.One;
    const t: Number = .Two;
    const f: Number = Number.Four;

    const v: Combo = {
        color: .Green,
        number: .Three
    };

    const w = Combo.fromJSON(`{"color":"b","number":2}`);

    println(r);
    println(g);
    println(b);

    println(o);
    println(t);
    println(f);

    println(w.color == Color.Blue);
    println(w.number == Number.Two);

    println(v);
    println(w);
}
