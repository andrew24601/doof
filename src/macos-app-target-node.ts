import { execFileSync } from "node:child_process";
import type { AssembleMacOSAppBundleOptions } from "./macos-app-target.js";

type GenerateMacOSIcon = NonNullable<AssembleMacOSAppBundleOptions["generateIcon"]>;

export const generateMacOSAppIconWithShell: GenerateMacOSIcon = (iconPath, outputPath, scriptPath) => {
  execFileSync("/bin/bash", [scriptPath, iconPath, outputPath], {
    stdio: "pipe",
    timeout: 30000,
  });
};