import { HttpClient, HttpError, HttpHeader, HttpRequest, HttpResponse, createClient, send } from "./http"
import { parseJsonText } from "./json_support"

export class OpenAIClient {
  http: HttpClient
  apiKey: string
  baseUrl: string
  model: string
}

export function createOpenAIClient(apiKey: string, model: string): OpenAIClient {
  return OpenAIClient {
    http: createClient(),
    apiKey,
    baseUrl: "https://api.openai.com/v1",
    model,
  }
}

export function createResponse(client: OpenAIClient, body: JSONValue): Result<JSONValue, string> {
  headers := buildHeaders(client.apiKey)
  request := HttpRequest {
    method: "POST",
    url: client.baseUrl + "/responses",
    headers,
    body: JSON.stringify(body),
    hasBody: true,
    timeoutMs: 60000,
    followRedirects: true,
  }

  return case send(client.http, request) {
    s: Success => parseHttpResponse(s.value),
    f: Failure => Failure(formatTransportError(f.error))
  }
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

function parseHttpResponse(response: HttpResponse): Result<JSONValue, string> {
  if !response.ok() {
    return Failure("OpenAI returned ${response.status} ${response.statusText}: ${response.body}")
  }

  return case parseJsonText(response.body) {
    parsed: Success => Success(parsed.value),
    failed: Failure => Failure("OpenAI returned invalid JSON: " + failed.error)
  }
}

function formatTransportError(error: HttpError): string {
  return "HTTP transport failed (${error.kind}/${error.code}): ${error.message}"
}