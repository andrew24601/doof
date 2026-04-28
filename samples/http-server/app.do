import { HttpRequest, HttpResponse, htmlResponse, jsonResponse, textResponse } from "./http"

function homePage(request: HttpRequest, requestCount: int): HttpResponse {
  host := request.headerOr("Host", "(missing)")
  return htmlResponse(200, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Doof HTTP Sample</title>
  </head>
  <body>
    <h1>Doof HTTP sample</h1>
    <p>This page was rendered by Doof code.</p>
    <p>The request line and headers were parsed in Doof.</p>
    <p>Requests served in this process: ${requestCount}</p>
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

function healthPage(requestCount: int): HttpResponse {
  return jsonResponse(200, "{\"status\":\"ok\",\"served\":${requestCount}}")
}

function aboutPage(): HttpResponse {
  return textResponse(200, "Doof handles request parsing, header access, routing, and response generation; C++ only owns socket I/O and HTTP message framing.\n")
}

function headersPage(request: HttpRequest): HttpResponse {
  host := request.headerOr("Host", "(missing)")
  userAgent := request.headerOr("User-Agent", "(missing)")
  let body = "Method: ${request.method}\n"
  body += "Path: ${request.path}\n"
  body += "Version: ${request.version}\n"
  body += "Host: ${host}\n"
  body += "User-Agent: ${userAgent}\n"
  body += "Header count: ${request.headers.length}\n"
  body += "\nHeaders:\n"

  for header of request.headers {
    body += "${header.name}: ${header.value}\n"
  }

  if request.body != "" {
    body += "\nBody:\n${request.body}\n"
  }

  return textResponse(200, body)
}

function methodNotAllowed(method: string): HttpResponse {
  return textResponse(405, "Only GET is supported by this sample. Received ${method}.\n")
}

function notFound(path: string): HttpResponse {
  return textResponse(404, "No route for ${path}. Try /, /health, /about, or /headers.\n")
}

export function handleRequest(request: HttpRequest, requestCount: int): HttpResponse {
  if request.method != "GET" {
    return methodNotAllowed(request.method)
  }

  return case request.path {
    "/" -> homePage(request, requestCount),
    "/health" -> healthPage(requestCount),
    "/about" -> aboutPage(),
    "/headers" -> headersPage(request),
    _ -> notFound(request.path)
  }
}