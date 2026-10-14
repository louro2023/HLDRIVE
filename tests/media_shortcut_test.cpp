#include "../source/backend/src/media_shortcut.cpp"
#include <cassert>
#include <iostream>
int kernel_dynlib_handle(int,const char *,uint32_t *){return -1;}
uintptr_t kernel_dynlib_resolve(int,uint32_t,const char *){return 0;}
extern "C" int sceAppInstUtilInitialize(){return 0;}
extern "C" int sceAppInstUtilTerminate(){return 0;}
extern "C" int sceAppInstUtilAppUnInstall(const char *){assert(false);return -1;}
int main(){
 using namespace prospero;
 char temp[]="/tmp/hldrive-media-XXXXXX";assert(mkdtemp(temp));fs::path dir=temp;
 auto rejected=[&](){try{CheckOwned(dir);return false;}catch(...){return true;}};
 assert(rejected());
 Write(dir/".hldrive-owner",owner,std::string(owner).size());CheckOwned(dir);
 fs::create_directory(dir/"sce_sys");Write(dir/"sce_sys/param.json",hldrive_param_start,hldrive_param_end-hldrive_param_start);Write(dir/"sce_sys/icon0.png",hldrive_icon_start,hldrive_icon_end-hldrive_icon_start);Write(dir/"eboot.bin","",0);CheckOwned(dir);
 Write(dir/"unrelated.pkg","keep",4);assert(rejected());fs::remove(dir/"unrelated.pkg");
 fs::remove(dir/"sce_sys/icon0.png");fs::create_symlink(dir/"sce_sys/param.json",dir/"sce_sys/icon0.png");assert(rejected());fs::remove(dir/"sce_sys/icon0.png");
 fs::create_hard_link(dir/"sce_sys/param.json",dir/"sce_sys/icon0.png");assert(rejected());fs::remove(dir/"sce_sys/icon0.png");CheckOwned(dir);
 fs::remove_all(dir);
 std::string error;assert(!InstallMediaShortcut(&error));assert(error.find("indisponível")!=std::string::npos);
 std::cout<<"Media shortcut ownership, symlink, hardlink, unrelated-file and missing-service tests passed.\n";
}
