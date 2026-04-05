# OpenAI Responses API Sample

This sample sends a request to the OpenAI Responses API and exposes a normal Doof class as tool definitions by reflecting over `WeeknightKitchenTools.metadata`.

## What It Covers

- building OpenAI `tools` entries directly from Doof metadata
- dispatching returned `function_call` items through `Class.metadata.invoke(...)`
- posting follow-up `function_call_output` items back to the Responses API
- keeping the transport layer small with the existing libcurl-backed native HTTP bridge pattern

The sample keeps the tools intentionally local and deterministic so the focus stays on the metadata-driven integration rather than on an external business API.

## Files

- `main.do` runs the Responses API loop and forwards tool calls back into Doof.
- `tools.do` defines the tool class plus a few JSON-serializable return types.
- `openai.do` builds and sends authenticated Responses API requests.
- `http.do` and `native_http_client.hpp` provide the synchronous HTTP transport.
- `json_bridge.do` and `native_json_bridge.hpp` provide small JSON object/array inspection helpers for walking Responses API payloads.
- `native_env.hpp` reads `OPENAI_API_KEY` and `OPENAI_MODEL` from the environment.

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
build-openai-responses/a.out "Use the tools to plan a quick vegetarian dinner and convert 200C to Fahrenheit."
```

Optionally override the model:

```bash
OPENAI_MODEL=gpt-4.1 build-openai-responses/a.out "Use the tools to plan dinner."
```

## How It Works

`WeeknightKitchenTools.metadata` exposes method names, descriptions, and JSON Schemas. `tools.do` converts each reflected method into an OpenAI tool entry shaped like:

```json
{
  "type": "function",
  "name": "suggestDinner",
  "description": "Suggests a dinner idea using a pantry ingredient and a time budget.",
  "parameters": { "type": "object", "properties": { ... } }
}
```

When OpenAI returns `function_call` items, `main.do` parses the `arguments` JSON, invokes the matching Doof method with `WeeknightKitchenTools.metadata.invoke(...)`, serializes the tool result, and sends a follow-up Responses API request with `function_call_output` items.

That means the same class descriptions and method signatures power both the tool schema and the runtime dispatch path.