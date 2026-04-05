// Shared HTTP client types and a small Doof-first wrapper around a libcurl bridge.

export import class NativeHttpClient from "./native_http_client.hpp" {
  perform(method: string, url: string, requestHeaders: string, body: string,
          hasBody: bool, timeoutMs: int, followRedirects: bool): Result<int, string>
  responseStatusText(): string
  responseHeadersText(): string
  responseBodyText(): string
}

export class HttpHeader {
  name: string
  value: string
}

export class HttpRequest {
  method: string
  url: string
  headers: HttpHeader[]
  body: string
  hasBody: bool
  timeoutMs: int
  followRedirects: bool

  header(name: string): string | null {
    lowerName := name.toLowerCase()
    for entry of headers {
      if entry.name.toLowerCase() == lowerName {
        return entry.value
      }
    }
    return null
  }
}

export class HttpResponse {
  status: int
  statusText: string
  headers: HttpHeader[]
  body: string

  ok(): bool {
    return this.status >= 200 && this.status < 300
  }

  header(name: string): string | null {
    lowerName := name.toLowerCase()
    for entry of headers {
      if entry.name.toLowerCase() == lowerName {
        return entry.value
      }
    }
    return null
  }
}

export class HttpError {
  kind: string
  code: string
  message: string
}

export class HttpClient {
  native: NativeHttpClient
}

export function createClient(): HttpClient {
  return HttpClient {
    native: NativeHttpClient(),
  }
}

export function send(client: HttpClient, request: HttpRequest): Result<HttpResponse, HttpError> {
  nativeResult := client.native.perform(
    request.method,
    request.url,
    renderHeaders(request.headers),
    request.body,
    request.hasBody,
    request.timeoutMs,
    request.followRedirects,
  )

  return case nativeResult {
    s: Success => Success {
      value: HttpResponse {
        status: s.value,
        statusText: client.native.responseStatusText(),
        headers: parseHeaders(client.native.responseHeadersText()),
        body: client.native.responseBodyText(),
      }
    },
    f: Failure => Failure {
      error: parseError(f.error)
    }
  }
}

function renderHeaders(headers: HttpHeader[]): string {
  let text = ""
  for header of headers {
    text += "${header.name}: ${header.value}\r\n"
  }
  return text
}

function parseHeaders(headerText: string): HttpHeader[] {
  headers: HttpHeader[] := []
  lines := headerText.split("\r\n")
  for line of lines {
    if line == "" {
      continue
    }

    separator := line.indexOf(":")
    if separator <= 0 {
      continue
    }

    headers.push(HttpHeader {
      name: line.substring(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    })
  }
  return headers
}

function parseError(raw: string): HttpError {
  firstSeparator := raw.indexOf("|")
  if firstSeparator < 0 {
    return HttpError {
      kind: "transport",
      code: "0",
      message: raw,
    }
  }

  remainder := raw.slice(firstSeparator + 1)
  secondSeparator := remainder.indexOf("|")
  if secondSeparator < 0 {
    return HttpError {
      kind: raw.substring(0, firstSeparator),
      code: "0",
      message: remainder,
    }
  }

  kind := raw.substring(0, firstSeparator)
  codeText := remainder.substring(0, secondSeparator)
  message := remainder.slice(secondSeparator + 1)

  return HttpError {
    kind,
    code: codeText,
    message,
  }
}