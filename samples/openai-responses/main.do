import { createOpenAIClient, createResponse } from "./openai"
import { jsonArrayValues, jsonIsArray, jsonIsObject, jsonObjectGet, jsonStringValue } from "./json_bridge"
import { invokeWeeknightTool, openAITools, WeeknightKitchenTools } from "./tools"

export import class NativeEnv from "./native_env.hpp" {
  get(name: string): string
}

class PendingToolCall {
  callId: string
  name: string
  args: JSONValue
}

function defaultModel(): string {
  return "gpt-4.1-mini"
}

function defaultPrompt(): string {
  return "Use the tools to plan a 20-minute vegetarian dinner from the pantry and convert 200C to Fahrenheit."
}

function main(args: string[]): int {
  if hasHelpFlag(args) {
    printUsage(args)
    return 0
  }

  env := NativeEnv()
  apiKey := env.get("OPENAI_API_KEY")
  if apiKey == "" {
    println("Set OPENAI_API_KEY before running this sample.")
    return 1
  }

  let model = env.get("OPENAI_MODEL")
  if model == "" {
    model = defaultModel()
  }

  let prompt = promptFromArgs(args)
  if prompt == "" {
    prompt = defaultPrompt()
  }

  println("Model: " + model)
  println("Prompt: " + prompt)
  println("")

  client := createOpenAIClient(apiKey, model)
  tools := WeeknightKitchenTools { }
  let current: JSONValue = null
  case createResponse(client, {
    model,
    instructions: "You are a concise assistant. Use the provided tools when they are relevant, and ground any tool-backed facts in the tool outputs.",
    input: prompt,
    tools: openAITools(),
    tool_choice: "auto",
  }) {
    s: Success => {
      current = s.value
    }
    f: Failure => {
      println("OpenAI request failed: " + f.error)
      return 1
    }
  }
  let round = 0

  while round < 4 {
    let calls: PendingToolCall[] = []
    case extractToolCalls(current) {
      s: Success => {
        calls = s.value
      }
      f: Failure => {
        println("Could not parse tool calls: " + f.error)
        return 1
      }
    }

    if calls.length == 0 {
      println("Assistant:")
      println(extractAssistantText(current) ?? JSON.stringify(current))
      return 0
    }

    println("Tool round ${round + 1}:")
    outputs := executeToolCalls(tools, calls)
    responseId := extractResponseId(current)
    if responseId == null {
      println("OpenAI response did not include an id for the follow-up tool result request.")
      return 1
    }

    println("")
    case createResponse(client, {
      model,
      previous_response_id: responseId!,
      input: outputs,
    }) {
      s: Success => {
        current = s.value
      }
      f: Failure => {
        println("OpenAI request failed: " + f.error)
        return 1
      }
    }
    round += 1
  }

  println("Stopped after 4 tool rounds without receiving a final assistant message.")
  return 1
}

function hasHelpFlag(args: string[]): bool {
  if args.length <= 1 {
    return false
  }
  return args[1] == "--help" || args[1] == "-h"
}

function printUsage(args: string[]): void {
  program := if args.length > 0 then args[0] else "./build-openai-responses/a.out"
  println("Usage: ${program} [prompt words...]")
  println("Environment:")
  println("  OPENAI_API_KEY  required")
  println("  OPENAI_MODEL    optional, defaults to ${defaultModel()}")
}

function promptFromArgs(args: string[]): string {
  if args.length <= 1 {
    return ""
  }

  let prompt = ""
  let index = 1
  while index < args.length {
    if prompt != "" {
      prompt += " "
    }
    prompt += args[index]
    index += 1
  }
  return prompt
}

function extractResponseId(response: JSONValue): string | null {
  if !jsonIsObject(response) {
    return null
  }

  return jsonStringValue(jsonObjectGet(response, "id"))
}

function collectToolCalls(items: JSONValue[]): Result<PendingToolCall[], string> {
  calls: PendingToolCall[] := []

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

    case JSON.parse(argumentsText!) {
      parsed: Success => {
        calls.push(PendingToolCall {
          callId: callId!,
          name: name!,
          args: parsed.value,
        })
      }
      failed: Failure => {
        return Failure("OpenAI returned invalid JSON arguments for ${name!}: ${failed.error}")
      }
    }
  }

  return Success(calls)
}

function extractToolCalls(response: JSONValue): Result<PendingToolCall[], string> {
  if !jsonIsObject(response) {
    return Failure("OpenAI response was not an object")
  }

  output := jsonObjectGet(response, "output")
  case output {
    null => {
      emptyCalls: PendingToolCall[] := []
      return Success { value: emptyCalls }
    }
    _ => {
    }
  }

  if !jsonIsArray(output) {
    return Failure("OpenAI response field \"output\" was not an array")
  }

  return collectToolCalls(jsonArrayValues(output))
}

function toolErrorText(error: any): string {
  return case error {
    value: string => value,
    _ => "Tool call failed"
  }
}

function executeToolCalls(tools: WeeknightKitchenTools, calls: PendingToolCall[]): JSONValue[] {
  outputs: JSONValue[] := []

  for call of calls {
    println("- ${call.name}(${JSON.stringify(call.args)})")
    case invokeWeeknightTool(tools, call.name, call.args) {
      s: Success => {
        outputText := JSON.stringify(s.value)
        println("  -> ${outputText}")
        outputs.push({
          "type": "function_call_output",
          call_id: call.callId,
          output: outputText,
        })
      }
      f: Failure => {
        errorText := toolErrorText(f.error)
        println("  -> error: ${errorText}")
        outputs.push({
          "type": "function_call_output",
          call_id: call.callId,
          output: JSON.stringify({ error: errorText }),
        })
      }
    }
  }

  return outputs
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

function collectMessageContent(parts: string[], contentItems: JSONValue[]): void {
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

function collectAssistantText(items: JSONValue[]): string | null {
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

function extractAssistantText(response: JSONValue): string | null {
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