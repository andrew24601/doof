import {
  Type,
  PrimitiveTypeNode,
  ArrayTypeNode,
  MapTypeNode,
  SetTypeNode,
  ClassTypeNode,
  ExternClassTypeNode,
  EnumTypeNode,
  FunctionTypeNode,
  UnionTypeNode,
  TypeAliasNode,
  RangeTypeNode,
} from '../types';
import { Printer } from './printer';

export class TypeFormatter {
  constructor(private readonly printer: Printer) {}

  formatType(type: Type): void {
    switch (type.kind) {
      case 'primitive':
        this.printer.write((type as PrimitiveTypeNode).type);
        break;
      case 'array':
        this.formatType((type as ArrayTypeNode).elementType);
        this.printer.write('[]');
        break;
      case 'map': {
        const mapType = type as MapTypeNode;
        this.printer.write('Map<');
        this.formatType(mapType.keyType);
        this.printer.write(', ');
        this.formatType(mapType.valueType);
        this.printer.write('>');
        break;
      }
      case 'set': {
        const setType = type as SetTypeNode;
        this.printer.write('Set<');
        this.formatType(setType.elementType);
        this.printer.write('>');
        break;
      }
      case 'class': {
        const classType = type as ClassTypeNode;
        if (classType.isWeak) {
          this.printer.write('weak ');
        }
        this.printer.write(classType.name);
        break;
      }
      case 'externClass': {
        const externClassType = type as ExternClassTypeNode;
        if (externClassType.isWeak) {
          this.printer.write('weak ');
        }
        this.printer.write(externClassType.name);
        break;
      }
      case 'enum':
        this.printer.write((type as EnumTypeNode).name);
        break;
      case 'function':
        this.formatFunctionType(type as FunctionTypeNode);
        break;
      case 'union':
        this.formatUnionType(type as UnionTypeNode);
        break;
      case 'typeAlias': {
        const aliasType = type as TypeAliasNode;
        if (aliasType.isWeak) {
          this.printer.write('weak ');
        }
        this.printer.write(aliasType.name);
        break;
      }
      case 'unknown':
        this.printer.write('unknown');
        break;
      case 'range': {
        const rangeType = type as RangeTypeNode;
        this.formatType(rangeType.start);
        this.printer.write(rangeType.inclusive ? '..' : '..<');
        this.formatType(rangeType.end);
        break;
      }
      default:
        this.printer.write(`/* Unknown type: ${(type as any).kind} */`);
    }
  }

  estimateTypeLength(type: Type): number {
    switch (type.kind) {
      case 'primitive':
        return (type as PrimitiveTypeNode).type.length;
      case 'array':
        return this.estimateTypeLength((type as ArrayTypeNode).elementType) + 2;
      case 'map': {
        const mapType = type as MapTypeNode;
        return (
          4 +
          this.estimateTypeLength(mapType.keyType) +
          2 +
          this.estimateTypeLength(mapType.valueType) +
          1
        );
      }
      case 'set':
        return 4 + this.estimateTypeLength((type as SetTypeNode).elementType) + 1;
      case 'class':
        return (type as ClassTypeNode).name.length + ((type as ClassTypeNode).isWeak ? 5 : 0);
      case 'externClass':
        return (
          (type as ExternClassTypeNode).name.length +
          ((type as ExternClassTypeNode).isWeak ? 5 : 0)
        );
      case 'enum':
        return (type as EnumTypeNode).name.length;
      case 'function':
        return this.estimateFunctionTypeLength(type as FunctionTypeNode);
      case 'union':
        return this.estimateUnionTypeLength(type as UnionTypeNode);
      case 'typeAlias':
        return (type as TypeAliasNode).name.length + ((type as TypeAliasNode).isWeak ? 5 : 0);
      case 'unknown':
        return 'unknown'.length;
      case 'range': {
        const rangeType = type as RangeTypeNode;
        return (
          this.estimateTypeLength(rangeType.start) +
          (rangeType.inclusive ? 2 : 3) +
          this.estimateTypeLength(rangeType.end)
        );
      }
      default:
        return 10;
    }
  }

  private formatFunctionType(type: FunctionTypeNode): void {
    if (type.isConciseForm) {
      this.printer.write('(');
      for (let i = 0; i < type.parameters.length; i++) {
        if (i > 0) {
          this.printer.write(', ');
        }
        const param = type.parameters[i];
        this.printer.write(param.name);
        this.printer.write('(');
        this.formatType(param.type);
        this.printer.write(')');
      }
      this.printer.write(')');
      return;
    }

    this.printer.write('(');
    for (let i = 0; i < type.parameters.length; i++) {
      if (i > 0) {
        this.printer.write(', ');
      }
      const param = type.parameters[i];
      this.printer.write(param.name);
      this.printer.write(': ');
      this.formatType(param.type);
    }
    this.printer.write(')');
    this.printer.write(' => ');
    this.formatType(type.returnType);
  }

  private formatUnionType(type: UnionTypeNode): void {
    for (let i = 0; i < type.types.length; i++) {
      if (i > 0) {
        this.printer.write(' | ');
      }
      this.formatType(type.types[i]);
    }
  }

  private estimateFunctionTypeLength(type: FunctionTypeNode): number {
    let length = 2; // ()

    for (const param of type.parameters) {
      if (length > 2) {
        length += 2; // ", "
      }
      length += param.name.length + 2; // ": "
      length += this.estimateTypeLength(param.type);
    }

    length += 4; // " => "
    length += this.estimateTypeLength(type.returnType);

    if (type.isConciseForm) {
      // Rough estimate for concise form - parameters already accounted for above
      length += 0;
    }

    return length;
  }

  private estimateUnionTypeLength(type: UnionTypeNode): number {
    let length = 0;
    for (let i = 0; i < type.types.length; i++) {
      if (i > 0) {
        length += 3; // " | "
      }
      length += this.estimateTypeLength(type.types[i]);
    }
    return length;
  }
}
