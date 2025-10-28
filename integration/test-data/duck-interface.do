interface Formatter {
  format(): string;
}

class PersonFormatter {
  name: string = "anonymous";

  format(): string {
    return this.name;
  }
}

function run(formatter: Formatter): void {
  println(formatter.format());
}

function main(): void {
  let formatter = PersonFormatter { name: "duck" };
  run(formatter);
}
