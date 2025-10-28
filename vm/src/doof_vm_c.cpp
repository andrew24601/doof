#include "doof_vm_c.h"
#include "vm.h"
#include "dap.h"
#include "dap_channel.h"
#include "json.h"
#include "json_bytecode_loader.h"

#include <string>
#include <cstring>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>
#include <memory>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <iostream>

static std::mutex g_vm_initializer_mutex;
static doof_vm_initializer_cpp_t g_vm_initializer = nullptr;
static void* g_vm_initializer_user_data = nullptr;

static void invoke_vm_initializer(DoofVM* vm) {
    doof_vm_initializer_cpp_t initializer = nullptr;
    void* userData = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_vm_initializer_mutex);
        initializer = g_vm_initializer;
        userData = g_vm_initializer_user_data;
    }
    if (initializer && vm) {
        initializer(vm, userData);
    }
}

// Minimal SocketDAPChannel shim used by the server helper
class SocketDAPChannel : public DAPChannel {
public:
    explicit SocketDAPChannel(int fd) : fd_(fd) {}
    ~SocketDAPChannel() override { if (fd_>=0) ::close(fd_); }
    bool readMessage(std::string &outJson) override {
        std::string headerBuf;
        char ch;
        while (true) {
            ssize_t n = ::recv(fd_, &ch, 1, 0);
            if (n <= 0) return false;
            headerBuf.push_back(ch);
            if (headerBuf.size() > 4 && headerBuf.substr(headerBuf.size()-4) == "\r\n\r\n") break;
            if (headerBuf.size()==1 && ch=='{') {
                std::string json; json.push_back('{');
                while (true) { char c; ssize_t m = ::recv(fd_, &c, 1, 0); if (m<=0) return false; json.push_back(c); if (c=='}') break; }
                outJson = std::move(json);
                return true;
            }
        }
        size_t pos = headerBuf.find("Content-Length:");
        if (pos == std::string::npos) return false;
        size_t lineEnd = headerBuf.find('\n', pos);
        std::string lenLine = headerBuf.substr(pos, lineEnd-pos);
        size_t colon = lenLine.find(':');
        int length = std::stoi(lenLine.substr(colon+1));
        outJson.assign(length, '\0');
        size_t off=0; while (off < (size_t)length) { ssize_t n = ::recv(fd_, outJson.data()+off, length-off, 0); if (n<=0) return false; off += (size_t)n; }
        return true;
    }
    void writeMessage(const std::string &json) override {
        std::string framed = "Content-Length: " + std::to_string(json.size()) + "\r\n\r\n" + json;
        size_t off=0; while (off < framed.size()) { ssize_t n = ::send(fd_, framed.data()+off, framed.size()-off, 0); if (n<=0) break; off += (size_t)n; }
    }
private:
    int fd_;
};

struct DoofVMHandle { DoofVM* vm; };
extern "C" {

DoofVMHandle* doof_vm_create() {
    DoofVM* v = new DoofVM();
    DoofVMHandle* h = new DoofVMHandle();
    h->vm = v;
    invoke_vm_initializer(v);
    return h;
}

void doof_vm_destroy(DoofVMHandle* h) {
    if (!h) return;
    delete h->vm;
    delete h;
}

int doof_vm_load_bytecode_from_buffer(DoofVMHandle* h, const char* json, char** out_error) {
    if (!h || !json) {
        if (out_error) *out_error = strdup("invalid arguments");
        return 1;
    }
    try {
        // Use the existing JSONBytecodeLoader
        auto loaded = JSONBytecodeLoader::load_from_string(std::string(json));
        const std::vector<Instruction> &code = loaded.instructions;
        const std::vector<Value> &constants = loaded.constants;
        int entry = loaded.entryPoint;
        int globals = loaded.globalCount;
        h->vm->set_globals_size(globals);
        // run the loaded bytecode
        h->vm->run(code, constants, entry, globals);
        return 0;
    } catch (const std::exception& ex) {
        if (out_error) *out_error = strdup(ex.what());
        return 3;
    }
}

void doof_vm_run(DoofVMHandle* h) { if (h) { /* no-op: run happens during load in this wrapper */ } }
void doof_vm_pause(DoofVMHandle* h) { if (h) h->vm->pause(); }
void doof_vm_resume(DoofVMHandle* h) { if (h) h->vm->resume(); }
int doof_vm_is_paused(DoofVMHandle* h) { return h && h->vm->isPaused(); }

char* doof_vm_last_output(DoofVMHandle* h) {
    if (!h) return nullptr;
    std::stringstream ss;
    h->vm->dump_state(ss);
    std::string s = ss.str();
    return strdup(s.c_str());
}

void doof_vm_free_string(char* s) { if (s) free(s); }

// Simple remote server (developer-mode); blocking accept loop in background thread
static std::thread server_thread;
static std::atomic<bool> server_running{false};
static int server_listen_fd = -1;
static std::atomic<int> server_active_connections{0};

struct RemoteServerCallbackState {
    doof_vm_remote_server_callback_t callback = nullptr;
    void* user_data = nullptr;
};

static std::mutex server_callback_mutex;
static std::shared_ptr<RemoteServerCallbackState> server_callback_state;

static std::shared_ptr<RemoteServerCallbackState> get_callback_state() {
    std::lock_guard<std::mutex> lock(server_callback_mutex);
    return server_callback_state;
}

static void set_callback_state(doof_vm_remote_server_callback_t callback, void* user_data) {
    std::lock_guard<std::mutex> lock(server_callback_mutex);
    if (callback) {
        server_callback_state = std::make_shared<RemoteServerCallbackState>(RemoteServerCallbackState{callback, user_data});
    } else {
        server_callback_state.reset();
    }
}

static int create_listen_socket(int port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return -1; }
    int opt=1; setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_addr.s_addr = INADDR_ANY; addr.sin_port = htons(port);
    if (bind(fd, (sockaddr*)&addr, sizeof(addr))<0) { perror("bind"); ::close(fd); return -1; }
    if (listen(fd, 1) < 0) { perror("listen"); ::close(fd); return -1; }
    return fd;
}

