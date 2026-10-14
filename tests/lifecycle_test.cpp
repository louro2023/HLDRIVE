#include "../source/backend/src/lifecycle.cpp"
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
namespace prospero {
std::map<std::string,RouteHandler> handlers;
bool drive_busy=false, file_busy=false, drive_lock=false, file_lock=false, installed=false, native_failure=false;
HttpServer::HttpServer(uint16_t){} HttpServer::~HttpServer(){}
void HttpServer::Route(const std::string &m,const std::string &p,RouteHandler h){handlers[m+" "+p]=h;}
bool BeginDriveMaintenance(){if(drive_busy||drive_lock)return false;return drive_lock=true;}
void EndDriveMaintenance(){drive_lock=false;}
bool BeginImmediateFileMutation(std::string *){if(file_busy||file_lock)return false;return file_lock=true;}
void EndImmediateFileMutation(){file_lock=false;}
bool InstallMediaShortcut(std::string *e){if(native_failure){*e="native install failed";return false;}installed=true;return true;}
bool RemoveMediaShortcut(std::string *e){if(native_failure){*e="native uninstall failed";return false;}return true;}
void ConfigurePersistentLog(const std::string &){}
void LogEvent(const std::string &){}
}
int main(){
 using namespace prospero;namespace fs=std::filesystem;
 HttpServer server(0);Config cfg;RegisterLifecycleRoutes(&server,cfg);
 auto call=[](const char *a,const char *c="HLDRIVE"){HttpRequest r;r.body=JsonWriter().Str("action",a).Str("confirm",c).Done();return handlers.at("POST /api/app/action")(r);};
 assert(call("remove","").status==400);assert(call("invalid").status==400);
 drive_busy=true;assert(call("stop").status==409);drive_busy=false;
 file_busy=true;assert(call("stop").status==409&&!drive_lock);file_busy=false;
 native_failure=true;assert(call("install_shortcut").status==500&&!drive_lock&&!file_lock);assert(call("remove").status==500&&!drive_lock&&!file_lock);native_failure=false;
 assert(call("install_shortcut").status==200&&installed&&!drive_lock&&!file_lock);
 char temp[]="/tmp/hldrive-lifecycle-XXXXXX";assert(mkdtemp(temp));fs::path root=temp;
 int dir=open(temp,O_RDONLY|O_DIRECTORY);assert(dir>=0);
 std::ofstream(root/"drive-folder.txt")<<"test";std::ofstream(root/"hldrive.log")<<"log";std::ofstream(root/"game.pkg")<<"keep";
 fs::create_directory(root/"downloads");std::ofstream(root/"downloads"/"game.pkg")<<"keep too";
 std::string error;
 fs::remove(root/"hldrive.log");fs::create_symlink(root/"game.pkg",root/"hldrive.log");
 assert(!RemoveSettingsAt(dir,&error));assert(fs::exists(root/"drive-folder.txt")&&fs::file_size(root/"game.pkg")==4);
 fs::remove(root/"hldrive.log");fs::create_hard_link(root/"game.pkg",root/"hldrive.log");assert(!RemoveSettingsAt(dir,&error));
 fs::remove(root/"hldrive.log");std::ofstream(root/"hldrive.log")<<"log";
 assert(RemoveSettingsAt(dir,&error));assert(!fs::exists(root/"drive-folder.txt")&&!fs::exists(root/"hldrive.log"));assert(fs::exists(root/"game.pkg")&&fs::exists(root/"downloads"/"game.pkg"));
 assert(RemoveSettingsAt(dir,&error));close(dir);fs::remove_all(root);
 assert(call("stop").status==200&&drive_lock&&file_lock);assert(!ShutdownDue());assert(call("stop").status==409);
 stop_at=std::chrono::steady_clock::now();assert(ShutdownDue());
 std::cout<<"Lifecycle confirmation, active-work barriers, native failures and deletion allowlist tests passed.\n";
}
