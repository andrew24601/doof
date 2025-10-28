class Tree {
    left: Tree | null = null;
    right: Tree | null = null;
    value: int;

    print() {
        if (left != null)
            left.print();
        println(value);
        if (right != null)
            right.print();
    }
}

function main() {
    const root: Tree = {
        left: {
            value: 1
        },
        right: {
            left: {
                value: 2
            },
            right: {
                value: 3
            },
            value: 7
        },
        value: 4
    };

    root.print();
}