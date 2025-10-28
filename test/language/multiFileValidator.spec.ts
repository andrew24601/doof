import { describe, expect, it } from 'vitest';
import { validateFiles } from '../../vscode-extension/src/language/multiFileValidator';

describe('multi-file validator', () => {
  it('resolves imported classes across modules', () => {
    const projectRoot = '/virtual/project';
    const sourceRoot = `${projectRoot}/src`;
    const fooPath = `${sourceRoot}/Foo.do`;
    const samplePath = `${sourceRoot}/sample.do`;

    const fooContent = `export class Foo {
    x: int;
    y: int;
}
`;

    const sampleContent = `import { Foo } from "./Foo";

function main(): void {
    let foo: Foo;
}
`;

    const result = validateFiles(
      [
        { path: fooPath, content: fooContent },
        { path: samplePath, content: sampleContent }
      ],
      { sourceRoots: [sourceRoot] }
    );

    const sampleErrors = result.errorsByFile.get(samplePath) ?? [];
    const unknownTypeErrors = sampleErrors.filter(error => error.message.includes('Unknown type'));

    expect(unknownTypeErrors.length).toBe(0);
    expect(sampleErrors.length).toBe(0);
  });
});
