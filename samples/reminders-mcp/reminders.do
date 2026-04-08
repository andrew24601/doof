import { parseJsonResult } from "./json_support"

export import class NativeRemindersStore from "./reminders_bridge.hpp" {
  authorizationStatus(): string
  requestAccess(): Result<bool, string>
  listListsJSON(): Result<string, string>
  listRemindersJSON(listId: string, includeCompleted: bool): Result<string, string>
  createReminderJSON(listId: string, title: string, notes: string, hasNotes: bool, dueDateIso: string, hasDueDate: bool): Result<string, string>
  updateReminderJSON(reminderId: string, title: string, notes: string, hasNotes: bool, dueDateIso: string, hasDueDate: bool): Result<string, string>
  completeReminderJSON(reminderId: string, completed: bool): Result<string, string>
  deleteReminderJSON(reminderId: string): Result<string, string>
}

class AuthorizationStatusResult {
  status: string
}

class RequestAccessResult {
  granted: bool
  status: string
}

export class RemindersTools "Read and modify reminders in the macOS Reminders app." {
  authorizationStatus "Returns the current EventKit authorization status for reminders."(): JsonValue {
    return AuthorizationStatusResult {
      status: NativeRemindersStore().authorizationStatus()
    }.toJsonValue()
  }

  requestAccess "Prompts the user to grant reminders access if the server has not already been authorized."(): Result<JsonValue, string> {
    store := NativeRemindersStore()
    return case store.requestAccess() {
      s: Success => Success(RequestAccessResult {
        granted: s.value,
        status: store.authorizationStatus(),
      }.toJsonValue()),
      f: Failure => Failure(f.error)
    }
  }

  listLists "Lists the available reminder lists."(): Result<JsonValue, string> => parseJsonResult(NativeRemindersStore().listListsJSON())

  listReminders "Lists reminders in a specific reminder list."(
    listId "Reminder list identifier.": string,
    includeCompleted "Whether completed reminders should be included.": bool = false
  ): Result<JsonValue, string> => parseJsonResult(NativeRemindersStore().listRemindersJSON(listId, includeCompleted))

  createReminder "Creates a reminder in a specific reminder list."(
    listId "Reminder list identifier.": string,
    title "Reminder title.": string,
    notes "Optional reminder notes.": string | null = null,
    dueDateIso "Optional due date in ISO-8601 format.": string | null = null
  ): Result<JsonValue, string> {
    notesText := notes ?? ""
    dueDateText := dueDateIso ?? ""

    return parseJsonResult(NativeRemindersStore().createReminderJSON(listId, title, notesText, notes != null, dueDateText, dueDateIso != null))
  }

  updateReminder "Updates a reminder by identifier. Provide null for notes or dueDateIso to clear those fields."(
    reminderId "Reminder identifier.": string,
    title "Updated reminder title.": string,
    notes "Updated reminder notes, or null to clear.": string | null = null,
    dueDateIso "Updated due date in ISO-8601 format, or null to clear.": string | null = null
  ): Result<JsonValue, string> {
    notesText := notes ?? ""
    dueDateText := dueDateIso ?? ""

    return parseJsonResult(NativeRemindersStore().updateReminderJSON(reminderId, title, notesText, notes != null, dueDateText, dueDateIso != null))
  }

  completeReminder "Marks a reminder complete or incomplete by identifier."(
    reminderId "Reminder identifier.": string,
    completed "Whether the reminder should be completed.": bool = true
  ): Result<JsonValue, string> => parseJsonResult(NativeRemindersStore().completeReminderJSON(reminderId, completed))

  deleteReminder "Deletes a reminder by identifier."(
    reminderId "Reminder identifier.": string
  ): Result<JsonValue, string> => parseJsonResult(NativeRemindersStore().deleteReminderJSON(reminderId))
}

export function toolsListResultJson(): string {
  meta := RemindersTools.metadata
  tools: JsonValue[] := []

  for method of meta.methods {
    tools.push({
      name: method.name,
      description: method.description,
      inputSchema: method.inputSchema,
    })
  }

  return JSON.stringify({ tools })
}