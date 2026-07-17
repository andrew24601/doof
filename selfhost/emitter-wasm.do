// JSON-over-C-ABI support generation for self-hosted WebAssembly libraries.
//
// The ABI intentionally matches the reference compiler: each exported entry
// function accepts one JSON object string and returns an allocated JSON
// envelope. Hosts release returned text through doof_free.

import { ClassDeclaration, ExportDeclaration, FunctionDeclaration, Parameter, Program, Statement } from "./ast"
import { AnalysisResult, ModuleInfo } from "./analyzer"
import { createEmitContextForModule, EmitContext } from "./emitter-context"
import { cppIdentifier, emitExpression } from "./emitter-expr"
import { emitJsonField, emitJsonRead, emitJsonTypeCheck, jsonTypeName } from "./emitter-json"
import { moduleHeaderName, moduleNamespace } from "./emitter-names"
import { emitContextType } from "./emitter-types"
import { canGenerateJsonDeserialization, canGenerateJsonSerialization, nullableJsonMember } from "./json-semantics"
import {
  ArrayResolvedType, ClassType, EnumType, FunctionType, JsonValueResolvedType, NullType,
  PrimitiveType, ResolvedType, ResultResolvedType, UnionResolvedType, VoidType,
} from "./semantic"

export class WasmEmission {
  source: string
  exportNames: string[] = []
}

export function emitWasmSupport(result: AnalysisResult, entry: string): Result<WasmEmission, string> {
  info := findModule(result, entry)
  if info == null { return Failure("Module not found: " + entry) }
  let exports: FunctionDeclaration[] = []
  collectExportedFunctions(info!, exports)
  let names: string[] = []
  for fn of exports {
    if fn.name == "main" { continue }
    try validateWasmFunction(fn, result)
    name := "doof_export_" + cppIdentifier(fn.name)
    for index of 0..<names.length {
      if names[index] == name {
        return Failure("WebAssembly export name collision for " + fn.name + " at " + name)
      }
    }
    names.push(name)
  }

  programs := allPrograms(result)
  context := createEmitContextForModule(info!.program, entry, programs)
  context.imports = info!.imports
  context.namespaceImports = info!.namespaceImports
  let source = wasmPreamble(info!)
  let exportIndex = 0
  for fn of exports {
    if fn.name == "main" { continue }
    source = source + emitWasmWrapper(fn, names[exportIndex], context)
    exportIndex += 1
  }
  return Success(WasmEmission { source, exportNames: names })
}

function collectExportedFunctions(info: ModuleInfo, result: FunctionDeclaration[]): void {
  for statement of info.program.statements {
    case statement {
      fn: FunctionDeclaration -> { if fn.exported || moduleExportsFunction(info, fn.name) { result.push(fn) } }
      export_: ExportDeclaration -> {
        case export_.declaration {
          fn: FunctionDeclaration -> { result.push(fn) }
          _ -> { }
        }
      }
      _ -> { }
    }
  }
}

function moduleExportsFunction(info: ModuleInfo, name: string): bool {
  for symbol of info.exports {
    sourceName := if symbol.originalName == "" then symbol.name else symbol.originalName
    if symbol.kind == "function" && symbol.module == info.path && sourceName == name { return true }
  }
  return false
}

