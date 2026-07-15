import { Assert } from "std/assert"
import { add } from "./math"
import { writeText } from "std/fs"

export function testAddsValues(): void {
  Assert.equal(add(2, 3), 5)
}

export function testAddsNegativeValues(): void {
  Assert.equal(add(5, -2), 3)
}

export function testUsesPackageRootAsWorkingDirectory(): void {
  try! writeText("runtime-cwd.txt", "ok")
}
