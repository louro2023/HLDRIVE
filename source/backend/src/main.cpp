#include "config.hpp"
#include "http_server.hpp"
#include "file_jobs.hpp"
#include "job_queue.hpp"
#include "jailbreak.hpp"
#include "log.hpp"
#include "lifecycle.hpp"
#include <chrono>
#include <cstdio>
#include <csignal>
#include <thread>
#include <unistd.h>
#include <sys/file.h>
#include <fcntl.h>
extern "C" int sceNetCtlInit(void);
extern "C" int sceUserServiceInitialize(void *);
extern "C" int sceUserServiceTerminate(void);
extern "C" int sceSystemServiceLaunchWebBrowser(const char *, void *);
namespace prospero {
void RegisterFileRoutes(HttpServer *,const Config &);
void RegisterDriveRoutes(HttpServer *,const Config &);
}
namespace {volatile sig_atomic_t resumed=0;void Resume(int){resumed=1;}}
int main() {
    using namespace prospero;
    signal(SIGPIPE,SIG_IGN);signal(SIGHUP,SIG_IGN);MarkStartTime();
    std::string error;
    if(!EscalatePrivileges(&error)) {std::fprintf(stderr,"HLDRIVE: %s\n",error.c_str());return 1;}
    auto cfg=Config::Load();
    int lock=open((cfg.root_dir+"/instance.lock").c_str(),O_CREAT|O_RDWR,0600);
    if(lock<0 || flock(lock,LOCK_EX|LOCK_NB)!=0) {std::fprintf(stderr,"HLDRIVE já está em execução.\n");return 1;}
    sceNetCtlInit();ConfigurePersistentLog(cfg.log_file);InstallCrashStack();
    InitializeJobQueue();InitializeFileJobs(cfg);
    HttpServer server(Config::kHttpPort);RegisterFileRoutes(&server,cfg);RegisterDriveRoutes(&server,cfg);
    RegisterLifecycleRoutes(&server,cfg);
    if(!server.Start()) {LogEvent("HLDRIVE: porta HTTP indisponível.");return 1;}
    const int user_service = sceUserServiceInitialize(nullptr);
    std::string shortcut_error;
    if(!InstallMediaShortcut(&shortcut_error))LogEvent("HLDRIVE atalho: "+shortcut_error);
    else LogEvent("HLDRIVE: atalho da aba Mídia instalado/atualizado.");
    signal(SIGCONT,Resume);
    char address[128];
    std::snprintf(address,sizeof(address),"HLDRIVE %s: http://<IP_DO_PS5>:%u",kVersion,(unsigned)Config::kHttpPort);
    LogEvent(address);
    // Same launch ABI as ps5-payload-dev/sdk samples/browser/main.c.
    char browser_url[96];
    std::snprintf(browser_url,sizeof(browser_url),"http://127.0.0.1:%u/?console=1",(unsigned)Config::kHttpPort);
    const int browser = sceSystemServiceLaunchWebBrowser(browser_url, nullptr);
    if (user_service == 0) sceUserServiceTerminate();
    char launch_log[160];
    std::snprintf(launch_log, sizeof(launch_log), "HLDRIVE: browser launch result=0x%08x, user service=0x%08x", browser, user_service);
    LogEvent(launch_log);
    for(;;){std::this_thread::sleep_for(std::chrono::milliseconds(100));if(ShutdownDue()){server.Stop();_exit(0);}if(resumed){resumed=0;server.RequestRestart();}}
}
