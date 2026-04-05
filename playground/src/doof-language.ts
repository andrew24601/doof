/**
 * Doof language definition for Monaco Editor.
 *
 * Registers:
 *   - Language ID "doof"
 *   - Monarch tokenizer (syntax highlighting)
 *   - Language configuration (brackets, comments, auto-closing)
 */
import * as monaco from "monaco-editor";

export function registerDoofLanguage() {
  // Register the language
  monaco.languages.register({
    id: "doof",
    extensions: [".do"],
    aliases: ["Doof", "doof"],
  });

  // Language configuration (auto-closing, brackets, comments)
  monaco.languages.setLanguageConfiguration("doof", {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
      { open: "`", close: "`", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: "`", close: "`" },
    ],
    folding: {
      markers: {
        start: /^\s*\/\/\s*#?region\b/,
        end: /^\s*\/\/\s*#?endregion\b/,
      },
    },
    indentationRules: {
      increaseIndentPattern: /^\s*(if|else|while|for|function|class|interface|enum|case|try|catch)\b.*\{\s*$/,
      decreaseIndentPattern: /^\s*\}/,
    },
  });

  // Monarch tokenizer
  monaco.languages.setMonarchTokensProvider("doof", {
    defaultToken: "invalid",
    tokenPostfix: ".doof",

    keywords: [
      "const", "readonly", "let", "function", "return",
      "if", "else", "then", "while", "for", "of",
      "break", "continue", "case", "class", "interface",
      "implements", "enum", "type", "import", "export",
      "from", "as", "void", "try", "catch", "panic",
      "static", "this", "weak", "destructor",
      "async", "isolated", "private", "with",
    ],

    builtinConstants: ["true", "false", "null"],

    builtinTypes: [
      "int", "long", "float", "double", "string", "char", "bool",
      "Array", "ReadonlyArray", "Map", "ReadonlyMap",
      "Set", "ReadonlySet", "Tuple", "Result", "ParseError",
    ],

    operators: [
      "=", ":=", "+=", "-=", "*=", "/=", "%=", "**=",
      "&=", "|=", "^=", "<<=", ">>=", "??=",
      "==", "!=", "<", "<=", ">", ">=",
      "+", "-", "*", "/", "%", "**",
      "&", "|", "^", "~", "<<", ">>", ">>>",
      "&&", "||", "!", "??",
      "=>", "..", "..<",
      "?.", "!.",
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    escapes: /\\(?:[abfnrtv\\"'`\$]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,

    tokenizer: {
      root: [
        // Whitespace & comments
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@blockComment"],

        // Template strings
        [/`/, "string.template", "@templateString"],

        // Strings
        [/"([^"\\]|\\.)*$/, "string.invalid"], // unterminated
        [/"/, "string", "@string_double"],

        // Char literals
        [/'([^'\\]|\\.)'/, "string.char"],
        [/'/, "string.char", "@string_single"],

        // Numbers
        [/\d+[Ll]\b/, "number.long"],
        [/\d+\.\d+[fF]\b/, "number.float"],
        [/\d+[fF]\b/, "number.float"],
        [/\d+\.\d+/, "number.double"],
        [/0[xX][0-9a-fA-F]+/, "number.hex"],
        [/0[bB][01]+/, "number.binary"],
        [/\d+/, "number"],

        // Identifiers & keywords
        [/[a-zA-Z_]\w*/, {
          cases: {
            "@builtinConstants": "constant.language",
            "@keywords": "keyword",
            "@builtinTypes": "type.identifier",
            "@default": "identifier",
          },
        }],

        // Delimiters & operators
        [/[{}()\[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
        [/_\b/, "keyword"], // underscore wildcard in patterns
        [/@symbols/, {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        }],
      ],

      blockComment: [
        [/[^\/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],

      string_double: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],

      string_single: [
        [/[^\\']+/, "string.char"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string.char", "@pop"],
      ],

      templateString: [
        [/\$\{/, "delimiter.bracket", "@templateStringInterpolation"],
        [/[^`\\$]+/, "string.template"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/\$/, "string.template"],
        [/`/, "string.template", "@pop"],
      ],

      templateStringInterpolation: [
        [/\{/, "delimiter.bracket", "@push"],
        [/\}/, "delimiter.bracket", "@pop"],
        { include: "root" },
      ],
    },
  } as monaco.languages.IMonarchLanguage);
}
