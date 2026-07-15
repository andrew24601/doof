#pragma once

#include <cstdint>
#include <memory>

namespace release_native {
struct Client : std::enable_shared_from_this<Client> {
  int32_t value;
  explicit Client(int32_t value) : value(value) {}
  int32_t get() { return value; }
  static std::shared_ptr<Client> make(int32_t value) {
    return std::make_shared<Client>(value);
  }
  std::shared_ptr<Client> same();
};
}  // namespace release_native
