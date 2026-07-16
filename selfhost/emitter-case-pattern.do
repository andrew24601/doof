// Shared type-pattern lowering for statement and expression cases.

import { NamedType, TypePattern } from "./ast"
import {
  ArrayResolvedType, JsonValueResolvedType, MapResolvedType, NullType, PrimitiveType,
  ResolvedType, ResultResolvedType,
} from "./semantic"
import { emitType, usesNullableSingleValueRepresentation, usesVariantRepresentation } from "./emitter-types"

export class CaseTypePatternEmission {
  condition: string
  binding: string
}

/** Lowers a checked type pattern from the subject's concrete C++ carrier. */
export function emitCaseTypePattern(
  pattern: TypePattern,
  subjectType: ResolvedType,
  subject: string,
  bindingName: string,
  currentModulePath: string,
): CaseTypePatternEmission {
  if pattern.resolvedType == null { panic("Case pattern has no resolved type") }
  patternType := pattern.resolvedType!
  case subjectType {
    result: ResultResolvedType -> { return emitResultPattern(pattern, result, subject, bindingName, currentModulePath) }
    _: JsonValueResolvedType -> { return emitJsonValuePattern(patternType, subject, bindingName) }
    _ -> { }
  }
  if usesVariantRepresentation(subjectType) {
    patternCpp := emitType(patternType, currentModulePath)
    if usesVariantRepresentation(patternType) {
      return CaseTypePatternEmission {
        condition: "doof::variant_is<" + patternCpp + ">(" + subject + ")",
        binding: if bindingName == "" then "" else "const auto " + bindingName + " = doof::variant_narrow<" + patternCpp + ">(" + subject + ");\n",
      }
    }
    return CaseTypePatternEmission {
      condition: "std::holds_alternative<" + patternCpp + ">(" + subject + ")",
      binding: if bindingName == "" then "" else "const auto& " + bindingName + " = std::get<" + patternCpp + ">(" + subject + ");\n",
    }
  }
  nullable := usesNullableSingleValueRepresentation(subjectType)
  value := if nullable then "doof::unwrap_optional(" + subject + ")" else subject
  return CaseTypePatternEmission {
    condition: if nullable then "!doof::is_null(" + subject + ")" else "true",
    binding: if bindingName == "" then "" else "const auto " + bindingName + " = " + value + ";\n",
  }
}

function emitResultPattern(
  pattern: TypePattern,
  result: ResultResolvedType,
  subject: string,
  bindingName: string,
  currentModulePath: string,
): CaseTypePatternEmission {
  let armType = ""
  case pattern.type_ {
    named: NamedType -> {
      if named.name == "Success" { armType = "doof::Success<" + emitType(result.valueType, currentModulePath) + ">" }
      if named.name == "Failure" { armType = "doof::Failure<" + emitType(result.errorType, currentModulePath) + ">" }
    }
    _ -> { }
  }
  if armType == "" { panic("Result case pattern must be Success or Failure") }
  return CaseTypePatternEmission {
    condition: "std::holds_alternative<" + armType + ">(" + subject + ")",
    binding: if bindingName == "" then "" else "const auto& " + bindingName + " = std::get<" + armType + ">(" + subject + ");\n",
  }
}

function emitJsonValuePattern(patternType: ResolvedType, subject: string, bindingName: string): CaseTypePatternEmission {
  let condition = "true"
  let value = subject
  case patternType {
    primitive: PrimitiveType -> {
      if primitive.name == "bool" { condition = "doof::json_is_boolean(" + subject + ")"; value = "doof::json_as_bool(" + subject + ")" }
      else if primitive.name == "string" { condition = "doof::json_is_string(" + subject + ")"; value = "doof::json_as_string(" + subject + ")" }
      else if primitive.name == "int" { condition = "doof::json_is_number(" + subject + ")"; value = "doof::json_as_int(" + subject + ")" }
      else if primitive.name == "long" { condition = "doof::json_is_number(" + subject + ")"; value = "doof::json_as_long(" + subject + ")" }
      else if primitive.name == "float" { condition = "doof::json_is_number(" + subject + ")"; value = "doof::json_as_float(" + subject + ")" }
      else if primitive.name == "double" { condition = "doof::json_is_number(" + subject + ")"; value = "doof::json_as_double(" + subject + ")" }
      else { panic("Unsupported primitive JsonValue case pattern " + primitive.name) }
    }
    _: ArrayResolvedType -> { condition = "doof::json_is_array(" + subject + ")"; value = "std::get<doof::JsonArray>(doof::json_storage(" + subject + "))" }
    _: MapResolvedType -> { condition = "doof::json_is_object(" + subject + ")"; value = "doof::json_object(" + subject + ")" }
    _: NullType -> { condition = "doof::json_is_null(" + subject + ")"; value = "nullptr" }
    _: JsonValueResolvedType -> { }
    _ -> { panic("Unsupported JsonValue case pattern") }
  }
  return CaseTypePatternEmission {
    condition,
    binding: if bindingName == "" then "" else "const auto " + bindingName + " = " + value + ";\n",
  }
}
