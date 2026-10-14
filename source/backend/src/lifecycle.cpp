#include "lifecycle.hpp"
#include "file_jobs.hpp"
#include "json_writer.hpp"
#include "log.hpp"
#include <mutex>
#include <chrono>
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace prospero {
namespace {
std::mutex lifecycle_mu;
bool stopping=false;
std::chrono::steady_clock::time_point stop_at;
HttpResponse Error(const std::string &s,int code=409){return HttpResponse::Json(JsonWriter().Str("error",s).Done(),code);}
// No recursive deletion, no arbitrary path from the browser, no symlink traversal.
bool RemoveSettingsAt(int dir,std::string *error) {
    const char *names[]={"drive-folder.txt","hldrive.log"};
    // Preflight the complete allowlist before removing anything.
    for(auto name:names){struct stat st{};if(fstatat(dir,name,&st,AT_SYMLINK_NOFOLLOW)==0){if(!S_ISREG(st.st_mode)||st.st_nlink!=1){*error="Configuração inesperada; exclusão bloqueada.";return false;}}else if(errno!=ENOENT){*error="Não foi possível verificar os arquivos do HLDRIVE.";return false;}}
    for(auto name:names)if(unlinkat(dir,name,0)!=0&&errno!=ENOENT){*error="Falha ao excluir configurações; alguns arquivos podem já ter sido removidos.";return false;}
    return true;
}
bool RemoveSettings(std::string *error) {
    int data=open("/data",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(data<0){*error="Não foi possível abrir /data com segurança.";return false;}
    int dir=openat(data,"HLDRIVE",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);close(data);
    if(dir<0){*error="Diretório HLDRIVE inválido ou inacessível.";return false;}
    bool ok=RemoveSettingsAt(dir,error);close(dir);return ok;
}
}
bool ShutdownDue(){std::lock_guard<std::mutex> lock(lifecycle_mu);return stopping&&std::chrono::steady_clock::now()>=stop_at;}
void RegisterLifecycleRoutes(HttpServer *server,const Config &cfg) {
    server->Route("POST","/api/app/action",[cfg](const HttpRequest &req) {
        const auto action=JsonExtractString(req.body,"action");
        if(action!="stop"&&action!="remove"&&action!="install_shortcut")return Error("Ação inválida.",400);
        if(JsonExtractString(req.body,"confirm")!="HLDRIVE")return Error("Confirme a ação na interface.",400);
        std::lock_guard<std::mutex> lock(lifecycle_mu);
        if(stopping)return Error("HLDRIVE já está encerrando.");
        if(!BeginDriveMaintenance())return Error("Há transferências do Drive ativas. Conclua ou cancele a fila e tente novamente.");
        std::string error;
        if(!BeginImmediateFileMutation(&error)){EndDriveMaintenance();return Error("Há operações locais ou uploads ativos. Aguarde e tente novamente.");}
        bool ok=true;
        if(action=="install_shortcut")ok=InstallMediaShortcut(&error);
        if(action=="remove") {
            ok=RemoveMediaShortcut(&error);
            if(ok){ConfigurePersistentLog("");ok=RemoveSettings(&error);if(!ok)ConfigurePersistentLog(cfg.log_file);}
        }
        if(!ok || action=="install_shortcut") {
            EndImmediateFileMutation();EndDriveMaintenance();
            if(!ok){LogEvent("HLDRIVE gerenciamento: "+error);return Error(error,500);}
            return HttpResponse::Json("{\"ok\":true,\"message\":\"Atalho registrado. Abra a aba Mídia do PS5.\"}");
        }
        // Retain both admission barriers until the main thread stops HTTP and exits.
        // Jobs/uploads are idle, so there is no unfinished file write to cut short.
        stopping=true;stop_at=std::chrono::steady_clock::now()+std::chrono::seconds(2);
        return HttpResponse::Json(JsonWriter().Bool("ok",true).Str("message",action=="stop"?"HLDRIVE encerrando. Os arquivos permanecem no console.":"Atalho e configurações removidos. HLDRIVE encerrando. Downloads preservados.").Done());
    });
}
}
