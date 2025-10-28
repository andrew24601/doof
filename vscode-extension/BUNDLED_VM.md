# Bundled VM Runtime

The VS Code extension now includes a bundled `json-runner` binary in the `runtime/` directory. This makes it easier for users to debug Doof files without having to build the VM separately.

## How it Works

1. The `json-runner` binary is copied from `vm/build/json-runner` to `vscode-extension/runtime/json-runner`
2. The binary is included in the extension package via the `files` array in `package.json`
3. The `.vscodeignore` file explicitly includes `runtime/json-runner` to ensure it's packaged
4. The debug adapter (`debugAdapter.ts`) checks for the bundled binary first before falling back to the workspace VM

## Updating the Bundled Binary

To update the bundled binary after making changes to the VM:

```bash
# Build the VM
cd vm/build
cmake --build .

# Copy to extension
cp json-runner ../../vscode-extension/runtime/json-runner
chmod +x ../../vscode-extension/runtime/json-runner

# Recompile the extension
cd ../../vscode-extension
npm run compile
```

Alternatively, run the helper script from the repository root which automates these steps:

```bash
./vm/scripts/rebuild_and_bundle_json_runner.sh
```

## Platform Considerations

**Current Limitation:** The bundled binary is platform-specific (currently macOS). This means:
- The extension will work out-of-the-box on the same platform as the build machine
- Users on other platforms will need to build the VM locally or provide a custom `vmPath` in their launch configuration

**Future Enhancement:** Consider implementing platform-specific builds:
- Bundle separate binaries for macOS (x64/arm64), Linux (x64/arm64), and Windows
- Detect the platform at runtime and use the appropriate binary
- This would require setting up CI/CD to build the VM on multiple platforms
