import {
  Program,
  Statement,
  Expression,
  Type,
  ValidationContext,
  SourceLocation,
  CallExpression,
  PositionalObjectExpression
} from "../types";
import { getTypeKey } from "../type-utils";
import { cloneTypeNode } from "../validation/type-substitution";

export type GenericInstantiationKind = "function" | "class";

export interface GenericInstantiationRecord {
  kind: GenericInstantiationKind;
  name: string;
  typeArguments: Type[];
  location?: SourceLocation;
}

export interface GenericInstantiationSummary {
  instantiations: GenericInstantiationRecord[];
  diagnostics: GenericInstantiationDiagnostic[];
}

export interface GenericInstantiationDiagnostic {
  message: string;
  location?: SourceLocation;
}

export function collectGenericInstantiations(
  program: Program,
  context: ValidationContext
): GenericInstantiationSummary {
  const collector = new InstantiationCollector(context);
  collector.collectProgram(program);
  return collector.toSummary();
}

class InstantiationCollector {
  private readonly seen = new Map<string, GenericInstantiationRecord>();
  private readonly instantiations: GenericInstantiationRecord[] = [];
  private readonly diagnostics: GenericInstantiationDiagnostic[] = [];

  constructor(private readonly context: ValidationContext) {}

  private isStatementNode(value: any): value is Statement {
    if (!value || typeof value !== "object") {
      return false;
    }
    switch ((value as { kind?: string }).kind) {
      case "block":
      case "expression":
      case "variable":
      case "function":
      case "class":
      case "externClass":
      case "interface":
      case "field":
      case "method":
      case "enum":
      case "typeAlias":
      case "if":
      case "while":
      case "for":
      case "forOf":
      case "switch":
      case "return":
      case "break":
      case "continue":
      case "import":
      case "export":
      case "blank":
      case "markdownHeader":
      case "markdownTable":
        return true;
      default:
        return false;
    }
  }

  collectProgram(program: Program): void {
    for (const stmt of program.body) {
      this.visitStatement(stmt);
    }
  }

  toSummary(): GenericInstantiationSummary {
    return {
      instantiations: this.instantiations,
      diagnostics: this.diagnostics
    };
  }

