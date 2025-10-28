// Unit tests for intrinsic methods on maps, arrays, and strings

import { describe, it, expect } from 'vitest';
import { transpile } from '../src/transpiler.js';
import { errorMessages } from './helpers/error-helpers.js';

describe('Intrinsic Methods', () => {
  describe('Map Methods', () => {
    it('should transpile map.set() method', () => {
      const input = `
        function main(): int {
          let myMap: Map<string, int> = {};
          myMap.set("key", 42);
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.header).toContain('#include <unordered_map>');
      expect(result.source).toContain('std::map<std::string, int> myMap = {}');
      expect(result.source).toContain('myMap["key"] = 42');
    });

    it('should transpile map.get() method', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let value = myMap.get("key");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int value = myMap.at("key")');
    });

    it('should transpile map.has() method', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let exists = myMap.has("key");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool exists = (myMap.find("key") != myMap.end())');
    });

    it('should transpile map.delete() method', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let removed = myMap.delete("key");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('bool removed = myMap.erase("key")');
    });

    it('should transpile map.clear() method', () => {
      const input = `
        function main(): int {
          let myMap: Map<string, int> = {};
          myMap.clear();
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('myMap.clear()');
    });

    it('should transpile map.keys() method', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let keys = myMap.keys();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.header).toContain('#include "doof_runtime.h"');
      expect(result.source).toContain('std::shared_ptr<std::vector<std::string>> keys =');
      expect(result.source).toContain('doof_runtime::map_keys(myMap)');
    });

    it('should transpile map.values() method', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let values = myMap.values();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::shared_ptr<std::vector<int>> values =');
      expect(result.source).toContain('doof_runtime::map_values(myMap)');
    });

    it('should transpile map.size property', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let size = myMap.size;
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int size = myMap.size()');
    });
  });

  describe('Array Methods', () => {
    it('should transpile array.push() method', () => {
      const input = `
        function main(): int {
          let arr = [1, 2, 3];
          arr.push(4);
          return 0;
      } 
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.header).toContain('#include <vector>');
      expect(result.source).toContain('arr->push_back(4)');
    });

    it('should transpile array.pop() method', () => {
      const input = `
        let arr = [1, 2, 3];
        let last = arr.pop();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int last = doof_runtime::array_pop(*arr)');
    });

    it('should transpile array.indexOf() method', () => {
      const input = `
        let arr = [1, 2, 3];
        let index = arr.indexOf(2);
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int index = std::distance(arr->begin(), std::find(arr->begin(), arr->end(), 2))');
    });

    it('should transpile array.length property', () => {
      const input = `
        let arr = [1, 2, 3];
        let len = arr.length;
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int len = arr->size()');
    });
  });

  describe('String Methods', () => {
    it('should transpile string.substring() method', () => {
      const input = `
        let str = "hello world";
        let sub = str.substring(0, 5);
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.header).toContain('#include <string>');
      expect(result.source).toContain('std::string sub = str.substr(0, 5 - 0)');
    });

    it('should transpile string.indexOf() method', () => {
      const input = `
        let str = "hello world";
        let pos = str.indexOf("world");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('static_cast<int>(str.find("world"))');
    });

    it('should transpile string.replace() method', () => {
      const input = `
        let str = "hello world";
        let replaced = str.replace("world", "universe");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string replaced = doof_runtime::string_replace(str, "world", "universe")');
    });

    it('should transpile string.toUpperCase() method', () => {
      const input = `
        let str = "hello";
        let upper = str.toUpperCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string upper = doof_runtime::string_to_upper(str)');
    });

    it('should transpile string.toLowerCase() method', () => {
      const input = `
        let str = "HELLO";
        let lower = str.toLowerCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string lower = doof_runtime::string_to_lower(str)');
    });

    it('should transpile string.length property', () => {
      const input = `
        let str = "hello";
        let len = str.length;
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int len = str.size()');
    });
  });

  describe('Method Chaining', () => {
    it('should support chaining string methods', () => {
      const input = `
        let str = "Hello World";
        let result = str.toLowerCase().replace("world", "universe");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string result =');
      // Should generate chained helper function calls
      expect(result.source).toContain('doof_runtime::string_replace(doof_runtime::string_to_lower(str)');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle map with complex types', () => {
      const input = `
        function main(): int {
          let complexMap: Map<string, int[]> = {};
          complexMap.set("numbers", [1, 2, 3]);
          let arr = complexMap.get("numbers");
          arr.push(4);
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::map<std::string, std::shared_ptr<std::vector<int>>> complexMap');
    });
  });

  describe('Error Handling', () => {
    it('should report error for unknown map method', () => {
      const input = `
        function main(): int {
          let myMap: Map<string, int> = {};
          myMap.unknownMethod();
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
        const messages = errorMessages(result.errors);
        expect(messages[0]).toContain('Unknown map method');
    });

    it('should report error for unknown array method', () => {
      const input = `
        function main(): int {
          let arr = [1, 2, 3];
          arr.unknownMethod();
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
        const messages = errorMessages(result.errors);
        expect(messages[0]).toContain('Unknown array method');
    });

    it('should report error for unknown string method', () => {
      const input = `
        function main(): int {
          let str = "hello";
          str.unknownMethod();
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors.length).toBeGreaterThan(0);
        const messages = errorMessages(result.errors);
        expect(messages[0]).toContain('Unknown string method');
    });
  });
});
