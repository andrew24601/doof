export class Quote {
  subtotal: double
  tax: double
  total: double
}

export class Stats {
  count: int
  total: int
  average: double
}

export function add(a: int, b: int): int => a + b

export function greet(name: string = "WebAssembly"): string {
  return "Hello, ${name} from Doof!"
}

export function quote(unitPrice: double, quantity: int, taxRate: double = 0.08): Result<Quote, string> {
  if quantity < 0 {
    return Failure { error: "quantity must be non-negative" }
  }

  subtotal := unitPrice * double(quantity)
  tax := subtotal * taxRate
  return Success {
    value: Quote {
      subtotal,
      tax,
      total: subtotal + tax,
    }
  }
}

export function summarize(values: int[]): Stats {
  let total = 0
  for value of values {
    total += value
  }

  average := if values.length == 0 then 0.0 else double(total) / double(values.length)
  return Stats {
    count: values.length,
    total,
    average,
  }
}
