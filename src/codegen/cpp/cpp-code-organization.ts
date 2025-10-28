// C++ code organization utilities for header/source generation

import {
  Program, Statement, ClassDeclaration, FunctionDeclaration, 
  PrimitiveTypeNode
} from '../../types';
import { classUsesThisAsValue } from '../../fluent-interface-utils';

export interface CodeOrganizationContext {
  forwardDeclarations: Set<string>;
  fluentInterfaceClasses: Set<string>;
  options: {
    namespace?: string;
  };
}

// Determine if a statement should be included in the header file
export function shouldIncludeInHeader(stmt: Statement): boolean {
  return ['class', 'enum', 'typeAlias', 'function', 'export'].includes(stmt.kind);
}

// Collect forward declarations needed for the header
export function collectForwardDeclarations(context: CodeOrganizationContext, program: Program): void {
  for (const stmt of program.body) {
    if (stmt.kind === 'class') {
      const classDecl = stmt as ClassDeclaration;
      context.forwardDeclarations.add(`class ${classDecl.name.name}`);
    }
  }
}

// Collect classes that use fluent interface pattern
export function collectFluentInterfaceClasses(context: CodeOrganizationContext, program: Program): void {
  for (const stmt of program.body) {
    if (stmt.kind === 'class') {
      const classDecl = stmt as ClassDeclaration;
      if (classUsesThisAsValue(classDecl)) {
        context.fluentInterfaceClasses.add(classDecl.name.name);
      }
    }
  }
}

// Generate forward declarations section for header
export function generateForwardDeclarations(context: CodeOrganizationContext): string {
  let output = '';
  
  if (context.forwardDeclarations.size > 0) {
    if (context.options.namespace) {
      output += `namespace ${context.options.namespace} {\n`;
      for (const decl of context.forwardDeclarations) {
        output += `    ${decl};\n`;
      }
      output += `} // namespace ${context.options.namespace}\n\n`;
    } else {
      for (const decl of context.forwardDeclarations) {
        output += `${decl};\n`;
      }
      output += '\n';
    }
  }
  
  return output;
}

// Generate C++ main wrapper for doof main functions
export function generateMainWrapper(
  program: Program, 
  options: { namespace?: string }
): string {
  // Find all function declarations that could be main functions
  let foundDoofMain = false;
  let mainFunctionName = '';
  let mainReturnType: 'void' | 'int' | null = null;

  for (const stmt of program.body) {
    if (stmt.kind === 'function') {
      const funcDecl = stmt as FunctionDeclaration;
      if (funcDecl.name.name === 'main') {
        // Check function signature for main-like functions
        if (funcDecl.parameters.length === 0 &&
          (!funcDecl.returnType ||
            (funcDecl.returnType.kind === 'primitive' && (funcDecl.returnType as PrimitiveTypeNode).type === 'void'))) {
          // void main() or main() with no return type - this needs a wrapper
          foundDoofMain = true;
          // If no namespace, the doof main should be generated as doof_main to avoid conflict
          mainFunctionName = options.namespace ? `${options.namespace}::main` : 'doof_main';
          mainReturnType = 'void';
          break;
        } else if (funcDecl.parameters.length === 0 && funcDecl.returnType?.kind === 'primitive' &&
          (funcDecl.returnType as PrimitiveTypeNode).type === 'int') {
          if (!options.namespace) {
            // int main() at global scope is already valid, no wrapper needed
            return '';
          }

          foundDoofMain = true;
          mainFunctionName = `${options.namespace}::main`;
          mainReturnType = 'int';
          break;
        }
      }
    }
  }

  if (!foundDoofMain || !mainReturnType) {
    return '';
  }

  // Generate C++ main wrapper for doof main functions
  let output = '\nint main() {\n';
  if (mainReturnType === 'int') {
    output += `    return ${mainFunctionName}();\n`;
  } else {
    output += `    ${mainFunctionName}();\n`;
    output += '    return 0;\n';
  }
  output += '}\n';

  return output;
}

// Generate namespace opening/closing wrappers
export function wrapWithNamespace(content: string, namespace?: string, indentLevel: number = 0): string {
  if (!namespace) {
    return content;
  }

  const indent = '    '.repeat(indentLevel);
  let output = `namespace ${namespace} {\n\n`;
  
  // Add content with increased indentation
  const indentedContent = content
    .split('\n')
    .map(line => line.trim() ? '    ' + line : line)
    .join('\n');
  
  output += indentedContent;
  output += `\n} // namespace ${namespace}\n`;

  return output;
}

// Generate header guard for a file
export function generateHeaderGuard(filename: string, content: string): string {
  // Sanitize filename for header guard - replace invalid characters with underscores
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
  const headerGuard = `${sanitizedFilename.toUpperCase()}_H`;
  
  let output = `#ifndef ${headerGuard}\n#define ${headerGuard}\n\n`;
  output += content;
  output += `\n#endif // ${headerGuard}\n`;
  
  return output;
}
