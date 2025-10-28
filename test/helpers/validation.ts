import { Validator } from '../../src/validation/validator';
import type { Program, ValidationContext } from '../../src/types';

type TestValidationOptions = {
  allowErrors?: boolean;
};

export function validateProgramForTests(program: Program, options: TestValidationOptions = {}): ValidationContext {
  const validator = new Validator({ allowTopLevelStatements: true });
  if (!program.filename) {
    (program as any).filename = 'test.do';
  }
  const context = validator.validate(program);
  if (!options.allowErrors && context.errors.length > 0) {
    const details = context.errors.map(error => error.message).join('\n');
    throw new Error(`Validation failed for test program:\n${details}`);
  }
  return context;
}
