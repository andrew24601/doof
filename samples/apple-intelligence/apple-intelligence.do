// Apple Intelligence — demonstrates calling Apple's on-device language model
// via a C++ bridge class backed by the FoundationModels framework.
//
// The bridge compiles a Swift layer (apple_intelligence_impl.swift) that
// calls LanguageModelSession from FoundationModels, exposed to C++ through
// @_cdecl C functions.
//
// Requirements: macOS 26+, Apple Silicon, Apple Intelligence enabled.
// Build:        cd samples/apple-intelligence && ./build.sh

import class AppleIntelligence from "./apple_intelligence_bridge.hpp" {
  compose(prompt: string): Result<string, string>
  rewrite(text: string, style: string): Result<string, string>
  summarize(text: string): Result<string, string>
}

// Generate a short story using Apple Intelligence compose
function generateStory(ai: AppleIntelligence, topic: string): Result<string, string> {
  prompt := `Write a short, whimsical story about ${topic} in 3 paragraphs.`
  try story := ai.compose(prompt)
  return Success { value: story }
}

// Rewrite text in a different tone
function rewriteStory(ai: AppleIntelligence, story: string, style: string): Result<string, string> {
  try rewritten := ai.rewrite(story, style)
  return Success { value: rewritten }
}

function main(): int {
  ai := AppleIntelligence()

  // ── 1. Generate a story ────────────────────────────────────────────
  println("=== Generating a story ===")
  println("")

  // try! unwraps the Result — panics with the error message on Failure
  story := try! generateStory(ai, "a robot who learns to bake sourdough")
  println(story)

  // ── 2. Rewrite in a different style ────────────────────────────────
  println("")
  println("=== Rewriting as a fairy tale ===")
  println("")

  fairyTale := try! rewriteStory(ai, story, "fairy tale")
  println(fairyTale)

  // ── 3. Summarize — demonstrate case-expression on Result ───────────
  println("")
  println("=== Summary ===")
  println("")

  // case expression handles both arms as values (no early return needed)
  const summary = case ai.summarize(fairyTale) {
    s: Success -> s.value,
    f: Failure -> "(summarization unavailable: " + f.error + ")"
  }
  println(summary)

  return 0
}
