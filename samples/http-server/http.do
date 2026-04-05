// Shared HTTP types for the simple server sample.

export import class NativeHttpServer from "./native_http_server.hpp" {
  port: int
  isReady(): bool
  errorMessage(): string
  nextRequest(): NativeRequest
}

export import class NativeRequest from "./native_http_server.hpp" {
  headerText: string
  body: string
  bodyText(): string
  setStatus(status: int): void
  addHeader(name: string, value: string): void
  send(body: string): void
}

export class HttpHeader {
  name: string
  value: string
}

export class HttpRequest {
  method: string
  path: string
  version: string
  headers: HttpHeader[]
  body: string

  header(name: string): string | null {
    lowerName := name.toLowerCase()
    for entry of headers {
      if entry.name.toLowerCase() == lowerName {
        return entry.value
      }
    }
    return null
  }

  headerOr(name: string, fallback: string): string {
    return this.header(name) ?? fallback
  }
}

export class HttpResponse {
  status: int
  contentType: string
  body: string
}

export function htmlResponse(status: int, body: string): HttpResponse {
  return HttpResponse {
    status,
    contentType: "text/html; charset=utf-8",
    body,
  }
}

export function jsonResponse(status: int, body: string): HttpResponse {
  return HttpResponse {
    status,
    contentType: "application/json; charset=utf-8",
    body,
  }
}

export function textResponse(status: int, body: string): HttpResponse {
  return HttpResponse {
    status,
    contentType: "text/plain; charset=utf-8",
    body,
  }
}

export function parseRequest(nativeRequest: NativeRequest): HttpRequest | null {
  lines := nativeRequest.headerText.split("\r\n")
  if lines.length == 0 {
    return null
  }

  requestLine := lines[0]
  firstSpace := requestLine.indexOf(" ")
  if firstSpace <= 0 {
    return null
  }

  remainder := requestLine.slice(firstSpace + 1)
  secondSpace := remainder.indexOf(" ")
  if secondSpace <= 0 {
    return null
  }

  method := requestLine.substring(0, firstSpace)
  path := remainder.substring(0, secondSpace)
  version := remainder.slice(secondSpace + 1).trim()
  if version == "" {
    return null
  }

  headers: HttpHeader[] := []
  for i of 1..<lines.length {
    line := lines[i]
    if line == "" {
      continue
    }

    separator := line.indexOf(":")
    if separator <= 0 {
      return null
    }

    name := line.substring(0, separator).trim()
    if name == "" {
      return null
    }

    value := line.slice(separator + 1).trim()
    headers.push(HttpHeader { name, value })
  }

  return HttpRequest {
    method,
    path,
    version,
    headers,
    body: nativeRequest.bodyText(),
  }
}

export function sendResponse(nativeRequest: NativeRequest, response: HttpResponse): void {
  nativeRequest.setStatus(response.status)
  nativeRequest.addHeader("Content-Type", response.contentType)
  nativeRequest.send(response.body)
}