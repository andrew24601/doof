// Observer runtime fragment inserted into doof_runtime.hpp.
// Source template for the generated observer support.
// ============================================================================

namespace observe {

inline const char* _asset_html = R"DOOFOBS(__DOOF_OBSERVER_HTML__)DOOFOBS";
inline const char* _asset_css = R"DOOFOBS(__DOOF_OBSERVER_CSS__)DOOFOBS";
inline const char* _asset_js = R"DOOFOBS(__DOOF_OBSERVER_JS__)DOOFOBS";
inline std::once_flag _server_once;

#if defined(_WIN32)
using socket_handle = SOCKET;
inline constexpr socket_handle invalid_socket_handle = INVALID_SOCKET;
inline void close_socket(socket_handle socket) { closesocket(socket); }
inline bool initialize_sockets() {
    WSADATA data;
    return WSAStartup(MAKEWORD(2, 2), &data) == 0;
}
#else
using socket_handle = int;
inline constexpr socket_handle invalid_socket_handle = -1;
inline void close_socket(socket_handle socket) { close(socket); }
inline bool initialize_sockets() { return true; }
#endif

inline std::string json_escape(const std::string& value) {
    std::ostringstream out;
    out << '"';
    for (unsigned char ch : value) {
        switch (ch) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (ch < 0x20) {
                    static constexpr char HEX[] = "0123456789abcdef";
                    out << "\\u00" << HEX[(ch >> 4) & 0x0F] << HEX[ch & 0x0F];
                } else {
                    out << static_cast<char>(ch);
                }
                break;
        }
    }
    out << '"';
    return out.str();
}

inline std::string snapshot_metrics_json() {
    const auto snapshot = metrics::snapshot_pairs();
    std::ostringstream out;
    out << '[';
    for (size_t index = 0; index < snapshot.size(); ++index) {
        if (index > 0) out << ',';
        out << "{\"name\":" << json_escape(snapshot[index].first)
            << ",\"value\":" << snapshot[index].second << '}';
    }
    out << ']';
    return out.str();
}

inline void launch_browser(const std::string& url) {
#if defined(_WIN32)
    const std::string command = "start \"\" \"" + url + "\"";
#elif defined(__APPLE__)
    const std::string command = "open \"" + url + "\" >/dev/null 2>&1";
#else
    const std::string command = "xdg-open \"" + url + "\" >/dev/null 2>&1";
#endif
    const int status = std::system(command.c_str());
    if (status != 0) {
        std::cerr << "[doof] observer available at " << url << " (could not launch browser)" << std::endl;
    }
}

inline bool should_launch_browser() {
    const char* value = std::getenv("DOOF_OBSERVE_NO_BROWSER");
    return value == nullptr || value[0] == '\\0' || std::string(value) == "0";
}

inline std::string reason_phrase(int status) {
    switch (status) {
        case 200: return "OK";
        case 404: return "Not Found";
        case 405: return "Method Not Allowed";
        default: return "Internal Server Error";
    }
}

inline void send_response(socket_handle client, int status, const std::string& content_type, const std::string& body) {
    std::ostringstream header;
    header << "HTTP/1.1 " << status << ' ' << reason_phrase(status) << "\r\n"
        << "Content-Type: " << content_type << "\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Cache-Control: no-store\r\n"
        << "Connection: close\r\n\r\n";
    const std::string response = header.str() + body;
    const char* data = response.data();
    size_t remaining = response.size();
    while (remaining > 0) {
#if defined(_WIN32)
        const int sent = send(client, data, static_cast<int>(remaining > INT_MAX ? INT_MAX : remaining), 0);
#else
        const ssize_t sent = send(client, data, remaining, 0);
#endif
        if (sent <= 0) return;
        data += sent;
        remaining -= static_cast<size_t>(sent);
    }
}

