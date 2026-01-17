import {
  Program,
  ValidationContext,
  Statement,
  FunctionDeclaration,
  ClassDeclaration,
  MethodDeclaration,
  Type,
  TypeParameter,
  Expression,
  CallExpression,
  PositionalObjectExpression,
  ObjectExpression,
  Identifier,
  ExportDeclaration,
  SourceLocation,
  Parameter,
  MemberExpression
} from "../types";
import {
  collectGenericInstantiations,
  GenericInstantiationDiagnostic,
  GenericInstantiationRecord,
  GenericInstantiationSummary
} from "./generic-instantiator";
import { substituteTypeParametersInType, cloneTypeNode } from "../validation/type-substitution";
import { createClassType, createFunctionType, createPrimitiveType, getTypeKey } from "../type-utils";
import { TypeSymbolTable } from "../types";

interface FunctionOwner {
  program: Program;
  context: ValidationContext;
  declaration: FunctionDeclaration;
}

interface ClassOwner {
  program: Program;
  context: ValidationContext;
  declaration: ClassDeclaration;
}

interface MethodOwner {
  program: Program;
  context: ValidationContext;
  classDeclaration: ClassDeclaration;
  methodDeclaration: MethodDeclaration;
}

interface FunctionSpecialization {
  kind: "function";
  key: string;
  originalName: string;
  specializedName: string;
  typeArguments: Type[];
  mapping: Map<string, Type>;
  owner: FunctionOwner;
  clone: FunctionDeclaration;
  location?: SourceLocation;
}

interface ClassSpecialization {
  kind: "class";
  key: string;
  originalName: string;
  specializedName: string;
  typeArguments: Type[];
  mapping: Map<string, Type>;
  owner: ClassOwner;
  clone: ClassDeclaration;
  location?: SourceLocation;
}

interface MethodSpecialization {
  kind: "method";
  key: string;
  className: string;
  originalMethodName: string;
  specializedMethodName: string;
  typeArguments: Type[];
  mapping: Map<string, Type>;
  owner: MethodOwner;
  clone: MethodDeclaration;
  location?: SourceLocation;
}

type SpecializationRecord = FunctionSpecialization | ClassSpecialization | MethodSpecialization;

type SpecializationKind = "function" | "class" | "method";

interface MonomorphizationInput {
  program: Program;
  context: ValidationContext;
}

export interface MonomorphizationResult {
  diagnostics: GenericInstantiationDiagnostic[];
}


function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createSpecializationKey(kind: SpecializationKind, name: string, typeArguments: Type[]): string {
  const argsKey = typeArguments.map(arg => getTypeKey(arg)).join("|");
  return `${kind}:${name}:${argsKey}`;
}

