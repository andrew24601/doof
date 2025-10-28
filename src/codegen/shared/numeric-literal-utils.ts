export interface FloatingLiteralParts {
  integral: string;
  fractional: string;
  isNegative: boolean;
  hasFloatSuffix: boolean;
}

export function isIntegerLiteral(expression: string): boolean {
  const trimmed = expression.trim();
  if (!trimmed.length) {
    return false;
  }

  let index = 0;
  if (trimmed[index] === '-') {
    index += 1;
    if (index === trimmed.length) {
      return false;
    }
  }

  for (; index < trimmed.length; index += 1) {
    if (!isDecimalDigit(trimmed[index])) {
      return false;
    }
  }

  return true;
}

export function isFloatingLiteral(expression: string): boolean {
  return splitFloatingLiteral(expression) !== null;
}

export function isFloatingLiteralWithZeroFraction(expression: string): boolean {
  const parts = splitFloatingLiteral(expression);
  if (!parts) {
    return false;
  }
  return parts.fractional.split("").every((digit) => digit === '0');
}

export function endsWithFloatSuffix(expression: string): boolean {
  const trimmed = expression.trim();
  return trimmed.endsWith('f') || trimmed.endsWith('F');
}

export function splitFloatingLiteral(expression: string): FloatingLiteralParts | null {
  const trimmed = expression.trim();
  if (!trimmed.length) {
    return null;
  }

  let start = 0;
  let isNegative = false;

  if (trimmed[start] === '-') {
    isNegative = true;
    start += 1;
    if (start === trimmed.length) {
      return null;
    }
  }

  let end = trimmed.length;
  let hasFloatSuffix = false;
  const suffixChar = trimmed[trimmed.length - 1];
  if (suffixChar === 'f' || suffixChar === 'F') {
    hasFloatSuffix = true;
    end -= 1;
    if (end === start) {
      return null;
    }
  }

  const core = trimmed.slice(start, end);
  const dotIndex = core.indexOf('.');
  if (dotIndex <= 0 || dotIndex === core.length - 1) {
    return null;
  }

  const integral = core.slice(0, dotIndex);
  const fractional = core.slice(dotIndex + 1);

  if (!isAllDecimalDigits(integral) || !isAllDecimalDigits(fractional)) {
    return null;
  }

  return { integral, fractional, hasFloatSuffix, isNegative };
}

function isAllDecimalDigits(value: string): boolean {
  if (!value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isDecimalDigit(value[index])) {
      return false;
    }
  }
  return true;
}

function isDecimalDigit(char: string): boolean {
  if (char.length !== 1) {
    return false;
  }
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}
