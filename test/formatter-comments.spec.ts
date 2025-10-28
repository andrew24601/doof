import { describe, test, expect } from 'vitest';
import { formatDoofCode } from '../src/formatter';

describe('Formatter Comment and Blank Line Preservation', () => {
  test('preserves trailing comments on statements', () => {
    const input = `let x = 1; // initialize x
let y = 2; // initialize y
return 5; // return value`;

    const expected = `let x = 1; // initialize x
let y = 2; // initialize y
return 5; // return value
`;

    const result = formatDoofCode(input);
    expect(result).toBe(expected);
  });

  test('preserves standalone comments as blank statements', () => {
    const input = `let x = 1;

// standalone comment

let y = 2;`;

    const expected = `let x = 1;

// standalone comment

let y = 2;
`;

    const result = formatDoofCode(input);
    expect(result).toBe(expected);
  });

  test('folds multiple blank lines into single blank lines', () => {
    const input = `let x = 1;



let y = 2;`;

    const expected = `let x = 1;

let y = 2;
`;

    const result = formatDoofCode(input);
    expect(result).toBe(expected);
  });

  test('handles mixed comments and blank lines', () => {
    const input = `// Top comment
let x = 1; // trailing

// Middle comment


let y = 2;`;

    const expected = `// Top comment
let x = 1; // trailing

// Middle comment

let y = 2;
`;

    const result = formatDoofCode(input);
    expect(result).toBe(expected);
  });
});