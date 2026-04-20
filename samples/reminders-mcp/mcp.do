import { parseJsonText } from "./json_support"
import { RemindersTools, toolsListResultJson } from "./reminders"
import { formatJsonValue } from "std/json"

export import class NativeMcpServer from "./native_mcp_stdio.hpp" {
  isOpen(): bool
  nextRequest(): NativeMcpRequest
  sendResult(requestIdJson: string, resultJson: string): void
  sendError(requestIdJson: string, code: int, message: string): void
  log(message: string): void
}

export import class NativeMcpRequest from "./native_mcp_stdio.hpp" {
  kind: string
  requestIdJson: string
  method: string
  toolName: string
  argsJson: string
  protocolVersion: string
  errorCode: int
  errorMessage: string
  hasRequestId(): bool
}

function chooseProtocolVersion(requestedVersion: string): string {
  if requestedVersion != "" {
    return requestedVersion
  }

  return "2025-11-25"
}

function initializeResultJson(requestedVersion: string): string {
  version := chooseProtocolVersion(requestedVersion)
  return formatJsonValue({
    protocolVersion: version,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: "doof-reminders-mcp",
      version: "0.1.0",
    },
  })
}

function callToolResultJson(isError: bool, text: string): string {
  return formatJsonValue({
    content: [{
      "type": "text",
      text: text,
    }],
    isError: isError,
  })
}

function toolErrorText(error: JsonValue): string {
  return formatJsonValue(error)
}

function invokeToolCallResultJson(tools: RemindersTools, toolName: string, argsJson: string): string {
  return case parseJsonText(argsJson) {
    s: Success => case RemindersTools.metadata.invoke(tools, toolName, s.value) {
      value: Success => callToolResultJson(false, formatJsonValue(value.value)),
      error: Failure => callToolResultJson(true, toolErrorText(error.error))
    },
    f: Failure => callToolResultJson(true, "Invalid tool args JSON: " + f.error)
  }
}

export function runServer(): int {
  server := NativeMcpServer()
  tools := RemindersTools { }

  while server.isOpen() {
    request := server.nextRequest()

    case request.kind {
      "eof" => {
        return 0
      }
      "parse-error" => {
        if request.hasRequestId() {
          server.sendError(request.requestIdJson, request.errorCode, request.errorMessage)
        } else {
          server.log("parse error: " + request.errorMessage)
        }
      }
      "initialized-notification" | "notification" => {
      }
      "initialize" => {
        server.sendResult(request.requestIdJson, initializeResultJson(request.protocolVersion))
      }
      "tools-list" => {
        server.sendResult(request.requestIdJson, toolsListResultJson())
      }
      "tools-call" => {
        server.sendResult(request.requestIdJson, invokeToolCallResultJson(tools, request.toolName, request.argsJson))
      }
      "unknown-request" => {
        server.sendError(request.requestIdJson, -32601, "Method not found: " + request.method)
      }
      _ => {
        server.log("ignoring unexpected MCP frame kind: " + request.kind)
      }
    }
  }

  return 0
}