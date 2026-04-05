import EventKit
import Foundation

private final class RemindersStoreHolder {
    static let shared = RemindersStoreHolder()
    let store = EKEventStore()
}

private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter
}()

private func runBlocking<T>(
    _ body: @Sendable @escaping () async throws -> T
) -> Result<T, any Error> {
    nonisolated(unsafe) var result: Result<T, any Error> = .failure(
        NSError(
            domain: "DoofRemindersMCP",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: "operation did not complete"]
        )
    )

    let semaphore = DispatchSemaphore(value: 0)

    Task.detached {
        do {
            result = .success(try await body())
        } catch {
            result = .failure(error)
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

private func wrapResult(_ body: () throws -> String) -> UnsafeMutablePointer<CChar>? {
    do {
        return strdup(try body())
    } catch {
        return nil
    }
}

private func writeError(
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    _ message: String
) {
    outError.pointee = strdup(message)
}

private func stringResult(
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>,
    _ body: () throws -> String
) -> UnsafeMutablePointer<CChar>? {
    do {
        return strdup(try body())
    } catch {
        writeError(outError, error.localizedDescription)
        return nil
    }
}

private func statusString() -> String {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    switch status {
    case .fullAccess:
        return "fullAccess"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .notDetermined:
        return "notDetermined"
    case .writeOnly:
        return "writeOnly"
    @unknown default:
        return "unknown"
    }
}

private func ensureAuthorized() throws {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    if status == .fullAccess {
        return
    }

    throw NSError(
        domain: "DoofRemindersMCP",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Reminders access is not authorized. Call requestAccess first."]
    )
}

private func requestAccessSync() -> Result<Bool, any Error> {
    let store = RemindersStoreHolder.shared.store

    return runBlocking {
        try await store.requestFullAccessToReminders()
    }
}

private func fetchReminders(
    matching predicate: NSPredicate
) -> Result<[EKReminder], any Error> {
    nonisolated(unsafe) var fetched: [EKReminder] = []
    let semaphore = DispatchSemaphore(value: 0)

    RemindersStoreHolder.shared.store.fetchReminders(matching: predicate) { reminders in
        fetched = reminders ?? []
        semaphore.signal()
    }

    semaphore.wait()
    return .success(fetched)
}

private func jsonString(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard let text = String(data: data, encoding: .utf8) else {
        throw NSError(
            domain: "DoofRemindersMCP",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: "failed to encode JSON as UTF-8"]
        )
    }
    return text
}

private func isoString(from components: DateComponents?) -> String? {
    guard let components, let date = Calendar(identifier: .gregorian).date(from: components) else {
        return nil
    }
    return isoFormatter.string(from: date)
}

private func isoString(from date: Date?) -> String? {
    guard let date else {
        return nil
    }
    return isoFormatter.string(from: date)
}

private func dueDateComponents(from isoText: String) throws -> DateComponents {
    guard let date = isoFormatter.date(from: isoText) else {
        throw NSError(
            domain: "DoofRemindersMCP",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "dueDateIso must be a valid ISO-8601 timestamp"]
        )
    }

    var components = Calendar(identifier: .gregorian).dateComponents(
        [.year, .month, .day, .hour, .minute, .second],
        from: date
    )
    components.calendar = Calendar(identifier: .gregorian)
    components.timeZone = TimeZone(secondsFromGMT: 0)
    return components
}

private func serializeList(_ calendar: EKCalendar) -> [String: Any] {
    [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "allowsContentModifications": calendar.allowsContentModifications,
        "sourceTitle": calendar.source.title,
    ]
}

private func serializeReminder(_ reminder: EKReminder) -> [String: Any] {
    [
        "id": reminder.calendarItemIdentifier,
        "externalId": reminder.calendarItemExternalIdentifier ?? "",
        "listId": reminder.calendar.calendarIdentifier,
        "listTitle": reminder.calendar.title,
        "title": reminder.title ?? "",
        "notes": reminder.notes ?? NSNull(),
        "completed": reminder.isCompleted,
        "completionDateIso": isoString(from: reminder.completionDate) ?? NSNull(),
        "dueDateIso": isoString(from: reminder.dueDateComponents) ?? NSNull(),
        "priority": reminder.priority,
    ]
}

private func reminderList(by identifier: String) throws -> EKCalendar {
    let store = RemindersStoreHolder.shared.store
    guard let calendar = store.calendar(withIdentifier: identifier), calendar.type == .calDAV || calendar.type == .local || calendar.type == .exchange || calendar.type == .subscription || calendar.type == .birthday || calendar.allowsContentModifications || true else {
        throw NSError(
            domain: "DoofRemindersMCP",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Reminder list not found: \(identifier)"]
        )
    }
    return calendar
}

