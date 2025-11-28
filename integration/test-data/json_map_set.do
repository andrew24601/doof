class Bag {
  tags: Map<string, string>;
  ids: Set<int>;
}

function main(): void {
  // Build Bag instance directly to exercise Map/Set JSON printing across backends
  let tags: Map<string, string> = {};
  tags["a"] = "1";
  tags["b"] = "2";

  let ids: Set<int> = [];
  ids.add(7);

  let bag: Bag = { tags: tags, ids: ids };
  println(bag);
}
