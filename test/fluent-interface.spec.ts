import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler.js';

function generateCodeFromString(source: string): { header: string; source: string; errors: string[] } {
  const transpiler = new Transpiler();
  const result = transpiler.transpile(source, 'test.do');
  
  return {
    header: result.header || '',
    source: result.source || '',
    errors: result.errors.map(err => typeof err === 'string' ? err : err.message)
  };
}

describe('Fluent Interface Support', () => {
  const generate = (source: string) => {
    return generateCodeFromString(source);
  };

  describe('Class Declaration', () => {
    it('should inherit from std::enable_shared_from_this for fluent interface classes', () => {
      const source = `
        class Builder {
          value = 0;
          
          setValue(val: int): Builder {
            value = val;
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class Builder : public std::enable_shared_from_this<Builder>');
    });

    it('should inherit from std::enable_shared_from_this when this is used as a value', () => {
      const source = `
        class Node {
          children: Node[];
          
          addToList(): void {
            children.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class Node : public std::enable_shared_from_this<Node>');
    });

    it('should inherit from std::enable_shared_from_this for all classes (simplified approach)', () => {
      const source = `
        class RegularClass {
          value = 0;
          
          getValue(): int {
            return this.value;
          }
          
          setValue(val: int): void {
            this.value = val;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class RegularClass : public std::enable_shared_from_this<RegularClass>');
    });
  });

  describe('Method Return Statements', () => {
    it('should replace "return this;" with "return shared_from_this();" in fluent methods', () => {
      const source = `
        class FluentBuilder {
          count = 0;
          
          increment(): FluentBuilder {
            count++;
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.source).toContain('return shared_from_this();');
      expect(result.source).not.toContain('return this;');
    });

    it('should replace this as argument with shared_from_this() when used as value', () => {
      const source = `
        class Node {
          siblings: Node[];
          
          addSelf(): void {
            siblings.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.source).toContain('this->siblings->push_back(shared_from_this())');
      expect(result.source).not.toContain('push_back(this);');
    });    it('should not modify this when used for member access', () => {
      const source = `
        class SimpleClass {
          value = 0;
          
          getValue(): int {
            return this.value;
          }
          
          setValue(val: int): void {
            this.value = val;
          }
        }
      `;

      const result = generate(source);
      // this.value should remain as this->value, not shared_from_this()->value
      expect(result.source).toContain('this->value');
      expect(result.source).not.toContain('shared_from_this()');
      // All classes now inherit from enable_shared_from_this for simplicity
      expect(result.header).toContain('std::enable_shared_from_this');
    });
  });

  describe('Shared Pointer Context Usage', () => {
    it('should handle graph-like structures with this as argument', () => {
      const source = `
        class Graph {
          connectsFrom: Graph[];
          connectsTo: Graph[];

          addConnection(other: Graph): void {
            connectsTo.push(other);
            other.connectsFrom.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class Graph : public std::enable_shared_from_this<Graph>');
      expect(result.source).toContain('push_back(shared_from_this())');
      expect(result.source).not.toContain('push_back(this);');
    });

    it('should handle this passed to method calls', () => {
      const source = `
        class Item {
          static allItems: Item[] = [];
          
          register(): void {
            Item.allItems.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.errors).toStrictEqual([]);
      expect(result.header).toContain('class Item : public std::enable_shared_from_this<Item>');
      expect(result.source).toContain('push_back(shared_from_this())');
    });
  });

  describe('Complex Fluent Interface Scenarios', () => {
    it('should handle multiple fluent methods in the same class', () => {
      const source = `
        class Builder {
          value = 0;
          name = "";
          
          setValue(val: int): Builder {
            value = val;
            return this;
          }
          
          setName(n: string): Builder {
            name = n;
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class Builder : public std::enable_shared_from_this<Builder>');
      
      // Count occurrences of shared_from_this() - should be 2 (one for each fluent method)
      const sharedFromThisCount = (result.source.match(/return shared_from_this\(\);/g) || []).length;
      expect(sharedFromThisCount).toBe(2);
    });

    it('should handle conditional returns in fluent methods', () => {
      const source = `
        class ConditionalBuilder {
          valid = true;
          
          validate(): ConditionalBuilder {
            if (valid) {
              return this;
            }
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::enable_shared_from_this<ConditionalBuilder>');
      
      // Both return statements should be converted
      const sharedFromThisCount = (result.source.match(/return shared_from_this\(\);/g) || []).length;
      expect(sharedFromThisCount).toBe(2);
    });
  });

  describe('Instance Creation', () => {
    it('should create instances with std::make_shared', () => {
      const source = `
        class FluentClass {
          value = 0;
          
          setValue(val: int): FluentClass {
            value = val;
            return this;
          }
        }
        
        function main(): int {
          const builder = FluentClass();
          return 0;
        }
      `;

      const result = generate(source);
      expect(result.source).toContain('std::make_shared<FluentClass>()');
    });
  });

  describe('Edge Cases', () => {
    it('should not affect static methods', () => {
      const source = `
        class StaticExample {
          value = 0;
          
          setValue(val: int): StaticExample {
            value = val;
            return this;
          }
          
          static createDefault(): StaticExample {
            return StaticExample();
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::enable_shared_from_this<StaticExample>');
      
      // Instance method should use shared_from_this
      expect(result.source).toContain('return shared_from_this();');
      
      // Static method should still create instance normally
      expect(result.source).toContain('return std::make_shared<StaticExample>()');
    });

    it('should handle mixed return types in the same class', () => {
      const source = `
        class MixedClass {
          count = 0;
          
          increment(): MixedClass {
            count++;
            return this;
          }
          
          getCount(): int {
            return count;
          }
          
          reset(): MixedClass {
            count = 0;
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::enable_shared_from_this<MixedClass>');
      
      // Two fluent methods should use shared_from_this
      const sharedFromThisCount = (result.source.match(/return shared_from_this\(\);/g) || []).length;
      expect(sharedFromThisCount).toBe(2);
      
      // getCount should return the count value directly
      expect(result.source).toContain('return this->count;');
    });

    it('should not affect classes without this as value usage', () => {
      const source = `
        class SimpleClass {
          value = 42;
          
          getValue(): int {
            return this.value;
          }
          
          setValue(val: int): void {
            this.value = val;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class SimpleClass : public std::enable_shared_from_this<SimpleClass>');
      expect(result.source).not.toContain('shared_from_this');
    });
  });

  describe('Type System Integration', () => {
    it('should correctly identify class types in return statements', () => {
      const source = `
        class TypedBuilder {
          name = "";
          
          setName(n: string): TypedBuilder {
            name = n;
            return this;
          }
          
          getName(): string {
            return name;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::shared_ptr<TypedBuilder> setName(const std::string& n);');
      expect(result.header).toContain('std::string getName();');
      expect(result.source).toContain('return shared_from_this();');
      expect(result.source).toContain('return this->name;');
    });
  });

  describe('Shared Pointer Contexts', () => {
    it('should use enable_shared_from_this for classes that pass this to shared_ptr fields', () => {
      const source = `
        class Graph {
          connectsFrom: Graph[];
          connectsTo: Graph[];

          addConnection(other: Graph) {
            connectsTo.push(other);
            other.connectsFrom.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class Graph : public std::enable_shared_from_this<Graph>');
      expect(result.source).toContain('push_back(shared_from_this())');
    });

    it('should handle classes with self-referencing array fields', () => {
      const source = `
        class TreeNode {
          children: TreeNode[];
          
          addChild(child: TreeNode) {
            children.push(child);
          }
          
          addSelfToParent(parent: TreeNode) {
            parent.children.push(this);
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::enable_shared_from_this<TreeNode>');
      expect(result.source).toContain('push_back(shared_from_this())');
    });

    it('should handle mixed usage of this in both return and array contexts', () => {
      const source = `
        class ChainableNode {
          siblings: ChainableNode[];
          
          addSibling(node: ChainableNode): ChainableNode {
            siblings.push(node);
            node.siblings.push(this);
            return this;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('std::enable_shared_from_this<ChainableNode>');
      expect(result.source).toContain('push_back(shared_from_this())');
      expect(result.source).toContain('return shared_from_this();');
    });

    it('should not affect classes that only use this for member access', () => {
      const source = `
        class SimpleClass {
          value = 42;
          
          getValue(): int {
            return value;
          }
          
          setValue(val: int): void {
            value = val;
          }
        }
      `;

      const result = generate(source);
      expect(result.header).toContain('class SimpleClass : public std::enable_shared_from_this<SimpleClass>');
      expect(result.source).not.toContain('shared_from_this');
    });

    it('should handle simple class with static fields', () => {
      const source = `
        class Item {
          static allItems: Item[] = [];
        }
      `;

      const result = generate(source);
      // Without constructors, this should compile successfully and generate basic class structure
      expect(result.errors).toEqual([]);
      expect(result.source).toContain('Item::Item()');
      expect(result.source).toContain('std::shared_ptr<std::vector<std::shared_ptr<Item>>> Item::allItems');
    });
  });
});
