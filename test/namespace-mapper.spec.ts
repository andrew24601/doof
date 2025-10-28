// Test file for namespace mapping functionality

import { describe, it, expect } from 'vitest';
import { NamespaceMapper } from '../src/namespace-mapper.js';

describe('NamespaceMapper', () => {
  it('should map file paths to namespaces with default source root', () => {
    const mapper = new NamespaceMapper();
    
    expect(mapper.mapFileToNamespace('src/foo/bar.do')).toBe('foo::bar');
    expect(mapper.mapFileToNamespace('src/utils/math.do')).toBe('utils::math');
    expect(mapper.mapFileToNamespace('src/main.do')).toBe('main');
  });

  it('should handle multiple source roots', () => {
    const mapper = new NamespaceMapper({ sourceRoots: ['src', 'test'] });
    
    expect(mapper.mapFileToNamespace('src/foo/bar.do')).toBe('foo::bar');
    expect(mapper.mapFileToNamespace('test/foo/bar.do')).toBe('foo::bar');
    expect(mapper.mapFileToNamespace('examples/demo.do')).toBe('examples::demo');
  });

  it('should sanitize invalid characters in identifiers', () => {
    const mapper = new NamespaceMapper();
    
    expect(mapper.mapFileToNamespace('src/my-module/test-file.do')).toBe('my_module::test_file');
    expect(mapper.mapFileToNamespace('src/123numeric/start.do')).toBe('_123numeric::start');
    expect(mapper.mapFileToNamespace('src/special@chars/file$.do')).toBe('special_chars::file_');
  });

  it('should handle paths without source root', () => {
    const mapper = new NamespaceMapper({ sourceRoots: ['src'] });
    
    expect(mapper.mapFileToNamespace('standalone.do')).toBe('standalone');
    expect(mapper.mapFileToNamespace('lib/utils.do')).toBe('lib::utils');
  });

  it('should produce consistent module names', () => {
    const mapper = new NamespaceMapper();
    
    const namespace = mapper.mapFileToNamespace('src/foo/bar.do');
    const moduleName = mapper.mapFileToModuleName('src/foo/bar.do');
    
    expect(namespace).toBe(moduleName);
  });

  it('should respect absolute source roots when mapping namespaces', () => {
    const mapper = new NamespaceMapper({ sourceRoots: ['/Users/example/project/src'] });

    expect(mapper.mapFileToNamespace('/Users/example/project/src/utils/logger.do')).toBe('utils::logger');
    expect(mapper.mapFileToNamespace('/Users/example/project/src/main.do')).toBe('main');
  });

  it('should handle dot-prefixed source roots', () => {
    const mapper = new NamespaceMapper({ sourceRoots: ['./src'] });

    expect(mapper.mapFileToNamespace('/tmp/project/src/models/user.do')).toBe('models::user');
  });
});
