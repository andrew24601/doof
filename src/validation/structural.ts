import { ClassDeclaration, FieldDeclaration, InterfaceDeclaration, InterfaceMember, InterfaceMethod, InterfaceProperty, Type } from '../types';

export type StructuralCandidate =
  | { kind: 'class'; declaration: ClassDeclaration };

export interface StructuralMatchOptions {
  resolveInterface?: (name: string) => InterfaceDeclaration | undefined;
  typeEquals?: (a: Type, b: Type) => boolean;
}

export interface StructuralMatchResult {
  matches: boolean;
  errors: string[];
}

interface InterfaceSurface {
  properties: Map<string, InterfaceProperty>;
  methods: Map<string, InterfaceMethod>;
}

interface ClassSurface {
  properties: Map<string, FieldDeclaration>;
  methods: Map<string, ClassDeclaration['methods'][number]>;
}

export function structurallyMatches(
  iface: InterfaceDeclaration,
  candidate: StructuralCandidate,
  options: StructuralMatchOptions = {}
): StructuralMatchResult {
  const errors: string[] = [];
  const surface = collectInterfaceSurface(iface, options, new Set(), errors);
  if (!surface) {
    if (errors.length === 0) {
      errors.push(`Unable to collect members for interface '${iface.name.name}'`);
    }
    return { matches: false, errors };
  }

  const typeEquals = options.typeEquals ?? defaultTypeEquals;
  const candidateSurface = extractCandidateSurface(candidate);

  for (const [name, property] of surface.properties) {
    const field = candidateSurface.properties.get(name);
    if (!field) {
      if (!property.optional) {
        errors.push(`Missing property '${name}' required by interface '${iface.name.name}'`);
      }
      continue;
    }

    if (!typeEquals(property.type, field.type)) {
      errors.push(`Property '${name}' type mismatch: expected ${describeType(property.type)}, got ${describeType(field.type)}`);
    }

    if (property.readonly && !field.isReadonly && !field.isConst) {
      const className = candidate.kind === 'class' ? candidate.declaration.name.name : 'candidate';
      errors.push(`Property '${name}' is readonly in interface '${iface.name.name}' but field '${className}.${name}' is mutable`);
    }
  }

  for (const [name, method] of surface.methods) {
    const classMethod = candidateSurface.methods.get(name);
    if (!classMethod) {
      if (!method.optional) {
        errors.push(`Missing method '${name}' required by interface '${iface.name.name}'`);
      }
      continue;
    }

    if (classMethod.parameters.length !== method.parameters.length) {
      errors.push(`Method '${name}' parameter count mismatch: expected ${method.parameters.length}, got ${classMethod.parameters.length}`);
      continue;
    }

    for (let i = 0; i < method.parameters.length; i++) {
      const expectedParam = method.parameters[i];
      const actualParam = classMethod.parameters[i];
      if (!typeEquals(expectedParam.type, actualParam.type)) {
        errors.push(
          `Method '${name}' parameter ${i + 1} type mismatch: expected ${describeType(expectedParam.type)}, got ${describeType(actualParam.type)}`
        );
      }
    }

    if (!typeEquals(method.returnType, classMethod.returnType)) {
      errors.push(
        `Method '${name}' return type mismatch: expected ${describeType(method.returnType)}, got ${describeType(classMethod.returnType)}`
      );
    }
  }

  return { matches: errors.length === 0, errors };
}

