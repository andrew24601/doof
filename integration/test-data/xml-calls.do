// Integration test for XML-style element call syntax
// Covers: attributes as named args (relaxed order), expression attribute values, children array mapping,
// nested text and braced expression children, self-closing tags, and shorthand lambda attribute with inferred param.

function container(title: string, children: string[]): void {
    println("CONTAINER:" + title);
    for (let c of children) {
        println("* " + c);
    }
}

function leaf(id: int, text: string): void {
    println("LEAF " + id + ":" + text);
}

function button(label: string, onClick: (value:int): void, children: string[]): void {
    println("BTN " + label);
    onClick(42);
    for (let c of children) {
        println("~ " + c);
    }
}

enum Colour {
    Red,
    Green,
    Blue
}

class Sphere {
    radius: int;
    colour: Colour;
}

function main(): int {
    <container title="root"> Hello { "world" } </container>;
    <leaf id=2 text="beta" />;
    <button onClick=>println(value) label="ok"> clicked </button>;
    const s = <Sphere radius=10 colour={Colour.Blue} ></Sphere>;
    println(s);
    return 0;
}
