import { writeText } from "std/fs"

function main(): void {
    try! writeText("dump.txt", "This is the dumped text")
}