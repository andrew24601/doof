import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { CppGenerator } from '../src/codegen/cppgen.js';
import { Validator } from '../src/validation/validator.js';

describe('Conditional JSON Generation', () => {
  function transpileCode(code: string) {
    const lexer = new Lexer(code, 'test.do');
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const validator = new Validator({ allowTopLevelStatements: true });
    const context = validator.validate(ast);
    const generator = new CppGenerator();
    const result = generator.generate(ast, 'test', context);
    return { ...result, errors: context.errors };
  }

  describe('println-triggered _toJSON generation', () => {

    it('should generate _toJSON for nested types when parent is printed', () => {
      const code = `
        class Address {
          street: string;
          city: string;
        }
        
        class Person {
          name: string;
          address: Address;
        }
        
        class Company {
          name: string;
          employees: Person[];
        }
        
        function main(): void {
          let company = Company { 
            name: "Tech Corp", 
            employees: [] 
          };
          println(company);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // All types should have _toJSON because they are transitively used in println
      // Company (directly printed)
      expect(result.header).toMatch(/class Company[\s\S]*?void _toJSON\(std::ostream& os\) const;/);
      expect(result.source).toContain('void Company::_toJSON(std::ostream& os) const');

      // Person (field of Company)
      expect(result.header).toMatch(/class Person[\s\S]*?void _toJSON\(std::ostream& os\) const/);

      // Address (field of Person)
      expect(result.header).toMatch(/class Address[\s\S]*?void _toJSON\(std::ostream& os\) const/);

      // All should have operator<< overloads
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const std::shared_ptr<Company>& obj\)/);
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const std::shared_ptr<Person>& obj\)/);
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const std::shared_ptr<Address>& obj\)/);
    });

    it('should handle arrays, maps, and sets transitively', () => {
      const code = `
        class Item {
          value: int;
        }
        
        class Container {
          items: Item[];
        }
        
        function main(): void {
          let container = Container {
            items: []
          };
          println(container);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // Both Container and Item should have _toJSON
      expect(result.header).toMatch(/class Container[\s\S]*?void _toJSON\(std::ostream& os\) const/);
      expect(result.header).toMatch(/class Item[\s\S]*?void _toJSON\(std::ostream& os\) const/);
      
      expect(result.source).toContain('std::ostream& operator<<(std::ostream& os, const Item& obj)');
    });

    it('should detect cycles and not cause infinite recursion', () => {
      const code = `
        class Node {
          value: int;
          children: Node[];
        }
        
        function main(): void {
          let node = Node { value: 1, children: [] };
          println(node);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // Should generate _toJSON for Node without infinite recursion
      expect(result.header).toMatch(/class Node[\s\S]*?void _toJSON\(std::ostream& os\) const;/);
      expect(result.source).toContain('void Node::_toJSON(std::ostream& os) const');
      
      // Should handle recursive array serialization
      expect(result.source).toContain('for (size_t i = 0; i < children->size(); ++i)');
    });
  });

  describe('fromJSON-triggered generation', () => {
    it('should generate fromJSON only for types with static fromJSON calls', () => {
      const code = `
        class UsedClass {
          value: int;
          
          static fromJSON(json: string): UsedClass {
            return UsedClass { value: 42 };
          }
        }
        
        class UnusedClass {
          data: string;
          
          static fromJSON(json: string): UnusedClass {
            return UnusedClass { data: "test" };
          }
        }
        
        function main(): void {
          let used = UsedClass.fromJSON("{}");
          // UnusedClass.fromJSON is never called
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // UsedClass should have fromJSON/_fromJSON declarations
      expect(result.header).toMatch(/class UsedClass[\s\S]*?static std::shared_ptr<UsedClass> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class UsedClass[\s\S]*?static std::shared_ptr<UsedClass> _fromJSON\(const doof_runtime::json::JSONObject& json_obj\);/);

      // UnusedClass should NOT have fromJSON/_fromJSON declarations (beyond user-defined)
      expect(result.header).toMatch(/class UnusedClass[\s\S]*?static std::shared_ptr<UnusedClass> fromJSON\(const std::string& json\);/);
      expect(result.header).not.toMatch(/class UnusedClass[\s\S]*?static std::shared_ptr<UnusedClass> fromJSON\(const std::string& json_str\);/);
      expect(result.header).not.toMatch(/class UnusedClass[\s\S]*?static std::shared_ptr<UnusedClass> _fromJSON\(const doof_runtime::json::JSONObject& json_obj\);/);
    });

    it('should generate fromJSON for nested types when parent fromJSON is called', () => {
      const code = `
        class Config {
          host: string;
          port: int;
        }
        
        class Database {
          url: string;
          config: Config;
        }
        
        class Server {
          name: string;
          database: Database;
          
          static fromJSON(json: string): Server {
            return Server { 
              name: "test", 
              database: Database { 
                url: "localhost", 
                config: Config { host: "127.0.0.1", port: 5432 } 
              } 
            };
          }
        }
        
        function main(): void {
          let server = Server.fromJSON("{}");
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // All types should have fromJSON/_fromJSON because they are transitively used
      // Server (directly called)
      expect(result.header).toMatch(/class Server[\s\S]*?static std::shared_ptr<Server> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class Server[\s\S]*?static std::shared_ptr<Server> _fromJSON\(const doof_runtime::json::JSONObject& json_obj\);/);

      // Database (field of Server)
      expect(result.header).toMatch(/class Database[\s\S]*?static std::shared_ptr<Database> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class Database[\s\S]*?static std::shared_ptr<Database> _fromJSON\(const doof_runtime::json::JSONObject& json_obj\);/);

      // Config (field of Database)
      expect(result.header).toMatch(/class Config[\s\S]*?static std::shared_ptr<Config> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class Config[\s\S]*?static std::shared_ptr<Config> _fromJSON\(const doof_runtime::json::JSONObject& json_obj\);/);
    });

    it('should handle arrays and collections in fromJSON transitively', () => {
      const code = `
        class Task {
          id: int;
          title: string;
        }
        
        class Project {
          name: string;
          tasks: Task[];
          
          static fromJSON(json: string): Project {
            return Project { name: "test", tasks: [] };
          }
        }
        
        function main(): void {
          let project = Project.fromJSON("{}");
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // Both Project and Task should have fromJSON/_fromJSON
      expect(result.header).toMatch(/class Project[\s\S]*?static std::shared_ptr<Project> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class Task[\s\S]*?static std::shared_ptr<Task> fromJSON\(const std::string& json_str\);/);
      
      // Source should contain implementations
      expect(result.source).toContain('std::shared_ptr<Project> Project::fromJSON(const std::string& json_str)');
      expect(result.source).toContain('std::shared_ptr<Task> Task::fromJSON(const std::string& json_str)');
    });
  });

  describe('independent detection patterns', () => {
    it('should handle println and fromJSON independently', () => {
      const code = `
        class PrintedStruct {
          value: int;
        }
        
        class DeserializedClass {
          data: string;
          
          static fromJSON(json: string): DeserializedClass {
            return DeserializedClass { data: "test" };
          }
        }
        
        class BothClass {
          count: int;
          
          static fromJSON(json: string): BothClass {
            return BothClass { count: 1 };
          }
        }
        
        function main(): void {
          let printed = PrintedStruct { value: 42 };
          println(printed);
          
          let deserialized = DeserializedClass.fromJSON("{}");
          
          let both = BothClass.fromJSON("{}");
          println(both);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // PrintedStruct: only _toJSON and operator<<
      expect(result.header).toMatch(/class PrintedStruct[\s\S]*?void _toJSON\(std::ostream& os\) const/);
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const PrintedStruct& obj\)/);
      expect(result.header).not.toMatch(/class PrintedStruct[\s\S]*?static PrintedStruct fromJSON/);

      // DeserializedClass: only fromJSON/_fromJSON
      expect(result.header).toMatch(/class DeserializedClass[\s\S]*?static std::shared_ptr<DeserializedClass> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class DeserializedClass[\s\S]*?static std::shared_ptr<DeserializedClass> _fromJSON/);
      // Check DeserializedClass class block specifically  
      const deserializedClassBlock = result.header!.match(/class DeserializedClass(?:\s*:\s*public std::enable_shared_from_this<DeserializedClass>)?\s*\{[\s\S]*?^};$/m);
      expect(deserializedClassBlock).toBeTruthy();
      expect(deserializedClassBlock![0]).not.toContain('void _toJSON');
      expect(result.header).not.toMatch(/operator<<\(std::ostream& os, const DeserializedClass& obj\)/);

      // BothClass: both _toJSON/operator<< and fromJSON/_fromJSON
      expect(result.header).toMatch(/class BothClass[\s\S]*?void _toJSON\(std::ostream& os\) const;/);
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const BothClass& obj\)/);
      expect(result.header).toMatch(/class BothClass[\s\S]*?static std::shared_ptr<BothClass> fromJSON\(const std::string& json_str\);/);
      expect(result.header).toMatch(/class BothClass[\s\S]*?static std::shared_ptr<BothClass> _fromJSON/);
    });

    it('should not generate JSON helpers for unused types', () => {
      const code = `
        class CompletelyUnused {
          value: int;
        }
        
        class AlsoUnused {
          data: string;
          
          static fromJSON(json: string): AlsoUnused {
            return AlsoUnused { data: "test" };
          }
        }
        
        function main(): void {
          // Neither type is used in println or fromJSON calls
          let x = 42;
          println(x);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // CompletelyUnused should have no JSON methods
      expect(result.header).toContain('CompletelyUnused');
      expect(result.header).not.toMatch(/class CompletelyUnused[\s\S]*?void _toJSON/);
      expect(result.header).not.toMatch(/class CompletelyUnused[\s\S]*?static CompletelyUnused fromJSON/);
      expect(result.header).not.toMatch(/operator<<\(std::ostream& os, const CompletelyUnused& obj\)/);

      // AlsoUnused should only have the user-defined fromJSON, not generated ones
      expect(result.header).toMatch(/class AlsoUnused[\s\S]*?static std::shared_ptr<AlsoUnused> fromJSON\(const std::string& json\);/);
      expect(result.header).not.toMatch(/class AlsoUnused[\s\S]*?static std::shared_ptr<AlsoUnused> fromJSON\(const std::string& json_str\);/);
      expect(result.header).not.toMatch(/class AlsoUnused[\s\S]*?static std::shared_ptr<AlsoUnused> _fromJSON/);
      expect(result.header).not.toMatch(/class AlsoUnused[\s\S]*?void _toJSON/);
    });
  });

  describe('edge cases and complex scenarios', () => {
    it('should handle union types in nested structures', () => {
      const code = `
        class StringData {
          value: string;
        }
        
        class NumberData {
          value: int;
        }
        
        class Container {
          data: StringData | NumberData;
        }
        
        function main(): void {
          let container = Container { data: StringData { value: "test" } };
          println(container);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // All types in the union should get _toJSON
      expect(result.header).toMatch(/class StringData[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class NumberData[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class Container[\s\S]*?void _toJSON/);
    });

    it('should handle deeply nested classures', () => {
      const code = `
        class Level3 {
          value: string;
        }
        
        class Level2 {
          level3: Level3;
        }
        
        class Level1 {
          level2: Level2;
        }
        
        class Root {
          level1: Level1;
        }
        
        function main(): void {
          let root = Root { 
            level1: Level1 { 
              level2: Level2 { 
                level3: Level3 { value: "deep" } 
              } 
            } 
          };
          println(root);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // All levels should have _toJSON
      expect(result.header).toMatch(/class Root[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class Level1[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class Level2[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class Level3[\s\S]*?void _toJSON/);
    });

    it('should handle multiple inheritance scenarios correctly', () => {
      const code = `
        class CommonData {
          id: int;
        }
        
        class ServiceA {
          common: CommonData;
          serviceAData: string;
          
          static fromJSON(json: string): ServiceA {
            return ServiceA { 
              common: CommonData { id: 1 }, 
              serviceAData: "A" 
            };
          }
        }
        
        class ServiceB {
          common: CommonData;
          serviceBData: int;
        }
        
        function main(): void {
          let serviceA = ServiceA.fromJSON("{}");
          
          let serviceB = ServiceB { 
            common: CommonData { id: 2 }, 
            serviceBData: 42 
          };
          println(serviceB);
        }
      `;
      const result = transpileCode(code);
      expect(result.errors).toHaveLength(0);

      // CommonData should have both _toJSON and fromJSON because it's used in both patterns
      expect(result.header).toMatch(/class CommonData[\s\S]*?void _toJSON/);
      expect(result.header).toMatch(/class CommonData[\s\S]*?static std::shared_ptr<CommonData> fromJSON/);
      expect(result.header).toMatch(/operator<<\(std::ostream& os, const CommonData& obj\)/);

      // ServiceA should have fromJSON (called) but not _toJSON (not printed)
      expect(result.header).toMatch(/class ServiceA[\s\S]*?static std::shared_ptr<ServiceA> fromJSON\(const std::string& json_str\);/);
      // Check ServiceA class block specifically
      const serviceABlock = result.header!.match(/class ServiceA(?:\s*:\s*public std::enable_shared_from_this<ServiceA>)?\s*\{[\s\S]*?^};$/m);
      expect(serviceABlock).toBeTruthy();
      expect(serviceABlock![0]).not.toContain('void _toJSON');

      // ServiceB should have _toJSON (printed) but not fromJSON (not called)
      expect(result.header).toMatch(/class ServiceB[\s\S]*?void _toJSON/);
      expect(result.header).not.toMatch(/class ServiceB[\s\S]*?static std::shared_ptr<ServiceB> fromJSON\(const std::string& json_str\);/);
    });
  });
});
