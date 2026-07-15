import class Client from "client.hpp" as release_native::Client {
  value: int
  get(): int
  static make(value: int): Client
  same(): Client { return this }
}

function main(): int {
  client := Client { value: 4 }
  made := Client.make(6)
  same := client.same()
  return if client.get() + made.get() + same.get() == 14 then 0 else 1
}
