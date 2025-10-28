#include <iostream>
#include <vector>
#include <string>
#include <thread>
#include <atomic>
#include <csignal>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
#include <arpa/inet.h>
#include "vm.h"
#include "dap.h"
#include "dap_channel.h"
#include "json.h"

// Simple blocking socket DAP channel.
class SocketDAPChannel : public DAPChannel {
public:
    explicit SocketDAPChannel(int fd) : fd_(fd) {}
    ~SocketDAPChannel() override { if (fd_>=0) ::close(fd_); }

    bool readMessage(std::string &outJson) override {
        // Read headers until blank line then read content-length bytes
        std::string headerBuf;
        char ch;
        while (true) {
            ssize_t n = ::recv(fd_, &ch, 1, 0);
            if (n <= 0) return false;
            headerBuf.push_back(ch);
            if (headerBuf.size() > 4 &&
                headerBuf.substr(headerBuf.size()-4) == "\r\n\r\n") {
                break;
            }
            // Support raw JSON (no framing) if first char is '{'
            if (headerBuf.size()==1 && ch=='{') {
                // read rest until '}' naive (prototype only)
                std::string json; json.push_back('{');
                while (true) {
                    char c; ssize_t m = ::recv(fd_, &c, 1, 0); if (m<=0) return false; json.push_back(c); if (c=='}') break; }
                outJson = std::move(json);
                return true;
            }
        }
        // Parse Content-Length
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

struct SessionState {
    std::atomic<bool> running{false};
};

static std::atomic<bool> stopFlag(false);
static std::atomic<int> listenSocketFd{-1};
static std::atomic<int> activeClientFd{-1};

void signalHandler(int){
    stopFlag.store(true);

    int listenFd = listenSocketFd.exchange(-1);
    if (listenFd >= 0) {
        ::shutdown(listenFd, SHUT_RDWR);
        ::close(listenFd);
    }

    int clientFd = activeClientFd.exchange(-1);
    if (clientFd >= 0) {
        ::shutdown(clientFd, SHUT_RDWR);
    }
}

int create_listen_socket(int port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return -1; }
    int opt=1; setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_addr.s_addr = INADDR_ANY; addr.sin_port = htons(port);
    if (bind(fd, (sockaddr*)&addr, sizeof(addr))<0) { perror("bind"); ::close(fd); return -1; }
    if (listen(fd, 1) < 0) { perror("listen"); ::close(fd); return -1; }
    listenSocketFd.store(fd);
    return fd;
}

// Expect first message from client: { "command":"upload", "length": N }
// Followed by raw N bytes of JSON bytecode (the .vmbc file content).
// Then client sends standard DAP messages (initialize, launch, etc.).
int main(int argc, char* argv[]) {
    int port = 7777;
    if (argc > 1) port = std::stoi(argv[1]);
    std::cout << "remote-vm-server listening on port " << port << std::endl;
    signal(SIGINT, signalHandler);
    int listenFd = create_listen_socket(port);
    if (listenFd < 0) return 1;
    SessionState state;
    while(!stopFlag.load()) {
        std::cout << "Waiting for connection..." << std::endl;
    int clientFd = ::accept(listenFd, nullptr, nullptr);
        if (clientFd < 0) { if (stopFlag.load()) break; perror("accept"); continue; }
        if (state.running.load()) { std::cerr << "Session already running, rejecting connection" << std::endl; ::close(clientFd); continue; }
        state.running.store(true);
        activeClientFd.store(clientFd);
        std::thread([clientFd,&state](){
            SocketDAPChannel channel(clientFd);
            DoofVM vm;
            DAPHandler dap(&vm);
            vm.setDAPHandler(&dap);
            dap.setOutputChannel(&channel);
            // Client will send uploadBytecode and then launch via DAP
            dap.run(&channel);
            activeClientFd.store(-1);
            state.running.store(false);
        }).detach();
    }
    int fd = listenSocketFd.exchange(-1);
    if (fd >= 0) {
        ::close(fd);
    }
    return 0;
}
