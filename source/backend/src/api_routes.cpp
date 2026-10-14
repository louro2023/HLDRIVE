#include "job_queue.hpp"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <thread>

#include "assets.hpp"
#include "file_jobs.hpp"
#include "file_manager.hpp"
#include "jailbreak.hpp"
#include "json_writer.hpp"
#include "log.hpp"

namespace fs = std::filesystem;

namespace prospero {

namespace {

constexpr uint64_t kMiB = 1024ull * 1024ull;
constexpr uint64_t kGiB = 1024ull * kMiB;

// PS5's FreeBSD kernel returns EAGAIN with zero bytes under sendfile() on PFS/exFAT, and
// MHD's fd-backed response path has no retry for that. Reading via pread() chunks avoids it.
constexpr size_t kDownloadReadChunk = 2 * 1024 * 1024;

class FileReadStream final : public HttpBodyStream {
  public:
    FileReadStream(int fd, std::shared_ptr<void> lease) : fd_(fd), lease_(std::move(lease)) {}
    ~FileReadStream() override {
        if (fd_ >= 0) close(fd_);
#ifdef PROSPEROMGR_DEBUG_NET
        double elapsed_s = std::chrono::duration<double>(std::chrono::steady_clock::now() - started_).count();
        double mb_s = elapsed_s > 0 ? (static_cast<double>(bytes_read_) / (1024.0 * 1024.0)) / elapsed_s : 0;
        LogEvent("[net] download stream: " + std::to_string(bytes_read_) + " bytes in " +
                 std::to_string(elapsed_s) + "s (" + std::to_string(mb_s) + " MB/s)");
#endif
    }

    ssize_t Read(uint64_t position, char *buffer, size_t max_bytes) override {
        size_t wanted = std::min(max_bytes, kDownloadReadChunk);
        ssize_t got;
        do {
            got = pread(fd_, buffer, wanted, static_cast<off_t>(position));
        } while (got < 0 && errno == EINTR);

        if (got > 0) {
#ifdef PROSPEROMGR_DEBUG_NET
            bytes_read_ += static_cast<uint64_t>(got);
#endif
            return got;
        }
        if (got == 0) return MHD_CONTENT_READER_END_OF_STREAM;
        return MHD_CONTENT_READER_END_WITH_ERROR;
    }

  private:
    int fd_ = -1;
    std::shared_ptr<void> lease_;
#ifdef PROSPEROMGR_DEBUG_NET
    uint64_t bytes_read_ = 0;
    std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
#endif
};

class FileReadLease {
  public:
    explicit FileReadLease(std::string path) : path_(std::move(path)), active_(BeginFileRead(path_, &error_)) {}
    ~FileReadLease() { if (active_) EndFileRead(path_); }

    explicit operator bool() const { return active_; }
    const std::string &Error() const { return error_; }

