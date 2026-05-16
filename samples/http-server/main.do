import { handleRequest } from "./app"
import { AsyncEventChannel, createMainAsyncEventChannel, runMainEventLoop } from "std/event"
import { Request, Server, ServerOptions } from "std/http-server"

function dispatchRequest(request: Request): void {
  response := handleRequest(request)
  try! request.respond(response)
}

function main(): int {
  requests: AsyncEventChannel<Request> := createMainAsyncEventChannel<Request>{
    handler: (request: Request): void => dispatchRequest(request),
    capacity: 256,
    keepsAlive: true,
  }

  server := Server.listen(ServerOptions { port: 8080 }, requests) else {
    println("Failed to start server: ${server.error.kind}: ${server.error.message}")
    return 1
  }

  println("Listening on http://${server.host}:${server.port}")
  println("Try: /, /health, /about")
  println("Press Ctrl+C to stop.")

  runMainEventLoop()

  try! server.close()

  return 0
}