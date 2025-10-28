import { ForOfStatement, Identifier } from '../../types';
import { CompilationContext } from '../vmgen';
import { emit, emitJump, createLabel, setLabel } from './vmgen-emit';
import { generateExpression } from './vmgen-expression-codegen';
import { getExpressionType } from './vmgen-type-utils';

export function generateIteratorBasedForOf(
  forOfStmt: ForOfStatement,
  context: CompilationContext,
  generateStatementFn: (statement: any, context: CompilationContext) => void
): void {
  const iterableType = getExpressionType(forOfStmt.iterable, context);

  // Allocate registers for the iterable and iterator helpers
  const iterableReg = context.registerAllocator.allocate();
  generateExpression(forOfStmt.iterable, iterableReg, context);

  const iteratorReg = context.registerAllocator.allocate();
  const hasNextReg = context.registerAllocator.allocate();

  // Prepare loop variable registers. For now we only support simple identifiers.
  if (forOfStmt.variable.kind !== 'identifier') {
    throw new Error('Iterator for-of currently supports identifier loop variables only');
  }
  const loopVarReg = context.registerAllocator.allocateVariable(forOfStmt.variable.name);

  // Establish loop control labels
  const loopStart = createLabel(context);
  const loopContinue = createLabel(context);
  const loopEnd = createLabel(context);

  context.loopContextStack.push({
    continueLabel: loopContinue,
    breakLabel: loopEnd,
    loopType: 'forOf'
  });

  // Initialize iterator and enter the loop
  emit('ITER_INIT', iteratorReg, iterableReg, 0, context);
  setLabel(loopStart, context);

  emit('ITER_NEXT', hasNextReg, iteratorReg, 0, context);
  emitJump('JMP_IF_FALSE', hasNextReg, loopEnd, context);

  emit('ITER_VALUE', loopVarReg, iteratorReg, 0, context);

  generateStatementFn(forOfStmt.body, context);

  setLabel(loopContinue, context);
  emitJump('JMP', 0, loopStart, context);

  setLabel(loopEnd, context);
  context.loopContextStack.pop();

  // Release temporaries
  context.registerAllocator.free(iterableReg);
  context.registerAllocator.free(iteratorReg);
  context.registerAllocator.free(hasNextReg);
}
