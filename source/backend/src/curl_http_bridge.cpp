// Direct PS5 HTTPS using PacBrew libcurl/OpenSSL and the console CA_LIST.
// Certificate and host verification stay enabled; HTTP and cross-host redirects are refused.
#include "ps5_http_bridge.h"
#include "console_curl.h"

#include <curl/curl.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
#include <fcntl.h>
#include <vector>

namespace {
static_assert(sizeof(off_t)>=8,"Drive downloads require 64-bit file offsets");
using Clock=std::chrono::steady_clock;
constexpr size_t kBodyCap=8u*1024u*1024u;
constexpr long kCurlBufferSize=256L*1024L;
constexpr long long kParallelDownloadThreshold=32LL*1024LL*1024LL;
constexpr int kParallelDownloadConnections=48;
constexpr long long kSegmentBytes=8LL*1024LL*1024LL;
constexpr size_t kWriteBufferBytes=1024u*1024u;
struct Metrics {
    std::atomic<int> active{0}, maximum{0}, reason{1};
    std::atomic<long long> calls{0}, bytes{0}, write_us{0};
    void reset(){active=0;maximum=0;reason=1;calls=0;bytes=0;write_us=0;}
} metrics;
std::once_flag curl_once;
int curl_init_result=CURLE_FAILED_INIT;
std::atomic<int> stage{0};
CURLSH *cookie_share=nullptr;
std::mutex cookie_locks[CURL_LOCK_DATA_LAST];
void lock_cookies(CURL *,curl_lock_data data,curl_lock_access,void *){cookie_locks[data].lock();}
void unlock_cookies(CURL *,curl_lock_data data,void *){cookie_locks[data].unlock();}
void init_curl(){
    curl_init_result=(int)curl_global_init(CURL_GLOBAL_DEFAULT);
    if(curl_init_result!=CURLE_OK)return;
    cookie_share=curl_share_init();
    if(!cookie_share){curl_init_result=CURLE_OUT_OF_MEMORY;return;}
    if(curl_share_setopt(cookie_share,CURLSHOPT_LOCKFUNC,lock_cookies)!=CURLSHE_OK ||
       curl_share_setopt(cookie_share,CURLSHOPT_UNLOCKFUNC,unlock_cookies)!=CURLSHE_OK ||
       curl_share_setopt(cookie_share,CURLSHOPT_SHARE,CURL_LOCK_DATA_COOKIE)!=CURLSHE_OK){
        curl_share_cleanup(cookie_share);cookie_share=nullptr;curl_init_result=CURLE_FAILED_INIT;
    }
}
struct ParallelProgress {
    std::atomic<long long> loaded{0};
    std::atomic<bool> abort{false};
    std::atomic<long long> next{0};
    std::atomic<int> finished{0};
    std::mutex wake_mu;
    std::condition_variable wake;
    long long total=0;
    prosperomgr_ps5_http_progress_fn progress=nullptr;
    void *progress_data=nullptr;
    prosperomgr_ps5_http_cancel_fn cancel=nullptr;
    void *cancel_data=nullptr;
};
struct Transfer {
    std::string location;
    std::string content_disposition;
    std::string etag, modified, response_date;
    std::string content_encoding;
    long status=0;
    long long content_length=-1;
    long long response_range_start=-1, response_range_end=-1, response_range_total=-1;
    long long request_range_start=-1, request_range_end=-1, request_range_total=-1;
    long long last_progress_now=0, aggregate_total=0;
    const char *path=nullptr;
    size_t cap=0;
    std::string body;
    int fd=-1;
    bool save_file=false, probe=false, head=false, attachment=false, overflow=false, write_error=false, canceled=false;
    bool range_probe=false, range_mode=false, range_valid=false, range_invalid=false;
    std::string expected_etag, expected_modified;
    int write_errno=0;
    long long written=0, total=-1;
    prosperomgr_ps5_http_progress_fn progress=nullptr;
    void *progress_data=nullptr;
    prosperomgr_ps5_http_cancel_fn cancel=nullptr;
    void *cancel_data=nullptr;
    std::atomic<long long> *aggregate_loaded=nullptr;
    curl_slist *request_headers=nullptr;
    std::vector<char> disk_buffer;
    Clock::time_point last_publish{};
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
    if(n>=5&&!std::memcmp(data,"HTTP/",5)){t.location.clear();t.content_disposition.clear();t.etag.clear();t.modified.clear();t.response_date.clear();t.content_encoding.clear();t.body.clear();t.attachment=false;t.content_length=-1;t.response_range_start=t.response_range_end=t.response_range_total=-1;t.range_valid=false;t.status=0;std::sscanf(data,"HTTP/%*s %ld",&t.status);}
    if(n>=17&&!strncasecmp(data,"Content-Encoding:",17)){size_t p=17;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&std::isspace((unsigned char)data[e-1]))--e;t.content_encoding=lower(std::string(data+p,e-p));}
    if(n>=9&&!strncasecmp(data,"Location:",9)){size_t p=9;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;t.location.assign(data+p,e-p);}
    if(n>=20&&!strncasecmp(data,"Content-Disposition:",20)){size_t p=20;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;t.content_disposition.assign(data+p,e-p);t.attachment=lower(t.content_disposition).find("attachment")!=std::string::npos;}
    for(const auto &field:{std::pair<const char*,std::string*>{"Last-Modified:",&t.modified},{"Date:",&t.response_date}}){
        size_t prefix=std::strlen(field.first);
        if(n>=prefix&&!strncasecmp(data,field.first,prefix)){
            size_t p=prefix,e=n;while(p<e&&std::isspace((unsigned char)data[p]))++p;
            while(e>p&&std::isspace((unsigned char)data[e-1]))--e;
            field.second->assign(data+p,e-p);
        }
    }
    if(n>=5&&!strncasecmp(data,"ETag:",5)){size_t p=5;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;t.etag.assign(data+p,e-p);}
    if(n>=14&&!strncasecmp(data,"Content-Range:",14)){char value[128]{};size_t p=14;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;size_t len=std::min(e-p,sizeof(value)-1);std::memcpy(value,data+p,len);long long first=-1,last=-1,total=-1;if(std::sscanf(value,"bytes %lld-%lld/%lld",&first,&last,&total)==3){t.response_range_start=first;t.response_range_end=last;t.response_range_total=total;}}
    if(n>=15&&!strncasecmp(data,"Content-Length:",15)){char value[40]{};size_t p=15;while(p<n&&std::isspace((unsigned char)data[p]))++p;size_t e=n;while(e>p&&(data[e-1]=='\r'||data[e-1]=='\n'))--e;size_t l=std::min(e-p,sizeof(value)-1);std::memcpy(value,data+p,l);char *end=nullptr;long long v=std::strtoll(value,&end,10);if(end!=value&&v>=0)t.content_length=v;}
    if(n==2&&data[0]=='\r'&&data[1]=='\n'){
        if(t.range_mode){t.range_valid=t.status==206&&t.response_range_start==t.request_range_start&&t.response_range_end==t.request_range_end&&t.response_range_total>0&&(t.request_range_total<0||t.response_range_total==t.request_range_total)&&(t.expected_etag.empty()||t.etag==t.expected_etag)&&(t.expected_modified.empty()||(t.etag.empty()&&t.modified==t.expected_modified))&&(t.content_encoding.empty()||t.content_encoding=="identity");}
        // Open only after a successful response explicitly identifies a file attachment.
        if(t.save_file&&t.attachment&&t.status>=200&&t.status<300&&t.fd<0&&t.path){t.fd=open(t.path,O_WRONLY|O_CREAT|O_EXCL,0644);if(t.fd<0){t.write_error=true;t.write_errno=errno;}}
    }
    return n;
}
bool flush_disk(Transfer &t){
    if(t.disk_buffer.empty())return true;
    const auto started=Clock::now();size_t off=0;
    while(off<t.disk_buffer.size()){
        if(t.cancel&&t.cancel(t.cancel_data)){t.canceled=true;return false;}
        ssize_t w=t.range_mode?pwrite(t.fd,t.disk_buffer.data()+off,t.disk_buffer.size()-off,(off_t)(t.request_range_start+t.written+off)):
                              write(t.fd,t.disk_buffer.data()+off,t.disk_buffer.size()-off);
        metrics.calls++;
        if(w<0&&errno==EINTR)continue;
        if(w<=0){t.write_error=true;t.write_errno=errno?errno:EIO;return false;}
        off+=(size_t)w;
    }
    metrics.write_us+=std::chrono::duration_cast<std::chrono::microseconds>(Clock::now()-started).count();
    metrics.bytes+=(long long)off;t.written+=(long long)off;
    if(t.aggregate_loaded)t.aggregate_loaded->fetch_add((long long)off);
    t.disk_buffer.clear();return true;
}
size_t body_cb(char *data,size_t size,size_t count,void *opaque){
    auto &t=*static_cast<Transfer*>(opaque);size_t n=size*count;
    if(t.range_probe&&t.status==206){if(!t.range_valid){t.range_invalid=true;return 0;}return 0;} // A one-byte probe only needs response headers.
    if(t.probe&&t.attachment)return 0; // stop after headers; no file bytes are buffered
    if(t.save_file){
        if(t.status>=300&&t.status<400)return n;
        if(!t.attachment||t.fd<0)return 0;
        if(t.range_mode && (!t.range_valid || (long long)n>t.request_range_end-t.request_range_start+1-t.written-(long long)t.disk_buffer.size())){t.range_invalid=true;return 0;}
        try {
            if(t.disk_buffer.capacity()<kWriteBufferBytes)t.disk_buffer.reserve(kWriteBufferBytes);
            for(size_t off=0;off<n;){
                size_t take=std::min(n-off,kWriteBufferBytes-t.disk_buffer.size());
                t.disk_buffer.insert(t.disk_buffer.end(),data+off,data+off+take);off+=take;
                if(t.disk_buffer.size()==kWriteBufferBytes&&!flush_disk(t))return 0;
            }
        } catch(...){t.write_error=true;t.write_errno=ENOMEM;return 0;}
        return n;
    }
    if(t.body.size()>t.cap||n>t.cap-t.body.size()){t.overflow=true;return 0;}
    t.body.append(data,n);return n;
}
int xfer_cb(void *opaque,curl_off_t total,curl_off_t now,curl_off_t,curl_off_t){
    auto &t=*static_cast<Transfer*>(opaque);
    if(t.cancel&&t.cancel(t.cancel_data)){t.canceled=true;return 1;}
    t.total=total>0?(long long)total:-1;
    auto tick=Clock::now();
    if(t.progress && tick-t.last_publish>=std::chrono::milliseconds(250)){
        t.last_publish=tick;t.progress(t.written,t.total,t.progress_data);
    }
    return 0;
}
void set_result(prosperomgr_http_result *r,int kind,long status,long long code,int where){
    if(!r)return;r->kind=kind;r->http_status=status;r->sce_code=code;r->stage=where;
    r->ssl_error=code==-10060?60:0;r->ssl_detail=0;
}
int curl_failure(CURLcode code,Transfer &t,prosperomgr_http_result *r){
    if(t.canceled){set_result(r,PROSPEROMGR_HTTP_ERR_CANCELED,t.status,-10000-(int)CURLE_ABORTED_BY_CALLBACK,10);return -1;}
    if(t.range_invalid){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}
    if(t.overflow){set_result(r,PROSPEROMGR_HTTP_ERR_OTHER,t.status,-10000-(int)CURLE_WRITE_ERROR,10);return -1;}
    if(t.write_error){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,t.write_errno,10);return -1;}
    int where=(code==CURLE_COULDNT_RESOLVE_HOST)?3:(code==CURLE_PEER_FAILED_VERIFICATION||code==CURLE_SSL_CONNECT_ERROR)?6:4;
    set_result(r,PROSPEROMGR_HTTP_ERR_CONNECT,t.status,-10000-(int)code,where);return -1;
}
bool configure(CURL *c,const std::string &url,Transfer &t,const char *hn,const char *hv,curl_slist **headers){
    if(!c||!allowed(url))return false;
    console_curl_setup(c);
    // Keep anonymous confirmation cookies between probe, redirect and download
    // handles, including parallel ranges. Nothing is written to a cookie file.
    if(!cookie_share || curl_easy_setopt(c,CURLOPT_SHARE,cookie_share)!=CURLE_OK ||
       curl_easy_setopt(c,CURLOPT_COOKIEFILE,"")!=CURLE_OK)return false;
    curl_easy_setopt(c,CURLOPT_URL,url.c_str());curl_easy_setopt(c,CURLOPT_HTTP_VERSION,(long)CURL_HTTP_VERSION_1_1);
    curl_easy_setopt(c,CURLOPT_BUFFERSIZE,kCurlBufferSize);
    curl_easy_setopt(c,CURLOPT_TCP_KEEPALIVE,1L);
    curl_easy_setopt(c,CURLOPT_ACCEPT_ENCODING,"identity");
    curl_easy_setopt(c,CURLOPT_PROTOCOLS_STR,"https");curl_easy_setopt(c,CURLOPT_REDIR_PROTOCOLS_STR,"https");
    curl_easy_setopt(c,CURLOPT_FOLLOWLOCATION,0L);curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT_MS,20000L);
    curl_easy_setopt(c,CURLOPT_LOW_SPEED_LIMIT,1L);curl_easy_setopt(c,CURLOPT_LOW_SPEED_TIME,25L);
    curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);
    curl_easy_setopt(c,CURLOPT_HEADERFUNCTION,header_cb);curl_easy_setopt(c,CURLOPT_HEADERDATA,&t);
    curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,body_cb);curl_easy_setopt(c,CURLOPT_WRITEDATA,&t);
    if(t.progress||t.cancel){curl_easy_setopt(c,CURLOPT_NOPROGRESS,0L);curl_easy_setopt(c,CURLOPT_XFERINFOFUNCTION,xfer_cb);curl_easy_setopt(c,CURLOPT_XFERINFODATA,&t);}
    if(headers){*headers=nullptr;for(curl_slist *item=t.request_headers;item;item=item->next){curl_slist *next=curl_slist_append(*headers,item->data);if(!next){curl_slist_free_all(*headers);*headers=nullptr;return false;}*headers=next;}if(hn&&hv){std::string h=std::string(hn)+": "+hv;curl_slist *next=curl_slist_append(*headers,h.c_str());if(!next){curl_slist_free_all(*headers);*headers=nullptr;return false;}*headers=next;}if(*headers)curl_easy_setopt(c,CURLOPT_HTTPHEADER,*headers);}
    if(t.head)curl_easy_setopt(c,CURLOPT_NOBODY,1L);
    return true;
}
int run(const char *input,Transfer &t,const char *hn,const char *hv,prosperomgr_http_result *r,std::string *resolved_url=nullptr,CURL *reusable=nullptr){
    std::call_once(curl_once,init_curl);
    if(curl_init_result!=CURLE_OK){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-curl_init_result,1);return -1;}
    std::string url=input?input:"";
    if(!allowed(url)){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
    for(int hop=0;hop<=5;++hop){
        CURL *c=reusable?reusable:curl_easy_init();if(!c){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-(int)CURLE_FAILED_INIT,1);return -1;}
        curl_easy_reset(c);t.location.clear();t.status=0;
        curl_slist *headers=nullptr;if(!configure(c,url,t,hn,hv,&headers)){if(!reusable)curl_easy_cleanup(c);curl_slist_free_all(headers);set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
        stage=5;CURLcode code=curl_easy_perform(c);curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&t.status);
        if(code!=CURLE_OK){
            // Probe mode intentionally aborts an attachment after seeing its headers.
            bool expected=t.probe&&(t.attachment||t.range_probe)&&code==CURLE_WRITE_ERROR&&t.status>=200&&t.status<300;
            if(!reusable)curl_easy_cleanup(c);curl_slist_free_all(headers);if(expected){if(resolved_url)*resolved_url=url;set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);return 0;}return curl_failure(code,t,r);
        }
        if(!reusable)curl_easy_cleanup(c);curl_slist_free_all(headers);
        if(t.status>=300&&t.status<400&&!t.location.empty()){
            if(hop==5){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}
            url=resolve_location(url,t.location);if(!allowed(url)){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,403,0,7);return -1;}continue;
        }
        if(t.status<200||t.status>=300){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);return -1;}
        if(resolved_url)*resolved_url=url;set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);return 0;
    }
    return -1;
}
int parallel_cancel(void *opaque){
    auto &state=*static_cast<ParallelProgress*>(opaque);
    return state.abort.load()||(state.cancel&&state.cancel(state.cancel_data));
}
bool strong_etag(const std::string &etag){return etag.size()>=2&&etag.rfind("W/",0)!=0&&etag.front()=='"'&&etag.back()=='"';}
// HTTP date fallback only without any ETag. Keep a conservative 60-second
// margin between server Date and Last-Modified (RFC 9110 8.8.2.2 / 13.1.5).
bool strong_modified(const Transfer &t){
    if(!t.etag.empty()||t.modified.empty()||t.response_date.empty())return false;
    auto modified=curl_getdate(t.modified.c_str(),nullptr);
    auto date=curl_getdate(t.response_date.c_str(),nullptr);
    return modified>=0&&date>=modified&&date-modified>=60;
}
int download_parallel(const std::string &url,const std::string &path,long long total,const std::string &etag,
                      prosperomgr_http_result *result,prosperomgr_ps5_http_progress_fn progress,void *progress_data,
                      prosperomgr_ps5_http_cancel_fn cancel,void *cancel_data,int connection_limit=kParallelDownloadConnections,const std::string &modified={}){
    const auto started=Clock::now();
    if(progress)progress(0,total,progress_data);
    if(cancel&&cancel(cancel_data)){set_result(result,PROSPEROMGR_HTTP_ERR_CANCELED,0,0,10);return -1;}
    int fd=open(path.c_str(),O_RDWR|O_CREAT|O_EXCL,0644);
    if(fd<0){set_result(result,PROSPEROMGR_HTTP_ERR_WRITE,0,errno,9);return -1;}
    if(ftruncate(fd,(off_t)total)!=0){int error=errno;close(fd);unlink(path.c_str());set_result(result,PROSPEROMGR_HTTP_ERR_WRITE,0,error,9);return -1;}

    ParallelProgress state;state.total=total;state.progress=progress;state.progress_data=progress_data;state.cancel=cancel;state.cancel_data=cancel_data;
    std::mutex result_mutex;prosperomgr_http_result first_error{};bool have_error=false;
    const int connections=(int)std::min<long long>(std::clamp(connection_limit,1,kParallelDownloadConnections),(total+kSegmentBytes-1)/kSegmentBytes);
    metrics.reason=0;metrics.maximum=connections;
    std::vector<std::thread> workers;workers.reserve(connections);
    try {
        for(int index=0;index<connections;++index){
            workers.emplace_back([&]{
                CURL *handle=curl_easy_init();
                try {
                    if(!handle)throw std::bad_alloc();
                    std::vector<char> buffer;buffer.reserve(kWriteBufferBytes);
                    while(!parallel_cancel(&state)){
                        const long long start=state.next.fetch_add(kSegmentBytes);
                        if(start>=total)break;
                        const long long end=std::min(total-1,start+kSegmentBytes-1);
                        Transfer part;part.save_file=true;part.range_mode=true;part.fd=fd;part.request_range_start=start;part.request_range_end=end;part.request_range_total=total;part.expected_etag=etag;part.expected_modified=modified;
                        part.cancel=parallel_cancel;part.cancel_data=&state;part.aggregate_loaded=&state.loaded;
                        part.disk_buffer.swap(buffer);
                        const std::string range="Range: bytes="+std::to_string(start)+"-"+std::to_string(end);
                        const std::string if_range="If-Range: "+(etag.empty()?modified:etag);
                        curl_slist *headers=nullptr;
                        for(const auto &header:{range,if_range}){
                            auto *next=curl_slist_append(headers,header.c_str());
                            if(!next){curl_slist_free_all(headers);throw std::bad_alloc();}headers=next;
                        }
                        part.request_headers=headers;
                        prosperomgr_http_result local{};
                        metrics.active++;
                        int rc=run(url.c_str(),part,nullptr,nullptr,&local,nullptr,handle);
                        if(rc==0&&!flush_disk(part)){curl_failure(part.canceled?CURLE_ABORTED_BY_CALLBACK:CURLE_WRITE_ERROR,part,&local);rc=-1;}
                        metrics.active--;
                        curl_slist_free_all(headers);
                        buffer.swap(part.disk_buffer);buffer.clear();
                        if(rc==0&&(part.status!=206||!part.range_valid||part.written!=end-start+1)){
                            set_result(&local,PROSPEROMGR_HTTP_ERR_HTTP,part.status,0,7);rc=-1;
                        }
                        if(rc!=0){
                            if(!state.abort.exchange(true)){std::lock_guard<std::mutex> lock(result_mutex);first_error=local;have_error=true;}
                            break;
                        }
                    }
                } catch(...) {
                    state.abort=true;std::lock_guard<std::mutex> lock(result_mutex);
                    set_result(&first_error,PROSPEROMGR_HTTP_ERR_OTHER,0,ENOMEM,1);have_error=true;
                }
                if(handle)curl_easy_cleanup(handle);
                state.finished++;state.wake.notify_one();
            });
        }
    } catch(...) {
        state.abort=true;
        std::lock_guard<std::mutex> lock(result_mutex);
        set_result(&first_error,PROSPEROMGR_HTTP_ERR_OTHER,0,ENOMEM,1);have_error=true;
    }
    // Only this thread publishes progress; disk/network workers never contend
    // on the UI/job mutex or race the caller's progress context.
    auto last_publish=Clock::now();
    while(state.finished.load()<(int)workers.size()){
        {std::unique_lock<std::mutex> lock(state.wake_mu);state.wake.wait_until(lock,last_publish+std::chrono::milliseconds(250),[&]{return state.finished.load()==(int)workers.size();});}
        if(progress)progress(state.loaded.load(),total,progress_data);
        last_publish=Clock::now();
    }
    for(auto &worker:workers)if(worker.joinable())worker.join();
    metrics.active=0;
    if(have_error||state.abort.load()){
        close(fd);unlink(path.c_str());
        if(have_error&&result)*result=first_error;
        else set_result(result,PROSPEROMGR_HTTP_ERR_CANCELED,0,0,10);
        return -1;
    }
    if(fsync(fd)!=0){int error=errno;close(fd);unlink(path.c_str());set_result(result,PROSPEROMGR_HTTP_ERR_WRITE,206,error,10);return -1;}
    close(fd);
    if(progress)progress(total,total,progress_data);
    set_result(result,PROSPEROMGR_HTTP_OK,206,0,7);
    if(result){result->bytes=total;result->total_ms=std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started).count();result->write_ms=metrics.write_us.load()/1000;}
    return 0;
}
}
extern "C" void hldrive_http_download_metrics(hldrive_download_metrics *out){
    if(out)*out={metrics.active.load(),metrics.maximum.load(),metrics.reason.load(),metrics.calls.load(),metrics.bytes.load(),metrics.write_us.load()};
}
extern "C" int prosperomgr_ps5_http_stage(void){return stage.load();}
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
    const auto download_started=Clock::now();metrics.reset();
    std::call_once(curl_once,init_curl);if(curl_init_result!=CURLE_OK){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,-10000-curl_init_result,1);return -1;}
    Transfer t;t.save_file=true;t.progress=progress;t.progress_data=progress_data;t.cancel=cancel;t.cancel_data=cancel_data;t.path=path;t.cap=0;
    // Downloads are streamed to a unique .part path; create it only after an attachment response.
    std::string url_now=url?url:"";if(!allowed(url_now)){set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);return -1;}
    if(cancel&&cancel(cancel_data)){set_result(r,PROSPEROMGR_HTTP_ERR_CANCELED,0,0,10);return -1;}
    // Public Drive links sometimes support byte ranges on their final signed URL.
    // Probe first; only use parallel writes when the server proves ranges and a strong HTTP validator.
    Transfer probe;probe.probe=true;probe.range_probe=true;probe.range_mode=true;probe.request_range_start=0;probe.request_range_end=0;probe.cancel=cancel;probe.cancel_data=cancel_data;
    prosperomgr_http_result probe_result{};std::string range_url;
    int probe_rc=run(url_now.c_str(),probe,"Range","bytes=0-0",&probe_result,&range_url);
    if(cancel&&cancel(cancel_data)){set_result(r,PROSPEROMGR_HTTP_ERR_CANCELED,probe.status,0,10);return -1;}
    if(probe_rc==0&&probe.status==206&&probe.range_valid&&probe.attachment&&(strong_etag(probe.etag)||strong_modified(probe))&&probe.response_range_total>=kParallelDownloadThreshold&&allowed(range_url)){
        int parallel_rc=download_parallel(range_url,path,probe.response_range_total,probe.etag,r,progress,progress_data,cancel,cancel_data,kParallelDownloadConnections,probe.etag.empty()?probe.modified:std::string{});
        return parallel_rc;
    }
    metrics.reason=probe_rc!=0?1:(!probe.range_valid||!probe.attachment)?2:!(strong_etag(probe.etag)||strong_modified(probe))?3:4;
    metrics.maximum=1;metrics.active=1;
    struct EndActive {~EndActive(){metrics.active=0;}} end_active;
    int rc=-1;
    for(int hop=0;hop<=5;++hop){
        CURL *c=curl_easy_init();if(!c)break;t.location.clear();t.status=0;t.attachment=false;
        if(!configure(c,url_now,t,nullptr,nullptr,nullptr)){curl_easy_cleanup(c);set_result(r,PROSPEROMGR_HTTP_ERR_INIT,0,0,1);break;}
        stage=5;CURLcode code=curl_easy_perform(c);curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&t.status);curl_off_t total=0;(void)curl_easy_getinfo(c,CURLINFO_CONTENT_LENGTH_DOWNLOAD_T,&total);t.total=total>0?(long long)total:-1;curl_easy_cleanup(c);
        if(code!=CURLE_OK){if(code==CURLE_WRITE_ERROR&&t.status>=200&&t.status<300&&!t.attachment){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,409,0,7);}else if(code==CURLE_WRITE_ERROR&&t.status>=400){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);}else curl_failure(code,t,r);rc=-1;break;}
        if(t.status>=300&&t.status<400&&!t.location.empty()){url_now=resolve_location(url_now,t.location);if(hop==5||!allowed(url_now)){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,403,0,7);rc=-1;break;}continue;}
        if(t.status<200||t.status>=300){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,t.status,0,7);rc=-1;break;}
        if(!t.attachment){set_result(r,PROSPEROMGR_HTTP_ERR_HTTP,409,0,7);rc=-1;break;}
        if(t.fd<0){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,errno?errno:EIO,9);rc=-1;break;}
        if(!flush_disk(t)){curl_failure(t.canceled?CURLE_ABORTED_BY_CALLBACK:CURLE_WRITE_ERROR,t,r);rc=-1;break;}
        if(fsync(t.fd)!=0){set_result(r,PROSPEROMGR_HTTP_ERR_WRITE,t.status,errno,10);rc=-1;break;}close(t.fd);t.fd=-1;set_result(r,PROSPEROMGR_HTTP_OK,t.status,0,7);if(r){r->bytes=t.written;r->total_ms=std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-download_started).count();r->write_ms=metrics.write_us.load()/1000;}rc=0;break;
    }
    if(rc==0&&progress)progress(t.written,t.total,progress_data);
    const bool owns_path=t.fd>=0;
    if(t.fd>=0)close(t.fd);if(rc!=0&&owns_path)unlink(path);return rc;
}