  private:
    std::string path_;
    std::string error_;
    bool active_ = false;
};

std::string FileVersion(const struct stat &st) {
    return std::to_string(static_cast<unsigned long long>(st.st_dev)) + "-" +
           std::to_string(static_cast<unsigned long long>(st.st_ino)) + "-" +
           std::to_string(static_cast<unsigned long long>(st.st_size)) + "-" +
           std::to_string(static_cast<long long>(st.st_mtim.tv_sec)) + "-" +
           std::to_string(st.st_mtim.tv_nsec);
}

bool ValidUtf8(const std::string &text) {
    size_t i = 0;
    while (i < text.size()) {
        unsigned char c = static_cast<unsigned char>(text[i]);
        if (c == 0) return false;
        if (c < 0x80) { i++; continue; }
        size_t count = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC2 ? 2 : 0;
        if (count == 0 || i + count > text.size()) return false;
        uint32_t value = c & ((1u << (7 - count)) - 1u);
        for (size_t j = 1; j < count; j++) {
            unsigned char next = static_cast<unsigned char>(text[i + j]);
            if ((next & 0xC0) != 0x80) return false;
            value = (value << 6) | (next & 0x3F);
        }
        if ((count == 2 && value < 0x80) || (count == 3 && value < 0x800) ||
            (count == 4 && value < 0x10000) || value > 0x10FFFF ||
            (value >= 0xD800 && value <= 0xDFFF)) return false;
        i += count;
    }
    return true;
}

std::string ContentDisposition(const std::string &filename) {
    std::string fallback;
    std::string encoded;
    const char hex[] = "0123456789ABCDEF";
    for (unsigned char c : filename) {
        fallback += c >= 0x20 && c < 0x7F && c != '"' && c != '\\' ? static_cast<char>(c) : '_';
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.') encoded += static_cast<char>(c);
        else {
            encoded.push_back('%');
            encoded.push_back(hex[c >> 4]);
            encoded.push_back(hex[c & 15]);
        }
    }
    if (fallback.empty()) fallback = "download";
    return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded;
}

#ifdef PROSPEROMGR_DEBUG_NET
// Streams a fixed, reused buffer up to `total_` bytes — constant-memory even for a multi-GiB
// request, isolating MHD/TCP throughput from filesystem cost. Mirror of net-sink on upload.
class GeneratedStream final : public HttpBodyStream {
  public:
    explicit GeneratedStream(uint64_t total) : total_(total) {
        pattern_.resize(4 * 1024 * 1024);
        for (size_t i = 0; i < pattern_.size(); i++) pattern_[i] = static_cast<char>(i);
    }
    ~GeneratedStream() override {
        double elapsed_s = std::chrono::duration<double>(std::chrono::steady_clock::now() - started_).count();
        double mb_s = elapsed_s > 0 ? (static_cast<double>(sent_) / (1024.0 * 1024.0)) / elapsed_s : 0;
        LogEvent("[net] net-source: " + std::to_string(sent_) + " bytes in " + std::to_string(elapsed_s) +
                 "s (" + std::to_string(mb_s) + " MB/s)");
    }

    ssize_t Read(uint64_t position, char *buffer, size_t max_bytes) override {
        if (position >= total_) return MHD_CONTENT_READER_END_OF_STREAM;
        size_t wanted = std::min<uint64_t>(max_bytes, total_ - position);
        wanted = std::min(wanted, pattern_.size());
        std::memcpy(buffer, pattern_.data(), wanted);
        sent_ += wanted;
        return static_cast<ssize_t>(wanted);
    }

  private:
    uint64_t total_;
    uint64_t sent_ = 0;
    std::vector<char> pattern_;
    std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
};
#endif

bool ParseUint64(const std::string &text, uint64_t *value) {
    if (!value || text.empty()) return false;
    char *end = nullptr;
    errno = 0;
    unsigned long long parsed = std::strtoull(text.c_str(), &end, 10);
    if (errno || !end || *end != '\0') return false;
    *value = static_cast<uint64_t>(parsed);
    return true;
}

bool SafeUploadId(const std::string &id) {
    if (id.empty() || id.size() > 64) return false;
    for (unsigned char c : id) {
        if (!std::isalnum(c) && c != '-' && c != '_') return false;
    }
    return true;
}

class ImmediateFileMutationGuard {
public:
    explicit ImmediateFileMutationGuard(std::string *err) : active_(BeginImmediateFileMutation(err)) {}
    ~ImmediateFileMutationGuard() { if (active_) EndImmediateFileMutation(); }

