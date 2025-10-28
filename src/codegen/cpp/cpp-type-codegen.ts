import { Type, PrimitiveTypeNode, ArrayTypeNode, MapTypeNode, SetTypeNode, ClassTypeNode, ExternClassTypeNode, EnumTypeNode, FunctionTypeNode, UnionTypeNode } from "../../types";

export class CppTypeCodegen {
    private qualifiedNameResolver?: (className: string) => string;

    setQualifiedNameResolver(resolver: (className: string) => string): void {
        this.qualifiedNameResolver = resolver;
    }

    private getQualifiedClassName(className: string): string {
        return this.qualifiedNameResolver ? this.qualifiedNameResolver(className) : className;
    }

    generateType(type: Type): string {
        switch (type.kind) {
            case 'primitive':
                return this.generatePrimitiveType(type as PrimitiveTypeNode);
            case 'array':
                return this.generateArrayType(type as ArrayTypeNode);
            case 'map':
                return this.generateMapType(type as MapTypeNode);
            case 'set':
                return this.generateSetType(type as SetTypeNode);
            case 'class':
                return this.generateClassType(type as ClassTypeNode);
            case 'externClass':
                return this.generateExternClassType(type as ExternClassTypeNode);
            case 'enum':
                return this.getQualifiedClassName((type as EnumTypeNode).name);
            case 'function':
                return this.generateFunctionType(type as FunctionTypeNode);
            case 'union':
                return this.generateUnionType(type as UnionTypeNode);
            case 'unknown':
                return 'auto'; // Use auto for unknown types during inference
            case 'typeAlias':
                // This shouldn't happen if the validator properly resolved all type aliases
                // But if it does, treat it as an error
                throw new Error(`Unresolved type alias: ${(type as any).name}`)
            default:
                throw new Error(`Unhandled type: ${type.kind}`);
        }
    }

    generatePrimitiveType(type: PrimitiveTypeNode): string {
        if (type.type === 'string') return 'std::string';
        if (type.type === 'char') return 'char';
        if (type.type === 'null') return 'std::nullptr_t'; // Use nullptr_t for null type
        return type.type;
    }

    generateArrayType(type: ArrayTypeNode): string {
        const elementType = this.generateType(type.elementType);
        return `std::shared_ptr<std::vector<${elementType}>>`;
    }

    generateMapType(type: MapTypeNode): string {
        return `std::map<${this.generateType(type.keyType)}, ${this.generateType(type.valueType)}>`;
    }

    generateSetType(type: SetTypeNode): string {
        return `std::unordered_set<${this.generateType(type.elementType)}>`;
    }

    private generateClassType(type: ClassTypeNode): string {
        const qualifiedName = this.getQualifiedClassName(type.name);
        return type.isWeak
            ? `std::weak_ptr<${qualifiedName}>`
            : `std::shared_ptr<${qualifiedName}>`;
    }

    private generateExternClassType(type: ExternClassTypeNode): string {
        // Use namespace from type if available, otherwise check extern class definitions
        let qualifiedName = type.name;
        if (type.namespace) {
            qualifiedName = `${type.namespace}::${type.name}`;
        }

        return type.isWeak
            ? `std::weak_ptr<${qualifiedName}>`
            : `std::shared_ptr<${qualifiedName}>`;
    }

    generateFunctionType(type: FunctionTypeNode): string {
        const paramTypes = type.parameters.map(p => this.generateType(p.type)).join(', ');
        return `std::function<${this.generateType(type.returnType)}(${paramTypes})>`;
    }

    generateUnionType(type: UnionTypeNode): string {
        const hasNull = type.types.some(t => t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null');
        const nonNullTypes = type.types.filter(t =>
            !(t.kind === 'primitive' && (t as PrimitiveTypeNode).type === 'null')
        );

        // T | null - use appropriate nullable representation
        if (hasNull && nonNullTypes.length === 1) {
            const baseType = nonNullTypes[0];

            // For class types, T | null is std::shared_ptr<T> (intrinsically nullable)
            if (baseType.kind === 'class') {
                return this.generateType(baseType);
            }

            // For primitives/values, T | null is std::optional<T>
            return `std::optional<${this.generateType(baseType)}>`;
        }

        // Multiple non-null types: use std::variant
        if (nonNullTypes.length > 1) {
            const variantTypes = nonNullTypes.map(t => this.generateType(t));
            const variantType = `std::variant<${variantTypes.join(', ')}>`;

            // If union includes null, wrap variant in optional
            return hasNull ? `std::optional<${variantType}>` : variantType;
        }

        // Edge case: only null type (shouldn't happen in practice)
        if (hasNull && nonNullTypes.length === 0) {
            return 'std::monostate';
        }

        // Single non-null type (shouldn't be a union)
        return this.generateType(nonNullTypes[0]);
    }
    
}
