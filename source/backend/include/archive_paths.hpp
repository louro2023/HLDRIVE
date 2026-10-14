#pragma once
// Shared ZIP Slip / path-traversal guard for the file-manager unzip and
// save-data backup restore, so both use one implementation.

#include <filesystem>
#include <string>

namespace prospero {

// Rejects absolute paths, "..", blank names, and NUL bytes; normalizes backslashes first.
// Doesn't touch the filesystem — callers still need IsWithinRoot() against the real root.
bool SafeArchiveRelativePath(const std::string &archive_name, std::filesystem::path *normalized_relative,
                             std::string *error);

// True if `candidate` (lexically normalized) is `root` or nested under it —
// the final check before any archive-driven filesystem write.
bool IsWithinRoot(const std::filesystem::path &root, const std::filesystem::path &candidate);

} // namespace prospero
