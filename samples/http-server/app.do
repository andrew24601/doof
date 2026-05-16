import { HttpHeader } from "std/http"
import { Request, Response } from "std/http-server"

function headerOr(headers: readonly HttpHeader[], name: string, fallback: string): string {
  lowerName := name.toLowerCase()
  for entry of headers {
    if entry.name.toLowerCase() == lowerName {
      return entry.value
    }
  }

  return fallback
}

function homePage(headers: readonly HttpHeader[]): Response {
  host := headerOr(headers, "Host", "(missing)")
  return Response.html(200, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Doof HTTP Sample</title>
  </head>
  <body>
    <h1>Doof HTTP sample</h1>
    <p>This page was rendered by Doof code.</p>
    <p>The request line and headers were parsed in Doof.</p>
    <p>Host header parsed in Doof: ${host}</p>
    <ul>
      <li><a href="/">/</a></li>
      <li><a href="/health">/health</a></li>
      <li><a href="/about">/about</a></li>
      <li><a href="/headers">/headers</a></li>
    </ul>
  </body>
</html>
`)
}

function healthPage(): Response {
  return Response.jsonValue(200, {
    status: "ok",
  })
}

function aboutPage(): Response {
  return Response.text(200, "Doof handles request parsing, header access, routing, and response generation; C++ only owns socket I/O and HTTP message framing.\n")
}

function headersPage(
  method: string,
  path: string,
  version: string,
  headers: readonly HttpHeader[],
  bodyText: string,
): Response {
  host := headerOr(headers, "Host", "(missing)")
  userAgent := headerOr(headers, "User-Agent", "(missing)")
  let body = "Method: ${method}\n"
  body += "Path: ${path}\n"
  body += "Version: ${version}\n"
  body += "Host: ${host}\n"
  body += "User-Agent: ${userAgent}\n"
  body += "Header count: ${headers.length}\n"
  body += "\nHeaders:\n"

  for header of headers {
    body += "${header.name}: ${header.value}\n"
  }

  if bodyText != "" {
    body += "\nBody:\n${bodyText}\n"
  }

  return Response.text(200, body)
}

function methodNotAllowed(method: string): Response {
  return Response.text(405, "Only GET is supported by this sample. Received ${method}.\n")
}

function notFound(path: string): Response {
  return Response.text(404, "No route for ${path}. Try /, /health, /about, or /headers.\n")
}

export function handleRequestParts(
  method: string,
  path: string,
  version: string,
  headers: readonly HttpHeader[],
  bodyText: string,
): Response {
  if method != "GET" {
    return methodNotAllowed(method)
  }

  return case path {
    "/" -> homePage(headers),
    "/health" -> healthPage(),
    "/about" -> aboutPage(),
    "/headers" -> headersPage(method, path, version, headers, bodyText),
    _ -> notFound(path)
  }
}

export function handleRequest(request: Request): Response {
  return handleRequestParts(
    request.method,
    request.path,
    request.version,
    request.headers,
    request.getText(),
  )
}