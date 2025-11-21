import { BlockStatement, ClassDeclaration, DestructuringAssignment, DestructuringVariableDeclaration, Expression, Identifier, MemberExpression, ObjectPattern, Statement, TuplePattern, VariableDeclaration } from "../types";
import { Validator } from "./validator";

function makeTempName(counter: number): string {
  return `__destr_${counter}`;
}

function createTempDeclaration(name: string, expr: Expression): VariableDeclaration {
  return {
    kind: 'variable',
    isConst: true,
    isReadonly: false,
    identifier: { kind: 'identifier', name, location: expr.location },
    initializer: expr,
    location: expr.location
  };
}

function createMemberAccess(objectIdent: Identifier, field: string, loc: any): MemberExpression {
  return {
    kind: 'member',
    object: objectIdent,
    property: { kind: 'identifier', name: field, location: loc },
    computed: false,
    location: loc
  } as MemberExpression;
}

function publicFieldNamesInOrder(classDecl: ClassDeclaration): string[] {
  return classDecl.fields.filter(f => !f.isStatic && f.isPublic).map(f => f.name.name);
}

export function lowerDestructuringVariable(stmt: DestructuringVariableDeclaration, validator: Validator): BlockStatement {
  const block: BlockStatement = { kind: 'block', body: [], location: stmt.location };

  // Create a temp to evaluate RHS once
  const tempName = makeTempName(validator.context.codeGenHints.callDispatch.size + (validator.context.errors.length || 0));
  const tempDecl = createTempDeclaration(tempName, stmt.initializer);
  block.body.push(tempDecl);

  const tempIdent: Identifier = { kind: 'identifier', name: tempName, location: stmt.initializer.location };

  if (stmt.pattern.kind === 'objectPattern') {
    const obj = stmt.pattern as ObjectPattern;
    for (const id of obj.names) {
      const varDecl: VariableDeclaration = {
        kind: 'variable',
        isConst: stmt.isConst,
        isReadonly: false,
        identifier: { kind: 'identifier', name: id.name, location: id.location },
        initializer: createMemberAccess(tempIdent, id.name, id.location),
        location: id.location
      };
      block.body.push(varDecl);
    }
    return block;
  }

  // Tuple pattern -> map to public field order
  const tuple = stmt.pattern as TuplePattern;
  // Validate RHS to get type information (inferredType set)
  const rhsType = validator ? undefined : undefined; // not used directly here
  // Use classes map to find field order after RHS is validated later; for now, use best-effort during validation
  // We resolve class name by validating the temp assignment later; here we build member names by index resolution during validation

  // We cannot know field names without class; defer by emitting member access with placeholder names is not viable;
  // Instead, attempt to resolve now using classes by peeking at initializer if it's an identifier with inferredType
  // Safer: derive at validation time. We'll do it here by validating initializer quickly to populate inferredType.
  const initType = validator ? validator.context.symbols.get((stmt.initializer as any).name) : undefined;
  // Regardless, compute from validation context after validating temp declaration; since validateBlockStatement will validate in order, by the time later varDecls validate, member resolution will occur.

  // To generate correct member names, inspect the current known class decl if possible
  let fieldOrder: string[] = [];
  // Try to look up type name if initializer already had inferredType
  const inferred = (stmt.initializer as any).inferredType;
  if (inferred && (inferred.kind === 'class')) {
    const classDecl = validator.context.classes.get(inferred.name);
    if (classDecl) fieldOrder = publicFieldNamesInOrder(classDecl);
  }

  // Fallback to empty, validators will error on unknown members if emitted
  for (let i = 0; i < tuple.names.length; i++) {
    const target = tuple.names[i];
    const fieldName = fieldOrder[i] || `__field_${i}`; // best-effort; validator will flag if invalid
    const varDecl: VariableDeclaration = {
      kind: 'variable',
      isConst: stmt.isConst,
      isReadonly: false,
      identifier: { kind: 'identifier', name: target.name, location: target.location },
      initializer: createMemberAccess(tempIdent, fieldName, target.location),
      location: target.location
    };
    block.body.push(varDecl);
  }

  return block;
}

export function lowerDestructuringAssignment(stmt: DestructuringAssignment, validator: Validator): BlockStatement {
  const block: BlockStatement = { kind: 'block', body: [], location: stmt.location };
  const tempName = makeTempName(validator.context.codeGenHints.callDispatch.size + (validator.context.errors.length || 0));
  const tempDecl = createTempDeclaration(tempName, stmt.expression);
  block.body.push(tempDecl);
  const tempIdent: Identifier = { kind: 'identifier', name: tempName, location: stmt.expression.location };

  if (stmt.pattern.kind === 'objectPattern') {
    const obj = stmt.pattern as ObjectPattern;
    for (const id of obj.names) {
      const assign: Statement = {
        kind: 'expression',
        expression: {
          kind: 'binary',
          operator: '=',
          left: { kind: 'identifier', name: id.name, location: id.location },
          right: createMemberAccess(tempIdent, id.name, id.location),
          location: id.location
        },
        location: id.location
      } as any;
      block.body.push(assign);
    }
    return block;
  }

  const tuple = stmt.pattern as TuplePattern;
  let fieldOrder: string[] = [];
  const inferred = (stmt.expression as any).inferredType;
  if (inferred && (inferred.kind === 'class')) {
    const classDecl = validator.context.classes.get(inferred.name);
    if (classDecl) fieldOrder = publicFieldNamesInOrder(classDecl);
  }

  for (let i = 0; i < tuple.names.length; i++) {
    const target = tuple.names[i];
    const fieldName = fieldOrder[i] || `__field_${i}`;
    const assign: Statement = {
      kind: 'expression',
      expression: {
        kind: 'binary',
        operator: '=',
        left: { kind: 'identifier', name: target.name, location: target.location },
        right: createMemberAccess(tempIdent, fieldName, target.location),
        location: target.location
      },
      location: target.location
    } as any;
    block.body.push(assign);
  }

  return block;
}
