import { HttpError, HttpResponse, createClient, get } from "http"

function formatResponse(response: HttpResponse): string {
  server := response.header("Server") ?? "(missing)"
  contentType := response.header("Content-Type") ?? "(missing)"
  bodyText := response.getText()
  let text = "Status: ${response.status} ${response.statusText}\n"
  text += "OK: ${response.ok()}\n"
  text += "Server: ${server}\n"
  text += "Content-Type: ${contentType}\n"
  text += "Header count: ${response.headers.length}\n"
  text += "Body bytes: ${response.getBlob().length}\n"
  text += "\nBody preview:\n"
  text += bodyText.substring(0, 240)
  if bodyText.length > 240 {
    text += "\n..."
  }
  return text
}

function formatError(error: HttpError): string {
  return "Request failed [${error.kind}, code=${error.code}]: ${error.message}"
}

function main(): int {
  client := createClient()
  result := get(client, "https://example.com")

  println(case result {
    s: Success => formatResponse(s.value),
    f: Failure => formatError(f.error)
  })

  return case result {
    s: Success => 0,
    f: Failure => 1
  }
}