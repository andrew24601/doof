import * as vscode from "vscode";
import { tokenize, DoofTokenKind } from "./doofLexer";

const TOKEN_TYPES = [
  "comment",       // 0
  "keyword",       // 1
  "string",        // 2
  "number",        // 3
  "type",          // 4
  "class",         // 5
  "interface",     // 6
  "enum",          // 7
  "function",      // 8
  "parameter",     // 9
  "variable",      // 10
  "property",      // 11
  "enumMember",    // 12
  "operator",      // 13
];

const TOKEN_MODIFIERS = [
  "declaration",   // 0
  "readonly",      // 1
  "defaultLibrary",// 2
];

const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

// Map DoofTokenKind → [tokenTypeIndex, modifierBitmask]
function mapToken(kind: DoofTokenKind): [number, number] | null {
  switch (kind) {
    case DoofTokenKind.LineComment:
    case DoofTokenKind.BlockComment:
      return [0, 0]; // comment

    case DoofTokenKind.Keyword:
      return [1, 0]; // keyword
    case DoofTokenKind.StorageKeyword:
      return [1, 0]; // keyword
    case DoofTokenKind.StorageModifier:
      return [1, 0]; // keyword
    case DoofTokenKind.ThisKeyword:
      return [1, 0]; // keyword

    case DoofTokenKind.StringLiteral:
    case DoofTokenKind.CharLiteral:
    case DoofTokenKind.TemplateHead:
    case DoofTokenKind.TemplateTail:
      return [2, 0]; // string

    case DoofTokenKind.IntLiteral:
    case DoofTokenKind.LongLiteral:
    case DoofTokenKind.FloatLiteral:
    case DoofTokenKind.DoubleLiteral:
      return [3, 0]; // number

    case DoofTokenKind.BooleanLiteral:
    case DoofTokenKind.NullLiteral:
      return [1, 0]; // keyword (language constants)

    case DoofTokenKind.TypeKeyword:
      return [4, 2]; // type + defaultLibrary
    case DoofTokenKind.BuiltinType:
      return [4, 2]; // type + defaultLibrary
    case DoofTokenKind.TypeReference:
      return [4, 0]; // type

    case DoofTokenKind.ClassDef:
      return [5, 1]; // class + declaration
    case DoofTokenKind.InterfaceDef:
      return [6, 1]; // interface + declaration
    case DoofTokenKind.EnumDef:
      return [7, 1]; // enum + declaration
    case DoofTokenKind.TypeAliasDef:
      return [4, 1]; // type + declaration

    case DoofTokenKind.FunctionDef:
      return [8, 1]; // function + declaration
    case DoofTokenKind.FunctionCall:
      return [8, 0]; // function

    case DoofTokenKind.Parameter:
      return [9, 0]; // parameter

    case DoofTokenKind.Property:
      return [11, 0]; // property

    case DoofTokenKind.Identifier:
      return [10, 0]; // variable

    case DoofTokenKind.Operator:
      return [13, 0]; // operator

    case DoofTokenKind.Punctuation:
      return null; // no semantic token for punctuation
  }
  return null;
}

class DoofSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _cancel: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();
    const tokens = tokenize(text);

    for (const tok of tokens) {
      const mapped = mapToken(tok.kind);
      if (mapped === null) continue;
      const [typeIdx, modBits] = mapped;
      builder.push(tok.line, tok.col, tok.length, typeIdx, modBits);
    }

    return builder.build();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = { language: "doof", scheme: "file" };

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      new DoofSemanticTokensProvider(),
      legend,
    ),
  );
}

export function deactivate() {}
