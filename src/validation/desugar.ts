import { createClassType } from '../type-utils';
import {
  ClassDeclaration,
  InterfaceDeclaration,
  Program,
  SourceLocation,
  Type,
  TypeAliasDeclaration,
  UnionTypeNode
} from '../types';
import { structurallyMatches } from './structural';

export interface DesugarOptions {
  closedWorld: boolean;
}

export interface DesugarError {
  message: string;
  location?: SourceLocation;
}

export interface DesugarResult {
  errors: DesugarError[];
  warnings: string[];
  transformed: boolean;
  transformedAliases: Map<string, Type>;
}

interface InterfaceInfo {
  declaration: InterfaceDeclaration;
  program: Program;
  index: number;
}

export function desugarInterfaces(programs: Program[], options: DesugarOptions): DesugarResult {
  const errors: DesugarError[] = [];
  const warnings: string[] = [];
  const transformedAliases = new Map<string, Type>();

  if (!options.closedWorld) {
    return { errors, warnings, transformed: false, transformedAliases };
  }

  const interfaces: InterfaceInfo[] = [];
  const allClasses: ClassDeclaration[] = [];

  for (const program of programs) {
    program.body.forEach((stmt, index) => {
      if (stmt.kind === 'interface') {
        interfaces.push({ declaration: stmt, program, index });
      } else if (stmt.kind === 'class') {
        allClasses.push(stmt);
      }
    });
  }

  if (interfaces.length === 0) {
    return { errors, warnings, transformed: false, transformedAliases };
  }

  const originProgramMap = new Map<InterfaceDeclaration, Program>();
  for (const info of interfaces) {
    originProgramMap.set(info.declaration, info.program);
  }

  const resolveInterface = (name: string, origin?: InterfaceDeclaration): InterfaceDeclaration | undefined => {
    if (origin) {
      const originProgram = originProgramMap.get(origin);
      if (originProgram) {
        const local = interfaces.find(info => info.program === originProgram && info.declaration.name.name === name);
        if (local) {
          return local.declaration;
        }
      }
    }
    const global = interfaces.find(info => info.declaration.name.name === name);
    return global?.declaration;
  };

  for (const info of interfaces) {
    const iface = info.declaration;
    const matches: ClassDeclaration[] = [];

    for (const classDecl of allClasses) {
      const match = structurallyMatches(iface, { kind: 'class', declaration: classDecl }, {
        resolveInterface: (name: string) => resolveInterface(name, iface)
      });
      if (match.matches) {
        matches.push(classDecl);
      }
    }

    if (matches.length === 0) {
      errors.push({
        message: `No concrete implementations found for interface '${iface.name.name}' during desugaring` ,
        location: iface.location
      });
      continue;
    }

    let aliasType: Type;
    if (matches.length === 1) {
      aliasType = createClassType(matches[0].name.name);
    } else {
      const union: UnionTypeNode = {
        kind: 'union',
        types: matches.map(match => createClassType(match.name.name))
      };
      aliasType = union;
    }

    const alias: TypeAliasDeclaration = {
      kind: 'typeAlias',
      name: iface.name,
      type: aliasType,
      isExport: iface.isExport,
      location: iface.location
    };

    info.program.body[info.index] = alias;
    transformedAliases.set(`${info.program.filename ?? 'input'}::${iface.name.name}`, aliasType);
  }

  return {
    errors,
    warnings,
    transformed: transformedAliases.size > 0,
    transformedAliases
  };
}
