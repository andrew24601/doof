# Minimal C++17 Project

This is a minimal C++17 project setup with CMake.

## Structure
- `main.cpp`: Entry point with a simple Hello World.
- `CMakeLists.txt`: Configured for C++17.

## Build Instructions

1. Create a build directory:
   Doof VM — XCFramework & Integration
   ====================================

   This document explains how to consume the Doof VM XCFramework produced by `vm/scripts/build_xcframework.sh`, and how to call the C API (`doof_vm_c.h`) from Objective-C, Swift or plain C.

   Prerequisites
   -------------
   - macOS with Xcode and Command Line Tools installed.
   - CMake and `xcodebuild` on PATH (Xcode provides `xcodebuild`).
   - The build script produces the XCFramework at `vm/build/xcframework/doof-vm.xcframework` by default.

   Build the XCFramework
   ---------------------
   Run the provided script from the repo root. It is idempotent and configurable:

   ```zsh
   # from repository root
   ./vm/scripts/build_xcframework.sh --build-type Release --lib-name doof-vm --output-dir vm/build/xcframework
   ```

   If everything succeeds the artifact will be at:

   - `vm/build/xcframework/doof-vm.xcframework`

   What the XCFramework contains
   -----------------------------
   - A static library for device slices (arm64, etc.).
   - A static library for simulator slices (x86_64 / arm64 simulator).
   - Public headers installed into the XCFramework so consumers can include `doof_vm_c.h`.

   Linking in Xcode (manual)
   -------------------------
   1. Drag `doof-vm.xcframework` into your Xcode project or workspace. Choose "Copy items if needed" if you want to keep a copy in your project.
   2. In your app target, under "Frameworks, Libraries, and Embedded Content" click `+` and add the XCFramework. For a static library XCFramework you do NOT need to embed it — select "Do Not Embed".
   3. Add a header search path (Build Settings -> Header Search Paths) that points at the XCFramework Headers directory. Example:

      $(PROJECT_DIR)/path/to/doof-vm.xcframework/Headers

      (no recursive flag needed)

   4. If you're using Swift, add a bridging header and import the header there (see the Swift section below).

   Swift Package Manager (binaryTarget)
   ------------------------------------
   You can publish or locally reference the produced XCFramework as a binaryTarget in a Package.swift. Example:

   ```swift
   // Package.swift snippet
   let package = Package(
      name: "MyApp",
      platforms: [.iOS(.v13)],
      products: [
         .library(name: "MyAppLib", targets: ["MyAppLib"]),
      ],
      targets: [
         .binaryTarget(
            name: "DoofVM",
            path: "./vm/build/xcframework/doof-vm.xcframework"
         ),
         .target(
            name: "MyAppLib",
            dependencies: ["DoofVM"],
            path: "Sources/MyAppLib"
         )
      ]
   )
   ```

   CocoaPods
   ---------
   You can vendor the XCFramework in a Podspec via `vendored_frameworks`:

   ```ruby
   Pod::Spec.new do |s|
     s.name         = 'DoofVM'
     s.version      = '0.0.1'
     s.summary      = 'Doof VM static library'
     s.vendored_frameworks = 'doof-vm.xcframework'
     s.public_header_files = 'Headers/*.h'
   end
   ```

   (Adjust paths depending on where you check the XCFramework into source control.)

   Using the C API
   ---------------
   The public header is `doof_vm_c.h`. It provides a stable C ABI for embedding the VM. The header uses an opaque `DoofVMHandle` type so consumers don't need C++.

   C example
   ~~~~~~~~~
   ```c
   #include "doof_vm_c.h"
   #include <stdio.h>

   int main(void) {
      DoofVMHandle* vm = doof_vm_create();
      if (!vm) {
         fprintf(stderr, "failed to create vm\n");
         return 1;
      }

      const char* json = "{ /* vmbc JSON or blob as a string */ }";
      char* err = NULL;
      bool ok = doof_vm_load_bytecode_from_buffer(vm, (char*)json, &err);
      if (!ok) {
         fprintf(stderr, "load error: %s\n", err ? err : "unknown");
         if (err) doof_vm_free_string(err);
         doof_vm_destroy(vm);
         return 2;
      }

      doof_vm_run(vm);

      const char* out = doof_vm_last_output(vm);
      if (out) {
         puts(out);
         doof_vm_free_string(out);
      }

      doof_vm_destroy(vm);
      return 0;
   }
   ```

   Swift (bridging header) example
   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   1. Create an Objective-C bridging header (e.g. `BridgingHeader.h`) and add:

   ```objc
   #import "doof_vm_c.h"
   ```

   2. In Swift you can then call the functions directly:

   ```swift
   // Note: doof_vm_create returns an opaque pointer in Swift. Use `OpaquePointer` or the imported type.
   let vm = doof_vm_create()
   defer { doof_vm_destroy(vm) }

   let json = "{ /* vmbc JSON */ }"
   json.withCString { ptr in
      var errPtr: UnsafeMutablePointer<CChar>? = nil
      let ok = doof_vm_load_bytecode_from_buffer(vm, UnsafeMutablePointer(mutating: ptr), &errPtr)
      if !ok, let e = errPtr { print(String(cString: e)); doof_vm_free_string(e) }
   }

   doof_vm_run(vm)
   if let out = doof_vm_last_output(vm) {
      print(String(cString: out))
      doof_vm_free_string(out)
   }
   ```

   Developer remote server helpers (convenience)
   ---------------------------------------------
   For rapid developer iteration there are two helpers in the C API:

      - `doof_vm_start_remote_server(int port, char** out_error, doof_vm_remote_server_callback_t callback, void* user_data)` — starts a background remote server (DAP/VM upload + inspector) listening on the provided port. Returns `true` on success. This creates background thread(s) that accept incoming connections and spin up per-connection VM/handlers. If a callback is provided it will be invoked whenever a connection is established or torn down, along with the active connection count.
   - `doof_vm_stop_remote_server()` — stops the server started above.

   Important: this helper is intended for developer workflows (rapid iteration) and should be used with caution for production mobile builds. Prefer disabling or gating it behind debug-only flags in release apps.

   Troubleshooting
   ---------------
   - "No CMAKE_C_COMPILER could be found": install Xcode command line tools (xcode-select --install) or open Xcode once so toolchain is configured.
   - "Bundle identifier is missing" during an Xcode-based install: the `build_xcframework.sh` script builds only the `doof-vm` library target and then runs `cmake --install`; if you modified the script to build `INSTALL` or `ALL_BUILD` targets Xcode may try to build app targets that require bundle identifiers. Keep the script building the library target only.
   - Simulator build fails with unknown target CPU (like `apple-m2`) — ensure `-march=native` and `-flto` are not forced when targeting iOS simulators. The included CMake changes in the repo already avoid these flags for iOS SDKs.

   Next steps / Integration checklist
   ---------------------------------
   - [ ] Verify the XCFramework by linking it into a small sample Xcode app and calling a basic VM round-trip.
   - [ ] Optionally add a `module.modulemap` or `Package.swift` wrapper for nicer Swift integration.
   - [ ] Consider gating the remote server helpers behind a compile-time flag or providing a runtime opt-in for production builds.

   Questions or issues? Open an issue or send a short reproduction and I can help wire up a sample Xcode project.
