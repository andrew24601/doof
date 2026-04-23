import { handleRequest } from "./app"
import { NativeHttpServer, parseRequest, sendResponse, textResponse } from "./http"

function main(): int {
  server := NativeHttpServer(8080)
  if !server.isReady() {
    println("Failed to start server: " + server.errorMessage())
    return 1
  }

  println("Listening on http://127.0.0.1:8080")
  println("Try: /, /health, /about")
  println("Press Ctrl+C to stop.")

  let requestCount = 0
  while true {
    request := server.nextRequest()
    parsed := parseRequest(request) else {
      request.addHeader("Connection", "close")
      sendResponse(request, textResponse(400, "Malformed HTTP request.\n"))
      continue
    }
    requestCount += 1
    response := handleRequest(parsed, requestCount)
    sendResponse(request, response)
  }

  return 0
}