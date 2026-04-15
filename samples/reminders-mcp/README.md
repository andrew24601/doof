# Reminders MCP Sample

This sample exposes the macOS Reminders database through an MCP server written in Doof. The server still speaks plain MCP over stdin/stdout, but the recommended launch target is the executable inside a minimal app bundle so EventKit permission prompts have a stable bundle identity and an `Info.plist` usage string.

## What It Covers

- `initialize`, `tools/list`, and `tools/call` over newline-delimited JSON on stdin/stdout
- accepts legacy `Content-Length` framed input as a fallback for manual probing
- explicit Reminders authorization via a `requestAccess` tool
- reminder list discovery plus create, update, complete, and delete flows
- a Swift EventKit bridge wrapped behind Doof `import class` declarations

## Build

Requirements:

- macOS 14 or later
- Xcode command-line tools (`clang++`, `swiftc`, `xcrun`)
- built Doof CLI (`npm run build`)

Build the bundled executable:

```bash
cd samples/reminders-mcp
./build.sh
```

The script emits the Doof project, stages the native headers, compiles the Swift bridge, and writes a bundle at `build-reminders-mcp/DoofRemindersMCP.app`.

## Register With An MCP Host

Point the host at:

```text
build-reminders-mcp/DoofRemindersMCP.app/Contents/MacOS/doof-reminders-mcp
```

That executable is still a normal stdin/stdout process. The `.app` wrapper exists so the process can carry the `NSRemindersFullAccessUsageDescription` metadata required by EventKit.

## First-Run Flow

1. Start the server through your MCP host.
2. Call `initialize`.
3. Call `tools/list`.
4. Call `authorizationStatus`.
5. Call `requestAccess` and answer the macOS prompt.
6. Use the CRUD tools after access is granted.

The server intentionally does not prompt during startup or `tools/list`. Permission is only requested when `requestAccess` is called.

## Tool Output

Tool calls return JSON text in the MCP text content field. That keeps the transport simple while still making the raw reminder payloads visible to clients.

## Logging

Stdout is reserved for MCP frames only. The native transport writes diagnostics to stderr so logs do not corrupt the protocol stream.