function validateWasmFunction(fn: FunctionDeclaration, analysis: AnalysisResult): Result<void, string> {
  if fn.typeParams.length > 0 { return Failure("WebAssembly export \"" + fn.name + "\" cannot be generic") }
  resolved := fn.resolvedType else {
    return Failure("WebAssembly export \"" + fn.name + "\" is missing a resolved function type")
  }
  case resolved {
    type_: FunctionType -> {
      for parameter of fn.params {
        if parameter.resolvedType == null || !isWasmJsonType(parameter.resolvedType!, analysis) {
          return Failure("Parameter \"" + parameter.name + "\" of WebAssembly export \"" + fn.name + "\" must be supported by the JSON ABI")
        }
      }
      case type_.returnType {
        _: VoidType -> { return Success() }
        result: ResultResolvedType -> {
          case result.valueType {
            _: VoidType -> { }
            _ -> { if !isWasmJsonType(result.valueType, analysis) { return Failure("Success type of WebAssembly export \"" + fn.name + "\" must be supported by the JSON ABI") } }
          }
          if !isWasmJsonType(result.errorType, analysis) { return Failure("Error type of WebAssembly export \"" + fn.name + "\" must be supported by the JSON ABI") }
          return Success()
        }
        _ -> {
          if !isWasmJsonType(type_.returnType, analysis) { return Failure("Return type of WebAssembly export \"" + fn.name + "\" must be supported by the JSON ABI") }
          return Success()
        }
      }
    }
    _ -> { return Failure("WebAssembly export \"" + fn.name + "\" is missing a resolved function type") }
  }
  return Success()
}

function isWasmJsonType(type_: ResolvedType, analysis: AnalysisResult): bool {
  case type_ {
    _: PrimitiveType -> { return true }
    _: JsonValueResolvedType -> { return true }
    _: NullType -> { return true }
    _: EnumType -> { return true }
    class_: ClassType -> {
      declaration := findClass(analysis, class_)
      return declaration != null && canGenerateJsonSerialization(declaration!, allPrograms(analysis)) && canGenerateJsonDeserialization(declaration!, allPrograms(analysis))
    }
    array: ArrayResolvedType -> { return isWasmJsonType(array.elementType, analysis) }
    union_: UnionResolvedType -> {
      inner := nullableJsonMember(union_)
      return inner != null && isWasmJsonType(inner!, analysis)
    }
    _ -> { return false }
  }
  return false
}

function wasmPreamble(info: ModuleInfo): string {
  return "#include \"" + moduleHeaderName(info.path) + "\"\n" +
    "#include \"doof_runtime.hpp\"\n#include \"std/json/native_json.hpp\"\n#include <cstring>\n\n" +
    "namespace {\n" +
    "char* __doof_wasm_return_text(const std::string& text) { auto* out = static_cast<char*>(std::malloc(text.size() + 1)); if (out == nullptr) return nullptr; std::memcpy(out, text.c_str(), text.size() + 1); return out; }\n" +
    "doof::JsonValue __doof_wasm_object(std::initializer_list<std::pair<std::string, doof::JsonValue>> values) { return doof::json_value(std::make_shared<doof::ordered_map<std::string, doof::JsonValue>>(values)); }\n" +
    "char* __doof_wasm_success(const doof::JsonValue& value) { return __doof_wasm_return_text(doof_json::format(__doof_wasm_object({{\"ok\", doof::json_value(true)}, {\"value\", value}}))); }\n" +
    "char* __doof_wasm_failure(const doof::JsonValue& error) { return __doof_wasm_return_text(doof_json::format(__doof_wasm_object({{\"ok\", doof::json_value(false)}, {\"error\", error}}))); }\n" +
    "char* __doof_wasm_failure_message(int32_t code, const std::string& message) { return __doof_wasm_failure(doof::json_error(code, message)); }\n" +
    "}\n\nextern \"C\" void doof_free(char* ptr) { std::free(ptr); }\n\n"
}

