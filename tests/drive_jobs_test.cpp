// Real Drive job/filesystem code with deterministic network and scheduler adapters.
#include "../source/backend/src/drive.cpp"
#include <cassert>
#include <cstring>
#include <functional>
#include <iostream>
namespace {
std::map<std::string,prospero::RouteHandler> routes;
std::vector<std::function<void()>> scheduled;
int mode=0;
bool tree=false;
bool file_lock=false;
int probes=0, downloads=0;
const std::string listing="<title>Tests</title><div class='flip-entries'><a href='https://drive.google.com/file/d/file1/view'>test.pkg</a></div>";
}
namespace prospero {
HttpServer::HttpServer(uint16_t port):port_(port){}
HttpServer::~HttpServer(){}
void HttpServer::Route(const std::string &method,const std::string &path,RouteHandler handler){routes[method+" "+path]=handler;}
void RunOnWorker(std::function<void()> fn){scheduled.push_back(fn);}
void LogEvent(const std::string &){}
bool BeginImmediateFileMutation(std::string *e){if(file_lock){*e="busy";return false;}file_lock=true;return true;}
void EndImmediateFileMutation(){file_lock=false;}
bool IsKernelUnsafePath(const std::string &p){return p=="/dev"||p=="/proc"||p=="/sys"||p=="/kern";}
bool CheckFreeSpaceAtDirectory(const std::string &,uint64_t,uint64_t *,std::string *e){if(mode==3){*e="no space";return false;}return true;}
}
extern "C" {
void hldrive_http_download_metrics(hldrive_download_metrics *out){*out={1,1,4,1,7,10};}
int prosperomgr_ps5_http_get(const char *url,char **body,size_t *len,size_t,const char *,const char *,prosperomgr_http_result *r){
 std::string html=listing;
 if(tree) {
   if(std::string(url).find("id=root")!=std::string::npos) html="<div class='flip-entries'><a href='https://drive.google.com/drive/folders/sub'>Sub</a></div>";
   else html="<div class='flip-entries'><a href='https://drive.google.com/file/d/file1/view'>test.pkg</a><a href='https://drive.google.com/file/d/file2/view'>new.pkg</a></div>";
 }
 r->http_status=200;*len=html.size();*body=(char*)malloc(*len);memcpy(*body,html.data(),*len);return 0;
}
int hldrive_http_probe(const char *url,char **body,size_t *len,prosperomgr_http_result *r){
 ++probes;
 if(mode>=4) {
   std::string page;
   if(mode==5)page="<p class='uc-error-subcaption'>Download quota exceeded.</p>";
   else if(mode==6)page="<html>Unrecognized Google notification</html>";
   else if(mode==7 || std::string(url).find("confirm=")==std::string::npos)page="<a href='/uc?export=download&amp;id=file1&amp;confirm=t'>Download anyway</a>";
   if(!page.empty()){*len=page.size();*body=(char*)malloc(*len);memcpy(*body,page.data(),*len);r->http_status=200;return 0;}
 }
 *body=nullptr;*len=0;r->http_status=mode==2?403:200;return mode==2?-1:0;
}
int prosperomgr_ps5_http_download(const char *,const char *path,prosperomgr_http_result *r,prosperomgr_ps5_http_progress_fn progress,void *opaque,prosperomgr_ps5_http_cancel_fn cancel,void *cancel_opaque){
 ++downloads;
 progress(0,7,opaque);if(cancel(cancel_opaque))return -1;
 std::ofstream f(path);f<<"payload";f.close();r->http_status=200;
 if(mode==1){r->kind=PROSPEROMGR_HTTP_ERR_READ;return -1;}
 progress(7,7,opaque);return 0;
}
}
prospero::HttpResponse Call(const std::string &path,const std::string &body){prospero::HttpRequest r;r.body=body;return routes.at(path)(r);}
void Run(){auto work=std::move(scheduled);scheduled.clear();for(auto &fn:work)fn();assert(!file_lock);}
int main(){
 namespace fs=std::filesystem;using namespace prospero;
 fs::create_directory("/data");char name[]="/data/hldrive-test-XXXXXX";assert(mkdtemp(name));std::string dest=name;
 Config cfg;cfg.root_dir=dest;HttpServer server(0);RegisterDriveRoutes(&server,cfg);
 std::string policy="cancel";
 auto body=[&](const std::string &d){return JsonWriter().Str("url","https://drive.google.com/drive/folders/root").Raw("ids","[\"file1\"]").Str("destination",d).Str("conflict",policy).Done();};
 auto submit=[&](){auto r=Call("POST /api/drive/copy",body(dest));assert(r.status==202);Run();};
 submit();assert(fs::file_size(dest+"/test.pkg")==7);assert(jobs.back()->state=="done");
 // Collision must preserve the completed file.
 submit();assert(jobs.back()->state=="error");assert(fs::file_size(dest+"/test.pkg")==7);
 policy="skip";submit();assert(jobs.back()->state=="done");assert(jobs.back()->skipped_files==1);assert(fs::file_size(dest+"/test.pkg")==7);
 policy="keep_both";submit();assert(jobs.back()->state=="done");assert(fs::file_size(dest+"/test (1).pkg")==7);fs::remove(dest+"/test (1).pkg");
 policy="invalid";assert(Call("POST /api/drive/copy",body(dest)).status==400);policy="cancel";
 fs::remove(dest+"/test.pkg");
 mode=1;submit();assert(jobs.back()->state=="error");assert(fs::is_empty(dest));
 mode=2;submit();assert(jobs.back()->state=="error");assert(fs::is_empty(dest));
 mode=3;submit();assert(jobs.back()->state=="error");assert(fs::is_empty(dest));
 mode=4;probes=downloads=0;submit();assert(jobs.back()->state=="done");assert(probes==2&&downloads==1);assert(!jobs.back()->notice.empty());fs::remove(dest+"/test.pkg");
 mode=5;downloads=0;submit();assert(jobs.back()->state=="error");assert(jobs.back()->error.find("quota exceeded")!=std::string::npos);assert(downloads==0&&fs::is_empty(dest));
 mode=6;submit();assert(jobs.back()->state=="error");assert(downloads==0&&fs::is_empty(dest));
 mode=7;probes=0;submit();assert(jobs.back()->state=="error");assert(probes==2&&downloads==0&&fs::is_empty(dest));
 mode=0;assert(Call("POST /api/drive/copy",body(dest+"/../")).status==400);
 fs::create_directory_symlink("/tmp",dest+"/link");assert(Call("POST /api/drive/copy",body(dest+"/link")).status==400);fs::remove(dest+"/link");
 assert(Call("POST /api/drive/copy",body(dest)).status==202);
 auto id=jobs.back()->id;Call("POST /api/drive/cancel",JsonWriter().Str("id",id).Done());Run();assert(jobs.back()->state=="canceled");assert(fs::is_empty(dest));
 Call("POST /api/drive/clear","{}");assert(jobs.empty());
 assert(Call("POST /api/drive/copy",body(dest)).status==202);Call("POST /api/drive/clear","{}");assert(jobs.size()==1);Run();fs::remove(dest+"/test.pkg");
 {std::lock_guard<std::mutex> locked(network_mu);bool busy=false;try{List({"root",""});}catch(const std::exception &){busy=true;}assert(busy);}
 // Re-selecting a partially completed folder with skip copies missing children only.
 tree=true;fs::create_directory(dest+"/Sub");{std::ofstream old(dest+"/Sub/test.pkg");old<<"original";}
 auto folderBody=JsonWriter().Str("url","https://drive.google.com/drive/folders/root").Raw("ids","[\"sub\"]").Str("destination",dest).Str("conflict","skip").Done();
 assert(Call("POST /api/drive/copy",folderBody).status==202);Run();assert(jobs.back()->state=="done");assert(jobs.back()->skipped_files==1);assert(jobs.back()->completed_files==1);
 assert(fs::file_size(dest+"/Sub/test.pkg")==8);assert(fs::file_size(dest+"/Sub/new.pkg")==7);
 fs::remove(dest+"/Sub/test.pkg");fs::remove(dest+"/Sub/new.pkg");fs::remove(dest+"/Sub");
 fs::remove(dest);
 std::cout<<"Drive jobs: successful copy, collision, partial cleanup, quota, disk full, traversal, symlink and cancellation passed\n";
}