    explicit operator bool() const { return active_; }

private:
    bool active_ = false;
};

std::string FileEntryToJson(const FileManagerEntry &e) {
    return JsonWriter()
        .Str("name", e.name)
        .Bool("is_dir", e.is_dir)
        .Int("size", static_cast<long long>(e.size))
        .Int("mode", e.mode)
        .Str("modified", e.modified)
        .Done();
}

std::string FileJobToJson(const FileJobInfo &job) {
    return JsonWriter()
        .Int("id", static_cast<long long>(job.id))
        .Str("type", job.type)
        .Str("state", job.state)
        .Str("source", job.source)
        .Str("destination", job.destination)
        .Str("current", job.current)
        .Int("current_index", static_cast<long long>(job.current_index))
        .Int("total_items", static_cast<long long>(job.total_items))
        .Int("completed", static_cast<long long>(job.completed_bytes))
        .Int("total", static_cast<long long>(job.total_bytes))
        .Str("error", job.error)
        .Str("error_code", job.error_code)
        .Str("compression", job.compression)
        .Str("conflict_policy", job.conflict_policy)
        .Bool("delete_source", job.delete_source_on_success)
        .Bool("ephemeral", job.ephemeral)
        .Done();
}

std::string ArchiveEntryToJson(const ArchiveEntryInfo &e) {
    return JsonWriter()
        .Str("name", e.name)
        .Bool("is_dir", e.is_dir)
        .Int("compressed_size", static_cast<long long>(e.compressed_size))
        .Int("uncompressed_size", static_cast<long long>(e.uncompressed_size))
        .Done();
}

std::string GuessContentType(const std::string &filename) {
    auto ends_with = [&](const char *suffix) {
        size_t n = std::strlen(suffix);
        return filename.size() >= n && filename.compare(filename.size() - n, n, suffix) == 0;
    };
    if (ends_with(".png")) return "image/png";
    if (ends_with(".jpg") || ends_with(".jpeg")) return "image/jpeg";
    if (ends_with(".json")) return "application/json";
    if (ends_with(".txt") || ends_with(".ini") || ends_with(".log")) return "text/plain; charset=utf-8";
    if (IsZipFilename(filename)) return "application/zip";
    if (IsRarFilename(filename)) return "application/vnd.rar";
    return "application/octet-stream";
}

} // namespace

void RegisterFileRoutes(HttpServer *server, const Config &cfg) {
    server->Route("GET", "/api/status", [](const HttpRequest &) {
        return HttpResponse::Json(JsonWriter().Str("name", "HLDRIVE").Str("version", "0.2.0").Done());
    });
    server->Route("GET", "/api/ftp/status", [](const HttpRequest &) {
        std::vector<FileManagerEntry> probe;
        std::string err;
        bool ready = ListNativeDirectory("/", &probe, &err);
        return HttpResponse::Json(JsonWriter().Bool("reachable", ready).Str("mode", "native").Str("error", err).Done());
    });

    server->Route("GET", "/api/ftp/list", [](const HttpRequest &req) {
        std::string path = req.Query("path", "/");

        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);
        std::string err;
        std::vector<FileManagerEntry> entries;
        if (!ListNativeDirectory(path, &entries, &err)) return HttpResponse::Error(err, 500);

        std::vector<std::string> items;
        for (const auto &e : entries) items.push_back(FileEntryToJson(e));
        return HttpResponse::Json(
            JsonWriter().Str("path", path).Raw("entries", JsonWriter::Array(items)).Done());
    });

