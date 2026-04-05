// Classes — demonstrates classes, methods, and object construction
class Point {
  x, y: float

  function distanceSquaredTo(other: Point): float {
    dx := x - other.x
    dy := y - other.y
    return dx * dx + dy * dy
  }

  function display(): string {
    return `(${x}, ${y})`
  }
}

class Rectangle {
  origin: Point
  width, height: float

  function area(): float => width * height

  function perimeter(): double => 2.0 * (width + height)
}

function main(): int {
  a := Point { x: 0.0, y: 0.0 }
  b := Point { x: 3.0, y: 4.0 }

  println(`Point A: ${a.display()}`)
  println(`Point B: ${b.display()}`)
  println(`Distance squared: ${a.distanceSquaredTo(b)}`)

  rect := Rectangle {
    origin: Point { x: 1.0, y: 1.0 },
    width: 10.0,
    height: 5.0
  }
  println(`Area: ${rect.area()}`)
  println(`Perimeter: ${rect.perimeter()}`)

  return 0
}
