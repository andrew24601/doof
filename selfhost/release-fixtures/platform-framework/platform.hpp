#pragma once

#include <CoreFoundation/CoreFoundation.h>
#include <cstdint>

namespace release_platform {
inline int32_t value() {
  return static_cast<int32_t>(CFStringGetLength(CFSTR("ok")));
}
}  // namespace release_platform
