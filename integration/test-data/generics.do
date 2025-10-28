// Integration test for generic functions and classes

function identity<T>(value: T): T {
    return value;
}

class Box<T> {
    value: T;

    getValue(): T {
        return this.value;
    }
}

function main(): int {
    let number: int = identity<int>(7);
    let label: string = identity<string>("generic");

    let boxedNumber: Box<int> = Box<int> { value: number };
    let boxedLabel: Box<string> = Box<string> { value: label + "s" };

    println(number);
    println(label);
    println(boxedNumber.getValue());
    println(boxedLabel.getValue());

    return 0;
}
