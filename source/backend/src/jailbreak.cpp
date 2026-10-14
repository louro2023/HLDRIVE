#include "jailbreak.hpp"

#include <cstdint>
#include <cstring>
#include <unistd.h>

#include <ps5/kernel.h>

namespace prospero {

namespace {
bool g_privileged = false;

// Identifies the process as a fully-privileged system app to every
// credential check that looks at it.
constexpr uint64_t kJbAuthId = 0x4801000000000013ULL;
} // namespace

bool IsPrivileged() { return g_privileged; }

bool EscalatePrivileges(std::string *err) {
    pid_t pid = getpid();

    if (!kernel_get_proc(pid)) {
        if (err) *err = "kernel_get_proc failed — kernel R/W not available";
        return false;
    }

    bool ok = true;
    ok = kernel_set_ucred_uid(pid, 0) == 0 && ok;
    ok = kernel_set_ucred_ruid(pid, 0) == 0 && ok;
    ok = kernel_set_ucred_svuid(pid, 0) == 0 && ok;
    ok = kernel_set_ucred_rgid(pid, 0) == 0 && ok;
    ok = kernel_set_ucred_svgid(pid, 0) == 0 && ok;

    intptr_t root_vnode = kernel_get_root_vnode();
    if (root_vnode) {
        ok = kernel_set_proc_rootdir(pid, root_vnode) == 0 && ok;
        ok = kernel_set_proc_jaildir(pid, root_vnode) == 0 && ok;
    }

    ok = kernel_set_ucred_authid(pid, kJbAuthId) == 0 && ok;

    uint8_t caps[16];
    std::memset(caps, 0xff, sizeof(caps));
    ok = kernel_set_ucred_caps(pid, caps) == 0 && ok;

    uint8_t attrs[32];
    std::memset(attrs, 0, sizeof(attrs));
    attrs[0] = 0x80;
    ok = kernel_set_ucred_attrs(pid, attrs) == 0 && ok;

    g_privileged = ok;
    if (!ok && err) *err = "one or more kernel_set_ucred_* calls failed";
    return ok;
}

} // namespace prospero
