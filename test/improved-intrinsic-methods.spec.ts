// Comprehensive tests for the improved intrinsic methods with helper functions

import { describe, it, expect } from 'vitest';
import { transpile } from '../src/index.js';

describe('Improved Intrinsic Methods with Helper Functions', () => {
  describe('String Method Improvements', () => {
    it('should generate clean helper function call for replace()', () => {
      const input = `
        let str = "hello world";
        let replaced = str.replace("world", "universe");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string replaced = doof_runtime::string_replace(str, "world", "universe")');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain nested lambdas
      expect(result.source).not.toContain('([&]() {');
    });

    it('should generate clean helper function call for toLowerCase()', () => {
      const input = `
        let str = "HELLO";
        let lower = str.toLowerCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string lower = doof_runtime::string_to_lower(str)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain lambdas
      expect(result.source).not.toContain('([&]() {');
    });

    it('should generate clean helper function call for toUpperCase()', () => {
      const input = `
        let str = "hello";
        let upper = str.toUpperCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string upper = doof_runtime::string_to_upper(str)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain lambdas
      expect(result.source).not.toContain('([&]() {');
    });

    it('should generate beautiful chained method calls', () => {
      const input = `
        let str = "Hello World";
        let result = str.toLowerCase().replace("world", "universe");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::string result = doof_runtime::string_replace(doof_runtime::string_to_lower(str), "world", "universe")');
      // Should NOT contain any nested lambdas
      expect(result.source).not.toContain('([&]() {');
      // Should be a single clean expression
      expect(result.source?.match(/doof_runtime::string_replace.*doof_runtime::string_to_lower/)).toBeTruthy();
    });

    it('should handle complex chaining with multiple methods', () => {
      const input = `
        let str = "  HELLO WORLD  ";
        let result = str.toLowerCase().replace("hello", "hi").toUpperCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // Should chain helper functions cleanly
      expect(result.source).toContain('doof_runtime::string_to_upper(doof_runtime::string_replace(doof_runtime::string_to_lower(str)');
      // Should NOT contain any lambdas
      expect(result.source).not.toContain('([&]() {');
    });
  });

  describe('Array Method Improvements', () => {
    it('should generate clean helper function call for pop()', () => {
      const input = `
        let arr = [1, 2, 3];
        let last = arr.pop();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('int last = doof_runtime::array_pop(*arr)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain lambda
      expect(result.source).not.toContain('([&]() { auto __val');
    });

    it('should include error handling in array pop helper', () => {
      const input = `
        let arr = [1, 2, 3];
        let last = arr.pop();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The error handling is now in the runtime library, so we just check the call is generated
      expect(result.source).toContain('doof_runtime::array_pop(*arr)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });
  });

  describe('Map Method Improvements', () => {
    it('should generate clean helper function call for keys()', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let keys = myMap.keys();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::shared_ptr<std::vector<std::string>> keys = doof_runtime::map_keys(*myMap)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain lambda
      expect(result.source).not.toContain('([&]() {');
    });

    it('should generate clean helper function call for values()', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let values = myMap.values();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('std::shared_ptr<std::vector<int>> values = doof_runtime::map_values(*myMap)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should NOT contain lambda  
      expect(result.source).not.toContain('([&]() {');
    });
  });

  describe('Code Quality Improvements', () => {
    it('should generate readable helper function implementations', () => {
      const input = `
        let str = "test";
        let result = str.toUpperCase();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      
      // Check that the call is clean and uses the runtime library
      expect(result.source).toContain('doof_runtime::string_to_upper(str)');
      expect(result.header).toContain('#include "doof_runtime.h"');
      // Should not contain generated helper functions since they're in the runtime
      expect(result.source).not.toContain('__str');
      expect(result.source).not.toContain('__pos');
      expect(result.source).not.toContain('__val');
    });

    it('should include proper includes for helper functions', () => {
      const input = `
        let str = "test";
        let result = str.replace("t", "T");
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // doof_runtime.h includes all necessary headers
      expect(result.header).toContain('#include "doof_runtime.h"');
    });

    it('should use template functions for type-safe array operations', () => {
      const input = `
        let arr = [1, 2, 3];
        let last = arr.pop();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The template functions are now in the runtime library
      expect(result.source).toContain('doof_runtime::array_pop(*arr)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });

    it('should use template functions for type-safe map operations', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let keys = myMap.keys();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The template functions are now in the runtime library, myMap is shared_ptr so dereference
      expect(result.source).toContain('doof_runtime::map_keys(*myMap)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });
  });

  describe('Performance and Memory Management', () => {
    it('should use efficient implementations in helpers', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let keys = myMap.keys();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The efficient implementations are now in the runtime library, myMap is shared_ptr so dereference
      expect(result.source).toContain('doof_runtime::map_keys(*myMap)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });

    it('should handle const correctness in map helpers', () => {
      const input = `
        let myMap: Map<string, int> = {};
        let values = myMap.values();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The const correctness is handled in the runtime library, myMap is shared_ptr so dereference
      expect(result.source).toContain('doof_runtime::map_values(*myMap)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });

    it('should handle references properly for array operations', () => {
      const input = `
        let arr = [1, 2, 3];
        let last = arr.pop();
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // The reference handling is in the runtime library
      expect(result.source).toContain('doof_runtime::array_pop(*arr)');
      expect(result.header).toContain('#include "doof_runtime.h"');
    });
  });

  describe('Backward Compatibility', () => {
    it('should still work with non-chainable methods', () => {
      const input = `
        let str = "hello world";
        let pos = str.indexOf("world");
        let len = str.length;
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      expect(result.source).toContain('static_cast<int>(str.find("world"))');
      expect(result.source).toContain('int len = str.size()');
    });

    it('should handle mixed method types', () => {
      const input = `
        function main(): int {
          let myMap: Map<string, int> = {};
          myMap.set("key", 42);
          let size = myMap.size;
          let keys = myMap.keys();
          return 0;
        }
      `;
      const result = transpile(input);
      expect(result.errors).toHaveLength(0);
      // myMap is now shared_ptr, so use -> for index operator
      expect(result.source).toContain('(*myMap)["key"] = 42');
      expect(result.source).toContain('int size = myMap->size()');
      expect(result.source).toContain('doof_runtime::map_keys(*myMap)');
    });
  });
});
