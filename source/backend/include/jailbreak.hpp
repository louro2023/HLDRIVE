#pragma once
// Self privilege escalation — raises HLDRIVE's own process credentials (uid, jail
// dir, auth ID, caps) using the kernel R/W every jailbroken payload already has via <ps5/kernel.h>.

#include <string>

namespace prospero {

// PS5-only; host builds return false with a clear reason. Safe to call more
// than once. Escalates the *calling* process (getpid()) only.
bool EscalatePrivileges(std::string *err);

// Cached result of the last EscalatePrivileges() call, for /api/status.
bool IsPrivileged();

} // namespace prospero
