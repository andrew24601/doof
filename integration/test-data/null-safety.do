// Test null safety operators (optional chaining and nullish coalescing)

// Nullable types and null coalescing operator


// Optional chaining with objects



// Optional chaining with methods
    
    



// Non-null assertion operator (if supported)


class Address {
    street: string | null;
    city: string | null;
    
}

    class Person {
        name: string;
        address: Address | null;
    }

    class Calculator {
        value: int = 0;
        add(x: int): Calculator {
            this.value += x;
            return this;
        }
        getResult(): int {
            return this.value;
        }
    }


function main(): int {
    let result = "";
    let nullableString: string | null = null;
    let defaultValue = nullableString ?? "default";
    result = result + defaultValue + "|";
    nullableString = "actual";
    let actualValue = nullableString ?? "default";
    result = result + actualValue + "|";
    let person: Person | null = null;
    let cityName = person?.address?.city ?? "unknown";
    result = result + cityName + "|";
    person = {
        name: "Alice",
        address: {
            street: "123 Main St",
            city: "Anytown"
        }
    };
    cityName = person?.address?.city ?? "unknown";
    result = result + cityName + "|";
    let calc: Calculator | null = new Calculator();
    let chainResult = calc?.add(5)?.add(3)?.getResult() ?? 0;
    result = result + chainResult + "|";
    calc = null;
    chainResult = calc?.add(5)?.add(3)?.getResult() ?? 999;
    result = result + chainResult + "|";
    let definitelyString: string | null = "hello";
    let assertedLength = definitelyString!.length;
    result = result + assertedLength;
    println(result);
    return 0;
}