export interface FormatterOptions {
  indentSize: number;
  maxLineLength: number;
  insertFinalNewline: boolean;
  trimTrailingWhitespace: boolean;
  insertSpaceAfterKeywords: boolean;
  insertSpaceBeforeBlockBrace: boolean;
  insertSpaceAfterComma: boolean;
  insertSpaceAroundBinaryOperators: boolean;
  breakLongArrays: boolean;
  breakLongObjects: boolean;
  breakLongFunctionParameters: boolean;
  alignObjectProperties: boolean;
}

export const DEFAULT_FORMATTER_OPTIONS: FormatterOptions = {
  indentSize: 4,
  maxLineLength: 100,
  insertFinalNewline: true,
  trimTrailingWhitespace: true,
  insertSpaceAfterKeywords: true,
  insertSpaceBeforeBlockBrace: true,
  insertSpaceAfterComma: true,
  insertSpaceAroundBinaryOperators: true,
  breakLongArrays: true,
  breakLongObjects: true,
  breakLongFunctionParameters: true,
  alignObjectProperties: false,
};
