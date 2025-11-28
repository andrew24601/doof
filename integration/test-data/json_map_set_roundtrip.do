class Bag {
  tags: Map<string, string>;
  ids: Set<int>;
}

function main(): void {
  // Create a Bag with Map/Set
  let tags: Map<string, string> = {};
  tags["a"] = "1";
  tags["b"] = "2";

  let ids: Set<int> = [];
  ids.add(7);

  let bag: Bag = { tags: tags, ids: ids };

  // Deserialize from JSON string (matches normalized shape)
  let json: string = "{\"tags\":{\"a\":\"1\",\"b\":\"2\"},\"ids\":[7]}";
  let restored: Bag = Bag.fromJSON(json);

  // Expect same normalized JSON on all backends that support fromJSON for Map/Set
  println(restored);
}
