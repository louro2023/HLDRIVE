#include "config.hpp"

#include <filesystem>
#include <fstream>

#include "file_manager.hpp"

namespace fs = std::filesystem;

namespace prospero {

namespace {

std::string PayloadsDirOverridePath(const std::string &root_dir) { return root_dir + "/payloads_dir.txt"; }

// Empty return means "no override" — caller keeps the default under root_dir.
std::string ReadPayloadsDirOverride(const std::string &root_dir) {
    std::ifstream f(PayloadsDirOverridePath(root_dir));
    std::string path;
    std::getline(f, path);
    while (!path.empty() && (path.back() == '\n' || path.back() == '\r' || path.back() == '/')) path.pop_back();
    return path;
}

} // namespace

Config Config::Load() {
    Config cfg;

    cfg.root_dir = "/data/HLDRIVE";

    std::string override_dir = ReadPayloadsDirOverride(cfg.root_dir);
    cfg.payloads_dir = override_dir.empty() ? cfg.root_dir + "/payloads" : override_dir;
    cfg.autoloader_ini = cfg.payloads_dir + "/autoloader.ini";
    cfg.bundled_dir = cfg.root_dir + "/bundled";
    cfg.tmp_dir = cfg.root_dir + "/tmp";
    cfg.log_file = cfg.root_dir + "/hldrive.log";

    std::error_code ec;
    fs::create_directories(cfg.root_dir, ec);
    fs::create_directories(cfg.payloads_dir, ec);
    fs::create_directories(cfg.bundled_dir, ec);
    fs::create_directories(cfg.tmp_dir, ec);

    return cfg;
}

bool SetPayloadsDirOverride(const Config &cfg, const std::string &path, std::string *err) {
    if (path.empty()) {
        // Empty clears the override — back to the default payloads_dir.
        std::error_code ec;
        fs::remove(PayloadsDirOverridePath(cfg.root_dir), ec);
        return true;
    }

    if (path.front() != '/' || IsKernelUnsafePath(path) || IsProtectedNativeRoot(path)) {
        if (err) *err = "unsafe or invalid path";
        return false;
    }

    std::error_code ec;
    fs::create_directories(path, ec);
    if (ec) {
        if (err) *err = "could not create directory: " + ec.message();
        return false;
    }

    std::ofstream f(PayloadsDirOverridePath(cfg.root_dir), std::ios::trunc);
    f << path;
    if (!f) {
        if (err) *err = "could not save setting";
        return false;
    }
    return true;
}

} // namespace prospero