function sanitizeTypeKey(typeKey: string): string {
  return typeKey
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mangleName(baseName: string, typeArguments: Type[]): string {
  const parts = typeArguments.map(arg => sanitizeTypeKey(getTypeKey(arg)) || "anon");
  return `${baseName}__${parts.join("__")}`;
}

export function monomorphizePrograms(inputs: MonomorphizationInput[]): MonomorphizationResult {
  const monomorphizer = new Monomorphizer(inputs);
  monomorphizer.run();
  return { diagnostics: monomorphizer.getDiagnostics() };
}

class Monomorphizer {
  private readonly programs: Program[];
  private readonly contexts: ValidationContext[];
  private readonly diagnostics: GenericInstantiationDiagnostic[] = [];

  private readonly functionOwners = new Map<string, FunctionOwner>();
  private readonly classOwners = new Map<string, ClassOwner>();
  /** Key: "className.methodName" */
  private readonly methodOwners = new Map<string, MethodOwner>();

  private readonly functionSpecializationsByKey = new Map<string, FunctionSpecialization>();
  private readonly classSpecializationsByKey = new Map<string, ClassSpecialization>();
  private readonly methodSpecializationsByKey = new Map<string, MethodSpecialization>();

  private readonly functionSpecializationsByProgram = new Map<Program, Map<string, FunctionSpecialization[]>>();
  private readonly classSpecializationsByProgram = new Map<Program, Map<string, ClassSpecialization[]>>();
  /** Key: "className.methodName" -> list of specializations */
  private readonly methodSpecializationsByClass = new Map<string, MethodSpecialization[]>();

  constructor(inputs: MonomorphizationInput[]) {
    this.programs = inputs.map(input => input.program);
    this.contexts = inputs.map(input => input.context);
    for (const input of inputs) {
      this.indexOwners(input.program, input.context);
    }
  }

  run(): void {
    for (let i = 0; i < this.programs.length; i++) {
      const program = this.programs[i];
      const context = this.contexts[i];
      const summary = collectGenericInstantiations(program, context);
      this.diagnostics.push(...summary.diagnostics);
      this.seedSpecializations(summary.instantiations, program);
    }

    this.applySpecializations();
    this.updateValidationContexts();
  }

  getDiagnostics(): GenericInstantiationDiagnostic[] {
    return this.diagnostics;
  }

  private indexOwners(program: Program, context: ValidationContext): void {
    for (const fnDecl of context.functions.values()) {
      if (fnDecl.typeParameters && fnDecl.typeParameters.length > 0) {
        this.functionOwners.set(fnDecl.name.name, { program, context, declaration: fnDecl });
      }
    }
    for (const classDecl of context.classes.values()) {
      if (classDecl.typeParameters && classDecl.typeParameters.length > 0) {
        this.classOwners.set(classDecl.name.name, { program, context, declaration: classDecl });
      }
      // Index generic methods within this class
      for (const method of classDecl.methods) {
        if (method.typeParameters && method.typeParameters.length > 0) {
          const key = `${classDecl.name.name}.${method.name.name}`;
          this.methodOwners.set(key, {
            program,
            context,
            classDeclaration: classDecl,
            methodDeclaration: method
          });
        }
      }
    }
  }

  private seedSpecializations(instantiations: GenericInstantiationRecord[], program: Program): void {
    for (const inst of instantiations) {
      if (inst.kind === "function") {
        this.ensureFunctionSpecialization(inst.name, inst.typeArguments, inst.location);
      } else if (inst.kind === "class") {
        this.ensureClassSpecialization(inst.name, inst.typeArguments, inst.location);
      } else if (inst.kind === "method" && inst.className) {
        this.ensureMethodSpecialization(inst.className, inst.name, inst.typeArguments, inst.location);
      }
    }
  }

  private ensureFunctionSpecialization(name: string, typeArguments: Type[], location?: any): FunctionSpecialization | undefined {
    if (typeArguments.some(arg => arg.kind === "typeParameter")) {
      return undefined;
    }

    const key = createSpecializationKey("function", name, typeArguments);
    const existing = this.functionSpecializationsByKey.get(key);
    if (existing) {
      return existing;
    }

    const owner = this.functionOwners.get(name);
    if (!owner) {
      this.diagnostics.push({
        message: `Generic function '${name}' has no declaration available for instantiation`,
        location
      });
      return undefined;
    }

    if (!owner.declaration.typeParameters || owner.declaration.typeParameters.length === 0) {
      this.diagnostics.push({
        message: `Function '${name}' is not generic but was instantiated with type arguments`,
        location
      });
      return undefined;
    }

    if (owner.declaration.typeParameters.length !== typeArguments.length) {
      this.diagnostics.push({
        message: `Function '${name}' requires ${owner.declaration.typeParameters.length} type argument(s); got ${typeArguments.length}`,
        location: location || owner.declaration.location
      });
      return undefined;
    }

    const mapping = this.createTypeMapping(owner.declaration.typeParameters, typeArguments);
    const clone = deepClone(owner.declaration);
    const specializedName = mangleName(owner.declaration.name.name, typeArguments);
    clone.name = { ...clone.name, name: specializedName } as Identifier;
    delete clone.typeParameters;

    const record: FunctionSpecialization = {
      kind: "function",
      key,
      originalName: owner.declaration.name.name,
      specializedName,
      typeArguments: typeArguments.map(arg => cloneTypeNode(arg)),
      mapping,
      owner,
      clone,
      location
    };

    this.functionSpecializationsByKey.set(key, record);
    this.registerFunctionSpecialization(record);
    this.transformNode(clone, mapping);
    return record;
  }

  private ensureClassSpecialization(name: string, typeArguments: Type[], location?: any): ClassSpecialization | undefined {
    if (typeArguments.some(arg => arg.kind === "typeParameter")) {
      return undefined;
    }

    const key = createSpecializationKey("class", name, typeArguments);
    const existing = this.classSpecializationsByKey.get(key);
    if (existing) {
      return existing;
    }

    const owner = this.classOwners.get(name);
    if (!owner) {
      // Check if it is an extern class in any context
      const isExtern = this.contexts.some(ctx => ctx.externClasses.has(name));
      if (isExtern) {
        return undefined;
      }

      this.diagnostics.push({
        message: `Generic class '${name}' has no declaration available for instantiation`,
        location
      });
      return undefined;
    }

    if (!owner.declaration.typeParameters || owner.declaration.typeParameters.length === 0) {
      this.diagnostics.push({
        message: `Class '${name}' is not generic but was instantiated with type arguments`,
        location
      });
      return undefined;
    }

    if (owner.declaration.typeParameters.length !== typeArguments.length) {
      this.diagnostics.push({
        message: `Class '${name}' requires ${owner.declaration.typeParameters.length} type argument(s); got ${typeArguments.length}`,
        location: location || owner.declaration.location
      });
      return undefined;
    }

    const mapping = this.createTypeMapping(owner.declaration.typeParameters, typeArguments);
    const clone = deepClone(owner.declaration);
    const specializedName = mangleName(owner.declaration.name.name, typeArguments);
    clone.name = { ...clone.name, name: specializedName } as Identifier;
    delete clone.typeParameters;

    const record: ClassSpecialization = {
      kind: "class",
      key,
      originalName: owner.declaration.name.name,
      specializedName,
      typeArguments: typeArguments.map(arg => cloneTypeNode(arg)),
      mapping,
      owner,
      clone,
      location
    };

    this.classSpecializationsByKey.set(key, record);
    this.registerClassSpecialization(record);
    this.transformNode(clone, mapping);
    return record;
  }

  private ensureMethodSpecialization(className: string, methodName: string, typeArguments: Type[], location?: any): MethodSpecialization | undefined {
    if (typeArguments.some(arg => arg.kind === "typeParameter")) {
      return undefined;
    }

    const key = this.createMethodSpecializationKey(className, methodName, typeArguments);
    const existing = this.methodSpecializationsByKey.get(key);
    if (existing) {
      return existing;
    }

    const ownerKey = `${className}.${methodName}`;
    const owner = this.methodOwners.get(ownerKey);
    if (!owner) {
      this.diagnostics.push({
        message: `Generic method '${className}.${methodName}' has no declaration available for instantiation`,
        location
      });
      return undefined;
    }

    const methodDecl = owner.methodDeclaration;
    if (!methodDecl.typeParameters || methodDecl.typeParameters.length === 0) {
      this.diagnostics.push({
        message: `Method '${className}.${methodName}' is not generic but was instantiated with type arguments`,
        location
      });
      return undefined;
    }

    if (methodDecl.typeParameters.length !== typeArguments.length) {
      this.diagnostics.push({
        message: `Method '${className}.${methodName}' requires ${methodDecl.typeParameters.length} type argument(s); got ${typeArguments.length}`,
        location: location || methodDecl.location
      });
      return undefined;
    }

    const mapping = this.createTypeMapping(methodDecl.typeParameters, typeArguments);
    const clone = deepClone(methodDecl);
    const specializedMethodName = mangleName(methodDecl.name.name, typeArguments);
    clone.name = { ...clone.name, name: specializedMethodName } as Identifier;
    delete clone.typeParameters;

    const record: MethodSpecialization = {
      kind: "method",
      key,
      className,
      originalMethodName: methodDecl.name.name,
      specializedMethodName,
      typeArguments: typeArguments.map(arg => cloneTypeNode(arg)),
      mapping,
      owner,
      clone,
      location
    };

    this.methodSpecializationsByKey.set(key, record);
    this.registerMethodSpecialization(record);
    this.transformNode(clone, mapping);
    return record;
  }

  private createMethodSpecializationKey(className: string, methodName: string, typeArguments: Type[]): string {
    const argsKey = typeArguments.map(arg => getTypeKey(arg)).join("|");
    return `method:${className}.${methodName}:${argsKey}`;
  }

  private createTypeMapping(params: TypeParameter[], args: Type[]): Map<string, Type> {
    const mapping = new Map<string, Type>();
    for (let i = 0; i < params.length; i++) {
      mapping.set(params[i].name, cloneTypeNode(args[i]));
    }
    return mapping;
  }

  private registerFunctionSpecialization(record: FunctionSpecialization): void {
    const perProgram = this.functionSpecializationsByProgram.get(record.owner.program) ?? new Map<string, FunctionSpecialization[]>();
    const list = perProgram.get(record.originalName) ?? [];
    list.push(record);
    perProgram.set(record.originalName, list);
    this.functionSpecializationsByProgram.set(record.owner.program, perProgram);
  }

  private registerClassSpecialization(record: ClassSpecialization): void {
    const perProgram = this.classSpecializationsByProgram.get(record.owner.program) ?? new Map<string, ClassSpecialization[]>();
    const list = perProgram.get(record.originalName) ?? [];
    list.push(record);
    perProgram.set(record.originalName, list);
    this.classSpecializationsByProgram.set(record.owner.program, perProgram);
  }

  private registerMethodSpecialization(record: MethodSpecialization): void {
    const key = `${record.className}.${record.originalMethodName}`;
    const list = this.methodSpecializationsByClass.get(key) ?? [];
    list.push(record);
    this.methodSpecializationsByClass.set(key, list);
  }

  private applySpecializations(): void {
    for (const program of this.programs) {
      const newBody: Statement[] = [];
      const functionSpecs = this.functionSpecializationsByProgram.get(program) ?? new Map<string, FunctionSpecialization[]>();
      const classSpecs = this.classSpecializationsByProgram.get(program) ?? new Map<string, ClassSpecialization[]>();

      for (const stmt of program.body) {
        switch (stmt.kind) {
          case "function":
            if (stmt.typeParameters && stmt.typeParameters.length > 0) {
              const specs = functionSpecs.get(stmt.name.name) ?? [];
              if (specs.length === 0) {
                this.diagnostics.push({
                  message: `Generic function '${stmt.name.name}' has no concrete instantiations and will be omitted`,
                  location: stmt.location
                });
              }
              for (const spec of specs) {
                newBody.push(spec.clone);
              }
              continue;
            }
            this.transformNode(stmt);
            newBody.push(stmt);
            break;
          case "class":
            if (stmt.typeParameters && stmt.typeParameters.length > 0) {
              const specs = classSpecs.get(stmt.name.name) ?? [];
              if (specs.length === 0) {
                this.diagnostics.push({
                  message: `Generic class '${stmt.name.name}' has no concrete instantiations and will be omitted`,
                  location: stmt.location
                });
              }
              for (const spec of specs) {
                newBody.push(spec.clone);
              }
              continue;
            }
            // Apply method specializations to non-generic classes
            this.applyMethodSpecializationsToClass(stmt);
            this.transformNode(stmt);
            newBody.push(stmt);
            break;
          case "export":
            this.handleExportStatement(stmt as ExportDeclaration, newBody, functionSpecs, classSpecs);
            break;
          default:
            this.transformNode(stmt);
            newBody.push(stmt);
            break;
        }
      }

      program.body = newBody;
    }
  }

  private handleExportStatement(
    stmt: ExportDeclaration,
    newBody: Statement[],
    functionSpecs: Map<string, FunctionSpecialization[]>,
    classSpecs: Map<string, ClassSpecialization[]>
  ): void {
    const decl = stmt.declaration;
    if (decl.kind === "function" && decl.typeParameters && decl.typeParameters.length > 0) {
      const specs = functionSpecs.get(decl.name.name) ?? [];
      if (specs.length === 0) {
        this.diagnostics.push({
          message: `Generic function '${decl.name.name}' is exported but has no concrete instantiations`,
          location: decl.location
        });
      }
      for (const spec of specs) {
        spec.clone.isExport = true;
        newBody.push({
          kind: "export",
          declaration: spec.clone,
          location: stmt.location
        } as ExportDeclaration);
      }
      return;
    }

    if (decl.kind === "class" && decl.typeParameters && decl.typeParameters.length > 0) {
      const specs = classSpecs.get(decl.name.name) ?? [];
      if (specs.length === 0) {
        this.diagnostics.push({
          message: `Generic class '${decl.name.name}' is exported but has no concrete instantiations`,
          location: decl.location
        });
      }
      for (const spec of specs) {
        spec.clone.isExport = true;
        newBody.push({
          kind: "export",
          declaration: spec.clone,
          location: stmt.location
        } as ExportDeclaration);
      }
      return;
    }

    this.transformNode(stmt);
    newBody.push(stmt);
  }

  private applyMethodSpecializationsToClass(classDecl: ClassDeclaration): void {
    const className = classDecl.name.name;
    const newMethods: MethodDeclaration[] = [];

    for (const method of classDecl.methods) {
      if (method.typeParameters && method.typeParameters.length > 0) {
        // This is a generic method - replace with specializations
        const key = `${className}.${method.name.name}`;
        const specs = this.methodSpecializationsByClass.get(key) ?? [];
        if (specs.length === 0) {
          this.diagnostics.push({
            message: `Generic method '${className}.${method.name.name}' has no concrete instantiations and will be omitted`,
            location: method.location
          });
        }
        for (const spec of specs) {
          newMethods.push(spec.clone);
        }
      } else {
        // Non-generic method - keep as is (will be transformed later)
        newMethods.push(method);
      }
    }

    classDecl.methods = newMethods;
  }

  private updateValidationContexts(): void {
    for (const context of this.contexts) {
      const programIndex = this.contexts.indexOf(context);
      const program = this.programs[programIndex];
      const functionSpecs = this.functionSpecializationsByProgram.get(program) ?? new Map();
      const classSpecs = this.classSpecializationsByProgram.get(program) ?? new Map();

      const updatedFunctions = new Map<string, FunctionDeclaration>();
      const updatedClasses = new Map<string, ClassDeclaration>();
      const updatedSymbols = new Map(context.symbols);

      for (const [name, fn] of context.functions.entries()) {
        if (fn.typeParameters && fn.typeParameters.length > 0) {
          const specs = functionSpecs.get(name) ?? [];
          if (specs.length === 0) {
            updatedSymbols.delete(name);
            continue;
          }
          updatedSymbols.delete(name);
          for (const spec of specs) {
            updatedFunctions.set(spec.specializedName, spec.clone);
            const fnType = createFunctionType(
              spec.clone.parameters.map((p: Parameter) => ({ name: p.name.name, type: p.type })),
              spec.clone.returnType || { kind: "primitive", type: "void" }
            );
            updatedSymbols.set(spec.specializedName, fnType);
          }
        } else {
          updatedFunctions.set(name, fn);
        }
      }

      for (const [name, cls] of context.classes.entries()) {
        if (cls.typeParameters && cls.typeParameters.length > 0) {
          const specs = classSpecs.get(name) ?? [];
          updatedSymbols.delete(name);
          for (const key of Array.from(updatedSymbols.keys())) {
            if (key.startsWith(`${name}.`)) {
              updatedSymbols.delete(key);
            }
          }
          if (specs.length === 0) {
            continue;
          }
          for (const spec of specs) {
            updatedClasses.set(spec.specializedName, spec.clone);
            updatedSymbols.set(spec.specializedName, createClassType(spec.specializedName));
            for (const method of spec.clone.methods) {
              if (method.isStatic) {
                const methodType = createFunctionType(
                  method.parameters.map((p: Parameter) => ({ name: p.name.name, type: p.type })),
                  method.returnType
                );
                updatedSymbols.set(`${spec.specializedName}.${method.name.name}`, methodType);
              }
            }
            updatedSymbols.set(
              `${spec.specializedName}.fromJSON`,
              createFunctionType(
                [{ name: "json_str", type: createPrimitiveType("string") }],
                createClassType(spec.specializedName)
              )
            );
          }
        } else {
          updatedClasses.set(name, cls);
        }
      }

      context.functions = updatedFunctions;
      context.classes = updatedClasses;
      context.symbols = updatedSymbols;
      context.typeSymbols = new TypeSymbolTable(
        context.interfaces,
        context.classes,
        context.enums,
        context.externClasses
      );
    }
  }

  private transformNode<T>(node: T, mapping?: Map<string, Type>): T {
    return this.transformValue(node, mapping) as T;
  }

  private transformValue(value: any, mapping?: Map<string, Type>): any {
    if (value == null) {
      return value;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = this.transformValue(value[i], mapping);
      }
      return value;
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    if (this.isFunctionDeclarationNode(value)) {
      return this.transformFunctionDeclaration(value, mapping);
    }

    if (this.isMethodDeclarationNode(value)) {
      return this.transformMethodDeclaration(value, mapping);
    }

    if (this.isClassDeclarationNode(value)) {
      return this.transformClassDeclaration(value, mapping);
    }

    if (this.isTypeNode(value)) {
      return this.rewriteTypeNode(value as Type, mapping);
    }

    switch ((value as { kind?: string }).kind) {
      case "call":
        return this.transformCallExpression(value as CallExpression, mapping);
      case "positionalObject":
        return this.transformPositionalObjectExpression(value as PositionalObjectExpression, mapping);
      case "object":
        return this.transformObjectExpression(value as ObjectExpression, mapping);
      default:
        break;
    }

    for (const key of Object.keys(value)) {
      if (key === "kind") continue;
      value[key] = this.transformValue(value[key], mapping);
    }

    return value;
  }

  private transformCallExpression(expr: CallExpression, mapping?: Map<string, Type>): CallExpression {
    expr.callee = this.transformValue(expr.callee, mapping) as Expression;
    expr.arguments = expr.arguments.map(arg => this.transformValue(arg, mapping) as Expression);
    if (expr.namedArguments) {
      expr.namedArguments = expr.namedArguments.map(arg => this.transformValue(arg, mapping));
    }

    if (expr.typeArguments) {
      expr.typeArguments = expr.typeArguments.map(arg => this.rewriteTypeNode(arg, mapping));
    }
    if (expr.resolvedTypeArguments) {
      expr.resolvedTypeArguments = expr.resolvedTypeArguments.map(arg => this.rewriteTypeNode(arg, mapping));
    }

    // Handle generic method calls (member expression callee)
    if (expr.genericInstantiation && expr.callee.kind === "member") {
      const memberExpr = expr.callee as MemberExpression;
      if (memberExpr.property.kind === "identifier") {
        const methodName = memberExpr.property.name;
        const typeArgs = expr.genericInstantiation.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
        
        // Try to resolve the class name from the object's inferred type
        let className: string | undefined;
        const objectType = (memberExpr.object as any).inferredType;
        if (objectType && objectType.kind === "class") {
          className = objectType.name;
        } else if (memberExpr.object.kind === "identifier") {
          // Could be a static method call: ClassName.method<T>()
          className = (memberExpr.object as Identifier).name;
        }

        if (className) {
          const specialization = this.ensureMethodSpecialization(className, methodName, typeArgs, expr.location);
          if (specialization) {
            (memberExpr.property as Identifier).name = specialization.specializedMethodName;
            expr.typeArguments = undefined;
            expr.resolvedTypeArguments = undefined;
            expr.genericInstantiation = undefined;
            // Update callInfo for method calls (instanceMethod or staticMethod)
            if (expr.callInfo && (expr.callInfo.kind === "instanceMethod" || expr.callInfo.kind === "staticMethod")) {
              expr.callInfo.targetName = specialization.specializedMethodName;
            }
            if (expr.callInfoSnapshot && (expr.callInfoSnapshot.kind === "instanceMethod" || expr.callInfoSnapshot.kind === "staticMethod")) {
              expr.callInfoSnapshot.targetName = specialization.specializedMethodName;
            }
          }
        }
      }
    }

    // Handle generic function calls (identifier callee)
    if (expr.genericInstantiation && expr.callee.kind === "identifier") {
      const typeArgs = expr.genericInstantiation.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
      const specialization = this.ensureFunctionSpecialization((expr.callee as Identifier).name, typeArgs, expr.location);
      if (specialization) {
        (expr.callee as Identifier).name = specialization.specializedName;
        expr.typeArguments = undefined;
        expr.resolvedTypeArguments = undefined;
        expr.genericInstantiation = undefined;
        if (expr.callInfo && expr.callInfo.kind === "function") {
          expr.callInfo.targetName = specialization.specializedName;
        }
        if (expr.callInfoSnapshot && expr.callInfoSnapshot.kind === "function") {
          expr.callInfoSnapshot.targetName = specialization.specializedName;
        }
      }
    }

    if (expr.inferredType) {
      expr.inferredType = this.rewriteTypeNode(expr.inferredType, mapping);
    }
    if ((expr as any)._expectedFunctionType) {
      (expr as any)._expectedFunctionType = this.rewriteTypeNode((expr as any)._expectedFunctionType, mapping);
    }

    return expr;
  }

  private transformObjectExpression(expr: ObjectExpression, mapping?: Map<string, Type>): ObjectExpression {
    const debug = (msg: string, data?: any) => {
      const flag = process.env.DOOF_DEBUG;
      if (flag === '1' || flag === 'true' || flag === 'vm' || flag === 'vmgen' || flag === 'mono' || flag === 'monomorphizer') {
        // eslint-disable-next-line no-console
        console.error('[MONO][object]', msg, data ?? {});
      }
    };
    debug('before', {
      className: expr.className,
      hasGenericInstantiation: !!expr.genericInstantiation,
      typeArgs: expr.genericInstantiation?.typeArguments?.map(t => (t as any).name || (t as any).type),
      inferredType: expr.inferredType && (expr.inferredType as any).name
    });
    expr.properties = expr.properties.map(prop => {
      if (prop.kind === 'spread') {
        prop.argument = this.transformValue(prop.argument, mapping) as Expression;
      } else if (prop.value) {
        prop.value = this.transformValue(prop.value, mapping) as Expression;
      }
      return prop;
    });

    if (expr.typeArguments) {
      expr.typeArguments = expr.typeArguments.map(arg => this.rewriteTypeNode(arg, mapping));
    }
    if (expr.resolvedTypeArguments) {
      expr.resolvedTypeArguments = expr.resolvedTypeArguments.map(arg => this.rewriteTypeNode(arg, mapping));
    }

    if (expr.genericInstantiation && expr.className) {
      const typeArgs = expr.genericInstantiation.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
      const specialization = this.ensureClassSpecialization(expr.className, typeArgs, expr.location);
      if (specialization) {
        expr.className = specialization.specializedName;
        expr.typeArguments = undefined;
        expr.resolvedTypeArguments = undefined;
        expr.genericInstantiation = undefined;
        if ((expr as any).instantiationInfo) {
          (expr as any).instantiationInfo.targetClass = specialization.specializedName;
        }
        debug('specialized via genericInstantiation', { to: expr.className });
      }
    }

    if (expr.instantiationInfo && expr.instantiationInfo.fieldMappings) {
      expr.instantiationInfo.fieldMappings = expr.instantiationInfo.fieldMappings.map(field => ({
        ...field,
        type: this.rewriteTypeNode(field.type, mapping)
      }));
    }

    if (expr.inferredType) {
      expr.inferredType = this.rewriteTypeNode(expr.inferredType, mapping);
    }

    debug('after', {
      className: expr.className,
      inferredType: expr.inferredType && (expr.inferredType as any).name
    });

    return expr;
  }

  private transformPositionalObjectExpression(expr: PositionalObjectExpression, mapping?: Map<string, Type>): PositionalObjectExpression {
    const debug = (msg: string, data?: any) => {
      const flag = process.env.DOOF_DEBUG;
      if (flag === '1' || flag === 'true' || flag === 'vm' || flag === 'vmgen' || flag === 'mono' || flag === 'monomorphizer') {
        // eslint-disable-next-line no-console
        console.error('[MONO][positional]', msg, data ?? {});
      }
    };
    debug('before', { className: expr.className, hasGenericInstantiation: !!expr.genericInstantiation });
    expr.arguments = expr.arguments.map(arg => this.transformValue(arg, mapping) as Expression);
    if (expr.genericInstantiation) {
      const typeArgs = expr.genericInstantiation.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
      const specialization = this.ensureClassSpecialization(expr.className, typeArgs, expr.location);
      if (specialization) {
        expr.className = specialization.specializedName;
        expr.typeArguments = undefined;
        expr.resolvedTypeArguments = undefined;
        expr.genericInstantiation = undefined;
        if ((expr as any).instantiationInfo) {
          (expr as any).instantiationInfo.targetClass = specialization.specializedName;
        }
        debug('specialized via genericInstantiation', { to: expr.className });
      }
    }
    if (expr.inferredType) {
      expr.inferredType = this.rewriteTypeNode(expr.inferredType, mapping);
    }
    debug('after', { className: expr.className });
    return expr;
  }

  private rewriteTypeNode(type: Type, mapping?: Map<string, Type>): Type {
    if (!type || typeof type !== "object" || !("kind" in type)) {
      throw new Error(
        `rewriteTypeNode received invalid type node: ${JSON.stringify(type)}`
      );
    }
    const substituted = mapping ? substituteTypeParametersInType(type, mapping) : cloneTypeNode(type);
    return this.canonicalizeType(substituted, mapping);
  }

  private canonicalizeType(type: Type, mapping?: Map<string, Type>): Type {
    switch (type.kind) {
      case "primitive":
      case "unknown":
      case "enum":
        return type;
      case "typeParameter":
        return type;
      case "class": {
        const processedArgs = type.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
        if (processedArgs.length > 0 && processedArgs.every(arg => arg.kind !== "typeParameter")) {
          const specialization = this.ensureClassSpecialization(type.name, processedArgs, (type as any).location);
          if (specialization) {
            return {
              kind: "class",
              name: specialization.specializedName,
              isWeak: type.isWeak,
              wasNullable: type.wasNullable
            } as Type;
          }
        }
        return {
          kind: "class",
          name: type.name,
          isWeak: type.isWeak,
          wasNullable: type.wasNullable,
          typeArguments: processedArgs.length > 0 ? processedArgs : undefined
        } as Type;
      }
      case "externClass": {
        const processedArgs = type.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping)) ?? [];
        return {
          kind: "externClass",
          name: type.name,
          isWeak: type.isWeak,
          wasNullable: type.wasNullable,
          namespace: type.namespace,
          typeArguments: processedArgs.length > 0 ? processedArgs : undefined
        } as Type;
      }
      case "array":
        return {
          kind: "array",
          elementType: this.rewriteTypeNode(type.elementType, mapping),
          isReadonly: type.isReadonly
        };
      case "map":
        return {
          kind: "map",
          keyType: this.rewriteTypeNode(type.keyType, mapping),
          valueType: this.rewriteTypeNode(type.valueType, mapping),
          isReadonly: type.isReadonly
        };
      case "set":
        return {
          kind: "set",
          elementType: this.rewriteTypeNode(type.elementType, mapping),
          isReadonly: type.isReadonly
        };
      case "union":
        return {
          kind: "union",
          types: type.types.map(t => this.rewriteTypeNode(t, mapping))
        };
      case "function":
        return {
          kind: "function",
          parameters: type.parameters.map(p => ({ name: p.name, type: this.rewriteTypeNode(p.type, mapping) })),
          returnType: this.rewriteTypeNode(type.returnType, mapping)
        };
      case "typeAlias":
        return {
          kind: "typeAlias",
          name: type.name,
          isWeak: type.isWeak,
          typeArguments: type.typeArguments?.map(arg => this.rewriteTypeNode(arg, mapping))
        } as Type;
      case "range":
        return {
          kind: "range",
          start: this.rewriteTypeNode(type.start, mapping),
          end: this.rewriteTypeNode(type.end, mapping),
          inclusive: type.inclusive
        };
      default:
        return type;
    }
  }

  private isTypeNode(value: any): value is Type {
    if (!value || typeof value !== "object") {
      return false;
    }
    switch ((value as { kind?: string }).kind) {
      case "primitive":
      case "unknown":
      case "enum":
      case "typeParameter":
      case "class":
      case "externClass":
      case "typeAlias":
        return true;
      case "array":
      case "set":
        return "elementType" in value && this.isTypeNode((value as any).elementType);
      case "map":
        return (
          "keyType" in value &&
          "valueType" in value &&
          this.isTypeNode((value as any).keyType) &&
          this.isTypeNode((value as any).valueType)
        );
      case "union":
        return Array.isArray((value as any).types);
      case "function":
        return (
          Array.isArray((value as any).parameters) &&
          (value as any).parameters.every((param: any) => this.isTypeNode(param.type)) &&
          "returnType" in value &&
          this.isTypeNode((value as any).returnType)
        );
      case "range":
        return (
          "start" in value &&
          "end" in value &&
          this.isTypeNode((value as any).start) &&
          this.isTypeNode((value as any).end)
        );
      default:
        return false;
    }
  }

  private isFunctionDeclarationNode(value: any): value is FunctionDeclaration {
    return value && typeof value === "object" && value.kind === "function" && Array.isArray(value.parameters) && "body" in value;
  }

  private isClassDeclarationNode(value: any): value is ClassDeclaration {
    return value && typeof value === "object" && value.kind === "class" && Array.isArray(value.fields) && Array.isArray(value.methods);
  }

  private isMethodDeclarationNode(value: any): value is MethodDeclaration {
    return value && typeof value === "object" && value.kind === "method" && Array.isArray(value.parameters) && "body" in value;
  }

  private transformFunctionDeclaration(fn: FunctionDeclaration, mapping?: Map<string, Type>): FunctionDeclaration {
    fn.parameters = fn.parameters.map(param => this.transformValue(param, mapping));
    if (fn.returnType) {
      fn.returnType = this.rewriteTypeNode(fn.returnType, mapping);
    }
    fn.body = this.transformValue(fn.body, mapping);
    if (fn.typeParameters) {
      fn.typeParameters = undefined;
    }
    return fn;
  }

  private transformMethodDeclaration(method: MethodDeclaration, mapping?: Map<string, Type>): MethodDeclaration {
    method.parameters = method.parameters.map(param => this.transformValue(param, mapping));
    if (method.returnType) {
      method.returnType = this.rewriteTypeNode(method.returnType, mapping);
    }
    method.body = this.transformValue(method.body, mapping);
    if (method.typeParameters) {
      method.typeParameters = undefined;
    }
    return method;
  }

  private transformClassDeclaration(cls: ClassDeclaration, mapping?: Map<string, Type>): ClassDeclaration {
    cls.fields = cls.fields.map(field => this.transformValue(field, mapping));
    cls.methods = cls.methods.map(method => this.transformMethodDeclaration(method, mapping));
    if (cls.nestedClasses) {
      cls.nestedClasses = cls.nestedClasses.map(nested => this.transformValue(nested, mapping));
    }
    if (cls.typeParameters) {
      cls.typeParameters = undefined;
    }
    return cls;
  }
}
