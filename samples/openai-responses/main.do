import {
  OpenAIToolCall,
  createInitialToolResponse,
  createOpenAIClient,
  createToolFollowUpResponse,
  extractAssistantText,
  extractResponseId,
  extractToolCalls,
  toolErrorOutput,
  toolOutput,
} from "./openai"
import { invokeWeeknightTool, openAITools, WeeknightKitchenTools } from "./tools"
import { formatJsonValue } from "std/json"

export import class NativeEnv from "./native_env.hpp" {
  get(name: string): string
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
  let current: JsonValue = null
  case createInitialToolResponse(
    client,
    "You are a concise assistant. Use the provided tools when they are relevant, and ground any tool-backed facts in the tool outputs.",
    prompt,
    openAITools(),
  ) {
    s: Success -> {
      current = s.value
    }
    f: Failure -> {
      println("OpenAI request failed: " + f.error)
      return 1
    }
  }
  let round = 0

  while round < 4 {
    let calls: OpenAIToolCall[] = []
    case extractToolCalls(current) {
      s: Success -> {
        calls = s.value
      }
      f: Failure -> {
        println("Could not parse tool calls: " + f.error)
        return 1
      }
    }

    if calls.length == 0 {
      println("Assistant:")
      println(extractAssistantText(current) ?? formatJsonValue(current))
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
    case createToolFollowUpResponse(client, responseId!, outputs) {
      s: Success -> {
        current = s.value
      }
      f: Failure -> {
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
  if args.length == 0 {
    return false
  }
  return args[0] == "--help" || args[0] == "-h"
}

function printUsage(args: string[]): void {
  program := "openai-responses"
  println("Usage: ${program} [prompt words...]")
  println("Environment:")
  println("  OPENAI_API_KEY  required")
  println("  OPENAI_MODEL    optional, defaults to ${defaultModel()}")
}

function promptFromArgs(args: string[]): string {
  if args.length == 0 {
    return ""
  }

  let prompt = ""
  let index = 0
  while index < args.length {
    if prompt != "" {
      prompt += " "
    }
    prompt += args[index]
    index += 1
  }
  return prompt
}

function toolErrorText(error: JsonValue): string {
  return case error {
    value: string -> value,
    _ -> "Tool call failed"
  }
}

function executeToolCalls(tools: WeeknightKitchenTools, calls: OpenAIToolCall[]): JsonValue[] {
  outputs: JsonValue[] := []

  for call of calls {
    println("- ${call.name}(${formatJsonValue(call.args)})")
    case invokeWeeknightTool(tools, call.name, call.args) {
      s: Success -> {
        outputText := formatJsonValue(s.value)
        println("  -> ${outputText}")
        outputs.push(toolOutput(call.callId, s.value))
      }
      f: Failure -> {
        errorText := toolErrorText(f.error)
        println("  -> error: ${errorText}")
        outputs.push(toolErrorOutput(call.callId, f.error))
      }
    }
  }

  return outputs
}
