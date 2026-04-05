// apple_intelligence_impl.swift — Swift bridge to Apple's FoundationModels
//
// Provides on-device text generation (compose, rewrite, summarize) using
// the FoundationModels framework introduced in macOS 26 (Tahoe).
//
// Exposes C-callable functions consumed by the C++ bridge header
// (apple_intelligence_bridge.hpp).
//
// Requirements:
//   - macOS 26.0+ (Tahoe)
//   - Apple Silicon (M1 or later)
//   - Apple Intelligence enabled in System Settings > Apple Intelligence & Siri

import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: – Synchronous wrapper for async FoundationModels API

/// Runs an `async throws` closure synchronously using a detached task and a
/// semaphore.  Safe to call from any thread — `Task.detached` avoids executor
/// coupling so the semaphore wait cannot deadlock.
private func runBlocking<T>(
    _ body: @Sendable @escaping () async throws -> T
) -> Result<T, any Error> {
    // nonisolated(unsafe) silences sendability diagnostics; the semaphore
    // guarantees exclusive access across the Task boundary.
    nonisolated(unsafe) var result: Result<T, any Error> =
        .failure(NSError(domain: "AppleIntelligence", code: -1,
                         userInfo: [NSLocalizedDescriptionKey: "operation did not complete"]))

    let semaphore = DispatchSemaphore(value: 0)

    Task.detached {
        do {
            result = .success(try await body())
        } catch {
            result = .failure(error)
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

// MARK: – Availability check

#if canImport(FoundationModels)
/// Returns `nil` when Apple Intelligence is ready, or a human-readable error
/// string explaining why it is unavailable.
@available(macOS 26.0, *)
private func checkAvailability() -> String? {
    let availability = SystemLanguageModel.default.availability
    switch availability {
    case .available:
        return nil

    case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible:
            return "This device does not support Apple Intelligence (Apple Silicon required)"
        case .appleIntelligenceNotEnabled:
            return "Apple Intelligence is not enabled – turn it on in System Settings > Apple Intelligence & Siri"
        case .modelNotReady:
            return "The Apple Intelligence model is still downloading – please try again later"
        @unknown default:
            return "Apple Intelligence is unavailable (unrecognised reason)"
        }

    @unknown default:
        return "Apple Intelligence is unavailable"
    }
}
#endif

// MARK: – C-callable entry points
//
// Convention: each function returns a `strdup`'d C string on success.
// On failure it returns `NULL` and writes a `strdup`'d error message
// into `*outError`.  The caller must `ai_free_string()` every non-NULL
// pointer it receives.

@_cdecl("ai_free_string")
public func aiFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

// ── compose ──────────────────────────────────────────────────────────────

@_cdecl("ai_compose")
public func aiCompose(
    _ prompt: UnsafePointer<CChar>,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    let promptStr = String(cString: prompt)

    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        if let errMsg = checkAvailability() {
            outError.pointee = strdup(errMsg)
            return nil
        }

        let result = runBlocking { () async throws -> String in
            let session = LanguageModelSession(
                instructions: """
                You are a creative writing assistant. Generate engaging, \
                original content based on the user's prompt. Write naturally \
                and imaginatively.
                """
            )
            let response = try await session.respond(to: promptStr)
            return response.content
        }

        switch result {
        case .success(let text):
            return strdup(text)
        case .failure(let error):
            outError.pointee = strdup("Apple Intelligence error: \(error.localizedDescription)")
            return nil
        }
    }
    #endif

    outError.pointee = strdup(
        "Apple Intelligence requires macOS 26.0 or later with the FoundationModels framework"
    )
    return nil
}

// ── rewrite ──────────────────────────────────────────────────────────────

@_cdecl("ai_rewrite")
public func aiRewrite(
    _ text: UnsafePointer<CChar>,
    _ style: UnsafePointer<CChar>,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    let textStr  = String(cString: text)
    let styleStr = String(cString: style)

    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        if let errMsg = checkAvailability() {
            outError.pointee = strdup(errMsg)
            return nil
        }

        let result = runBlocking { () async throws -> String in
            let session = LanguageModelSession(
                instructions: """
                You are an expert editor. Rewrite the provided text in the \
                requested style while preserving the core meaning and key \
                details. Output only the rewritten text with no commentary \
                or preamble.
                """
            )
            let prompt = "Rewrite the following text in a \(styleStr) style:\n\n\(textStr)"
            let response = try await session.respond(to: prompt)
            return response.content
        }

        switch result {
        case .success(let text):
            return strdup(text)
        case .failure(let error):
            outError.pointee = strdup("Apple Intelligence error: \(error.localizedDescription)")
            return nil
        }
    }
    #endif

    outError.pointee = strdup(
        "Apple Intelligence requires macOS 26.0 or later with the FoundationModels framework"
    )
    return nil
}

// ── summarize ────────────────────────────────────────────────────────────

@_cdecl("ai_summarize")
public func aiSummarize(
    _ text: UnsafePointer<CChar>,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    let textStr = String(cString: text)

    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        if let errMsg = checkAvailability() {
            outError.pointee = strdup(errMsg)
            return nil
        }

        let result = runBlocking { () async throws -> String in
            let session = LanguageModelSession(
                instructions: """
                You are a concise summariser. Produce a brief, faithful \
                summary of the provided text in one to three sentences. \
                Output only the summary with no labels or preamble.
                """
            )
            let prompt = "Summarise the following text:\n\n\(textStr)"
            let response = try await session.respond(to: prompt)
            return response.content
        }

        switch result {
        case .success(let text):
            return strdup(text)
        case .failure(let error):
            outError.pointee = strdup("Apple Intelligence error: \(error.localizedDescription)")
            return nil
        }
    }
    #endif

    outError.pointee = strdup(
        "Apple Intelligence requires macOS 26.0 or later with the FoundationModels framework"
    )
    return nil
}
