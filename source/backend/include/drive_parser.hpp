#pragma once
#include <string>
#include <vector>
namespace hldrive {
struct DriveRef { std::string id, resource_key; };
struct DriveEntry { DriveRef ref; std::string name; bool folder = false; };
struct DriveListing { std::string name; std::vector<DriveEntry> entries; };
bool ParseDriveFolder(const std::string &, DriveRef *);
bool ParseDriveListing(const std::string &, DriveListing *, std::string *error);
std::string DownloadConfirmation(const std::string &, const std::string &expected_id);
std::string Encode(const std::string &);
bool SafeName(const std::string &);
bool SafeGoogleUrl(const std::string &);
}
