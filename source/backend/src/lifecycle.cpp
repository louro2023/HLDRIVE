#include "lifecycle.hpp"
#include "file_jobs.hpp"
#include "json_writer.hpp"
#include "log.hpp"
#include <mutex>
#include <chrono>
#include <cerrno>
#include <filesystem>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace prospero {
namespace {
std::mutex lifecycle_mu;
bool stopping=false;
std::chrono::steady_clock::time_point stop_at;
HttpResponse Error(const std::string &s,int code=409){return HttpResponse::Json(JsonWriter().Str("error",s).Done(),code);}

namespace fs=std::filesystem;
bool IsUnder(const fs::path &child,const fs::path &parent) {
    const std::string c=child.lexically_normal().string(),p=parent.lexically_normal().string();
    return c==p||(c.size()>p.size()&&c.compare(0,p.size(),p)==0&&c[p.size()]=='/');
}
bool InspectHldriveTree(std::string *error) {
    struct stat root{};
    if(lstat("/data/HLDRIVE",&root)!=0){if(errno==ENOENT)return true;*error="Nao foi possivel verificar /data/HLDRIVE.";return false;}
    if(!S_ISDIR(root.st_mode)||S_ISLNK(root.st_mode)){*error="/data/HLDRIVE nao e uma pasta real; exclusao bloqueada.";return false;}
    std::error_code ec;
    for(fs::recursive_directory_iterator it("/data/HLDRIVE",fs::directory_options::none,ec),end;it!=end;it.increment(ec)) {
        if(ec){*error="Nao foi possivel inspecionar todos os dados do HLDRIVE.";return false;}
        struct stat st{};
        if(lstat(it->path().c_str(),&st)!=0){*error="Um item de /data/HLDRIVE mudou durante a verificacao.";return false;}
        if(S_ISDIR(st.st_mode)&&st.st_dev!=root.st_dev){*error="Ha uma montagem externa dentro de /data/HLDRIVE; exclusao bloqueada.";return false;}
        if(!S_ISDIR(st.st_mode)&&!S_ISREG(st.st_mode)&&!S_ISLNK(st.st_mode)){*error="Ha um arquivo especial dentro de /data/HLDRIVE; exclusao bloqueada.";return false;}
    }
    if(ec){*error="Nao foi possivel inspecionar todos os dados do HLDRIVE.";return false;}
    return true;
}
bool GetExternalPayloadCopy(const Config &cfg,std::string *path,std::string *error) {
    path->clear();
    const fs::path root=fs::path("/data/HLDRIVE");
    const fs::path dir=fs::path(cfg.payloads_dir).lexically_normal();
    if(!dir.is_absolute()||dir.string().find("..")!=std::string::npos){*error="Pasta de payloads configurada invalida; exclusao bloqueada.";return false;}
    if(IsUnder(dir,root))return true;
    std::error_code ec;
    const fs::path canonical=fs::canonical(dir,ec);
    if(ec){if(ec==std::errc::no_such_file_or_directory)return true;*error="Nao foi possivel verificar a pasta de payloads configurada.";return false;}
    if(canonical!=dir){*error="A pasta de payloads usa link simbolico; exclusao do ELF bloqueada.";return false;}
    *path=(dir/"HLDRIVE.elf").string();
    for(const char *name:{"HLDRIVE.elf","HLDRIVE.elf.sha256"}) {
        struct stat st{};
        if(lstat((dir/name).c_str(),&st)!=0){if(errno==ENOENT)continue;*error="Nao foi possivel verificar os arquivos de payload.";return false;}
        if(!S_ISREG(st.st_mode)||st.st_nlink!=1){*error="A copia de HLDRIVE nao e um arquivo regular exclusivo; exclusao bloqueada.";return false;}
    }
    return true;
}
bool RemovePayloadCopy(const std::string &elf,std::string *error) {
    if(elf.empty())return true;
    fs::path dir=fs::path(elf).parent_path();
    int fd=open(dir.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(fd<0){if(errno==ENOENT)return true;*error="Nao foi possivel abrir a pasta de payloads.";return false;}
    bool ok=true;
    for(const char *name:{"HLDRIVE.elf","HLDRIVE.elf.sha256"}) {
        struct stat st{};
        if(fstatat(fd,name,&st,AT_SYMLINK_NOFOLLOW)!=0){if(errno==ENOENT)continue;ok=false;break;}
        if(!S_ISREG(st.st_mode)||st.st_nlink!=1||unlinkat(fd,name,0)!=0){ok=false;break;}
    }
    close(fd);
    if(!ok)*error="Falha ao remover a copia de HLDRIVE.elf da pasta de payloads.";
    return ok;
}
bool RemoveHldriveTree(std::string *error) {
    std::error_code ec;
    fs::remove_all("/data/HLDRIVE",ec);
    if(ec){*error="Falha ao remover /data/HLDRIVE: "+ec.message();return false;}
    return true;
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
            std::string payload_copy;
            ok=InspectHldriveTree(&error)&&GetExternalPayloadCopy(cfg,&payload_copy,&error);
            if(ok)ok=RemoveMediaShortcut(&error);
            if(ok)ok=RemovePayloadCopy(payload_copy,&error);
            if(ok){ConfigurePersistentLog("");ok=RemoveHldriveTree(&error);if(!ok)ConfigurePersistentLog(cfg.log_file);}
        }
        if(!ok || action=="install_shortcut") {
            EndImmediateFileMutation();EndDriveMaintenance();
            if(!ok){LogEvent("HLDRIVE gerenciamento: "+error);return Error(error,500);}
            return HttpResponse::Json("{\"ok\":true,\"message\":\"Atalho registrado. Abra a aba Mídia do PS5.\"}");
        }
        // Retain both admission barriers until the main thread stops HTTP and exits.
        // Jobs/uploads are idle, so there is no unfinished file write to cut short.
        stopping=true;stop_at=std::chrono::steady_clock::now()+std::chrono::seconds(2);
        return HttpResponse::Json(JsonWriter().Bool("ok",true).Str("message",action=="stop"?"HLDRIVE encerrando. Os arquivos permanecem no console.":"Atalho, copia do ELF e pasta /data/HLDRIVE removidos. HLDRIVE encerrando.").Done());
    });
}
}
