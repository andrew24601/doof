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

class FilteredStream<T> implements Stream<T> {
  source: Stream<T>
  pred: (it: T): bool

  next(): T | null {
    while true {
      candidate := this.source.next() else {
          return null
      }
      
      if (this.pred(candidate)) {
          return candidate
      }
    }
  }
}

class MappedStream<T, U> implements Stream<U> {
  source: Stream<T>
  transform: (it: T): U

  next(): U | null {
    value := this.source.next() else {
      return null
    }
    return this.transform(value)
  }
}

class TakeStream<T> implements Stream<T> {
  source: Stream<T>
  remaining: int

  next(): T | null {
    if this.remaining <= 0 {
      return null
    }
    value := this.source.next()
    if value == null {
      return null
    }
    this.remaining = this.remaining - 1
    return value
  }
}

class Chain<T> implements Stream<T> {
  source: Stream<T>

  next(): T | null => this.source.next()

  filter(pred: (it: T): bool): Chain<T> => Chain<T> { source: FilteredStream<T> { source: this.source, pred } }
  map<U>(transform: (it: T): U): Chain<U> => Chain<U> { source: MappedStream<T, U> { source: this.source, transform } }
  take(count: int): Chain<T> => Chain<T> { source: TakeStream<T> { source: this.source, remaining: count } }

  collect(): T[] {
    let values: T[] = []
    for item of this.source {
      values.push(item)
    }
    return values
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