inline std::string request_path(const std::string& request) {
    const size_t first_space = request.find(' ');
    if (first_space == std::string::npos) return "";
    const size_t second_space = request.find(' ', first_space + 1);
    if (second_space == std::string::npos) return "";
    return request.substr(first_space + 1, second_space - first_space - 1);
}

inline bool request_is_get(const std::string& request) {
    return request.rfind("GET ", 0) == 0;
}

inline void handle_client(socket_handle client) {
    char buffer[4096];
#if defined(_WIN32)
    const int received = recv(client, buffer, static_cast<int>(sizeof(buffer) - 1), 0);
#else
    const ssize_t received = recv(client, buffer, sizeof(buffer) - 1, 0);
#endif
    if (received <= 0) {
        close_socket(client);
        return;
    }
    buffer[received] = '\0';
    const std::string request(buffer, static_cast<size_t>(received));
    if (!request_is_get(request)) {
        send_response(client, 405, "text/plain; charset=utf-8", "Only GET is supported.\n");
        close_socket(client);
        return;
    }

    const std::string path = request_path(request);
    if (path == "/" || path == "/index.html") {
        send_response(client, 200, "text/html; charset=utf-8", _asset_html);
    } else if (path == "/assets/app.css") {
        send_response(client, 200, "text/css; charset=utf-8", _asset_css);
    } else if (path == "/assets/app.js") {
        send_response(client, 200, "application/javascript; charset=utf-8", _asset_js);
    } else if (path == "/api/metrics") {
        send_response(client, 200, "application/json; charset=utf-8", snapshot_metrics_json());
    } else if (path == "/api/metrics/prometheus") {
        send_response(client, 200, "text/plain; charset=utf-8", metrics::snapshot_prometheus());
    } else {
        send_response(client, 404, "text/plain; charset=utf-8", "Not found.\n");
    }
    close_socket(client);
}

inline void serve_loop(socket_handle server) {
    while (true) {
        sockaddr_in client_addr {};
#if defined(_WIN32)
        int client_len = sizeof(client_addr);
#else
        socklen_t client_len = sizeof(client_addr);
#endif
        socket_handle client = accept(server, reinterpret_cast<sockaddr*>(&client_addr), &client_len);
        if (client == invalid_socket_handle) {
            continue;
        }
        std::thread(handle_client, client).detach();
    }
}

inline void start_server() {
    std::call_once(_server_once, [] {
        if (!initialize_sockets()) {
            std::cerr << "[doof] warning: failed to initialize observer sockets" << std::endl;
            return;
        }

        socket_handle server = socket(AF_INET, SOCK_STREAM, 0);
        if (server == invalid_socket_handle) {
            std::cerr << "[doof] warning: failed to create observer socket" << std::endl;
            return;
        }

        int reuse = 1;
        setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&reuse), sizeof(reuse));

        sockaddr_in addr {};
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
        addr.sin_len = sizeof(addr);
#endif
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            std::cerr << "[doof] warning: failed to bind observer socket" << std::endl;
            close_socket(server);
            return;
        }
        if (listen(server, 16) != 0) {
            std::cerr << "[doof] warning: failed to listen on observer socket" << std::endl;
            close_socket(server);
            return;
        }

        sockaddr_in bound {};
#if defined(_WIN32)
        int bound_len = sizeof(bound);
#else
        socklen_t bound_len = sizeof(bound);
#endif
        if (getsockname(server, reinterpret_cast<sockaddr*>(&bound), &bound_len) != 0) {
            std::cerr << "[doof] warning: failed to read observer socket port" << std::endl;
            close_socket(server);
            return;
        }

        const uint16_t port = ntohs(bound.sin_port);
        const std::string url = std::string("http://127.0.0.1:") + std::to_string(port) + "/";
        std::cout << "DOOF_OBSERVE_URL=" << url << std::endl;
        std::thread(serve_loop, server).detach();
        if (should_launch_browser()) {
            std::thread(launch_browser, url).detach();
        }
    });
}

} // namespace observe
