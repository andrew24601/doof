import function platformValue(): int from "platform.hpp" as release_platform::value

function main(): int => if platformValue() == 2 then 0 else 1