private func reminder(by identifier: String) throws -> EKReminder {
    let store = RemindersStoreHolder.shared.store
    guard let item = store.calendarItem(withIdentifier: identifier) as? EKReminder else {
        throw NSError(
            domain: "DoofRemindersMCP",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Reminder not found: \(identifier)"]
        )
    }
    return item
}

@_cdecl("doof_reminders_free_string")
public func doofRemindersFreeString(_ value: UnsafeMutablePointer<CChar>?) {
    free(value)
}

@_cdecl("doof_reminders_authorization_status")
public func doofRemindersAuthorizationStatus() -> UnsafeMutablePointer<CChar>? {
    strdup(statusString())
}

@_cdecl("doof_reminders_request_access")
public func doofRemindersRequestAccess(
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Bool {
    switch requestAccessSync() {
    case .success(let granted):
        return granted
    case .failure(let error):
        writeError(outError, error.localizedDescription)
        return false
    }
}

@_cdecl("doof_reminders_list_lists")
public func doofRemindersListLists(
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let store = RemindersStoreHolder.shared.store
        let lists = store.calendars(for: .reminder)
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            .map(serializeList)
        return try jsonString(["lists": lists])
    }
}

@_cdecl("doof_reminders_list_reminders")
public func doofRemindersListReminders(
    _ listId: UnsafePointer<CChar>,
    _ includeCompleted: Bool,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let listIdentifier = String(cString: listId)
        let calendar = try reminderList(by: listIdentifier)
        let store = RemindersStoreHolder.shared.store
        let predicate = includeCompleted
            ? store.predicateForReminders(in: [calendar])
            : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [calendar])

        let reminders: [EKReminder]
        switch fetchReminders(matching: predicate) {
        case .success(let values):
            reminders = values.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .failure(let error):
            throw error
        }

        return try jsonString([
            "listId": calendar.calendarIdentifier,
            "listTitle": calendar.title,
            "reminders": reminders.map(serializeReminder),
        ])
    }
}

@_cdecl("doof_reminders_create_reminder")
public func doofRemindersCreateReminder(
    _ listId: UnsafePointer<CChar>,
    _ title: UnsafePointer<CChar>,
    _ notes: UnsafePointer<CChar>,
    _ hasNotes: Bool,
    _ dueDateIso: UnsafePointer<CChar>,
    _ hasDueDate: Bool,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let store = RemindersStoreHolder.shared.store
        let calendar = try reminderList(by: String(cString: listId))
        let reminder = EKReminder(eventStore: store)
        reminder.calendar = calendar
        reminder.title = String(cString: title)
        reminder.notes = hasNotes ? String(cString: notes) : nil
        reminder.dueDateComponents = hasDueDate ? try dueDateComponents(from: String(cString: dueDateIso)) : nil
        try store.save(reminder, commit: true)
        return try jsonString(serializeReminder(reminder))
    }
}

@_cdecl("doof_reminders_update_reminder")
public func doofRemindersUpdateReminder(
    _ reminderId: UnsafePointer<CChar>,
    _ title: UnsafePointer<CChar>,
    _ notes: UnsafePointer<CChar>,
    _ hasNotes: Bool,
    _ dueDateIso: UnsafePointer<CChar>,
    _ hasDueDate: Bool,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let store = RemindersStoreHolder.shared.store
        let reminder = try reminder(by: String(cString: reminderId))
        reminder.title = String(cString: title)
        reminder.notes = hasNotes ? String(cString: notes) : nil
        reminder.dueDateComponents = hasDueDate ? try dueDateComponents(from: String(cString: dueDateIso)) : nil
        try store.save(reminder, commit: true)
        return try jsonString(serializeReminder(reminder))
    }
}

@_cdecl("doof_reminders_complete_reminder")
public func doofRemindersCompleteReminder(
    _ reminderId: UnsafePointer<CChar>,
    _ completed: Bool,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let store = RemindersStoreHolder.shared.store
        let reminder = try reminder(by: String(cString: reminderId))
        reminder.isCompleted = completed
        reminder.completionDate = completed ? Date() : nil
        try store.save(reminder, commit: true)
        return try jsonString(serializeReminder(reminder))
    }
}

@_cdecl("doof_reminders_delete_reminder")
public func doofRemindersDeleteReminder(
    _ reminderId: UnsafePointer<CChar>,
    _ outError: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> UnsafeMutablePointer<CChar>? {
    stringResult(outError) {
        try ensureAuthorized()
        let store = RemindersStoreHolder.shared.store
        let reminder = try reminder(by: String(cString: reminderId))
        let payload = try jsonString([
            "deleted": true,
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? "",
        ])
        try store.remove(reminder, commit: true)
        return payload
    }
}