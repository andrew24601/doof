interface PrinterResultOptions {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
}

export class Printer {
  private output: string[] = [];
  private indentLevel = 0;
  private currentLineLength = 0;

  constructor(private readonly indentSize: number) {}

  reset(): void {
    this.output = [];
    this.indentLevel = 0;
    this.currentLineLength = 0;
  }

  write(text: string): void {
    if (text.length === 0) {
      return;
    }
    this.output.push(text);
    this.currentLineLength += text.length;
  }

  writeLine(text: string = ''): void {
    if (text.length > 0) {
      this.output.push(text);
    }
    this.output.push('\n');
    this.currentLineLength = 0;
  }

  writeIndent(): void {
    if (this.indentLevel <= 0) {
      return;
    }
    this.write(' '.repeat(this.indentLevel * this.indentSize));
  }

  increaseIndent(): void {
    this.indentLevel += 1;
  }

  decreaseIndent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }

  getCurrentLineLength(): number {
    return this.currentLineLength;
  }

  getResult(options: PrinterResultOptions): string {
    let result = this.output.join('');

    if (options.trimTrailingWhitespace) {
      result = result.replace(/[ \t]+$/gm, '');
    }

    if (options.insertFinalNewline && !result.endsWith('\n')) {
      result += '\n';
    }

    return result;
  }
}
