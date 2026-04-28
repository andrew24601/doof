import { runViewer } from "./viewer"

function main(args: string[]): int {
  executable := if args.length > 0 then args[0] else "a.out"
  if args.length > 1 && args[1] == "--help" {
    printUsage(executable)
    return 0
  }

  modelPath := if args.length > 1 then args[1] else "samples/obj-viewer/models/cube.obj"

  let exitCode = 1
  result := runViewer(modelPath)
  case result {
    s: Success -> {
      exitCode = 0
    }
    f: Failure -> {
      println(`OBJ viewer error: ${f.error}`)
      if args.length <= 1 {
        println("Hint: pass an explicit .obj path, or run from the repository root to use the built-in cube sample.")
      }
    }
  }

  return exitCode
}

function printUsage(executable: string): void {
  println("Doof OBJ viewer sample")
  println("")
  println("Usage:")
  println(`  ${executable} [path/to/model.obj]`)
  println("")
  println("Controls:")
  println("  left drag  orbit")
  println("  right drag pan")
  println("  wheel      zoom")
  println("  R          reset camera")
  println("  Esc        quit")
}