#include "drive_parser.hpp"
#include "http_server.hpp"
#include "config.hpp"
#include "file_manager.hpp"
#include "file_jobs.hpp"
#include "job_queue.hpp"
#include "json_writer.hpp"
#include "log.hpp"
#include "ps5_http_bridge.h"
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>
namespace prospero {
namespace {
using namespace hldrive;
namespace fs=std::filesystem;
struct Job {
    std::string id, name, destination, current, state="queued", error, conflict="skip";
    long long loaded=0, total=-1, completed_files=0, skipped_files=0, speed=0;
    std::atomic<bool> cancel{false};
};
std::mutex jobs_mu, network_mu;
std::deque<std::shared_ptr<Job>> jobs;
std::atomic<unsigned long long> next_id{1};
bool worker_running=false;
bool maintenance=false;
struct Pending { std::shared_ptr<Job> job; DriveEntry entry; };
std::deque<Pending> pending;

std::string RefUrl(const DriveRef &ref) {
    return "https://drive.google.com/drive/folders/"+ref.id+(ref.resource_key.empty()?"":"?resourcekey="+Encode(ref.resource_key));
}
std::string NetworkError(const prosperomgr_http_result &r) {
    char diagnostic[256];
    std::snprintf(diagnostic,sizeof(diagnostic),"HTTP %ld; etapa %d; transporte %d; SCE 0x%08x; TLS 0x%08x/0x%08x",r.http_status,r.stage,r.kind,(unsigned int)r.sce_code,(unsigned int)r.ssl_error,r.ssl_detail);
    LogEvent(std::string("Drive transporte: ")+diagnostic);
    if (r.sce_code == (long long)(int)0x804311fe) {
        if (r.stage == 3) return std::string("A biblioteca HTTP do PS5 rejeitou os parâmetros de inicialização (SCE_HTTP_ERROR_INVALID_VALUE). A conexão ainda não chegou à resolução DNS; o DNS 45.56.67.85 não é a causa desta etapa. ") + diagnostic;
        if (r.stage == 31) return std::string("A biblioteca HTTPS do PS5 rejeitou a consulta da lista de certificados do sistema (SCE_HTTP_ERROR_INVALID_VALUE). A conexão ainda não chegou à resolução DNS. ") + diagnostic;
        if (r.stage == 32) return std::string("A biblioteca HTTPS do PS5 rejeitou o carregamento dos certificados confiáveis do sistema (SCE_HTTP_ERROR_INVALID_VALUE). A conexão ainda não chegou à resolução DNS. ") + diagnostic;
    }
    if(r.sce_code==-10060) return std::string("libcurl/OpenSSL recusou o certificado TLS do Google usando a lista CA_LIST.cer do PS5. Confira a data e hora do console e atualize o sistema se a cadeia estiver desatualizada. A validação do certificado permanece ativa. ")+diagnostic;
    if(r.sce_code==-10077) return std::string("Não foi possível abrir /system/common/cert/CA_LIST.cer no PS5. Confira o acesso do payload à lista de certificados. ")+diagnostic;
    if(r.sce_code==-10006) return std::string("O resolvedor de rede do PS5 não encontrou o host do Google. Confira a conexão e o DNS configurado no console. ")+diagnostic;
    if(r.kind==PROSPEROMGR_HTTP_ERR_WRITE)return std::string("Falha ao gravar no console. Confira espaço livre e permissões. ")+diagnostic;
    if (r.ssl_error == 0x8095f00a && (r.ssl_detail & 0x20u)) {
        return std::string("O PS5 recusou o certificado TLS do Google porque a autoridade certificadora não é confiável (TLS 0x8095f00a; detalhe 0x20). Confira data/hora e os certificados do sistema. Se estiverem corretos, este transporte TLS nativo não conseguiu validar a cadeia de certificados neste ambiente. ") + diagnostic;
    }
    if(r.ssl_error || r.ssl_detail) return std::string("O PS5 recusou a conexão TLS com o Google. Confira data/hora e os certificados do sistema; não é seguro ignorar a validação do certificado. ")+diagnostic;
    if(r.http_status==403||r.http_status==429) return "Google recusou o acesso: permissão, cota ou limite de downloads (HTTP "+std::to_string(r.http_status)+").";
    if(r.http_status==404) return "Arquivo ou pasta não encontrado no Google Drive.";
    if(r.http_status==409) return "Google retornou uma página de confirmação ou erro, não um arquivo. Nenhum arquivo foi concluído.";
    return std::string("Falha na transferência do Drive. ")+diagnostic+". Confira a conexão e o DNS do console; envie este diagnóstico se persistir.";
}
DriveListing List(const DriveRef &ref) {
    std::unique_lock<std::mutex> net(network_mu,std::try_to_lock);
    if(!net.owns_lock()) throw std::runtime_error("O Drive está ocupado com outra transferência. Aguarde e tente novamente.");
    std::string url="https://drive.google.com/embeddedfolderview?id="+ref.id;
    if(!ref.resource_key.empty()) url+="&resourcekey="+Encode(ref.resource_key);
    char *raw=nullptr;size_t length=0;prosperomgr_http_result result{};
    int rc=prosperomgr_ps5_http_get(url.c_str(),&raw,&length,8*1024*1024,nullptr,nullptr,&result);
    std::unique_ptr<char,decltype(&std::free)> body(raw,&std::free);
    if(rc!=0) throw std::runtime_error(NetworkError(result));
    DriveListing listing;std::string error;
    if(!ParseDriveListing(std::string(raw?raw:"",length),&listing,&error)) throw std::runtime_error(error);
    return listing;
}
void CheckCancel(const std::shared_ptr<Job> &job) {
    if(job->cancel) throw std::runtime_error("Transferência cancelada.");
}
bool Exists(const std::string &path) {
    struct stat st{};
    if(lstat(path.c_str(),&st)==0) return true;
    if(errno!=ENOENT) throw std::runtime_error("Não foi possível verificar o destino: "+path);
    return false;
}
std::string UniqueTarget(const std::string &path) {
    if(!Exists(path)) return path;
    fs::path file(path);
    for(int n=1;n<=10000;++n) {
        auto name=file.stem().string()+" ("+std::to_string(n)+")"+file.extension().string();
        if(!SafeName(name)) throw std::runtime_error("Nome longo demais para manter as duas cópias.");
        auto candidate=(file.parent_path()/name).string();
        if(!Exists(candidate)) return candidate;
    }
    throw std::runtime_error("Não foi possível encontrar um nome livre no destino.");
}
void CheckDirectory(const std::string &path) {
    // Validate before stat/lstat: touching /dev children may panic the console.
    if(path.empty()||path[0]!='/'||path.find('\0')!=std::string::npos) throw std::runtime_error("Destino inválido.");
    fs::path current;
    for(const auto &part:fs::path(path)) {
        if(part==".."||part==".") throw std::runtime_error("Destino deve ser um caminho absoluto normalizado.");
        current/=part;
        if(IsKernelUnsafePath(current.string())) throw std::runtime_error("Destino protegido.");
        struct stat st{};
        if(lstat(current.c_str(),&st)!=0||!S_ISDIR(st.st_mode)||S_ISLNK(st.st_mode)) throw std::runtime_error("Destino inexistente ou contém link simbólico.");
    }
    if(path!="/data" && path.rfind("/data/",0)!=0 && path.rfind("/mnt/usb",0)!=0 && path.rfind("/mnt/ext",0)!=0)
        throw std::runtime_error("Escolha uma pasta em /data ou no armazenamento externo.");
}
void Download(const DriveEntry &entry,const std::string &destination,const std::shared_ptr<Job> &job) {
    CheckCancel(job);CheckDirectory(destination);
    if(!SafeName(entry.name)) throw std::runtime_error("Nome de arquivo inválido.");
    std::string target=destination+"/"+entry.name;
    if(Exists(target)) {
        if(job->conflict=="skip") {std::lock_guard<std::mutex> lock(jobs_mu);++job->skipped_files;return;}
        if(job->conflict=="keep_both") target=UniqueTarget(target);
        else throw std::runtime_error("Já existe: "+target+". Renomeie ou escolha outra pasta.");
    }
    std::string temp=destination+"/.hldrive-"+std::to_string(getpid())+"-"+job->id+"-"+std::to_string(next_id++)+".part";
    struct Cleanup { std::string path; ~Cleanup(){unlink(path.c_str());} } cleanup{temp};
    std::string url="https://drive.usercontent.google.com/download?id="+entry.ref.id+"&export=download";
    if(!entry.ref.resource_key.empty()) url+="&resourcekey="+Encode(entry.ref.resource_key);
    std::lock_guard<std::mutex> net(network_mu);
    for(int attempt=0;attempt<3;++attempt) {
        CheckCancel(job);
        char *raw=nullptr;size_t length=0;prosperomgr_http_result result{};
        int rc=hldrive_http_probe(url.c_str(),&raw,&length,&result);
        std::unique_ptr<char,decltype(&std::free)> body(raw,&std::free);
        if(rc!=0) throw std::runtime_error(NetworkError(result));
        if(!raw) break;
        auto next=DownloadConfirmation(std::string(raw,length),entry.ref.id);
        if(next.empty()||next==url||attempt==2) throw std::runtime_error("Google exige login, bloqueou o download ou mudou a confirmação. Confira o link no navegador.");
        url=next;
    }
    {std::lock_guard<std::mutex> lock(jobs_mu);job->current=target;job->loaded=0;job->total=-1;job->speed=0;}
    struct Context {std::shared_ptr<Job> job;std::string destination;std::string error;bool checked=false;
        std::chrono::steady_clock::time_point started=std::chrono::steady_clock::now();};
    Context ctx{job,destination,"",false};
    auto progress=[](long long loaded,long long total,void *opaque) {
        auto &c=*static_cast<Context*>(opaque);
        if(!c.checked && total>0) {
            c.checked=true;uint64_t available=0;
            if(!CheckFreeSpaceAtDirectory(c.destination,static_cast<uint64_t>(std::max(0LL,total-loaded)),&available,&c.error)) c.job->cancel=true;
        }
        std::lock_guard<std::mutex> lock(jobs_mu);c.job->loaded=loaded;c.job->total=total;
        auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-c.started).count();
        c.job->speed=elapsed>=500?static_cast<long long>(static_cast<double>(loaded)*1000.0/elapsed):0;
    };
    auto canceled=[](void *opaque)->int {return static_cast<Context*>(opaque)->job->cancel?1:0;};
    prosperomgr_http_result result{};
    int rc=prosperomgr_ps5_http_download(url.c_str(),temp.c_str(),&result,progress,&ctx,canceled,&ctx);
    if(!ctx.error.empty()) {job->cancel=false;throw std::runtime_error(ctx.error);}
    CheckCancel(job);
    if(rc!=0) throw std::runtime_error(NetworkError(result));
    if(Exists(target)) throw std::runtime_error("Destino passou a existir; arquivo existente preservado.");
    if(rename(temp.c_str(),target.c_str())!=0) throw std::runtime_error("Não foi possível finalizar o arquivo no destino.");
    std::lock_guard<std::mutex> lock(jobs_mu);++job->completed_files;
}
void Copy(const DriveEntry &entry,const std::string &destination,const std::shared_ptr<Job> &job,std::set<std::string> &visited,int depth,int &count) {
    CheckCancel(job);
    if(depth>32||++count>10000) throw std::runtime_error("Limite de profundidade ou quantidade de arquivos atingido.");
    if(!entry.folder) {Download(entry,destination,job);return;}
    if(!visited.insert(entry.ref.id).second) throw std::runtime_error("Pasta repetida na árvore do Drive.");
    CheckDirectory(destination);
    std::string next=destination+"/"+entry.name;
    if(!SafeName(entry.name)) throw std::runtime_error("Nome de pasta inválido.");
    bool exists=Exists(next);
    if(exists) {
        if(job->conflict=="skip") CheckDirectory(next); // Merge only real directories; reject symlinks.
        else if(job->conflict=="keep_both") {next=UniqueTarget(next);exists=false;}
        else throw std::runtime_error("Pasta já existe: "+next+". Escolha outro destino.");
    }
    auto listing=List(entry.ref);CheckCancel(job);
    if(!exists && mkdir(next.c_str(),0755)!=0) throw std::runtime_error("Não foi possível criar a pasta de destino.");
    for(const auto &child:listing.entries) Copy(child,next,job,visited,depth+1,count);
}
void Worker() {
    for(;;) {
        Pending task;
        {std::lock_guard<std::mutex> lock(jobs_mu);if(pending.empty()){worker_running=false;return;}task=pending.front();pending.pop_front();task.job->state="running";}
        bool mutation=false;
        try {
            CheckCancel(task.job);std::string error;
            // Share the upstream file-operation lock so paste/delete/uploads cannot race this job.
            mutation=BeginImmediateFileMutation(&error);
            if(!mutation) throw std::runtime_error("Outra operação de arquivos está ativa: "+error);
            std::set<std::string> visited;int count=0;Copy(task.entry,task.job->destination,task.job,visited,0,count);
            LogEvent("Drive: concluído "+task.job->name);
            std::lock_guard<std::mutex> lock(jobs_mu);task.job->state="done";
        } catch(const std::exception &e) {
            LogEvent(std::string("Drive: ")+e.what());
            std::lock_guard<std::mutex> lock(jobs_mu);task.job->state=task.job->cancel?"canceled":"error";task.job->error=e.what();
        }
        if(mutation) EndImmediateFileMutation();
    }
}
HttpResponse Error(const std::string &message,int status=400) {return HttpResponse::Json(JsonWriter().Str("error",message).Done(),status);}
}
bool BeginDriveMaintenance() {
    std::lock_guard<std::mutex> lock(jobs_mu);
    if(maintenance || worker_running || !pending.empty()) return false;
    maintenance=true;return true;
}
void EndDriveMaintenance() {std::lock_guard<std::mutex> lock(jobs_mu);maintenance=false;}
void RegisterDriveRoutes(HttpServer *server,const Config &cfg) {
    server->Route("GET","/api/drive/list",[](const HttpRequest &req) {
        DriveRef ref;if(!ParseDriveFolder(req.Query("url"),&ref)) return Error("Cole um link https://drive.google.com/drive/folders/...");
        try {
            auto listing=List(ref);std::vector<std::string> entries;
            for(const auto &e:listing.entries) entries.push_back(JsonWriter().Str("id",e.ref.id).Str("name",e.name).Bool("is_dir",e.folder).Str("url",e.folder?RefUrl(e.ref):"").Done());
            return HttpResponse::Json(JsonWriter().Str("name",listing.name).Str("url",RefUrl(ref)).Raw("entries",JsonWriter::Array(entries)).Done());
        } catch(const std::exception &e) {return Error(e.what(),502);}
    });
    server->Route("POST","/api/drive/copy",[](const HttpRequest &req) {
        DriveRef ref;if(!ParseDriveFolder(JsonExtractString(req.body,"url"),&ref)) return Error("Pasta do Drive inválida.");
        auto ids=JsonExtractStringArray(req.body,"ids");auto destination=JsonExtractString(req.body,"destination");
        auto conflict=JsonExtractString(req.body,"conflict");if(conflict.empty())conflict="skip";
        if(conflict!="skip"&&conflict!="keep_both"&&conflict!="cancel") return Error("Política de conflito inválida.");
        if(ids.empty()||ids.size()>32) return Error("Selecione entre 1 e 32 itens.");
        try {
            CheckDirectory(destination);auto listing=List(ref);std::vector<DriveEntry> selected;std::set<std::string> seen;
            for(const auto &id:ids) {
                auto it=std::find_if(listing.entries.begin(),listing.entries.end(),[&](const DriveEntry &e){return e.ref.id==id;});
                if(it==listing.entries.end()) return Error("Arquivo não está mais na pasta pública.");
                if(seen.insert(id).second) selected.push_back(*it);
            }
            std::lock_guard<std::mutex> lock(jobs_mu);
            if(maintenance) return Error("HLDRIVE em manutenção ou encerrando.",409);
            size_t active=0;for(const auto &j:jobs) if(j->state=="queued"||j->state=="running") ++active;
            if(active+selected.size()>32) return Error("Fila cheia. Aguarde os downloads atuais.",409);
            std::vector<std::string> result;
            for(const auto &entry:selected) {
                auto job=std::make_shared<Job>();job->id=std::to_string(next_id++);job->name=entry.name;job->destination=destination;job->conflict=conflict;
                jobs.push_back(job);pending.push_back({job,entry});result.push_back(JsonWriter::Quote(job->id));
            }
            while(jobs.size()>64 && jobs.front()->state!="queued" && jobs.front()->state!="running") jobs.pop_front();
            if(!worker_running){worker_running=true;RunOnWorker(Worker);}
            return HttpResponse::Json(JsonWriter().Raw("ids",JsonWriter::Array(result)).Done(),202);
        } catch(const std::exception &e){return Error(e.what(),400);}
    });
    server->Route("GET","/api/drive/jobs",[](const HttpRequest &) {
        std::lock_guard<std::mutex> lock(jobs_mu);std::vector<std::string> list;
        for(const auto &j:jobs) list.push_back(JsonWriter().Str("id",j->id).Str("name",j->name).Str("state",j->state).Str("destination",j->destination).Str("current",j->current).Str("error",j->error).Str("conflict",j->conflict).Int("loaded",j->loaded).Int("total",j->total).Int("files",j->completed_files).Int("skipped",j->skipped_files).Int("speed",j->speed).Done());
        return HttpResponse::Json(JsonWriter().Raw("jobs",JsonWriter::Array(list)).Done());
    });
    server->Route("POST","/api/drive/cancel",[](const HttpRequest &req) {
        auto id=JsonExtractString(req.body,"id");std::lock_guard<std::mutex> lock(jobs_mu);
        for(const auto &j:jobs) if(j->id==id){if(j->state=="queued"||j->state=="running")j->cancel=true;return HttpResponse::Json("{\"ok\":true}");}
        return Error("Transferência não encontrada.",404);
    });
    server->Route("POST","/api/drive/clear",[](const HttpRequest &) {
        std::lock_guard<std::mutex> lock(jobs_mu);
        std::erase_if(jobs,[](const auto &j){return j->state!="queued"&&j->state!="running";});
        return HttpResponse::Json("{\"ok\":true}");
    });
    server->Route("GET","/api/drive/config",[cfg](const HttpRequest &) {
        std::ifstream f(cfg.root_dir+"/drive-folder.txt");std::string url;std::getline(f,url);
        return HttpResponse::Json(JsonWriter().Str("url",url).Done());
    });
    server->Route("POST","/api/drive/config",[cfg](const HttpRequest &req) {
        std::lock_guard<std::mutex> lock(jobs_mu);
        if(maintenance)return Error("HLDRIVE em manutenção ou encerrando.",409);
        auto url=JsonExtractString(req.body,"url");DriveRef ref;
        if(!ParseDriveFolder(url,&ref)) return Error("Link de pasta inválido.");
        std::ofstream f(cfg.root_dir+"/drive-folder.txt",std::ios::trunc);f<<RefUrl(ref);f.close();
        if(!f) return Error("Não foi possível salvar o link.",500);
        return HttpResponse::Json("{\"ok\":true}");
    });
}
}