function collectInterfaceSurface(
  iface: InterfaceDeclaration,
  options: StructuralMatchOptions,
  seen: Set<string>,
  errors: string[]
): InterfaceSurface | null {
  if (seen.has(iface.name.name)) {
    errors.push(`Detected circular interface inheritance involving '${iface.name.name}'`);
    return null;
  }
  seen.add(iface.name.name);

  const properties = new Map<string, InterfaceProperty>();
  const methods = new Map<string, InterfaceMethod>();

  if (iface.extends) {
    for (const ref of iface.extends) {
      if (!options.resolveInterface) {
        errors.push(`Cannot resolve base interface '${ref.name}' without resolver`);
        return null;
      }
      const base = options.resolveInterface(ref.name);
      if (!base) {
        errors.push(`Base interface '${ref.name}' not found while evaluating '${iface.name.name}'`);
        return null;
      }
      const baseSurface = collectInterfaceSurface(base, options, seen, errors);
      if (!baseSurface) {
        return null;
      }
      for (const [name, prop] of baseSurface.properties) {
        properties.set(name, prop);
      }
      for (const [name, method] of baseSurface.methods) {
        methods.set(name, method);
      }
    }
  }

  for (const member of iface.members) {
    if (member.kind === 'interfaceProperty') {
      properties.set(member.name.name, member);
    } else if (member.kind === 'interfaceMethod') {
      methods.set(member.name.name, member);
    }
  }

  return { properties, methods };
}

function extractCandidateSurface(candidate: StructuralCandidate): ClassSurface {
  switch (candidate.kind) {
    case 'class':
      return {
        properties: new Map(
          candidate.declaration.fields
            .filter(field => field.isPublic && !field.isStatic)
            .map(field => [field.name.name, field])
        ),
        methods: new Map(
          candidate.declaration.methods
            .filter(method => method.isPublic && !method.isStatic)
            .map(method => [method.name.name, method])
        )
      };
    default:
      return { properties: new Map(), methods: new Map() };
  }
}

function defaultTypeEquals(left: Type, right: Type): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'primitive':
      return (left as any).type === (right as any).type;
    case 'class':
    case 'externClass':
    case 'enum':
    case 'typeAlias':
      return (left as any).name === (right as any).name;
    case 'array':
      return defaultTypeEquals((left as any).elementType, (right as any).elementType);
    case 'map':
      return (
        defaultTypeEquals((left as any).keyType, (right as any).keyType) &&
        defaultTypeEquals((left as any).valueType, (right as any).valueType)
      );
    case 'set':
      return defaultTypeEquals((left as any).elementType, (right as any).elementType);
    case 'function': {
      const leftFunc = left as any;
      const rightFunc = right as any;
      if (leftFunc.parameters.length !== rightFunc.parameters.length) {
        return false;
      }
      for (let i = 0; i < leftFunc.parameters.length; i++) {
        if (!defaultTypeEquals(leftFunc.parameters[i].type, rightFunc.parameters[i].type)) {
          return false;
        }
      }
      return defaultTypeEquals(leftFunc.returnType, rightFunc.returnType);
    }
    case 'union': {
      const leftUnion = left as any;
      const rightUnion = right as any;
      if (leftUnion.types.length !== rightUnion.types.length) {
        return false;
      }
      return leftUnion.types.every((type: Type, index: number) => defaultTypeEquals(type, rightUnion.types[index]));
    }
    case 'unknown':
      return true;
    case 'range':
      return (
        defaultTypeEquals((left as any).start, (right as any).start) &&
        defaultTypeEquals((left as any).end, (right as any).end)
      );
    default:
      return false;
  }
}

function describeType(type: Type): string {
  switch (type.kind) {
    case 'primitive':
      return (type as any).type;
    case 'class':
    case 'externClass':
    case 'enum':
    case 'typeAlias':
      return (type as any).name;
    case 'array':
      return `${describeType((type as any).elementType)}[]`;
    case 'map':
      return `Map<${describeType((type as any).keyType)}, ${describeType((type as any).valueType)}>`;
    case 'set':
      return `Set<${describeType((type as any).elementType)}>`;
    case 'function':
      return 'function';
    case 'union':
      return (type as any).types.map((t: Type) => describeType(t)).join(' | ');
    case 'range':
      return 'range';
    case 'unknown':
      return 'unknown';
    default:
      return 'unknown';
  }
}
