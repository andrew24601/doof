import { abs } from "./math"
import { parseObj } from "./obj"

export function testParsesQuadFaceAndBounds(): void {
  parsed := parseObj(`
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
f 1 2 3 4
`, "quad.obj")

  case parsed {
    s: Success => {
      model := s.value
      assert(model.vertices.length == 4, "expected four vertices")
      assert(model.faces.length == 1, "expected one face")
      assert(model.faces[0].indices.length == 4, "expected quad face indices")
      assert(abs(model.center.x) < 0.001f, "expected centered x bounds")
      assert(abs(model.center.y) < 0.001f, "expected centered y bounds")
      assert(abs(model.extent - 1.0f) < 0.001f, "expected extent to match half-size")
    }
    f: Failure => assert(false, `expected parse success, got ${f.error.message}`)
  }
}

export function testResolvesNegativeFaceIndices(): void {
  parsed := parseObj(`
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f -4 -3 -2 -1
`, "negative.obj")

  case parsed {
    s: Success => {
      face := s.value.faces[0]
      assert(face.indices[0] == 0, "expected -4 to resolve to the first vertex")
      assert(face.indices[3] == 3, "expected -1 to resolve to the last vertex")
    }
    f: Failure => assert(false, `expected parse success, got ${f.error.message}`)
  }
}

export function testRejectsOutOfRangeFaceIndex(): void {
  parsed := parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 9
`, "bad.obj")

  case parsed {
    s: Success => assert(false, "expected parse failure")
    f: Failure => assert(f.error.line == 5, "expected the failing line number to be reported")
  }
}