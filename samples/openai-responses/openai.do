import { HttpClient, HttpError, HttpHeader, HttpRequest, HttpResponse, createClient, send } from "./http"
import { jsonArrayValues, jsonIsArray, jsonIsNull, jsonIsObject, jsonObjectGet, jsonStringValue } from "./json_bridge"
import { parseJsonText } from "./json_support"
import { parseJsonValue, formatJsonValue } from "std/json"

export class OpenAIClient {
  http: HttpClient
  apiKey: string
  baseUrl: string
  model: string
}

export class OpenAIToolCall {
  callId: string
  name: string
  args: JsonValue
}

export function createOpenAIClient(apiKey: string, model: string): OpenAIClient {
  return OpenAIClient {
    http: createClient(),
    apiKey,
    baseUrl: "https://api.openai.com/v1",
    model,
  }
}

export function createResponse(client: OpenAIClient, body: JsonValue): Result<JsonValue, string> {
  headers := buildHeaders(client.apiKey)
  request := HttpRequest {
    method: "POST",
    url: client.baseUrl + "/responses",
    headers,
    body: formatJsonValue(body),
    hasBody: true,
    timeoutMs: 60000,
    followRedirects: true,
  }

  return case send(client.http, request) {
    s: Success -> parseHttpResponse(s.value),
    f: Failure -> Failure(formatTransportError(f.error))
  }
}

export function createInitialToolResponse(
  client: OpenAIClient,
  instructions: string,
  input: string,
  tools: JsonValue[],
): Result<JsonValue, string> {
  return createResponse(client, {
    model: client.model,
    instructions,
    input,
    tools,
    tool_choice: "auto",
  })
}

export function createToolFollowUpResponse(
  client: OpenAIClient,
  previousResponseId: string,
  outputs: JsonValue[],
): Result<JsonValue, string> {
  return createResponse(client, {
    model: client.model,
    previous_response_id: previousResponseId,
    input: outputs,
  })
}

export function toolOutput(callId: string, value: JsonValue): JsonValue {
  return {
    "type": "function_call_output",
    call_id: callId,
    output: formatJsonValue(value),
  }
}

export function toolErrorOutput(callId: string, error: JsonValue): JsonValue {
  return toolOutput(callId, { error: toolErrorText(error) })
}

export function extractResponseId(response: JsonValue): string | null {
  if !jsonIsObject(response) {
    return null
  }

  return jsonStringValue(jsonObjectGet(response, "id"))
}

export function extractToolCalls(response: JsonValue): Result<OpenAIToolCall[], string> {
  if !jsonIsObject(response) {
    return Failure("OpenAI response was not an object")
  }

  output := jsonObjectGet(response, "output")
  if jsonIsNull(output) {
    emptyCalls: OpenAIToolCall[] := []
    return Success { value: emptyCalls }
  }

  if !jsonIsArray(output) {
    return Failure("OpenAI response field \"output\" was not an array")
  }

  return collectToolCalls(jsonArrayValues(output))
}

export function extractAssistantText(response: JsonValue): string | null {
  if !jsonIsObject(response) {
    return null
  }

  topLevel := jsonStringValue(jsonObjectGet(response, "output_text"))
  if topLevel != null && topLevel != "" {
    return topLevel
  }

  output := jsonObjectGet(response, "output")
  if !jsonIsArray(output) {
    return null
  }

  return collectAssistantText(jsonArrayValues(output))
}

function buildHeaders(apiKey: string): HttpHeader[] {
  headers: HttpHeader[] := []
  headers.push(HttpHeader {
    name: "Authorization",
    value: "Bearer " + apiKey,
  })
  headers.push(HttpHeader {
    name: "Content-Type",
    value: "application/json",
  })
  return headers
}

function parseHttpResponse(response: HttpResponse): Result<JsonValue, string> {
  if !response.ok() {
    return Failure("OpenAI returned ${response.status} ${response.statusText}: ${response.body}")
  }

  return case parseJsonText(response.body) {
    parsed: Success -> Success(parsed.value),
    failed: Failure -> Failure("OpenAI returned invalid JSON: " + failed.error)
  }
}

function formatTransportError(error: HttpError): string {
  return "HTTP transport failed (${error.kind}/${error.code}): ${error.message}"
}

function collectToolCalls(items: JsonValue[]): Result<OpenAIToolCall[], string> {
  calls: OpenAIToolCall[] := []

  for item of items {
    if !jsonIsObject(item) {
      continue
    }

    itemType := jsonStringValue(jsonObjectGet(item, "type"))
    if itemType != "function_call" {
      continue
    }

    callId := jsonStringValue(jsonObjectGet(item, "call_id"))
    name := jsonStringValue(jsonObjectGet(item, "name"))
    argumentsText := jsonStringValue(jsonObjectGet(item, "arguments"))

    if callId == null || name == null || argumentsText == null {
      return Failure("OpenAI returned a function_call item without call_id, name, or arguments")
    }

    case parseJsonValue(argumentsText!) {
      parsed: Success -> {
        calls.push(OpenAIToolCall {
          callId: callId!,
          name: name!,
          args: parsed.value,
        })
      }
      failed: Failure -> {
        return Failure("OpenAI returned invalid JSON arguments for ${name!}: ${failed.error}")
      }
    }
  }

  return Success(calls)
}

function toolErrorText(error: JsonValue): string {
  return case error {
    value: string -> value,
    _ -> "Tool call failed"
  }
}

function joinWithNewlines(parts: string[]): string {
  let text = ""
  let index = 0

  while index < parts.length {
    if text != "" {
      text += "\n"
    }
    text += parts[index]
    index += 1
  }

  return text
}

function collectMessageContent(parts: string[], contentItems: JsonValue[]): void {
  for contentItem of contentItems {
    if !jsonIsObject(contentItem) {
      continue
    }

    partType := jsonStringValue(jsonObjectGet(contentItem, "type"))
    if partType != "output_text" && partType != "text" {
      continue
    }

    text := jsonStringValue(jsonObjectGet(contentItem, "text"))
    if text != null && text != "" {
      parts.push(text!)
    }
  }
}

function collectAssistantText(items: JsonValue[]): string | null {
  parts: string[] := []

  for item of items {
    if !jsonIsObject(item) {
      continue
    }

    if jsonStringValue(jsonObjectGet(item, "type")) != "message" {
      continue
    }

    content := jsonObjectGet(item, "content")
    if jsonIsArray(content) {
      collectMessageContent(parts, jsonArrayValues(content))
    }
  }

  if parts.length == 0 {
    return null
  }
  return joinWithNewlines(parts)
}
