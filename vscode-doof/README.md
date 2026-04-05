# Doof Language Extension

VS Code extension providing syntax highlighting for the [Doof programming language](../README.md).

## Features

- **TextMate grammar** — basic keyword, string, comment, and number highlighting
- **Semantic tokens** — richer highlighting using a lexer: distinguishes function definitions, calls, type references, parameters, class/interface/enum definitions, built-in types, and more

## Development

```bash
cd vscode-doof
npm install
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

## Structure

```
vscode-doof/
  package.json                    # Extension manifest
  language-configuration.json     # Bracket matching, comments, indentation
  tsconfig.json                   # TypeScript config
  syntaxes/
    doof.tmLanguage.json          # TextMate grammar for basic highlighting
  src/
    extension.ts                  # Extension entry point, registers semantic token provider
    doofLexer.ts                  # Lightweight lexer for semantic token classification
```

## Extending

This extension is designed to be extended with:
- **Error diagnostics** — integrate the Doof compiler's analyzer/checker for squiggly underlines
- **Go to definition** — use the analyzer's import resolution
- **Hover info** — show resolved types from the checker
- **Completions** — suggest symbols from module symbol tables
