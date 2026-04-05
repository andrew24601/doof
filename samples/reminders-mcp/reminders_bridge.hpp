#pragma once

#include <cstdlib>
#include <string>
#include <utility>

#include "doof_runtime.hpp"

extern "C" {
    char* doof_reminders_authorization_status();
    bool doof_reminders_request_access(char** outError);
    char* doof_reminders_list_lists(char** outError);
    char* doof_reminders_list_reminders(const char* listId, bool includeCompleted, char** outError);
    char* doof_reminders_create_reminder(
        const char* listId,
        const char* title,
        const char* notes,
        bool hasNotes,
        const char* dueDateIso,
        bool hasDueDate,
        char** outError
    );
    char* doof_reminders_update_reminder(
        const char* reminderId,
        const char* title,
        const char* notes,
        bool hasNotes,
        const char* dueDateIso,
        bool hasDueDate,
        char** outError
    );
    char* doof_reminders_complete_reminder(const char* reminderId, bool completed, char** outError);
    char* doof_reminders_delete_reminder(const char* reminderId, char** outError);
    void doof_reminders_free_string(char* value);
}

namespace doof_reminders_detail {

inline std::string take_string(char* raw) {
    std::string value(raw ? raw : "");
    if (raw) {
        doof_reminders_free_string(raw);
    }
    return value;
}

inline doof::Result<std::string, std::string> wrap_string_result(char* raw, char* error) {
    if (raw) {
        return doof::Result<std::string, std::string>::success(take_string(raw));
    }

    const std::string message = error ? take_string(error) : std::string("unknown reminders error");
    return doof::Result<std::string, std::string>::failure(message);
}

inline doof::Result<bool, std::string> wrap_bool_result(bool value, char* error) {
    if (!error) {
        return doof::Result<bool, std::string>::success(value);
    }

    return doof::Result<bool, std::string>::failure(take_string(error));
}

} // namespace doof_reminders_detail

class NativeRemindersStore {
public:
    NativeRemindersStore() = default;

    std::string authorizationStatus() const {
        return doof_reminders_detail::take_string(doof_reminders_authorization_status());
    }

    doof::Result<bool, std::string> requestAccess() const {
        char* error = nullptr;
        const bool granted = doof_reminders_request_access(&error);
        return doof_reminders_detail::wrap_bool_result(granted, error);
    }

    doof::Result<std::string, std::string> listListsJSON() const {
        char* error = nullptr;
        char* result = doof_reminders_list_lists(&error);
        return doof_reminders_detail::wrap_string_result(result, error);
    }

    doof::Result<std::string, std::string> listRemindersJSON(const std::string& listId, bool includeCompleted) const {
        char* error = nullptr;
        char* result = doof_reminders_list_reminders(listId.c_str(), includeCompleted, &error);
        return doof_reminders_detail::wrap_string_result(result, error);
    }

    doof::Result<std::string, std::string> createReminderJSON(
        const std::string& listId,
        const std::string& title,
        const std::string& notes,
        bool hasNotes,
        const std::string& dueDateIso,
        bool hasDueDate
    ) const {
        char* error = nullptr;
        char* result = doof_reminders_create_reminder(
            listId.c_str(),
            title.c_str(),
            notes.c_str(),
            hasNotes,
            dueDateIso.c_str(),
            hasDueDate,
            &error
        );
        return doof_reminders_detail::wrap_string_result(result, error);
    }

    doof::Result<std::string, std::string> updateReminderJSON(
        const std::string& reminderId,
        const std::string& title,
        const std::string& notes,
        bool hasNotes,
        const std::string& dueDateIso,
        bool hasDueDate
    ) const {
        char* error = nullptr;
        char* result = doof_reminders_update_reminder(
            reminderId.c_str(),
            title.c_str(),
            notes.c_str(),
            hasNotes,
            dueDateIso.c_str(),
            hasDueDate,
            &error
        );
        return doof_reminders_detail::wrap_string_result(result, error);
    }

    doof::Result<std::string, std::string> completeReminderJSON(const std::string& reminderId, bool completed) const {
        char* error = nullptr;
        char* result = doof_reminders_complete_reminder(reminderId.c_str(), completed, &error);
        return doof_reminders_detail::wrap_string_result(result, error);
    }

    doof::Result<std::string, std::string> deleteReminderJSON(const std::string& reminderId) const {
        char* error = nullptr;
        char* result = doof_reminders_delete_reminder(reminderId.c_str(), &error);
        return doof_reminders_detail::wrap_string_result(result, error);
    }
};