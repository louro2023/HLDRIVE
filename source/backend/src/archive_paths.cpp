#include "archive_paths.hpp"

namespace fs = std::filesystem;

namespace prospero {

bool SafeArchiveRelativePath(const std::string &archive_name, fs::path *normalized_relative, std::string *error) {
    if (archive_name.empty()) {
        if (error) *error = "archive entry has an empty name";
        return false;
    }
    if (archive_name.find('\0') != std::string::npos) {
        if (error) *error = "archive entry name contains a NUL byte";
        return false;
    }

    std::string cleaned = archive_name;
    for (char &c : cleaned) {
        if (c == '\\') c = '/';
    }

    // Reject a Windows drive-letter absolute form ("C:/foo") — std::filesystem
    // on POSIX doesn't treat a bare colon as special, so this needs its own check.
    if (cleaned.size() >= 2 && cleaned[1] == ':') {
        if (error) *error = "archive entry uses an absolute path: " + archive_name;
        return false;
    }
    if (cleaned.front() == '/') {
        if (error) *error = "archive entry uses an absolute path: " + archive_name;
        return false;
    }

    fs::path input(cleaned);
    if (input.is_absolute()) {
        if (error) *error = "archive entry uses an absolute path: " + archive_name;
        return false;
    }
    for (const auto &part : input) {
        if (part == "..") {
            if (error) *error = "archive entry attempts to traverse outside the destination: " + archive_name;
            return false;
        }
    }

    fs::path normalized = input.lexically_normal();
    std::string normalized_text = normalized.string();
    if (normalized_text.empty() || normalized_text == "." || normalized.is_absolute()) {
        if (error) *error = "archive entry resolves to an invalid path: " + archive_name;
        return false;
    }
    // A path like "a/../../b" only becomes unsafe once normalized, so check the
    // normalized form as well.
    for (const auto &part : normalized) {
        if (part == "..") {
            if (error) *error = "archive entry attempts to traverse outside the destination: " + archive_name;
            return false;
        }
    }

    if (normalized_relative) *normalized_relative = normalized;
    return true;
}

bool IsWithinRoot(const fs::path &root, const fs::path &candidate) {
    fs::path root_norm = root.lexically_normal();
    fs::path candidate_norm = candidate.lexically_normal();
    if (candidate_norm == root_norm) return true;
    std::string root_text = root_norm.string();
    std::string candidate_text = candidate_norm.string();
    if (root_text.empty() || root_text.back() != '/') root_text.push_back('/');
    return candidate_text.rfind(root_text, 0) == 0;
}

} // namespace prospero