  private visitStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "function":
        this.visitFunctionStatement(stmt);
        break;
      case "class":
        this.visitClassStatement(stmt);
        break;
      case "externClass":
        this.visitExternClassStatement(stmt);
        break;
      case "variable":
        if (stmt.type) {
          this.visitType(stmt.type);
        }
        if (stmt.initializer) {
          this.visitExpression(stmt.initializer);
        }
        break;
      case "expression":
        this.visitExpression(stmt.expression);
        break;
      case "block":
        for (const inner of stmt.body) {
          this.visitStatement(inner);
        }
        break;
      case "if":
        this.visitExpression(stmt.condition);
        this.visitStatement(stmt.thenStatement);
        if (stmt.elseStatement) {
          this.visitStatement(stmt.elseStatement);
        }
        break;
      case "while":
        this.visitExpression(stmt.condition);
        this.visitStatement(stmt.body);
        break;
      case "for":
        if (stmt.init) {
          if (stmt.init.kind === "variable") {
            this.visitStatement(stmt.init);
          } else {
            this.visitExpression(stmt.init);
          }
        }
        if (stmt.condition) {
          this.visitExpression(stmt.condition);
        }
        if (stmt.update) {
          this.visitExpression(stmt.update);
        }
        this.visitStatement(stmt.body);
        break;
      case "forOf":
        this.visitExpression(stmt.iterable);
        this.visitStatement(stmt.body);
        break;
      case "switch":
        this.visitExpression(stmt.discriminant);
        for (const switchCase of stmt.cases) {
          for (const test of switchCase.tests) {
            if (test.kind === "range") {
              this.visitExpression(test.start);
              this.visitExpression(test.end);
            } else {
              this.visitExpression(test);
            }
          }
          for (const bodyStmt of switchCase.body) {
            this.visitStatement(bodyStmt);
          }
        }
        break;
      case "return":
        if (stmt.argument) {
          this.visitExpression(stmt.argument);
        }
        break;
      case "export":
        this.visitStatement(stmt.declaration);
        break;
      case "typeAlias":
        this.visitType(stmt.type);
        break;
      case "interface":
        for (const member of stmt.members) {
          if (member.kind === "interfaceProperty") {
            this.visitType(member.type);
          } else if (member.kind === "interfaceMethod") {
            for (const param of member.parameters) {
              this.visitType(param.type);
            }
            this.visitType(member.returnType);
          }
        }
        break;
      case "field":
      case "method":
      case "enum":
      case "import":
      case "blank":
      case "continue":
      case "break":
      case "markdownHeader":
      case "markdownTable":
        break;
      default:
        const neverStmt: never = stmt;
        throw new Error(`Unhandled statement kind '${(neverStmt as any).kind}' in generic instantiation collector`);
    }
  }

  private visitFunctionStatement(stmt: Statement & { kind: "function" }): void {
    for (const param of stmt.parameters) {
      this.visitType(param.type);
      if (param.defaultValue) {
        this.visitExpression(param.defaultValue);
      }
    }
    this.visitType(stmt.returnType);
    this.visitStatement(stmt.body);
  }

  private visitClassStatement(stmt: Statement & { kind: "class" }): void {
    for (const field of stmt.fields) {
      this.visitType(field.type);
      if (field.defaultValue) {
        this.visitExpression(field.defaultValue);
      }
    }

    if (stmt.constructor) {
      for (const param of stmt.constructor.parameters) {
        this.visitType(param.type);
        if (param.defaultValue) {
          this.visitExpression(param.defaultValue);
        }
      }
      this.visitStatement(stmt.constructor.body);
    }

    for (const method of stmt.methods) {
      for (const param of method.parameters) {
        this.visitType(param.type);
        if (param.defaultValue) {
          this.visitExpression(param.defaultValue);
        }
      }
      this.visitType(method.returnType);
      this.visitStatement(method.body);
    }

    if (stmt.nestedClasses) {
      for (const nested of stmt.nestedClasses) {
        this.visitStatement(nested);
      }
    }
  }

  private visitExternClassStatement(stmt: Statement & { kind: "externClass" }): void {
    for (const field of stmt.fields) {
      this.visitType(field.type);
    }

    for (const method of stmt.methods) {
      for (const param of method.parameters) {
        this.visitType(param.type);
      }
      this.visitType(method.returnType);
    }
  }

  private visitExpression(expr: Expression): void {
    switch (expr.kind) {
      case "literal":
      case "identifier":
        break;
      case "binary":
        this.visitExpression(expr.left);
        this.visitExpression(expr.right);
        break;
      case "unary":
        this.visitExpression(expr.operand);
        break;
      case "conditional":
        this.visitExpression(expr.test);
        this.visitExpression(expr.consequent);
        this.visitExpression(expr.alternate);
        break;
      case "call":
        this.recordFunctionInstantiation(expr);
        this.visitExpression(expr.callee);
        for (const arg of expr.arguments) {
          this.visitExpression(arg);
        }
        if (expr.namedArguments) {
          for (const named of expr.namedArguments) {
            if (named.value) {
              this.visitExpression(named.value);
            }
          }
        }
        break;
      case "member":
        this.visitExpression(expr.object);
        if (expr.computed) {
          this.visitExpression(expr.property as Expression);
        }
        break;
      case "index":
        this.visitExpression(expr.object);
        this.visitExpression(expr.index);
        break;
      case "array":
        for (const element of expr.elements) {
          this.visitExpression(element);
        }
        break;
      case "object":
        for (const prop of expr.properties) {
          if (prop.key.kind === "member") {
            this.visitExpression(prop.key);
          }
          if (prop.value) {
            this.visitExpression(prop.value);
          }
        }
        break;
      case "positionalObject":
        this.recordClassInstantiation(expr);
        for (const arg of expr.arguments) {
          this.visitExpression(arg);
        }
        break;
      case "tuple":
      case "set":
        for (const element of expr.elements) {
          this.visitExpression(element);
        }
        break;
      case "enumShorthand":
        break;
      case "lambda":
        for (const param of expr.parameters) {
          this.visitType(param.type);
          if (param.defaultValue) {
            this.visitExpression(param.defaultValue);
          }
        }
        if (expr.returnType) {
          this.visitType(expr.returnType);
        }
        this.visitLambdaBody(expr.body);
        break;
      case "trailingLambda":
        this.visitExpression(expr.callee);
        for (const arg of expr.arguments) {
          this.visitExpression(arg);
        }
        if (expr.lambda.parameters) {
          for (const param of expr.lambda.parameters) {
            this.visitType(param.type);
          }
        }
        if (expr.lambda._expectedFunctionType) {
          this.visitType(expr.lambda._expectedFunctionType);
        }
        this.visitLambdaBody(expr.lambda.body);
        break;
      case "typeGuard":
        this.visitExpression(expr.expression);
        this.visitType(expr.type);
        break;
      case "interpolated-string":
        for (const part of expr.parts) {
          if (typeof part !== "string") {
            this.visitExpression(part);
          }
        }
        if (expr.tagIdentifier) {
          this.visitExpression(expr.tagIdentifier);
        }
        break;
      case "nullCoalesce":
        this.visitExpression(expr.left);
        this.visitExpression(expr.right);
        break;
      case "optionalChain":
        this.visitExpression(expr.object);
        if (expr.property && expr.property.kind !== "identifier") {
          this.visitExpression(expr.property as Expression);
        }
        break;
      case "nonNullAssertion":
        this.visitExpression(expr.operand);
        break;
      case "range":
        this.visitExpression(expr.start);
        this.visitExpression(expr.end);
        break;
      default:
        const neverExpr: never = expr;
        throw new Error(`Unhandled expression kind '${(neverExpr as any).kind}' in generic instantiation collector`);
    }
  }

  private visitLambdaBody(body: Expression | Statement): void {
    if (this.isStatementNode(body)) {
      this.visitStatement(body as Statement);
    } else {
      this.visitExpression(body as Expression);
    }
  }

  private visitType(type: Type): void {
    switch (type.kind) {
      case "primitive":
      case "unknown":
      case "enum":
      case "typeParameter":
        break;
      case "class":
        this.maybeRecordClassType(type.name, type.typeArguments);
        if (type.typeArguments) {
          for (const arg of type.typeArguments) {
            this.visitType(arg);
          }
        }
        break;
      case "externClass":
        break;
      case "array":
        this.visitType(type.elementType);
        break;
      case "map":
        this.visitType(type.keyType);
        this.visitType(type.valueType);
        break;
      case "set":
        this.visitType(type.elementType);
        break;
      case "union":
        for (const member of type.types) {
          this.visitType(member);
        }
        break;
      case "function":
        for (const param of type.parameters) {
          this.visitType(param.type);
        }
        this.visitType(type.returnType);
        break;
      case "typeAlias":
        if (type.typeArguments) {
          for (const arg of type.typeArguments) {
            this.visitType(arg);
          }
        }
        break;
      case "range":
        this.visitType(type.start);
        this.visitType(type.end);
        break;
      default:
        const neverType: never = type;
        throw new Error(`Unhandled type kind '${(neverType as any).kind}' in generic instantiation collector`);
    }
  }

  private recordFunctionInstantiation(expr: CallExpression): void {
    if (!expr.genericInstantiation || expr.genericInstantiation.typeArguments.length === 0) {
      return;
    }

    if (expr.callee.kind !== "identifier") {
      this.diagnostics.push({
        message: "Generic instantiation collector currently supports only identifier call expressions",
        location: expr.location
      });
      return;
    }

    const key = this.createKey("function", expr.callee.name, expr.genericInstantiation.typeArguments);
    if (this.seen.has(key)) {
      return;
    }

    const clonedArgs = expr.genericInstantiation.typeArguments.map(arg => cloneTypeNode(arg));
    const record: GenericInstantiationRecord = {
      kind: "function",
      name: expr.callee.name,
      typeArguments: clonedArgs,
      location: expr.location
    };

    this.seen.set(key, record);
    this.instantiations.push(record);
  }

  private recordClassInstantiation(expr: PositionalObjectExpression): void {
    if (!expr.genericInstantiation || expr.genericInstantiation.typeArguments.length === 0) {
      return;
    }

    const key = this.createKey("class", expr.className, expr.genericInstantiation.typeArguments);
    if (this.seen.has(key)) {
      return;
    }

    const clonedArgs = expr.genericInstantiation.typeArguments.map(arg => cloneTypeNode(arg));
    const record: GenericInstantiationRecord = {
      kind: "class",
      name: expr.className,
      typeArguments: clonedArgs,
      location: expr.location
    };

    this.seen.set(key, record);
    this.instantiations.push(record);
  }

  private maybeRecordClassType(name: string, typeArguments: Type[] | undefined): void {
    if (!typeArguments || typeArguments.length === 0) {
      return;
    }

    if (typeArguments.some(arg => arg.kind === "typeParameter")) {
      return;
    }

    const key = this.createKey("class", name, typeArguments);
    if (this.seen.has(key)) {
      return;
    }

    const clonedArgs = typeArguments.map(arg => cloneTypeNode(arg));
    const record: GenericInstantiationRecord = {
      kind: "class",
      name,
      typeArguments: clonedArgs
    };

    this.seen.set(key, record);
    this.instantiations.push(record);
  }

  private createKey(kind: GenericInstantiationKind, name: string, typeArguments: Type[]): string {
    const argsKey = typeArguments.map(arg => getTypeKey(arg)).join("|");
    return `${kind}:${name}:${argsKey}`;
  }
}
