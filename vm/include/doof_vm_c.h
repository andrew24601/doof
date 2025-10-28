#pragma once
#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

typedef struct DoofVMHandle DoofVMHandle;

// Create/destroy the VM handle
DoofVMHandle* doof_vm_create();
void doof_vm_destroy(DoofVMHandle* h);

// Load bytecode from a JSON buffer. Returns 0 on success, non-zero on error.
// If an error occurs and out_error is non-null, the function will allocate a
// null-terminated string that the caller must free with doof_vm_free_string.
int doof_vm_load_bytecode_from_buffer(DoofVMHandle* h, const char* json, char** out_error);

// Run / control
void doof_vm_run(DoofVMHandle* h);
void doof_vm_pause(DoofVMHandle* h);
void doof_vm_resume(DoofVMHandle* h);
int doof_vm_is_paused(DoofVMHandle* h);

// Get last textual output; caller must free returned string with doof_vm_free_string
char* doof_vm_last_output(DoofVMHandle* h);
void doof_vm_free_string(char* s);

#ifdef __cplusplus
struct DoofVM;
typedef void (*doof_vm_initializer_cpp_t)(DoofVM*, void*);
void doof_vm_set_vm_initializer(doof_vm_initializer_cpp_t initializer, void* user_data);
#endif

// Remote debugging server helpers (developer-mode)
typedef enum doof_vm_remote_server_event {
    DOOF_VM_REMOTE_SERVER_EVENT_CONNECTED = 1,
    DOOF_VM_REMOTE_SERVER_EVENT_DISCONNECTED = 2
} doof_vm_remote_server_event_t;

typedef void (*doof_vm_remote_server_callback_t)(doof_vm_remote_server_event_t event,
                                                 int active_connections,
                                                 void* user_data);

int doof_vm_start_remote_server(int port,
                                char** out_error,
                                doof_vm_remote_server_callback_t callback,
                                void* user_data);
void doof_vm_stop_remote_server();
int doof_vm_remote_server_active_connections(void);

#ifdef __cplusplus
}
#endif
