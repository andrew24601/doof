export type MaybeError = string | {
  message?: string;
  filename?: string;
  line?: number;
  column?: number;
  severity?: string;
};

function formatLocation(error: MaybeError): string {
  if (typeof error === 'string') {
    return '';
  }

  const segments: string[] = [];
  if (error.filename) {
    segments.push(String(error.filename));
  }
  if (typeof error.line === 'number') {
    segments.push(String(error.line));
  }
  if (typeof error.column === 'number') {
    segments.push(String(error.column));
  }
  return segments.join(':');
}

export function formatErrorMessage(error: MaybeError | undefined): string {
  if (!error) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  const location = formatLocation(error);
  const message = error.message ?? '';

  if (location && message) {
    return `${location}: ${message}`;
  }

  if (location) {
    return location;
  }

  if (message) {
    return message;
  }

  return JSON.stringify(error);
}

export function errorMessages(errors: MaybeError[] | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.map(error => formatErrorMessage(error));
}

export function firstErrorMessage(errors: MaybeError[] | undefined): string | undefined {
  const messages = errorMessages(errors);
  return messages[0];
}

export function errorsInclude(errors: MaybeError[] | undefined, substring: string): boolean {
  return errorMessages(errors).some(message => message.includes(substring));
}
