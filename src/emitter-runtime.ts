/**
 * Runtime support library content generation.
 *
 * Produces the contents of `doof_runtime.hpp` — a single C++ header
 * providing foundational types and utilities for transpiled Doof code.
 */

// ============================================================================
// Public API
// ============================================================================

/**
 * Return the full contents of the doof_runtime.hpp header.
 */
import {
    buildObserverRuntimeSupport,
    loadObserverPlatformSupport,
    loadRuntimeHeader,
} from "./runtime-assets.js";

export interface RuntimeHeaderOptions {
    observe?: boolean;
}

export function generateRuntimeHeader(options: RuntimeHeaderOptions = {}): string {
    return RUNTIME_HEADER
        .replace("/* __DOOF_OBSERVER_PLATFORM_SUPPORT__ */", options.observe ? loadObserverPlatformSupport() : "")
        .replace("/* __DOOF_OBSERVER_RUNTIME_SUPPORT__ */", options.observe ? buildObserverRuntimeSupport() : "");
}

// ============================================================================
// Observer-specific support layered onto the standalone header template
// ============================================================================

const RUNTIME_HEADER = loadRuntimeHeader();
