import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transpiler, transpile, transpileFile } from '../src/transpiler.js';
import { firstErrorMessage } from './helpers/error-helpers.js';
import { promises as fs } from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn()
  },
  readFile: vi.fn()
}));

describe('Transpiler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const transpiler = new Transpiler();
      expect(transpiler).toBeDefined();
    });

    it('should merge provided options with defaults', () => {
      const transpiler = new Transpiler({
        namespace: 'testns',
        validate: false,
        outputHeader: false
      });
      expect(transpiler).toBeDefined();
    });
  });

  describe('transpile', () => {
    it('should transpile simple code successfully', () => {
      const transpiler = new Transpiler();
      const result = transpiler.transpile('let x: int = 5;', 'test.do');
      
      expect(result).toHaveProperty('header');
      expect(result).toHaveProperty('source');
      expect(result.errors).toEqual([]);
    });

    it('should handle validation errors', () => {
      const transpiler = new Transpiler({ validate: true });
      const result = transpiler.transpile('let x: invalid_type = 5;', 'test.do');
      
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.header).toBeUndefined();
      expect(result.source).toBeUndefined();
    });

    it('should generate only header when outputSource is false', () => {
      const transpiler = new Transpiler({ outputSource: false });
      const result = transpiler.transpile('let x: int = 5;', 'test.do');
      
      expect(result).toHaveProperty('header');
      expect(result.source).toBeUndefined();
    });

    it('should generate only source when outputHeader is false', () => {
      const transpiler = new Transpiler({ outputHeader: false });
      const result = transpiler.transpile('let x: int = 5;', 'test.do');
      
      expect(result.header).toBeUndefined();
      expect(result).toHaveProperty('source');
    });

    it('should handle syntax errors gracefully', () => {
      const transpiler = new Transpiler();
      const result = transpiler.transpile('let x: int = ;', 'test.do');
      
      expect(result.errors.length).toBeGreaterThan(0);
      const firstError = firstErrorMessage(result.errors);
      expect(firstError).toBeDefined();
      expect(firstError).toContain('test.do');
    });

    it('should use custom namespace in generation', () => {
      const transpiler = new Transpiler({ namespace: 'custom' });
      const result = transpiler.transpile('let x: int = 5;', 'test.do');
      
      expect(result.header).toContain('namespace custom');
    });

    it('should use custom include headers', () => {
      const transpiler = new Transpiler({ 
        includeHeaders: ['<custom.h>', '<another.h>'] 
      });
      const result = transpiler.transpile('let x: int = 5;', 'test.do');
      
      expect(result.header).toContain('#include <custom.h>');
      expect(result.header).toContain('#include <another.h>');
    });

    it('should format error locations correctly', () => {
      const transpiler = new Transpiler();
      // This will likely cause a parsing error
      const result = transpiler.transpile('invalid syntax here', 'test.do');
      
      expect(result.errors.length).toBeGreaterThan(0);
      const firstError = firstErrorMessage(result.errors);
      expect(firstError).toBeDefined();
      expect(firstError).toMatch(/test\.do:\d+:\d+:/);
    });
  });

  describe('transpileFile', () => {
    it('should read and transpile file successfully', async () => {
      const mockReadFile = vi.fn();
      vi.doMock('fs', () => ({
        readFile: mockReadFile
      }));
      
      mockReadFile.mockImplementation((filename, encoding, callback) => {
        callback(null, 'let x: int = 5;');
      });

      const transpiler = new Transpiler();
      const result = await transpiler.transpileFile('test.do');
      
      expect(result).toHaveProperty('header');
      expect(result).toHaveProperty('source');
      expect(result.errors).toEqual([]);
    });

    it('should handle file read errors', async () => {
      const mockReadFile = vi.fn();
      vi.doMock('fs', () => ({
        readFile: mockReadFile
      }));
      
      mockReadFile.mockImplementation((filename, encoding, callback) => {
        callback(new Error('File not found'), null);
      });

      const transpiler = new Transpiler();
      const result = await transpiler.transpileFile('nonexistent.do');
      
      expect(result.errors.length).toBeGreaterThan(0);
      const firstError = firstErrorMessage(result.errors);
      expect(firstError).toBeDefined();
      expect(firstError).toContain('Failed to read file');
    });
  });

  describe('convenience functions', () => {
    it('transpile function should work', () => {
      const result = transpile('let x: int = 5;');
      
      expect(result).toHaveProperty('header');
      expect(result).toHaveProperty('source');
      expect(result.errors).toEqual([]);
    });

    it('transpile function should accept options', () => {
      const result = transpile('let x: int = 5;', { namespace: 'test' });
      
      expect(result.header).toContain('namespace test');
    });

    it('transpileFile function should work', async () => {
      const mockReadFile = vi.fn();
      vi.doMock('fs', () => ({
        readFile: mockReadFile
      }));
      
      mockReadFile.mockImplementation((filename, encoding, callback) => {
        callback(null, 'let x: int = 5;');
      });

      const result = await transpileFile('test.do');
      
      expect(result).toHaveProperty('header');
      expect(result).toHaveProperty('source');
    });
  });

  describe('private methods', () => {
    it('should extract basename correctly', () => {
      const transpiler = new Transpiler();
      // Access private method through any cast for testing
      const getBasename = (transpiler as any).getBasename.bind(transpiler);
      
      expect(getBasename('test.do')).toBe('test');
      expect(getBasename('/path/to/file.do')).toBe('file');
      expect(getBasename('C:\\path\\to\\file.do')).toBe('file');
      expect(getBasename('noextension')).toBe('noextension');
    });

    it('should format location correctly', () => {
      const transpiler = new Transpiler();
      const formatLocation = (transpiler as any).formatLocation.bind(transpiler);
      
      const location1 = { start: { line: 10, column: 5 } };
      expect(formatLocation(location1, 'test.do')).toBe('test.do:10:5');
      
      const location2 = { filename: 'custom.do', start: { line: 2, column: 3 } };
      expect(formatLocation(location2, 'default.do')).toBe('custom.do:2:3');
      
      const location3 = {};
      expect(formatLocation(location3, 'test.do')).toBe('test.do');
    });
  });
});
