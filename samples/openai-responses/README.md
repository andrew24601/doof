# OpenAI Responses API Package Sample

This sample is structured as a small reusable OpenAI Responses API package plus
a concrete executable example. The package code owns HTTP transport, Responses
request construction, response parsing, tool-call extraction, and follow-up tool
output formatting. The sample-specific kitchen tools stay in `tools.do`.

## What It Covers

- building OpenAI `tools` entries directly from Doof metadata
- dispatching returned `function_call` items through `Class.metadata.invoke(...)`
- posting follow-up `function_call_output` items back to the Responses API
- keeping the transport layer small with the existing libcurl-backed native HTTP bridge pattern

The sample keeps the tools intentionally local and deterministic so the focus
stays on the metadata-driven integration rather than on an external business
API.

## Files

- `doof.json` declares the package name and native build inputs.
- `index.do` re-exports the reusable package surface.
- `openai.do` builds authenticated Responses requests, parses Responses payloads, and formats follow-up tool outputs.
- `main.do` runs the executable sample loop and logs tool calls.
- `tools.do` defines the sample tool class, JSON-serializable return types, and the concrete metadata adapter for `WeeknightKitchenTools`.
- `http.do` and `native_http_client.hpp` provide the synchronous HTTP transport.
- `json_bridge.do` and `native_json_bridge.hpp` provide small JSON object/array inspection helpers for walking Responses API payloads.
- `native_env.hpp` reads `OPENAI_API_KEY` and `OPENAI_MODEL` from the environment.

## Reuse

Import the package facade when another package wants the Responses primitives:

```doof
import {
  createInitialToolResponse,
  createOpenAIClient,
  createToolFollowUpResponse,
  extractAssistantText,
  extractResponseId,
  extractToolCalls,
  toolErrorOutput,
  toolOutput,
} from "openai-responses"
```

Domain modules provide their own reflected tool adapter. `tools.do` shows the
pattern: iterate over `MyTools.metadata.methods` to create OpenAI tool schemas,
then invoke returned tool calls with `MyTools.metadata.invoke(...)`.

## Build

From the repository root:

```bash
samples/openai-responses/build.sh
```

Or build and run immediately:

```bash
samples/openai-responses/build.sh --run
```

The script uses `curl-config` when available so it can pick up the right include paths and link flags for libcurl.

## Run

Set your API key first:

```bash
export OPENAI_API_KEY=...
```

Then run the binary with a prompt, or omit the prompt to use the built-in example:

```bash
build-openai-responses/debug/a.out "Use the tools to plan a quick vegetarian dinner and convert 200C to Fahrenheit."
```

Optionally override the model:

```bash
OPENAI_MODEL=gpt-4.1 build-openai-responses/debug/a.out "Use the tools to plan dinner."
```

## How It Works

`WeeknightKitchenTools.metadata` exposes method names, descriptions, and JSON
Schemas. `tools.do` converts each reflected method into an OpenAI tool entry
shaped like:

```json
{
  "type": "function",
  "name": "suggestDinner",
  "description": "Suggests a dinner idea using a pantry ingredient and a time budget.",
  "parameters": { "type": "object", "properties": { ... } }
}
```

When OpenAI returns `function_call` items, `openai.do` parses the `arguments`
JSON, `main.do` invokes the matching Doof method with
`WeeknightKitchenTools.metadata.invoke(...)`, and the reusable helpers serialize
the tool result into `function_call_output` items for the follow-up request.

That means the same class descriptions and method signatures power both the tool schema and the runtime dispatch path.
