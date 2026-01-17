# Generics

Doof supports generic (parameterized) functions, classes, and methods. Generics are monomorphized at compile time, meaning specialized versions are generated for each unique type argument combination used in the code.

## Generic Functions

Generic functions declare type parameters in angle brackets after the function name:

```doof
function identity<T>(value: T): T {
    return value;
}

// Call with explicit type argument
let s = identity<string>("hello");
let n = identity<int>(42);
```

Multiple type parameters:

```doof
function pair<K, V>(key: K, value: V): Map<K, V> {
    return { key: value };
}

let m = pair<string, int>("count", 10);
```

## Generic Classes

Classes can declare type parameters after the class name:

```doof
class Box<T> {
    value: T;
}

// Instantiate with type argument
let intBox = Box<int> { value: 42 };
let strBox = Box<string> { value: "hello" };
```

Generic class with methods:

```doof
class Container<T> {
    private items: Array<T> = [];
    
    add(item: T): void {
        this.items.push(item);
    }
    
    get(index: int): T {
        return this.items[index];
    }
}

let c = Container<string>();
c.add("first");
let item = c.get(0);
```

## Generic Methods

Methods can have their own type parameters independent of the class type parameters:

### Instance Methods

```doof
class Transformer {
    transform<T>(value: T): T {
        return value;
    }
}

let t = Transformer {};
let result = t.transform<int>(42);
```

### Static Methods

```doof
class Factory {
    static create<T>(value: T): T {
        return value;
    }
}

let obj = Factory.create<string>("hello");
```

### Combining Class and Method Type Parameters

```doof
class Processor<T> {
    value: T;
    
    // Method has its own type parameter U
    convertTo<U>(converter: (T) => U): U {
        return converter(this.value);
    }
}

let p = Processor<int> { value: 42 };
let s = p.convertTo<string>((n: int): string => int_to_string(n));
```

## Monomorphization

Doof uses monomorphization to implement generics. When the transpiler encounters a generic function, class, or method with concrete type arguments, it generates a specialized version.

For example:
```doof
function identity<T>(x: T): T { return x; }

let a = identity<int>(1);
let b = identity<string>("hello");
```

Generates two specialized functions:
- `identity__primitive_int` for `int`
- `identity__class_String` for `string`

### Unused Generics

Generic definitions that are never instantiated with concrete types produce a diagnostic:
```
Generic function 'identity' is not instantiated with any concrete type arguments
```

This is a warning, not an error, as unused generics may be intended for library code.

## C++ Mapping

Generic functions and classes map to mangled names in C++:

| Doof | C++ |
|------|-----|
| `identity<int>(x)` | `identity__primitive_int(x)` |
| `Box<string>` | `Box__class_String` |
| `Map<int, string>` | Uses built-in `std::unordered_map` |

Type parameter mangling rules:
- Primitive types: `primitive_int`, `primitive_string`, etc.
- Class types: `class_ClassName`
- Array types: `array_ElementType`
- Nested generics: `class_Box__primitive_int`

## Constraints and Limitations

Current limitations:
- Type parameter constraints (bounds) are not yet supported
- Type inference for type arguments is not supported; explicit type arguments required
- Generic type parameters cannot be used in static contexts within generic classes
- Variadic type parameters are not supported

## Examples

### Generic Data Structure

```doof
class Stack<T> {
    private items: Array<T> = [];
    
    push(item: T): void {
        this.items.push(item);
    }
    
    pop(): T | null {
        if (this.items.length() == 0) {
            return null;
        }
        return this.items.pop();
    }
    
    peek(): T | null {
        if (this.items.length() == 0) {
            return null;
        }
        return this.items[this.items.length() - 1];
    }
}

let stack = Stack<int>();
stack.push(1);
stack.push(2);
let top = stack.pop(); // 2
```

### Generic Factory Pattern

```doof
class Result<T> {
    readonly success: bool;
    readonly value: T | null;
    readonly error: string | null;
    
    static ok<T>(value: T): Result<T> {
        return Result<T> { success: true, value: value, error: null };
    }
    
    static err<T>(message: string): Result<T> {
        return Result<T> { success: false, value: null, error: message };
    }
}

let r1 = Result.ok<int>(42);
let r2 = Result.err<string>("not found");
```
