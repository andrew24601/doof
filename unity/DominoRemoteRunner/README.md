Unity DoofRemoteRunner
=======================

This library exposes a C API for Unity to start a socket listener (background thread) and query whether a remote debugger/client is connected. The produced dylib is named `libUnityDoofRemoteRunner.dylib` and is suitable to place in `Assets/Plugins/macOS/` in a Unity project.

API (in `remote_runner.h`):

- `bool drr_start_listener(unsigned short port);`
- `void drr_stop_listener(void);`
- `bool drr_is_connected(void);`
- `void drr_register_event_callback(drr_event_callback cb);`
- `void drr_emit_event(const char* event_name, const char* payload);`
- `void drr_queue_doof_event(const char* event_name, const char* payload);`
- `bool drr_wait_next_doof_event(int timeout_millis);`
- `bool drr_has_pending_doof_events(void);`
- `const char* drr_last_doof_event_name(void);`
- `const char* drr_last_doof_event_payload(void);`

`drr_register_event_callback` lets Unity (or any host) supply a callback to receive
events fired by the native code. `drr_emit_event` can be invoked from Doof-generated
code (or any native caller) to relay custom payloads back to Unity.

Build (macOS):

```sh
cd unity/DoofRemoteRunner
mkdir -p build && cd build
cmake ..
cmake --build .
```

C# sample (Unity):

- `DoofRemoteRunnerBehaviour.cs` demonstrates how to:
    - Wrap the native API in a MonoBehaviour.
    - Expose a public `IsConnected` property that mirrors `drr_is_connected()`.
    - Register for native events and dispatch them back onto Unity's main thread.
    - (Optional) send test events back through `drr_emit_event` for tooling.

Drop the script onto a Unity GameObject, assign a port, and hook the
`DoofEvent` C# event to react to callbacks from Doof-transpiled code.

Doof integration:

- `DoofRemoteRunnerNative.h` exposes a C++ wrapper that doof extern classes can bind to.
- `doof/remote_runner_bridge.do` declares the extern class and helper functions for doof source.
- From doof code you can `import { DoofRemoteRunnerNative } from "./remote_runner_bridge";` and call
    `DoofRemoteRunnerNative.emitEvent("level-loaded", levelName);` to notify Unity.
    To receive events from Unity-driven code, loop on `DoofRemoteRunnerNative.waitNextEvent(timeout)` and read
    `DoofRemoteRunnerNative.lastEventName()` / `.lastEventPayload()` (or check `hasPendingEvents()` for polling).

Notes:
- `drr_is_connected()` is lock-free and safe to call from any thread.
- The listener runs in an internal std::thread. Start/stop from Unity main thread.
- Event callbacks may be invoked from the listener thread; marshal back to the main
    thread before touching Unity objects (see `DoofRemoteRunnerBehaviour.cs`).
- Ensure your doof build includes the folder containing `DoofRemoteRunnerNative.h` in the compiler's
    include path so the generated C++ can include it automatically.
