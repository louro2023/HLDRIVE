// Direct PS5 HTTPS using PacBrew libcurl/OpenSSL and the console CA_LIST.
// Certificate and host verification stay enabled; HTTP and cross-host redirects are refused.
#include "ps5_http_bridge.h"
#include "console_curl.h"

#include <curl/curl.h>
#include <algorithm>
#include <cerrno>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>

namespace {
using Clock=std::chrono::steady_clock;
constexpr size_t kBodyCap=8u*1024u*1024u;
std::once_flag curl_once;
int curl_init_result=CURLE_FAILED_INIT;
int stage=0;
void init_curl(){curl_init_result=(int)curl_global_init(CURL_GLOBAL_DEFAULT);}
struct Transfer {
    std::string location;
    std::string content_disposition;
    long status=0;
    long long content_length=-1;
    const char *path=nullptr;
    size_t cap=0;
    std::string body;
    int fd=-1;
    bool save_file=false, probe=false, head=false, attachment=false, overflow=false, write_error=false, canceled=false;
    int write_errno=0;
    long long written=0, total=-1;
    prosperomgr_ps5_http_progress_fn progress=nullptr;
    void *progress_data=nullptr;
    prosperomgr_ps5_http_cancel_fn cancel=nullptr;
    void *cancel_data=nullptr;
};
std::string lower(std::string s){for(char &c:s)c=(char)std::tolower((unsigned char)c);return s;}
bool allowed(const std::string &url){
    if(url.rfind("https://",0)!=0)return false;
    auto begin=url.find("//")+2, end=url.find_first_of("/:?#",begin);
    if(end==std::string::npos)end=url.size();
    std::string authority=url.substr(begin,end-begin);
    if(authority.find('@')!=std::string::npos)return false;
    auto port=authority.find(':');
    if(port!=std::string::npos&&authority.substr(port+1)!="443")return false;
    std::string host=lower(authority.substr(0,port));
    if(host=="drive.google.com"||host=="docs.google.com"||host=="drive.usercontent.google.com")return true;
    constexpr char suffix[]=".googleusercontent.com";
    return host.size()>sizeof(suffix)-1&&host.compare(host.size()-(sizeof(suffix)-1),sizeof(suffix)-1,suffix)==0;
}
std::string resolve_location(const std::string &base,const std::string &loc){
    if(loc.rfind("https://",0)==0||loc.rfind("http://",0)==0)return loc;
    auto authority=base.find("//"); if(authority==std::string::npos)return {};
    auto slash=base.find('/',authority+2); std::string origin=base.substr(0,slash==std::string::npos?base.size():slash);
    if(loc.rfind("//",0)==0)return "https:"+loc;
    if(!loc.empty()&&loc[0]=='/')return origin+loc;
    auto path=base.find('?',authority+2); if(path==std::string::npos)path=base.size();
    auto last=base.rfind('/',path); return base.substr(0,last==std::string::npos?base.size():last+1)+loc;
}
size_t header_cb(char *data,size_t size,size_t count,void *opaque){
    auto &t=*static_cast<Transfer*>(opaque); size_t n=size*count;
    if(n>=5&&!std::memcmp(data,"HTTP/",5)){t.location.clear();t.content_disposition.clear();t.body.clear();t.attachment=false;t.content_length=-1;t.status=0;std::sscanf(data,"HTTP/%*s %ld",&t.status);}
    if(n>=9&&!strncasecmp(data,"Location:",9)){size_t p=9;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;t.location.assign(data+p,e-p);}
    if(n>=20&&!strncasecmp(data,"Content-Disposition:",20)){size_t p=20;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;t.content_disposition.assign(data+p,e-p);t.attachment=lower(t.content_disposition).find("attachment")!=std::string::npos;}
    if(n>=15&&!strncasecmp(data,"Content-Length:",15)){char value[40]{};size_t p=15;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;size_t l=std::min(e-p,sizeof(value)-1);std::memcpy(value,data+p,l);char *end=nullptr;long long v=std::strtoll(value,&end,10);if(end!=value&&v>=0)t.content_length=v;}
    if(n==2&&data[0]=='\r'&&data[1]=='\n'){
        // Open only after a successful response explicitly identifies a file attachment.
        if(t.save_file&&t.attachment&&t.status>=200&&t.status<300&&t.fd<0&&t.path){t.fd=open(t.path,O_WRONLY|O_CREAT|O_EXCL,0644);if(t.fd<0){t.write_error=true;t.write_errno=errno;}}
    }
    return n;
}
size_t body_cb(char *data,size_t size,size_t count,void *opaque){
    auto &t=*static_cast<Transfer*>(opaque);size_t n=size*count;
    if(t.probe&&t.attachment)return 0; // stop after headers; no file bytes are buffered
    if(t.save_file){if(t.status>=300&&t.status<400)return n;if(!t.attachment||t.fd<0)return 0;size_t off=0;while(off<n){ssize_t w=write(t.fd,data+off,n-off);if(w<0&&errno==EINTR)continue;if(w<=0){t.write_error=true;t.write_errno=errno;return 0;}off+=(size_t)w;}t.written+=(long long)n;return n;}
    if(t.body.size()>t.cap||n>t.cap-t.body.size()){t.overflow=true;return 0;}
    t.body.append(data,n);return n;
}
int xfer_cb(void *opaque,curl_off_t total,curl_off_t now,curl_off_t,curl_off_t){
    auto &t=*static_cast<Transfer*>(opaque);
    if(t.cancel&&t.cancel(t.cancel_data)){t.canceled=true;return 1;}
    t.total=total>0?(long long)total:-1;
    if(t.progress)t.progress((long long)now,t.total,t.progress_data);
    return 0;
}
void set_result(prosperomgr_http_result *r,int kind,long status,long long code,int where){
    if(!r)return;r->kind=kind;r->http_status=status;r->sce_code=code;r->stage=where;
    r->ssl_error=code==-10060?60:0;r->ssl_detail=0;
}
int curl_failure(CURLcode code,Transfer &t,prosperomgr_http_result *r){
    if(t.canceled){set_result(r,PROSPEROMGR_HTTP_ERR_CANCELED,t.status,-10000-(int)CURLE_ABORTED_BY_CALLBACK,10);return -1;}
    if(t.overflow){set_result(r,PROSPEROMGR_HTTP_ERR_OTHER,t.status,-10000-(int)CURLE_WRITE_ERROR,10);return -1;}
    if(t.write_error){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,t.write_errno,10);return -1;}
    int where=(code==CURLE_COULDNT_RESOLVE_HOST)?3:(code==CURLE_PEER_FAILED_VERIFICATION||code==CURLE_SSL_CONNECT_ERROR)?6:4;
    set_result(r,PROSPEROMGR_HTTP_ERR_CONNECT,t.status,-10000-(int)code,where);return -1;
}
bool configure(CURL *c,const std::string &url,Transfer &t,const char *hn,const char *hv){
    if(!c||!allowed(url))return false;
    console_curl_setup(c);
    curl_easy_setopt(c,CURLOPT_URL,url.c_str());curl_easy_setopt(c,CURLOPT_HTTP_VERSION,(long)CURL_HTTP_VERSION_1_1);
    curl_easy_setopt(c,CURLOPT_PROTOCOLS_STR,"https");curl_easy_setopt(c,CURLOPT_REDIR_PROTOCOLS_STR,"https");
    curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,0L);curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT_MS,20000L);
    curl_easy_setopt(c,CURLOPT_LOW_SPEED_LIMIT,1L);curl_easy_setopt(c,CURLOPT_LOW_SPEED_TIME,25L);
    curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);
    curl_easy_setopt(c,CURLOPT_HEADERFUNCTION,header_cb);curl_easy_setopt(c,CURLOPT_HEADERDATA,&t);
    curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,body_cb);curl_easy_setopt(c,CURLOPT_WRITEDATA,&t);
    if(t.progress||t.cancel){curl_easy_setopt(c,CURLOPT_NOPROGRESS,0L);curl_easy_setopt(c,CURLOPT_XFERINFOFUNCTION,xfer_cb);curl_easy_setopt(c,CURLOPT_XFERINFODATA,&t);}
    if(hn&&hv){std::string h=std::string(hn)+": "+hv;curl_slist *headers=curl_slist_append(nullptr,h.c_str());curl_easy_setopt(c,CURLOPT_HTTPHEADER,headers);}
    if(t.head)curl_easy_setopt(c,CURLOPT_NOBODY,1L);
    return true;
}
int run(const char *input,Transfer &t,const char *hn,const char *hv,prosperomgr_http_result *r){
    std::call_once(curl_once,init_curl);
    if(curl_init_result!=CURLE_OK){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-curl_init_result,1);return -1;}
    std::string url=input?input:"";
    if(!allowed(url)){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
    for(int hop=0;hop<=5;++hop){
        CURL *c=curl_easy_init();if(!c){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-(int)CURLE_FAILED_INIT,1);return -1;}
        t.location.clear();t.status=0;
        if(!configure(c,url,t,hn,hv)){curl_easy_cleanup(c);set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
        stage=5;CURLcode code=curl_easy_perform(c);curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&t.status);
        if(code!=CURLE_OK){
            // Probe mode intentionally aborts an attachment after seeing its headers.
            bool expected=t.probe&&t.attachment&&code==CURLE_WRITE_ERROR&&t.status>=200&&t.status<300;
            curl_easy_cleanup(c);if(expected){set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);return 0;}return curl_failure(code,t,r);
        }
        curl_easy_cleanup(c);
        if(t.status>=300&&t.status<400&&!t.location.empty()){
            if(hop==5){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}
            url=resolve_location(url,t.location);if(!allowed(url)){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,403,0,7);return -1;}continue;
        }
        if(t.status<200||t.status>=300){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}
        set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);return 0;
    }
    return -1;
}
}
extern "C" int prosperomgr_ps5_http_stage(void){return stage;}
extern "C" int prosperomgr_ps5_http_get(const char *url,char **out,size_t *out_len,size_t cap,const char *hn,const char *hv,prosperomgr_http_result *r){
    if(out)*out=nullptr;if(out_len)*out_len=0;Transfer t;t.cap=std::min(cap,kBodyCap);
    int rc=run(url,t,hn,hv,r);if(rc)return rc;char *p=(char*)std::malloc(t.body.size()+1);if(!p){set_result(r,PROSPEROMGR_HTTP_ERR_OTHER,t.status,ENOMEM,10);return -1;}std::memcpy(p,t.body.data(),t.body.size());p[t.body.size()]=0;if(out)*out=p;else std::free(p);if(out_len)*out_len=t.body.size();return 0;
}
extern "C" int hldrive_http_probe(const char *url,char **out,size_t *out_len,prosperomgr_http_result *r){
    if(out)*out=nullptr;if(out_len)*out_len=0;Transfer t;t.cap=256*1024;t.probe=true;int rc=run(url,t,nullptr,nullptr,r);if(rc)return rc;
    if(t.attachment)return 0;char *p=(char*)std::malloc(t.body.size()+1);if(!p){set_result(r,PROSPEROMGR_HTTP_ERR_OTHER,t.status,ENOMEM,10);return -1;}std::memcpy(p,t.body.data(),t.body.size());p[t.body.size()]=0;if(out)*out=p;else std::free(p);if(out_len)*out_len=t.body.size();return 0;
}
extern "C" int prosperomgr_ps5_http_size(const char *url,long long *out,prosperomgr_http_result *r){
    Transfer t;t.head=true;int rc=run(url,t,nullptr,nullptr,r);if(rc)return rc;if(t.content_length<0){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}if(out)*out=t.content_length;return 0;
}
extern "C" int prosperomgr_ps5_http_range(const char *url,long long start,long long end,char *buf,size_t cap,size_t *out,prosperomgr_http_result *r){
    if(out)*out=0;if(!allowed(url?url:"")){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}Transfer t;t.cap=cap;std::call_once(curl_once,init_curl);if(curl_init_result!=CURLE_OK)return -1;std::string range=std::to_string(start)+"-"+std::to_string(end);CURL *c=curl_easy_init();if(!c)return -1;console_curl_setup(c);curl_easy_setopt(c,CURLOPT_URL,url);curl_easy_setopt(c,CURLOPT_RANGE,range.c_str());curl_easy_setopt(c,CURLOPT_PROTOCOLS_STR,"https");curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,body_cb);curl_easy_setopt(c,CURLOPT_WRITEDATA,&t);t.cap=cap;CURLcode code=curl_easy_perform(c);curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&t.status);curl_easy_cleanup(c);if(code!=CURLE_OK||t.status!=206){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,-10000-(int)code,5);return -1;}std::memcpy(buf,t.body.data(),t.body.size());if(out)*out=t.body.size();set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);return 0;
}
extern "C" int prosperomgr_ps5_http_download(const char *url,const char *path,prosperomgr_http_result *r,prosperomgr_ps5_http_progress_fn progress,void *progress_data,prosperomgr_ps5_http_cancel_fn cancel,void *cancel_data){
    std::call_once(curl_once,init_curl);if(curl_init_result!=CURLE_OK){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-curl_init_result,1);return -1;}
    Transfer t;t.save_file=true;t.progress=progress;t.progress_data=progress_data;t.cancel=cancel;t.cancel_data=cancel_data;t.path=path;t.cap=0;
    // Downloads are streamed to a unique .part path; create it only after an attachment response.
    std::string url_now=url?url:"";if(!allowed(url_now)){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
    int rc=-1;
    for(int hop=0;hop<=5;++hop){CURL *c=curl_easy_init();if(!c)break;t.location.clear();t.status=0;t.attachment=false;console_curl_setup(c);curl_easy_setopt(c,CURLOPT_URL,url_now.c_str());curl_easy_setopt(c,CURLOPT_HTTP_VERSION,(long)CURL_HTTP_VERSION_1_1);curl_easy_setopt(c,CURLOPT_PROTOCOLS_STR,"https");curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,0L);curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT_MS,20000L);curl_easy_setopt(c,CURLOPT_LOW_SPEED_LIMIT,1L);curl_easy_setopt(c,CURLOPT_LOW_SPEED_TIME,25L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);curl_easy_setopt(c,CURLOPT_HEADERFUNCTION,header_cb);curl_easy_setopt(c,CURLOPT_HEADERDATA,&t);curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,body_cb);curl_easy_setopt(c,CURLOPT_WRITEDATA,&t);curl_easy_setopt(c,CURLOPT_NOPROGRESS,0L);curl_easy_setopt(c,CURLOPT_XFERINFOFUNCTION,xfer_cb);curl_easy_setopt(c,CURLOPT_XFERINFODATA,&t);
        stage=5;CURLcode code=curl_easy_perform(c);curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&t.status);curl_off_t total=0;(void)curl_easy_getinfo(c,CURLINFO_CONTENT_LENGTH_DOWNLOAD_T,&total);t.total=total>0?(long long)total:-1;curl_easy_cleanup(c);
        if(code!=CURLE_OK){if(code==CURLE_WRITE_ERROR&&t.status>=200&&t.status<300&&!t.attachment){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,409,0,7);}else if(code==CURLE_WRITE_ERROR&&t.status>=400){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);}else curl_failure(code,t,r);rc=-1;break;}
        if(t.status>=300&&t.status<400&&!t.location.empty()){url_now=resolve_location(url_now,t.location);if(hop==5||!allowed(url_now)){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,403,0,7);rc=-1;break;}continue;}
        if(t.status<200||t.status>=300){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);rc=-1;break;}
        if(!t.attachment){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,409,0,7);rc=-1;break;}
        if(t.fd<0){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,errno?errno:EIO,9);rc=-1;break;}
        if(fsync(t.fd)!=0){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,errno,10);rc=-1;break;}close(t.fd);t.fd=-1;set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);if(r){r->bytes=t.written;r->total_ms=0;}rc=0;break;
    }
    if(t.fd>=0)close(t.fd);if(rc!=0)unlink(path);return rc;
}
