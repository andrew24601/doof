// C API for Unity remote runner integration
#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*drr_event_callback)(const char* event_name, const char* payload);

// Start the remote runner socket listener on the specified port.
// Returns true on success, false on failure.
bool drr_start_listener(unsigned short port);

// Stop the listener and join background thread. Safe to call multiple times.
void drr_stop_listener(void);

// Returns whether a debugger / remote client is currently connected
bool drr_is_connected(void);

// Registers a callback invoked when the native layer emits events. The callback will
// be invoked on the native threads (listener thread or the caller of drr_emit_event).
// Passing NULL unregisters the callback.
void drr_register_event_callback(drr_event_callback callback);

// Allows Doof-transpiled code to trigger a callback into Unity. The callback will
// be executed synchronously (on the caller's thread) if registered.
void drr_emit_event(const char* event_name, const char* payload);

// Enqueue an event destined for Doof code. Typically called from Unity-managed threads.
void drr_queue_doof_event(const char* event_name, const char* payload);

// Blocking wait for the next queued Doof event. timeout_millis < 0 waits indefinitely.
// Returns true if an event was dequeued, false if the wait timed out.
bool drr_wait_next_doof_event(int timeout_millis);

// Returns true if there are pending Doof events in the queue.
bool drr_has_pending_doof_events(void);

// Accessors for the most recently dequeued Doof event. Return empty strings if none.
const char* drr_last_doof_event_name(void);
const char* drr_last_doof_event_payload(void);

// Back-compat aliases for older Domino-based integrations
void drr_queue_domino_event(const char* event_name, const char* payload);
bool drr_wait_next_domino_event(int timeout_millis);
bool drr_has_pending_domino_events(void);
const char* drr_last_domino_event_name(void);
const char* drr_last_domino_event_payload(void);

#ifdef __cplusplus
}
#endif
