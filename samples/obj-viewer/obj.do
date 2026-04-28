import { max } from "./math"

export class Vec3 {
  x: float = 0.0f
  y: float = 0.0f
  z: float = 0.0f
}

export class ObjFace {
  indices: int[] = []
}

export class ObjModel {
  source: string = ""
  vertices: Vec3[] = []
  faces: ObjFace[] = []
  center: Vec3 = Vec3 {}
  extent: float = 1.0f

  edgeCount(): int {
    let total = 0
    for face of this.faces {
      total += face.indices.length
    }
    return total
  }
}

export class ObjError {
  stage: string = ""
  line: int = 0
  message: string = ""
}

function stripComment(line: string): string {
  marker := line.indexOf("#")
  if marker >= 0 {
    return line.substring(0, marker).trim()
  }
  return line.trim()
}

function splitWhitespace(text: string): string[] {
  tokens: string[] := []
  let current = ""
  normalized := text.replaceAll("\t", " ")

  for index of 0..<normalized.length {
    ch := normalized.charAt(index)
    if ch == " " {
      if current != "" {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if current != "" {
    tokens.push(current)
  }

  return tokens
}

function parseFloatToken(token: string, lineNumber: int, source: string, label: string): Result<float, ObjError> {
  return case float.parse(token) {
    s: Success -> Success { value: s.value },
    f: Failure -> Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: invalid ${label} value "${token}"`,
      }
    }
  }
}

function parseIntToken(token: string, lineNumber: int, source: string, label: string): Result<int, ObjError> {
  return case int.parse(token) {
    s: Success -> Success { value: s.value },
    f: Failure -> Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: invalid ${label} value "${token}"`,
      }
    }
  }
}

function parseVertex(tokens: string[], lineNumber: int, source: string): Result<Vec3, ObjError> {
  if tokens.length < 4 {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: expected three coordinates after v`,
      }
    }
  }

  try x := parseFloatToken(tokens[1], lineNumber, source, "x")
  try y := parseFloatToken(tokens[2], lineNumber, source, "y")
  try z := parseFloatToken(tokens[3], lineNumber, source, "z")

  return Success {
    value: Vec3 {
      x,
      y,
      z,
    }
  }
}

function resolveFaceIndex(token: string, vertexCount: int, lineNumber: int, source: string): Result<int, ObjError> {
  parts := token.split("/")
  if parts.length == 0 || parts[0].trim() == "" {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: invalid face element "${token}"`,
      }
    }
  }

  try rawIndex := parseIntToken(parts[0], lineNumber, source, "face index")
  if rawIndex == 0 {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: OBJ indices are 1-based; 0 is invalid`,
      }
    }
  }

  resolvedIndex := if rawIndex > 0 then rawIndex - 1 else vertexCount + rawIndex
  if resolvedIndex < 0 || resolvedIndex >= vertexCount {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: face index ${rawIndex} is out of range for ${vertexCount} vertices`,
      }
    }
  }

  return Success {
    value: resolvedIndex
  }
}

function parseFace(tokens: string[], vertexCount: int, lineNumber: int, source: string): Result<ObjFace, ObjError> {
  if tokens.length < 4 {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: lineNumber,
        message: `${source}:${lineNumber}: faces need at least three vertices`,
      }
    }
  }

  indices: int[] := []
  for tokenIndex of 1..<tokens.length {
    try resolvedIndex := resolveFaceIndex(tokens[tokenIndex], vertexCount, lineNumber, source)
    indices.push(resolvedIndex)
  }

  return Success {
    value: ObjFace { indices }
  }
}

export function parseObj(text: string, source: string = "input"): Result<ObjModel, ObjError> {
  vertices: Vec3[] := []
  faces: ObjFace[] := []
  normalizedText := text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  lines := normalizedText.split("\n")

  for lineIndex of 0..<lines.length {
    lineNumber := lineIndex + 1
    line := stripComment(lines[lineIndex])
    if line == "" {
      continue
    }

    tokens := splitWhitespace(line)
    if tokens.length == 0 {
      continue
    }

    kind := tokens[0]
    if kind == "v" {
      try vertex := parseVertex(tokens, lineNumber, source)
      vertices.push(vertex)
      continue
    }

    if kind == "f" {
      try face := parseFace(tokens, vertices.length, lineNumber, source)
      faces.push(face)
      continue
    }

    if kind == "vt" || kind == "vn" || kind == "vp" || kind == "o" ||
       kind == "g" || kind == "s" || kind == "mtllib" || kind == "usemtl" {
      continue
    }
  }

  if vertices.length == 0 {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: 0,
        message: `${source}: no vertex records were found`,
      }
    }
  }

  if faces.length == 0 {
    return Failure {
      error: ObjError {
        stage: "parse",
        line: 0,
        message: `${source}: no face records were found`,
      }
    }
  }

  let minX = vertices[0].x
  let maxX = vertices[0].x
  let minY = vertices[0].y
  let maxY = vertices[0].y
  let minZ = vertices[0].z
  let maxZ = vertices[0].z

  for index of 1..<vertices.length {
    vertex := vertices[index]
    if vertex.x < minX { minX = vertex.x }
    if vertex.x > maxX { maxX = vertex.x }
    if vertex.y < minY { minY = vertex.y }
    if vertex.y > maxY { maxY = vertex.y }
    if vertex.z < minZ { minZ = vertex.z }
    if vertex.z > maxZ { maxZ = vertex.z }
  }

  center := Vec3 {
    x: (minX + maxX) * 0.5f,
    y: (minY + maxY) * 0.5f,
    z: (minZ + maxZ) * 0.5f,
  }

  halfX := (maxX - minX) * 0.5f
  halfY := (maxY - minY) * 0.5f
  halfZ := (maxZ - minZ) * 0.5f
  let extent = max(max(halfX, halfY), halfZ)
  if extent <= 0.0001f {
    extent = 1.0f
  }

  return Success {
    value: ObjModel {
      source,
      vertices,
      faces,
      center,
      extent,
    }
  }
}