    server->Route("POST", "/api/ftp/conflicts", [](const HttpRequest &req) {
        std::vector<std::string> paths = JsonExtractStringArray(req.body, "paths");
        if (paths.empty()) return HttpResponse::Json(JsonWriter().Raw("paths", "[]").Done());
        auto external = std::find_if(paths.begin(), paths.end(), IsExternalStoragePath);
        auto lease = std::make_shared<FileReadLease>(external == paths.end() ? paths.front() : *external);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);

        std::vector<std::string> existing;
        for (const auto &path : paths) {
            bool parent_traversal = false;
            for (const auto &part : fs::path(path)) if (part == "..") parent_traversal = true;
            if (path.empty() || path.front() != '/' || parent_traversal || IsKernelUnsafePath(path)) {
                return HttpResponse::Error("invalid conflict-check path");
            }
            struct stat st {};
            if (lstat(path.c_str(), &st) == 0) existing.push_back(JsonWriter::Quote(path));
            else if (errno != ENOENT) return HttpResponse::Error("could not inspect upload destination", 500);
        }
        return HttpResponse::Json(JsonWriter().Raw("paths", JsonWriter::Array(existing)).Done());
    });

    // Backs the upload conflict dialog's "Keep both" option — same renaming
    // UniqueSiblingName() already does for copy/move/extract collisions.
    server->Route("POST", "/api/ftp/unique-names", [](const HttpRequest &req) {
        std::vector<std::string> paths = JsonExtractStringArray(req.body, "paths");
        if (paths.empty()) return HttpResponse::Json(JsonWriter().Raw("paths", "[]").Done());

        std::vector<std::string> renamed;
        for (const auto &path : paths) {
            bool parent_traversal = false;
            for (const auto &part : fs::path(path)) if (part == "..") parent_traversal = true;
            if (path.empty() || path.front() != '/' || parent_traversal || IsKernelUnsafePath(path)) {
                return HttpResponse::Error("invalid path");
            }
            std::string unique = UniqueSiblingPath(path);
            if (unique.empty()) return HttpResponse::Error("too many name collisions: " + path, 409);
            renamed.push_back(JsonWriter::Quote(unique));
        }
        return HttpResponse::Json(JsonWriter().Raw("paths", JsonWriter::Array(renamed)).Done());
    });

    server->Route("GET", "/api/ftp/dirsize", [](const HttpRequest &req) {
        std::string path = req.Query("path");
        if (path.empty()) return HttpResponse::Error("missing 'path'");
        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);

        uint64_t size = 0;
        std::string err;
        errno = 0;
        if (!NativeDirectorySize(path, &size, &err)) return HttpResponse::Error(err, errno == EBUSY ? 409 : 500);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Int("size", static_cast<long long>(size)).Done());
    });

    server->Route("POST", "/api/ftp/mkdir", [](const HttpRequest &req) {
        std::string path = JsonExtractString(req.body, "path");
        if (path.empty()) return HttpResponse::Error("missing 'path'");

        std::string err;
        ImmediateFileMutationGuard mutation(&err);
        if (!mutation) return HttpResponse::Error(err, 409);
        bool ok = CreateNativeDirectory(path, &err);
        if (!ok) return HttpResponse::Error(err, 500);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Done());
    });

    server->Route("POST", "/api/ftp/delete", [](const HttpRequest &req) {
        std::string path = JsonExtractString(req.body, "path");
        if (path.empty()) return HttpResponse::Error("missing 'path'");

        uint64_t id = 0;
        std::string err;
        if (!QueueDeleteJob(path, &id, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Int("job_id", static_cast<long long>(id)).Done());
    });

    server->Route("POST", "/api/ftp/chmod", [](const HttpRequest &req) {
        std::string path = JsonExtractString(req.body, "path");
        std::string mode_text = JsonExtractString(req.body, "mode");
        if (path.empty() || mode_text.empty()) return HttpResponse::Error("missing 'path' or 'mode'");
        char *end = nullptr;
        errno = 0;
        unsigned long mode = std::strtoul(mode_text.c_str(), &end, 8);
        if (errno || !end || *end != '\0' || mode > 07777) return HttpResponse::Error("invalid octal permissions");

        std::string err;
        ImmediateFileMutationGuard mutation(&err);
        if (!mutation) return HttpResponse::Error(err, 409);
        if (!SetNativePermissions(path, static_cast<uint32_t>(mode), &err)) return HttpResponse::Error(err, 500);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Done());
    });

    server->Route("POST", "/api/ftp/rename", [](const HttpRequest &req) {
        std::string from = JsonExtractString(req.body, "from");
        std::string to = JsonExtractString(req.body, "to");
        if (from.empty() || to.empty()) return HttpResponse::Error("missing 'from'/'to'");

        std::string err;
        ImmediateFileMutationGuard mutation(&err);
        if (!mutation) return HttpResponse::Error(err, 409);
        bool ok = RenameNativePath(from, to, &err);
        if (!ok) return HttpResponse::Error(err, 500);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Done());
    });

    server->Route("GET", "/api/ftp/storage", [](const HttpRequest &) {
        std::vector<std::string> items;
        for (const auto &volume : ListStorageVolumes()) {
            items.push_back(JsonWriter()
                                .Str("label", volume.label)
                                .Str("kind", volume.kind)
                                .Int("index", volume.index)
                                .Str("path", volume.path)
                                .Int("total", static_cast<long long>(volume.total_bytes))
                                .Int("free", static_cast<long long>(volume.free_bytes))
                                .Done());
        }
        return HttpResponse::Json(JsonWriter().Raw("volumes", JsonWriter::Array(items)).Done());
    });

    // `path` is normally the file to be written, so its parent is checked. Pass
    // is_dir=1 when path is the destination itself, which matters at a mount boundary.
    server->Route("GET", "/api/ftp/preflight", [](const HttpRequest &req) {
        std::string path = req.Query("path");
        std::string raw_size = req.Query("size");
        bool is_dir = req.Query("is_dir") == "1";
        if (path.empty() || raw_size.empty()) return HttpResponse::Error("missing path/size");
        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);
        char *end = nullptr;
        errno = 0;
        unsigned long long size = std::strtoull(raw_size.c_str(), &end, 10);
        if (errno || !end || *end != '\0') return HttpResponse::Error("invalid upload size");
        uint64_t available = 0;
        std::string err;
        bool ok = is_dir ? CheckFreeSpaceAtDirectory(path, size, &available, &err)
                          : CheckUploadSpace(path, size, &available, &err);
        if (!ok) {
            return HttpResponse::Json(JsonWriter().Bool("ok", false).Int("available", available).Str("error", err).Done(), 507);
        }
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Int("available", available).Done());
    });

    server->Route("POST", "/api/ftp/zip", [](const HttpRequest &req) {
        std::string path = JsonExtractString(req.body, "path");
        std::string compression = JsonExtractString(req.body, "compression");
        if (path.empty()) return HttpResponse::Error("missing 'path'");
        if (compression.empty()) compression = "smart";

        fs::path source(path);
        std::string destination = (source.parent_path() / (source.filename().string() + ".zip")).string();
        uint64_t id = 0;
        std::string err;
        if (!QueueZipJob({path}, destination, compression, &id, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Int("job_id", static_cast<long long>(id))
                                      .Str("zip_name", fs::path(destination).filename().string())
                                      .Done());
    });

    // One archive from several items, each keeping its top-level name so siblings
    // can't collide. `dir` is where it lands, `name` is the archive's filename.
    server->Route("POST", "/api/ftp/zip-selection", [](const HttpRequest &req) {
        std::vector<std::string> paths = JsonExtractStringArray(req.body, "paths");
        std::string dir = JsonExtractString(req.body, "dir");
        std::string name = JsonExtractString(req.body, "name");
        std::string compression = JsonExtractString(req.body, "compression");
        if (paths.empty() || dir.empty() || name.empty()) return HttpResponse::Error("missing 'paths', 'dir', or 'name'");
        if (compression.empty()) compression = "smart";
        if (!IsZipFilename(name)) name += ".zip";

        std::string destination = (fs::path(dir) / name).string();
        uint64_t id = 0;
        std::string err;
        if (!QueueZipJob(paths, destination, compression, &id, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Int("job_id", static_cast<long long>(id))
                                      .Str("zip_name", name)
                                      .Done());
    });

    // Temporary "Download as ZIP", written under Prospero's temp directory.
    // /api/ftp/download unlinks it as soon as it opens it for streaming.
    server->Route("POST", "/api/ftp/download-zip", [](const HttpRequest &req) {
        std::vector<std::string> paths = JsonExtractStringArray(req.body, "paths");
        std::string name = JsonExtractString(req.body, "name");
        if (paths.empty() || name.empty()) return HttpResponse::Error("missing 'paths' or 'name'");
        if (!IsZipFilename(name)) name += ".zip";

        uint64_t id = 0;
        std::string download_path, err;
        if (!QueueDownloadZipJob(paths, name, &id, &download_path, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Int("job_id", static_cast<long long>(id))
                                      .Str("download_path", download_path)
                                      .Done());
    });

    // Reads only the ZIP central directory (never decompresses) — backs both
    // the Extract Archive dialog's stats and the Open Archive inspector.
    server->Route("GET", "/api/ftp/archive-info", [](const HttpRequest &req) {
        std::string path = req.Query("path");
        if (path.empty() || !(IsZipFilename(path) || IsRarFilename(path))) {
            return HttpResponse::Error("missing 'path' or not a .zip/.rar file");
        }
        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);

        ArchiveInfo info;
        std::string err, code;
        if (!ReadArchiveInfo(path, req.Query("password"), &info, &err, &code)) {
            return code.empty() ? HttpResponse::Error(err, 500) : HttpResponse::CodedError(code, err, 409);
        }

        std::vector<std::string> entries;
        for (const auto &e : info.entries) entries.push_back(ArchiveEntryToJson(e));
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Int("items", static_cast<long long>(info.items))
                                      .Int("compressed_size", static_cast<long long>(info.compressed_size))
                                      .Int("uncompressed_size", static_cast<long long>(info.uncompressed_size))
                                      .Bool("entries_truncated", info.entries_truncated)
                                      .Raw("entries", JsonWriter::Array(entries))
                                      .Done());
    });

    server->Route("POST", "/api/ftp/copy", [](const HttpRequest &req) {
        std::string source = JsonExtractString(req.body, "source");
        std::string destination = JsonExtractString(req.body, "destination");
        std::string conflict_policy = JsonExtractString(req.body, "conflict_policy");
        if (conflict_policy.empty()) conflict_policy = "cancel";
        uint64_t id = 0;
        std::string err;
        if (!QueueFileJob("copy", source, destination, conflict_policy, &id, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Int("job_id", static_cast<long long>(id)).Done());
    });

    server->Route("POST", "/api/ftp/move", [](const HttpRequest &req) {
        std::string source = JsonExtractString(req.body, "source");
        std::string destination = JsonExtractString(req.body, "destination");
        std::string conflict_policy = JsonExtractString(req.body, "conflict_policy");
        if (conflict_policy.empty()) conflict_policy = "cancel";
        uint64_t id = 0;
        std::string err;
        if (!QueueFileJob("move", source, destination, conflict_policy, &id, &err)) return HttpResponse::Error(err, 409);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Int("job_id", static_cast<long long>(id)).Done());
    });

    server->Route("GET", "/api/files/jobs", [](const HttpRequest &) {
        std::vector<std::string> items;
        for (const auto &job : GetFileJobs()) items.push_back(FileJobToJson(job));
        return HttpResponse::Json(JsonWriter().Raw("jobs", JsonWriter::Array(items)).Done());
    });

    server->Route("POST", "/api/files/jobs/cancel", [](const HttpRequest &req) {
        int id = JsonExtractInt(req.body, "id", 0);
        std::string err;
        if (id <= 0 || !CancelFileJob(static_cast<uint64_t>(id), &err)) {
            return HttpResponse::Error(err.empty() ? "invalid job id" : err, 409);
        }
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Done());
    });

    server->Route("POST", "/api/files/jobs/clear", [](const HttpRequest &) {
        ClearFinishedFileJobs();
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Done());
    });

    server->Route("POST", "/api/ftp/unzip", [](const HttpRequest &req) {
        std::string path = JsonExtractString(req.body, "path");
        std::string destination = JsonExtractString(req.body, "destination");
        std::string conflict_policy = JsonExtractString(req.body, "conflict_policy");
        std::string password = JsonExtractString(req.body, "password");
        bool delete_source = JsonExtractBool(req.body, "delete_source", false);
        if (path.empty() || !(IsZipFilename(path) || IsRarFilename(path))) {
            return HttpResponse::Error("missing 'path' or not a .zip/.rar file");
        }
        if (conflict_policy.empty()) conflict_policy = "skip";

        fs::path source(path);
        // Default target keeps the friendly "archive.zip" -> "archive/" behaviour
        // unless the dialog picked a destination.
        std::string folder = source.filename().string();
        folder = folder.substr(0, folder.size() - 4);
        if (destination.empty()) destination = (source.parent_path() / folder).string();
        uint64_t id = 0;
        std::string err;
        if (!QueueUnzipJob(path, destination, conflict_policy, delete_source, password, &id, &err)) {
            return HttpResponse::Error(err, 409);
        }
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Int("job_id", static_cast<long long>(id))
                                      .Str("folder", fs::path(destination).filename().string())
                                      .Done());
    });

    // Returns the text with the metadata needed for a conflict-safe save.
    server->Route("GET", "/api/ftp/text", [](const HttpRequest &req) {
        std::string path = req.Query("path");
        if (path.empty()) return HttpResponse::Error("missing 'path'");

        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);
        struct stat st {};
        if (lstat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
            return HttpResponse::Error("file does not exist or is not a regular file", 404);
        }
        constexpr uint64_t kMaxEditableBytes = 4 * kMiB;
        if (static_cast<uint64_t>(st.st_size) > kMaxEditableBytes) {
            return HttpResponse::Error("file is too large to edit here (over 4 MiB) — download it instead", 413);
        }

        std::ifstream in(path, std::ios::binary);
        if (!in) return HttpResponse::Error("could not open file", 500);
        std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        struct stat after_read {};
        if (lstat(path.c_str(), &after_read) != 0 || FileVersion(after_read) != FileVersion(st)) {
            return HttpResponse::Error("file changed while it was being read; reload it", 409);
        }
        bool bom = text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
                   static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF;
        if (bom) text.erase(0, 3);
        if (!ValidUtf8(text)) return HttpResponse::Error("file is not valid UTF-8 text", 415);
        std::string newline = text.find("\r\n") != std::string::npos ? "crlf" :
                              text.find('\r') != std::string::npos ? "cr" : "lf";
        return HttpResponse::Json(JsonWriter()
                                      .Str("text", text)
                                      .Str("version", FileVersion(st))
                                      .Str("newline", newline)
                                      .Bool("bom", bom)
                                      .Done());
    });

    server->DirectUploadRoute("POST", "/api/ftp/text/write", "path", 5 * kMiB, [](const HttpRequest &req) {
        std::string path = req.Query("path");
        std::string version = req.Query("version");
        if (path.empty() || version.empty() || req.body_file.empty()) {
            return HttpResponse::Error("missing text save parameters");
        }

        struct stat current {};
        if (lstat(path.c_str(), &current) != 0 || !S_ISREG(current.st_mode)) {
            return HttpResponse::Error("file no longer exists or is not a regular file", 409);
        }
        if (FileVersion(current) != version) {
            return HttpResponse::Error("file changed on disk; reload it before saving", 409);
        }

        struct stat staged {};
        if (lstat(req.body_file.c_str(), &staged) != 0 || !S_ISREG(staged.st_mode) || staged.st_size < 0 ||
            static_cast<uint64_t>(staged.st_size) > 4 * kMiB + 3) {
            return HttpResponse::Error("invalid text upload", 413);
        }
        std::ifstream in(req.body_file, std::ios::binary);
        std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        bool bom = text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
                   static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF;
        if (!ValidUtf8(bom ? text.substr(3) : text)) return HttpResponse::Error("saved text is not valid UTF-8", 415);
        if (chmod(req.body_file.c_str(), current.st_mode & 07777) != 0) {
            return HttpResponse::Error(std::string("could not preserve file permissions: ") + std::strerror(errno), 500);
        }
        if (rename(req.body_file.c_str(), path.c_str()) != 0) {
            return HttpResponse::Error(std::string("could not commit text file: ") + std::strerror(errno), 500);
        }
        struct stat saved {};
        if (stat(path.c_str(), &saved) != 0) return HttpResponse::Error("could not verify saved file", 500);
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Str("version", FileVersion(saved)).Done());
    });

    server->Route("GET", "/api/ftp/download", [cfg](const HttpRequest &req) {
        std::string path = req.Query("path");
        if (path.empty()) return HttpResponse::Error("missing 'path'");

        auto lease = std::make_shared<FileReadLease>(path);
        if (!*lease) return HttpResponse::Error(lease->Error(), 409);
        struct stat st {};
        if (stat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
            return HttpResponse::Error("file does not exist or is not a regular file", 404);
        }
        int fd = open(path.c_str(), O_RDONLY);
        // Widens the kernel read-ahead window past its small default, which
        // is what keeps a sequential download from stalling between extents.
        if (fd >= 0) (void)posix_fadvise(fd, 0, 0, POSIX_FADV_SEQUENTIAL);
        if (fd < 0) return HttpResponse::Error("could not open file", 500);

        // Unlink now, with the fd already open: the stream keeps working and the
        // temp archive can't linger however the transfer ends.
        std::string ephemeral_root = cfg.tmp_dir + "/archives/";
        if (path.compare(0, ephemeral_root.size(), ephemeral_root) == 0) std::remove(path.c_str());

        std::string filename = fs::path(path).filename().string();
        HttpResponse resp;
        resp.status = 200;
        resp.content_type = GuessContentType(filename);
        // Stream through FileReadStream rather than handing MHD the fd, so even a
        // multi-GB file transfers with constant memory. See kDownloadReadChunk.
        resp.body_stream_size = static_cast<uint64_t>(st.st_size);
        resp.body_stream = std::make_shared<FileReadStream>(fd, lease);
        resp.extra_headers["Content-Disposition"] = ContentDisposition(filename);
        return resp;
    });

    server->DirectUploadRoute("POST", "/api/ftp/upload", "path", 256 * kGiB, [](const HttpRequest &req) {
        std::string path = req.Query("path");
        bool overwrite = req.Query("overwrite") == "1";
        if (path.empty()) return HttpResponse::Error("missing 'path' query parameter");
        if (req.body_file.empty()) return HttpResponse::Error("empty upload");

        struct stat existing {};
        if (req.body_file != path && lstat(path.c_str(), &existing) == 0) {
            if (!overwrite) return HttpResponse::Error("destination already exists", 409);
            if (!S_ISREG(existing.st_mode)) return HttpResponse::Error("destination is not a regular file", 409);
        } else if (req.body_file != path && errno != 0 && errno != ENOENT) {
            return HttpResponse::Error(std::string("could not inspect upload destination: ") + std::strerror(errno), 500);
        }

        // The body was written to a synced sibling of `path` and dispatched only once
        // complete, so this rename can never expose a partial upload.
        if (rename(req.body_file.c_str(), path.c_str()) != 0) {
            return HttpResponse::Error(std::string("could not commit upload: ") + std::strerror(errno), 500);
        }
        return HttpResponse::Json(JsonWriter().Bool("ok", true).Str("path", path).Done());
    });

    // Large files append straight into their checkpoint — no staging copy, so each
    // byte hits PFS once and a dropped connection only retries the current chunk.
    server->AppendUploadRoute("POST", "/api/ftp/upload/chunk", "path", "upload_id", "offset", "total",
                              264 * kMiB, [](const HttpRequest &req) {
        std::string path = req.Query("path");
        std::string upload_id = req.Query("upload_id");
        bool overwrite = req.Query("overwrite") == "1";
        uint64_t offset = 0, total = 0;
        if (path.empty() || !SafeUploadId(upload_id) ||
            !ParseUint64(req.Query("offset"), &offset) || !ParseUint64(req.Query("total"), &total)) {
            return HttpResponse::Error("invalid resumable-upload parameters");
        }
        if (total == 0 || total > 256 * kGiB || req.body_file.empty()) {
            return HttpResponse::Error("invalid resumable-upload size");
        }
        uint64_t next = offset + req.body_size;
        if (req.body_size == 0 || next > total) return HttpResponse::Error("invalid upload chunk size");
        struct stat checkpoint {};
        if (stat(req.body_file.c_str(), &checkpoint) != 0 || checkpoint.st_size < 0 ||
            static_cast<uint64_t>(checkpoint.st_size) != next) {
            return HttpResponse::Error("saved upload checkpoint has an unexpected size", 409);
        }
        bool complete = next == total;
        if (complete && req.body_file != path) {
            struct stat existing {};
            errno = 0;
            if (lstat(path.c_str(), &existing) == 0) {
                if (!overwrite || !S_ISREG(existing.st_mode)) {
                    std::remove(req.body_file.c_str());
                    ReleaseFileUpload(path, upload_id);
                    return HttpResponse::Error(!overwrite ? "destination already exists" :
                                               "destination is not a regular file", 409);
                }
            } else if (errno != ENOENT) {
                int inspect_error = errno;
                ReleaseFileUpload(path, upload_id);
                return HttpResponse::Error(std::string("could not inspect upload destination: ") +
                                               std::strerror(inspect_error), 500);
            }
            chmod(req.body_file.c_str(), 0777);
            if (rename(req.body_file.c_str(), path.c_str()) != 0) {
                int publish_error = errno;
                ReleaseFileUpload(path, upload_id);
                return HttpResponse::Error(std::string("could not publish completed upload: ") +
                                               std::strerror(publish_error), 500);
            }
        }
        if (complete) {
            ReleaseFileUpload(path, upload_id);
            LogEvent("Completed resumable upload: " + path + " (" + std::to_string(total) + " bytes)");
        }
        return HttpResponse::Json(JsonWriter()
                                      .Bool("ok", true)
                                      .Bool("complete", complete)
                                      .Int("next_offset", static_cast<long long>(next))
                                      .Done());
    });

    server->SetStaticFallback([](const std::string &url) {
        HttpResponse response = ServeEmbeddedAsset(url);
        // A redeployed ELF must never keep the PS5 browser on an older JS
        // bundle whose API method/body contract belongs to the previous build.
        response.extra_headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        response.extra_headers["Pragma"] = "no-cache";
        return response;
    });
}

} // namespace prospero
