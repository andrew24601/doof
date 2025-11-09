import { describe, it, expect } from 'vitest';
import { Transpiler } from '../src/transpiler';
import { SourceMapConsumer } from 'source-map';

describe('JavaScript Source Map Generation', () => {
  it('should generate source map when emitLineDirectives is enabled for JS target', () => {
    const source = `
function add(a: int, b: int): int {
  return a + b;
}

function main(): void {
  let result: int = add(5, 3);
  println(result);
}
`;
    
    const transpiler = new Transpiler({
      target: 'js',
      validate: true,
      emitLineDirectives: true
    });
    
    const result = transpiler.transpile(source, 'test.do');
    
    expect(result.errors).toHaveLength(0);
    expect(result.source).toBeDefined();
    expect(result.sourceMap).toBeDefined();
    
    // Verify source map comment is in the generated code
    expect(result.source).toContain('//# sourceMappingURL=test.js.map');
  });

  it('should not generate source map when emitLineDirectives is disabled', () => {
    const source = `
function add(a: int, b: int): int {
  return a + b;
}
`;
    
    const transpiler = new Transpiler({
      target: 'js',
      validate: true,
      emitLineDirectives: false
    });
    
    const result = transpiler.transpile(source, 'test.do');
    
    expect(result.errors).toHaveLength(0);
    expect(result.source).toBeDefined();
    expect(result.sourceMap).toBeUndefined();
    
    // Verify no source map comment in the generated code
    expect(result.source).not.toContain('sourceMappingURL');
  });

  it('should generate valid Source Map V3 format', async () => {
    const source = `
function greet(name: string): void {
  println("Hello, " + name);
}

function main(): void {
  greet("World");
}
`;
    
    const transpiler = new Transpiler({
      target: 'js',
      validate: true,
      emitLineDirectives: true
    });
    
    const result = transpiler.transpile(source, 'test.do');
    
    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap).toBeDefined();
    
    // Parse the source map to verify it's valid JSON
    const sourceMapObj = JSON.parse(result.sourceMap!);
    
    // Verify Source Map V3 properties
    expect(sourceMapObj.version).toBe(3);
    expect(sourceMapObj.file).toBe('test.js');
    expect(sourceMapObj.sources).toBeDefined();
    expect(sourceMapObj.mappings).toBeDefined();
    
    // Verify we can consume the source map
    const consumer = await new SourceMapConsumer(sourceMapObj);
    
    // The source map should have at least one mapping
    let hasMappings = false;
    consumer.eachMapping(() => {
      hasMappings = true;
    });
    
    expect(hasMappings).toBe(true);
    
    consumer.destroy();
  });

  it('should map generated code back to original source locations', async () => {
    const source = `
function square(x: int): int {
  return x * x;
}
`;
    
    const transpiler = new Transpiler({
      target: 'js',
      validate: true,
      emitLineDirectives: true
    });
    
    const result = transpiler.transpile(source, 'test.do');
    
    expect(result.errors).toHaveLength(0);
    expect(result.sourceMap).toBeDefined();
    
    const sourceMapObj = JSON.parse(result.sourceMap!);
    const consumer = await new SourceMapConsumer(sourceMapObj);
    
    // Check that we have mappings that reference the original source file
    let foundOriginalMapping = false;
    consumer.eachMapping((mapping) => {
      if (mapping.source === 'test.do' && mapping.originalLine > 0) {
        foundOriginalMapping = true;
      }
    });
    
    expect(foundOriginalMapping).toBe(true);
    
    consumer.destroy();
  });

  it('should work with C++ target without generating source maps', () => {
    const source = `
function add(a: int, b: int): int {
  return a + b;
}
`;
    
    const transpiler = new Transpiler({
      target: 'cpp',
      validate: true,
      emitLineDirectives: true
    });
    
    const result = transpiler.transpile(source, 'test.do');
    
    expect(result.errors).toHaveLength(0);
    expect(result.source).toBeDefined();
    // C++ target should not have sourceMap
    expect(result.sourceMap).toBeUndefined();
    // But should have #line directives
    expect(result.source).toContain('#line');
  });
});
