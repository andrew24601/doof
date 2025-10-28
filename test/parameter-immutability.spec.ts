import { describe, it, expect } from 'vitest';
import { transpileCode } from './util';

describe('Parameter immutability rules', () => {
  it('reports an error when assigning to a parameter', () => {
    const code = `
function demo(value: int): void {
  value = value + 1;
}
`;

    const result = transpileCode(code);
    expect(result.errors.some(error =>
      error.message.includes("Cannot assign to parameter 'value'")
    )).toBe(true);
  });

  it('reports an error when incrementing a parameter', () => {
    const code = `
function demo(value: int): void {
  value++;
}
`;

    const result = transpileCode(code);
    expect(result.errors.some(error =>
      error.message.includes("Cannot modify parameter 'value'")
    )).toBe(true);
  });

  it('allows copying parameters into locals for mutation', () => {
    const code = `
function demo(value: int): int {
  let current: int = value;
  current++;
  return current;
}
`;

    const result = transpileCode(code);
    expect(result.errors).toEqual([]);
  });
});
