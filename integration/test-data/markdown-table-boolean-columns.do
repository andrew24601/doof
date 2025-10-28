// Markdown table boolean condition columns (empty headers)
function main(): int {
    let isAdmin: bool = true;
    let isOwner: bool = false;
    let canEdit: bool = false;

    |            |         | =canEdit |
    |------------|---------|----------|
    | isAdmin    |         | true     |
    |            | isOwner | true     |
    |            |         | false    |

    println(canEdit);
    return 0;
}
