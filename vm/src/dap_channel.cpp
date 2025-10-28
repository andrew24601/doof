#include "dap_channel.h"
#include <iostream>
#include <sstream>

bool StdioDAPChannel::readMessage(std::string &outJson) {
    std::string line;    
    std::string header = "Content-Length: ";
    while (std::getline(std::cin, line)) {
        if (line.rfind(header, 0) == 0) {
            std::string lenStr = line.substr(header.size());
            if (!lenStr.empty() && lenStr.back()=='\r') lenStr.pop_back();
            int length = std::stoi(lenStr);
            // Skip empty line
            std::getline(std::cin, line);
            outJson.assign(length, '\0');
            std::cin.read(outJson.data(), length);
            return true;
        } else if (!line.empty() && line.front()=='{') {
            // fallback raw json line
            outJson = line;
            return true;
        }
    }
    return false; // EOF
}

void StdioDAPChannel::writeMessage(const std::string &json) {
    std::cout << "Content-Length: " << json.size() << "\r\n\r\n" << json << std::flush;
}
