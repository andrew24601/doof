// Namespace mapping utility for multi-file projects

export interface NamespaceMapperOptions {
  sourceRoots?: string[];
}

export class NamespaceMapper {
  private readonly normalizedRootSegments: string[][];

  constructor(options: NamespaceMapperOptions = {}) {
    const sourceRoots = (options.sourceRoots && options.sourceRoots.length > 0)
      ? options.sourceRoots
      : ['src'];

    this.normalizedRootSegments = sourceRoots
      .map(root => this.splitPathComponents(this.normalizePath(root)))
      .filter(segments => segments.length > 0)
      .sort((a, b) => b.length - a.length);
  }

  /**
   * Maps a file path to a C++ namespace, considering source roots
   */
  mapFileToNamespace(filePath: string): string {
    const normalizedPath = this.normalizePath(filePath);
    const fileSegments = this.splitPathComponents(normalizedPath);

    // Try to strip the longest matching source root from the path
    for (const rootSegments of this.normalizedRootSegments) {
      const relativeSegments = this.stripRootSegments(fileSegments, rootSegments);
      if (relativeSegments && relativeSegments.length > 0) {
        return this.pathSegmentsToNamespace(relativeSegments);
      }
    }

    // If no root matches, fall back to using the full path
    if (fileSegments.length > 0) {
      return this.pathSegmentsToNamespace(fileSegments);
    }

    // As a last resort, provide a placeholder namespace
    return '_';
  }

  /**
   * Maps a file path to a module name (for import/export resolution)
   */
  mapFileToModuleName(filePath: string): string {
    const namespace = this.mapFileToNamespace(filePath);
    // For module names, we use the same as namespace but could be different in the future
    return namespace;
  }

  private normalizePath(filePath: string): string {
    // Normalize path separators and remove file extension
    let normalized = filePath.replace(/\\/g, '/');
    
    // Remove .do extension if present
    if (normalized.endsWith('.do')) {
      normalized = normalized.slice(0, -3);
    }
    
    return normalized;
  }

  private pathToNamespace(relativePath: string): string {
    // Split path into components and sanitize each one
    const components = this.splitPathComponents(relativePath);
    return this.pathSegmentsToNamespace(components);
  }

  private pathSegmentsToNamespace(segments: string[]): string {
    return segments.map(segment => this.sanitizeIdentifier(segment)).join('::');
  }

  private sanitizeIdentifier(name: string): string {
    // Replace invalid characters with underscores
    let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // Ensure it doesn't start with a digit
    if (/^[0-9]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }
    
    // Handle empty strings
    if (sanitized.length === 0) {
      sanitized = '_';
    }
    // Avoid C++ reserved keywords to prevent compilation errors (e.g. namespace enum { ... })
    // Minimal keyword set expanded as needed; underscores retain readability while avoiding clashes
    const cppReserved = new Set([
      'alignas','alignof','and','and_eq','asm','auto','bitand','bitor','bool','break','case','catch','char','char16_t','char32_t','class','compl','const','constexpr','const_cast','continue','decltype','default','delete','do','double','dynamic_cast','else','enum','explicit','export','extern','false','float','for','friend','goto','if','inline','int','long','mutable','namespace','new','noexcept','not','not_eq','nullptr','operator','or','or_eq','private','protected','public','register','reinterpret_cast','return','short','signed','sizeof','static','static_assert','static_cast','struct','switch','template','this','thread_local','throw','true','try','typedef','typeid','typename','union','unsigned','using','virtual','void','volatile','wchar_t','while','xor','xor_eq'
    ]);
    if (cppReserved.has(sanitized)) {
      // Append single underscore; guaranteed different and still a valid identifier
      sanitized = sanitized + '_';
    }
    return sanitized;
  }

  private splitPathComponents(pathString: string): string[] {
    return pathString
      .split('/')
      .filter(component => component.length > 0 && component !== '.');
  }

  private stripRootSegments(fileSegments: string[], rootSegments: string[]): string[] | null {
    if (rootSegments.length === 0 || rootSegments.length > fileSegments.length) {
      return null;
    }

    for (let start = 0; start <= fileSegments.length - rootSegments.length; start++) {
      let matches = true;
      for (let offset = 0; offset < rootSegments.length; offset++) {
        if (fileSegments[start + offset] !== rootSegments[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return fileSegments.slice(start + rootSegments.length);
      }
    }

    return null;
  }
}