function emitWasmWrapper(fn: FunctionDeclaration, exportName: string, context: EmitContext): string {
  resolved := fn.resolvedType else { panic("checked wasm function lost its resolved type") }
  type_ := resolved as FunctionType else { panic("checked wasm function lost its function type") }
  let source = "extern \"C\" char* " + exportName + "(const char* params_json) {\n    try {\n"
  source = source + "        const bool _lenient = false;\n"
  source = source + "        auto& __domain = doof::detail::ApplicationDomain::shared(); doof::detail::ActiveActorScope __scope(&__domain);\n"
  source = source + "        auto __parsed = doof_json::parse(params_json == nullptr ? std::string(\"{}\") : std::string(params_json));\n"
  source = source + "        if (doof::is_failure(__parsed)) return __doof_wasm_failure_message(400, std::string(\"Invalid JSON params: \" ) + doof::failure_error(__parsed));\n"
  source = source + "        const auto* __params = doof::json_as_object(doof::success_value(__parsed));\n"
  source = source + "        if (__params == nullptr) return __doof_wasm_failure_message(400, \"Invalid JSON params: expected object\");\n"
  for parameter of fn.params { source = source + emitParameter(parameter, context) }
  let arguments = ""
  for parameter of fn.params {
    if arguments != "" { arguments = arguments + ", " }
    arguments = arguments + cppIdentifier(parameter.name)
  }
  call := "::" + moduleNamespace(context.modulePath) + "::" + cppIdentifier(fn.name) + "(" + arguments + ")"
  case type_.returnType {
    _: VoidType -> { source = source + "        " + call + ";\n        return __doof_wasm_success(doof::json_value(nullptr));\n" }
    result: ResultResolvedType -> {
      source = source + "        auto __result = " + call + ";\n        if (doof::is_failure(__result)) return __doof_wasm_failure(" + emitJsonField("doof::failure_error(__result)", result.errorType, context) + ");\n"
      case result.valueType {
        _: VoidType -> { source = source + "        return __doof_wasm_success(doof::json_value(nullptr));\n" }
        _ -> { source = source + "        auto __value = doof::success_value(__result);\n        return __doof_wasm_success(" + emitJsonField("__value", result.valueType, context) + ");\n" }
      }
    }
    _ -> { source = source + "        auto __value = " + call + ";\n        return __doof_wasm_success(" + emitJsonField("__value", type_.returnType, context) + ");\n" }
  }
  return source + "    } catch (const doof::Panic& error) { return __doof_wasm_failure_message(500, std::string(\"panic: \" ) + error.what()); } catch (const std::exception& error) { return __doof_wasm_failure_message(500, error.what()); }\n}\n\n"
}

function emitParameter(parameter: Parameter, context: EmitContext): string {
  type_ := parameter.resolvedType!
  name := cppIdentifier(parameter.name)
  iterator := "__it_" + name
  let source = "        auto " + iterator + " = __params->find(\"" + parameter.name + "\");\n"
  if parameter.defaultValue != null {
    source = source + "        " + emitContextType(type_, context) + " " + name + ";\n        if (" + iterator + " == __params->end()) { " + name + " = " + emitExpression(parameter.defaultValue!, context, type_) + "; } else {\n"
    source = source + "            if (!(" + emitJsonTypeCheck(iterator + "->second", type_) + ")) return __doof_wasm_failure_message(400, \"Parameter " + parameter.name + " expected " + jsonTypeName(type_) + "\");\n"
    return source + "            " + name + " = " + emitJsonRead(iterator + "->second", type_, context) + ";\n        }\n"
  }
  source = source + "        if (" + iterator + " == __params->end()) return __doof_wasm_failure_message(400, \"Missing required parameter \\\"" + parameter.name + "\\\"\");\n"
  source = source + "        if (!(" + emitJsonTypeCheck(iterator + "->second", type_) + ")) return __doof_wasm_failure_message(400, \"Parameter " + parameter.name + " expected " + jsonTypeName(type_) + "\");\n"
  return source + "        auto " + name + " = " + emitJsonRead(iterator + "->second", type_, context) + ";\n"
}

function findModule(result: AnalysisResult, path: string): ModuleInfo | null {
  for module of result.modules { if module.path == path { return module } }
  return null
}

function allPrograms(result: AnalysisResult): Program[] {
  let programs: Program[] = []
  for module of result.modules { programs.push(module.program) }
  return programs
}

function findClass(result: AnalysisResult, type_: ClassType): ClassDeclaration | null {
  module := findModule(result, type_.symbol.module)
  if module == null { return null }
  for statement of module!.program.statements {
    case statement {
      class_: ClassDeclaration -> { if class_.name == type_.name { return class_ } }
      export_: ExportDeclaration -> {
        case export_.declaration {
          class_: ClassDeclaration -> { if class_.name == type_.name { return class_ } }
          _ -> { }
        }
      }
      _ -> { }
    }
  }
  return null
}
