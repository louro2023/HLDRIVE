// Registration ABI and deeplink metadata researched in kvnhrt/ps5-browser-app
// (GPLv3), src/app_installer.c. No global AppInstallAll fallback is used here.
#include "lifecycle.hpp"
#include <ps5/kernel.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <set>
#include <stdexcept>

extern "C" int sceAppInstUtilInitialize(void);
extern "C" int sceAppInstUtilTerminate(void);
extern "C" int sceAppInstUtilAppUnInstall(const char *);
asm(".pushsection .rodata\n"
    ".global hldrive_param_start, hldrive_param_end, hldrive_icon_start, hldrive_icon_end\n"
    "hldrive_param_start:\n.incbin \"source/launcher/param.json\"\nhldrive_param_end:\n"
    "hldrive_icon_start:\n.incbin \"source/launcher/icon0.png\"\nhldrive_icon_end:\n.popsection\n");
extern "C" const char hldrive_param_start[], hldrive_param_end[], hldrive_icon_start[], hldrive_icon_end[];
namespace prospero {
namespace {
namespace fs = std::filesystem;
constexpr const char *title = "HLDR00001";
constexpr const char *root = "/user/app/HLDR00001";
constexpr const char *owner = "HLDRIVE media shortcut v1\n";
void RealDirectory(const fs::path &p) {
    if (fs::symlink_status(p).type() != fs::file_type::directory) throw std::runtime_error("Diretório de instalação inválido ou simbólico: " + p.string());
}
void CheckOwned(const fs::path &directory) {
    RealDirectory(directory);
    const auto marker = directory/".hldrive-owner";
    if (fs::symlink_status(marker).type() != fs::file_type::regular || fs::file_size(marker) != std::string(owner).size()) throw std::runtime_error("Atalho existente não pertence a esta instalação do HLDRIVE.");
    std::ifstream f(marker); std::string data((std::istreambuf_iterator<char>(f)),{});
    if (data != owner) throw std::runtime_error("Identificação do atalho não confere.");
    // Never let the system uninstaller recursively remove unrelated user files.
    for (const auto &entry : fs::recursive_directory_iterator(directory)) {
        auto name=entry.path().lexically_relative(directory).generic_string();
        auto type=entry.symlink_status().type();
        if (name=="sce_sys" && type==fs::file_type::directory) continue;
        if (type!=fs::file_type::regular || (name!=".hldrive-owner" && name!="sce_sys/param.json" && name!="sce_sys/icon0.png" && name!="eboot.bin")) throw std::runtime_error("Arquivos não reconhecidos no atalho; remoção automática bloqueada.");
        if(fs::hard_link_count(entry.path())!=1)throw std::runtime_error("Arquivo compartilhado por hard link; alteração bloqueada.");
    }
}
void Write(const fs::path &p, const char *data, size_t length) {
    int fd=open(p.c_str(), O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW,0644);
    if(fd<0) throw std::runtime_error("Não foi possível gravar "+p.string());
    size_t offset=0;
    while(offset<length) {ssize_t n=write(fd,data+offset,length-offset);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);throw std::runtime_error("Falha de gravação do atalho.");}offset+=n;}
    int sync=fsync(fd);int closed=close(fd);
    if(sync || closed)throw std::runtime_error("Falha ao finalizar arquivos do atalho.");
}
std::string Code(const char *operation,int rc) {char b[128];std::snprintf(b,sizeof(b),"%s: 0x%08x",operation,(unsigned)rc);return b;}
struct Service {
    Service(){int rc=sceAppInstUtilInitialize();if(rc)throw std::runtime_error(Code("AppInstUtilInitialize",rc));}
    ~Service(){sceAppInstUtilTerminate();}
};
}
bool InstallMediaShortcut(std::string *error) {
    try {
        Service service; uint32_t handle;
        if(kernel_dynlib_handle(-1,"libSceAppInstUtil.sprx",&handle)) throw std::runtime_error("AppInstUtil indisponível neste ambiente.");
        using Install=int(*)(const char *,const char *,void *);
        auto install=reinterpret_cast<Install>(kernel_dynlib_resolve(-1,handle,"Wudg3Xe3heE"));
        if(!install)throw std::runtime_error("Registro individual de título não suportado neste firmware/loader.");
        RealDirectory("/user"); RealDirectory("/user/app");
        if(fs::symlink_status(root).type()==fs::file_type::not_found) {
            if(!fs::create_directory(root))throw std::runtime_error("Não foi possível criar o diretório do atalho.");
            Write(fs::path(root)/".hldrive-owner",owner,std::string(owner).size());
        }
        CheckOwned(root);
        fs::create_directory(fs::path(root)/"sce_sys"); RealDirectory(fs::path(root)/"sce_sys");
        Write(fs::path(root)/"sce_sys/param.json",hldrive_param_start,hldrive_param_end-hldrive_param_start);
        Write(fs::path(root)/"sce_sys/icon0.png",hldrive_icon_start,hldrive_icon_end-hldrive_icon_start);
        Write(fs::path(root)/"eboot.bin","",0);
        int rc=install(title,"/user/app/",nullptr);
        if(rc)throw std::runtime_error(Code("AppInstallTitleDir",rc));
        return true;
    }catch(const std::exception &e){*error=e.what();return false;}
}
bool RemoveMediaShortcut(std::string *error) {
    try {
        if(fs::symlink_status(root).type()==fs::file_type::not_found) {
            if(fs::exists("/user/appmeta/HLDR00001"))throw std::runtime_error("Registro encontrado sem identificação de propriedade; exclua esse item pelo menu do PS5.");
            return true;
        }
        RealDirectory("/user");RealDirectory("/user/app");CheckOwned(root); Service service;
        int rc=sceAppInstUtilAppUnInstall(title);
        if(rc)throw std::runtime_error(Code("AppUnInstall",rc));
        if(fs::symlink_status(root).type()!=fs::file_type::not_found) {
            CheckOwned(root);
            for(const char *file:{"sce_sys/param.json","sce_sys/icon0.png","eboot.bin",".hldrive-owner"})fs::remove(fs::path(root)/file);
            fs::remove(fs::path(root)/"sce_sys");fs::remove(root);
        }
        return true;
    }catch(const std::exception &e){*error=e.what();return false;}
}
}
