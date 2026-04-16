import { Chain } from "std/stream"

class Counter implements Stream<int> {
  current: int
  endExclusive: int

  next(): int | null {
    if this.current < this.endExclusive {
      value := this.current
      this.current = this.current + 1
      return value
    }
    return null
  }
}

function main(): int {
  base := Counter(1, 10)
  chain := Chain<int> { source: Counter(1, 10) }
  chain2: Chain<int> := Chain<int> { source: Counter(1, 10) }
  chain3: Chain<int> := { source: base }
  chain4 := Chain<int>(Counter(1, 10))
  chain5 := Chain(Counter(1, 10))

  values := chain.filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect()
  values2 := Chain<int>{ source: Counter(1, 10) }.filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect()
  values3 := Chain(base).filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect()

  println(values)
  println(values2)
  println(Chain<int>{source: Counter(1, 10)}.filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect())
  println(Chain<int>(Counter(1, 10)).filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect())
  println(Chain(Counter(1, 10)).filter(=> it % 2 == 0).map(=> "{${it}}").take(5).collect())
  return 0
}
