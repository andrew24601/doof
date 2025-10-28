# Doof Remote Runner (iOS)

A minimal SwiftUI application that embeds the Doof VM remote JSON runner so you can execute and debug Doof programs from the VS Code extension on a physical iOS device. The app listens for the extension to upload compiled bytecode over the local network and forwards all Debug Adapter Protocol (DAP) messages to the VM.

## Features

- Uses the Doof `doof-vm.xcframework` and its remote server helpers (`doof_vm_start_remote_server`, `doof_vm_stop_remote_server`).
- Auto-starts the remote server when the app is active and keeps the device awake while listening.
- UI for choosing a TCP port, monitoring the server state, and copying connection endpoints.
- Local-network permission prompt with simple guidance for wiring the VS Code extension.

## Prerequisites

1. **Build the XCFramework** (once after VM changes):
   ```sh
   ./vm/scripts/build_xcframework.sh --build-type Release
   ```
   The project references `vm/build/xcframework/doof-vm.xcframework` relative to the repository root.

2. **Tools**: Xcode 15 or later, iOS 15+ device or simulator. (Physical hardware is recommended because local-network sockets are restricted on the simulator.)

## Project Layout

```
ios/
  DoofRemoteRunner/
    DoofRemoteRunner.xcodeproj/       # Xcode project configuration
    DoofRemoteRunner/                 # App sources, assets, Info.plist
    README.md                           # This guide
```

Key source files:

- `DoofRemoteRunnerApp.swift` – App entry point and scene lifecycle glue.
- `RemoteRunnerService.swift` – ObservableObject that wraps the Doof C API and manages lifecycle/idle timer.
- `ContentView.swift` – SwiftUI interface for controlling the remote server.
- `NetworkInfo.swift` – Helper for enumerating reachable IPv4/IPv6 addresses.

## Running the App

1. Open `ios/DoofRemoteRunner/DoofRemoteRunner.xcodeproj` in Xcode.
2. Select an iOS device target (physical device strongly preferred).
3. Build & run. The first launch will ask for Local Network access.
4. Leave the app in the foreground while debugging; it disables auto-lock when the server is running.

## Connecting from the VS Code Extension

1. Build or transpile your Doof program to bytecode inside VS Code.
2. Create or pick a "Remote" Doof debug configuration (host/port fields are available in the launch configuration schema).
3. Set the host to one of the IP addresses displayed in the app (tap the copy button for `host:port`).
4. Ensure the port matches the value configured in the app (default `7777`).
5. Start debugging from VS Code – the extension uploads the `.vmbc` artifact and attaches over the network.

If you change the port inside the app while the server is running, tap **Restart** to apply the new value. Turning off "Auto-start when app is active" stops the server immediately and prevents automatic restarts on foregrounding.

## Notes & Next Steps

- Background execution is deliberately disabled; the server stops when the app moves to the background to comply with iOS networking policies.
- The app currently expects the XCFramework to exist; if you move or rename it, update the reference in the project (`doof-vm.xcframework`).
- For production builds consider adding authentication and TLS before exposing the remote runner outside trusted developer networks.

Contributions & enhancements (e.g., Bonjour discovery, richer diagnostics, or integrated log streaming) are welcome—record ideas in `enhancements/TODO.md`.