int doof_vm_start_remote_server(int port,
                                  char** out_error,
                                  doof_vm_remote_server_callback_t callback,
                                  void* user_data) {
    if (server_running.load()) {
        if (out_error) *out_error = strdup("server already running");
        return 1;
    }
    int listenFd = create_listen_socket(port);
    if (listenFd < 0) {
        if (out_error) *out_error = strdup("failed to create listen socket");
        return 2;
    }
    server_listen_fd = listenFd;
    set_callback_state(callback, user_data);
    server_running.store(true);
    try {
        server_thread = std::thread([listenFd](){
        while (server_running.load()) {
            int clientFd = ::accept(listenFd, nullptr, nullptr);
            if (clientFd < 0) { if (!server_running.load()) break; perror("accept"); continue; }
            auto callbackState = get_callback_state();
            server_active_connections.fetch_add(1, std::memory_order_acq_rel);
            if (callbackState && callbackState->callback) {
                callbackState->callback(DOOF_VM_REMOTE_SERVER_EVENT_CONNECTED,
                                        server_active_connections.load(std::memory_order_acquire),
                                        callbackState->user_data);
            }
            bool threadStarted = false;
            try {
                std::thread([clientFd, callbackState]() mutable {
                    SocketDAPChannel channel(clientFd);
                    DoofVM vm;
                    invoke_vm_initializer(&vm);
                    DAPHandler dap(&vm);
                    vm.setDAPHandler(&dap);
                    dap.setOutputChannel(&channel);
                    dap.run(&channel);
                    // close handled by channel destructor
                    server_active_connections.fetch_sub(1, std::memory_order_acq_rel);
                    if (callbackState && callbackState->callback) {
                        callbackState->callback(DOOF_VM_REMOTE_SERVER_EVENT_DISCONNECTED,
                                                server_active_connections.load(std::memory_order_acquire),
                                                callbackState->user_data);
                    }
                }).detach();
                threadStarted = true;
            } catch (...) {
                server_active_connections.fetch_sub(1, std::memory_order_acq_rel);
                if (callbackState && callbackState->callback) {
                    callbackState->callback(DOOF_VM_REMOTE_SERVER_EVENT_DISCONNECTED,
                                            server_active_connections.load(std::memory_order_acquire),
                                            callbackState->user_data);
                }
                ::close(clientFd);
            }
            if (!threadStarted) {
                continue;
            }
        }
        if (listenFd >= 0) ::close(listenFd);
        });
    } catch (...) {
        server_running.store(false);
        set_callback_state(nullptr, nullptr);
        if (listenFd >= 0) ::close(listenFd);
        server_listen_fd = -1;
        if (out_error) *out_error = strdup("failed to start server thread");
        return 3;
    }
    return 0;
}

void doof_vm_stop_remote_server() {
    if (!server_running.load()) return;
    server_running.store(false);
    int fd = server_listen_fd; server_listen_fd = -1;
    if (fd >= 0) {
        ::shutdown(fd, SHUT_RDWR);
        ::close(fd);
    }
    if (server_thread.joinable()) server_thread.join();
    server_active_connections.store(0, std::memory_order_release);
    set_callback_state(nullptr, nullptr);
}

void doof_vm_set_vm_initializer(doof_vm_initializer_cpp_t initializer, void* user_data) {
    std::lock_guard<std::mutex> lock(g_vm_initializer_mutex);
    g_vm_initializer = initializer;
    g_vm_initializer_user_data = user_data;
}

int doof_vm_remote_server_active_connections(void) {
    return server_active_connections.load(std::memory_order_acquire);
}

} // extern "C"
