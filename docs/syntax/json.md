# JSON handling

This page explains how the language serializes to and deserializes from JSON, and what C++17 code is generated.

## What you get

- println(obj) prints user-defined types as JSON objects
- string(obj) returns a JSON string for user-defined types
- Classes can define static fromJSON(json: string): T to construct instances from JSON
- Arrays are serialized as JSON arrays; nested classes/arrays are handled transitively

All of this is generated automatically when the features are used; the transpiler emits only the helpers actually needed by your program.

## Serialization rules (→ JSON)

- Primitives
  - int, float, double → JSON number
  - bool → true/false
  - string → JSON string with correct escaping
  - char → JSON string of length 1
- Arrays (T[]):
  - Serialized as JSON arrays
  - null arrays print as null
  - For element type:
    - Primitive elements: printed directly
    - string elements: escaped
    - Class elements: element->_toJSON(...) or null when the shared_ptr is empty
- Classes
  - Emitted as JSON objects with all non-static fields
  - Includes private/protected fields as well (intentional for round-trip consistency)
  - string fields are escaped; bool/number fields are emitted directly
  - Nested classes/arrays serialize transitively

Notes and current limitations
- Maps: keys must be strings for JSON deserialization. Serialization supports string-key maps as JSON objects; non-string keys serialize as an array of {"key", "value"} objects.
- Sets: serialize as JSON arrays; order is not guaranteed.
- Union-typed fields are not currently specialized; they fall back to operator<< if present

### Triggering codegen

- println(obj) on a class or any structure containing a class triggers generation of:
  - void T::_toJSON(std::ostream& os) const
  - operator<<(std::ostream&, const T&)
  - operator<<(std::ostream&, const std::shared_ptr<T>&)
- string(obj) marks the type so it also generates the helpers above and returns the JSON string

### Examples

```doof
class Address { city: string; }
class Person { name: string; age: int; address: Address; }

function main() {
  let p = Person { name: "Ada", age: 36, address: Address { city: "Zürich" } };
  println(p);             // {"name":"Ada","age":36,"address":{"city":"Z\u00fcrich"}}
  let s = string(p);      // JSON string of the same object
}
```

## Deserialization rules (JSON → class)

Call a class’s static fromJSON(json: string) to build an instance from a JSON object string. The transpiler generates two helpers when needed:
- static std::shared_ptr<T> fromJSON(const std::string& json_str)
- static std::shared_ptr<T> _fromJSON(const doof_runtime::json::JSONObject& json_obj)

Field handling
- Required fields (no default value): must be present; otherwise a runtime error is thrown
- Optional fields (have a default value): if missing, the default is used
- Types:
  - int/float/double/bool/string: validated and converted via helpers; wrong types cause clear runtime errors
  - class fields: expect a JSON object; nested classes are constructed recursively
  - arrays: expect a JSON array; elements are validated by kind
    - class elements: if the array item is not an object, a null element is inserted

Example

```doof
class User {
  name: string;
  email: string;
  score: int = 0; // optional: default applied if missing

  static fromJSON(json: string): User {
    // the body can be user-defined; presence of this call triggers generator
    return User { name: "", email: "" };
  }
}

function main() {
  let u = User.fromJSON("{\"name\":\"A\",\"email\":\"a@x\"}");
}
```

## Integration with built-ins

- println(obj) prints JSON via the generated operator<< overloads
- string(obj) returns a JSON string (null for a null shared_ptr)

## C++ target details

- The runtime provides a lightweight JSONValue and JSONParser in doof_runtime::json
- The generator emits:
  - T::_toJSON(std::ostream&): streams a well-formed JSON object
  - operator<< overloads delegating to _toJSON
  - T::fromJSON and T::_fromJSON using doof_runtime::json helpers:
    - get_int/get_double/get_bool/get_string/get_array/get_object
    - has_key for optional fields
- For string conversion, C++ uses doof_runtime::class_to_json_string(shared_ptr<T>) under the hood

## Limitations and edge cases

- Map/Set serialization and deserialization
  - Map<K,V> and Set<T> are mapped to unordered containers in C++ but are not yet handled by _toJSON/_fromJSON
  - Workaround: expose custom methods on your class and serialize explicitly for now

- Unicode in strings
  - Strings are escaped; non-ASCII \uXXXX sequences are preserved in escaped form on parsing
  - Full UTF-8 decoding of \uXXXX (including surrogate pairs) is not implemented in the parser today

- Numbers format
  - Floating-point formatting uses iostreams; output is stable but not tailored for minimal JSON representations

If any of these limitations affect you, see enhancements/TODO.md for tracked improvements.

## See also

- Built-ins: println, string — see builtins.md
- Collections mapping — see collections.md and cpp-mapping.md
