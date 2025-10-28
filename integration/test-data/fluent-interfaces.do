// Test fluent interfaces and method chaining

class FluentBuilder {
    private value: string = "";
    private count: int = 0;
    append(text: string): FluentBuilder {
        this.value = this.value + text;
        return this;
    }
    repeat(times: int): FluentBuilder {
        let original = this.value;
        for (let i = 1; i < times; i++) {
            this.value = this.value + original;
        }
        return this;
    }
    prefix(text: string): FluentBuilder {
        this.value = text + this.value;
        return this;
    }
    increment(): FluentBuilder {
        this.count = this.count + 1;
        return this;
    }
    build(): string {
        return this.value + "(" + this.count + ")";
    }
}

function main(): int {
    let result = "";
    let builder = FluentBuilder{};
    let fluentResult = builder
        .append("hello")
        .append(" ")
        .append("world")
        .prefix(">> ")
        .increment()
        .increment()
        .build();
    result = result + fluentResult + "|";
    let shortChain = FluentBuilder{}
        .append("test")
        .repeat(3)
        .increment()
        .build();
    result = result + shortChain;
    println(result);
    return 0;
}