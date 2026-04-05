# Hello Package Sample

This sample imports a tagged remote Doof package from GitHub through its local [doof.json](/Users/andrew/develop/doof/samples/hello-package/doof.json) manifest.

Run it from the repository root with:

```bash
npx doof run samples/hello-package/main.do
```

The first run materializes the `hello-doof` package into `~/.doof/packages/` by cloning the `v0.1` tag referenced as version `0.1`.