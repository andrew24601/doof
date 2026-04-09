export class PantrySnapshot {
  ingredients: string[]
  staples: string[]
  appliances: string[]
}

export class DinnerPlan {
  dish: string
  summary: string
  minutes: int
  steps: string[]
}

export class TemperatureConversion {
  celsius: int
  fahrenheit: int
  note: string
}

export class WeeknightKitchenTools "Structured household cooking helpers for a weeknight planning assistant." {
  pantry "Lists the pantry ingredients, staple sauces, and appliances available tonight."(): PantrySnapshot {
    ingredients: string[] := ["chickpeas", "tomatoes", "spinach", "shallots", "garlic", "pasta", "feta"]
    staples: string[] := ["olive oil", "cumin", "smoked paprika", "soy sauce", "red pepper flakes"]
    appliances: string[] := ["oven", "stovetop", "blender"]

    return PantrySnapshot {
      ingredients,
      staples,
      appliances,
    }
  }

  suggestDinner "Suggests a dinner idea using a pantry ingredient and a time budget."(
    focusIngredient "Ingredient the dish should highlight.": string,
    vegetarian "Whether the dinner should avoid meat and fish.": bool = true,
    maxMinutes "Maximum cooking time in minutes.": int = 20
  ): DinnerPlan {
    ingredient := focusIngredient.toLowerCase().trim()

    if ingredient.contains("chickpea") {
      return DinnerPlan {
        dish: "Smoky chickpea tomato skillet",
        summary: "A pantry-first skillet dinner with warm spices and enough sauce for pasta or toast.",
        minutes: if maxMinutes <= 0 then 18 else if maxMinutes < 18 then maxMinutes else 18,
        steps: [
          "Saute shallots and garlic in olive oil with cumin and smoked paprika.",
          "Add tomatoes, chickpeas, and spinach, then simmer until thick.",
          "Finish with feta and spoon over toasted bread or pasta.",
        ],
      }
    }

    if ingredient.contains("pasta") {
      return DinnerPlan {
        dish: "Tomato spinach feta pasta",
        summary: "Fast stovetop pasta with a bright tomato base and salty feta finish.",
        minutes: if maxMinutes <= 0 then 17 else if maxMinutes < 17 then maxMinutes else 17,
        steps: [
          "Boil the pasta while shallots soften in olive oil.",
          "Wilt spinach into the pan with garlic, tomatoes, and red pepper flakes.",
          "Toss everything with pasta water and crumble feta on top.",
        ],
      }
    }

    if vegetarian {
      return DinnerPlan {
        dish: "Roasted chickpea bowls",
        summary: "A flexible vegetarian bowl built from pantry staples and a fast tomato sauce.",
        minutes: if maxMinutes <= 0 then 20 else if maxMinutes < 20 then maxMinutes else 20,
        steps: [
          "Blend tomatoes, olive oil, garlic, and smoked paprika into a quick sauce.",
          "Roast chickpeas until crisp while warming the sauce on the stove.",
          "Serve the chickpeas over spinach with the sauce and feta.",
        ],
      }
    }

    return DinnerPlan {
      dish: "Weeknight tomato braise",
      summary: "A simple tomato-based dinner template that can flex around whatever protein you have.",
      minutes: if maxMinutes <= 0 then 22 else if maxMinutes < 22 then maxMinutes else 22,
      steps: [
        "Brown your protein with shallots and garlic.",
        "Add tomatoes, paprika, and a splash of soy sauce for depth.",
        "Serve over pasta with spinach folded in at the end.",
      ],
    }
  }

  convertOvenTemperature "Converts an oven temperature from Celsius to Fahrenheit."(
    celsius "Degrees Celsius.": int
  ): TemperatureConversion {
    fahrenheit := int((double(celsius) * 9.0 / 5.0) + 32.0)
    return TemperatureConversion {
      celsius,
      fahrenheit,
      note: "Rounded to the nearest whole degree for recipe instructions.",
    }
  }
}

export function openAITools(): JsonValue[] {
  meta := WeeknightKitchenTools.metadata
  tools: JsonValue[] := []

  for method of meta.methods {
    tools.push({
      "type": "function",
      name: method.name,
      description: method.description,
      parameters: method.inputSchema,
    })
  }

  return tools
}

export function invokeWeeknightTool(instance: WeeknightKitchenTools, methodName: string, args: JsonValue): Result<JsonValue, JsonValue> {
  return WeeknightKitchenTools.metadata.invoke(instance, methodName, args)
}