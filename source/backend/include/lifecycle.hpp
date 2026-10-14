#pragma once
#include <string>
#include "config.hpp"
#include "http_server.hpp"
namespace prospero {
void RegisterLifecycleRoutes(HttpServer *, const Config &);
bool ShutdownDue();
bool BeginDriveMaintenance();
void EndDriveMaintenance();
bool InstallMediaShortcut(std::string *error);
bool RemoveMediaShortcut(std::string *error);
}
