#pragma once
// Small in-memory ring buffer of recent events, for the Logs sidebar panel
// — the only place logs are visible once this is running headless on a PS5.

#include <string>
#include <vector>

namespace prospero {

void LogEvent(const std::string &line);
std::vector<std::string> GetLogs();
void ClearLogs();

// Enables an append-only diagnostic log after Config creates its data directory, rotated
// at a bounded size so a long-running payload can't fill /data. Failures never affect the service.
void ConfigurePersistentLog(const std::string &path);
std::string PersistentLogPath();

// Gives the calling thread its own signal stack, so a stack overflow on it
// can still run the fatal handler and leave a breadcrumb in the log.
void InstallCrashStack();

// Process start time, for the Home page's uptime readout.
void MarkStartTime();
long UptimeSeconds();
std::string ProcessInstanceId();

} // namespace prospero
