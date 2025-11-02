// Comprehensive end-to-end regression test across backends

class Point {
  x: int;
  y: int;
}

function main(): int {
  // Object-literal init
  let p1 = Point { x: 1, y: 2 };
  println(`P1:${p1.x},${p1.y}`);

  // Positional init
  let p2 = Point(3, 4);
  println(`P2:${p2.x + p2.y}`);

  // Destructuring (object)
  let { x, y } = p2;
  println(`DX:${x * y}`);

  // Destructuring (tuple by field order)
  let (a, b) = p2;
  println(`TD:${a - b}`);

  return 0;
}
