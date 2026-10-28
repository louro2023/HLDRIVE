// Production transport, local HTTPS fixture. TLS and host allowlist remain on.
#include "../source/backend/src/curl_http_bridge.cpp"
#include <cassert>
#include <fstream>
#include <iostream>
namespace {curl_slist *fixture=nullptr;const char *ca=nullptr;}
extern "C" void console_curl_setup(CURL *handle){
    curl_easy_setopt(handle,CURLOPT_NOSIGNAL,1L);
    curl_easy_setopt(handle,CURLOPT_CAINFO,ca);
    curl_easy_setopt(handle,CURLOPT_CONNECT_TO,fixture);
    curl_easy_setopt(handle,CURLOPT_NOPROXY,"*");
}
struct Progress {
    long long last=0;int calls=0;std::thread::id owner=std::this_thread::get_id();
};
void report(long long bytes,long long total,void *opaque){
    auto &p=*static_cast<Progress*>(opaque);
    assert(std::this_thread::get_id()==p.owner);assert(bytes>=p.last);assert(bytes<=total||total<0);
    p.last=bytes;++p.calls;
}
int cancel(void *opaque){return static_cast<Progress*>(opaque)->last>=2*1024*1024;}
int main(int argc,char **argv){
    Transfer validator;
    validator.modified="Sat, 01 Jan 2000 10:00:00 GMT";
    validator.response_date="Sat, 01 Jan 2000 10:00:59 GMT";
    assert(!strong_modified(validator));
    validator.response_date="Sat, 01 Jan 2000 10:01:00 GMT";
    assert(strong_modified(validator));
    validator.response_date.clear();assert(!strong_modified(validator));
    assert(argc==5);std::string mode=argv[1],path=argv[2];ca=argv[4];
    std::string mapping="drive.google.com:443:127.0.0.1:"+std::string(argv[3]);
    fixture=curl_slist_append(nullptr,mapping.c_str());
    std::string url="https://drive.google.com/"+mode;
    prosperomgr_http_result result{};Progress p;
    auto begin=Clock::now();int rc;
    const bool existing=mode=="existingparallel"||mode=="existingsequential";
    if(existing){std::ofstream file(path);file<<"preserve existing file";}
    if(mode=="bench8"||mode=="bench16"){
        std::call_once(curl_once,init_curl);metrics.reset();
        rc=download_parallel(url,path,400LL*1024*1024+123,"\"fixture\"",&result,report,&p,nullptr,nullptr,mode=="bench8"?8:16);
    }else rc=prosperomgr_ps5_http_download(url.c_str(),path.c_str(),&result,report,&p,mode=="cancel"?cancel:nullptr,&p);
    const auto ms=std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-begin).count();
    bool success=mode=="datevalid"||mode=="dateinvalid"||mode=="daterecent"||mode=="dateweak"||mode=="normal"||mode=="noetag"||mode=="norange"||mode=="small"||mode=="bench8"||mode=="bench16"||mode=="redirect";
    if(success){
        assert(rc==0);assert(p.last==result.bytes);
        std::ifstream file(path,std::ios::binary);std::vector<unsigned char> block(65536);long long offset=0;
        while(file){file.read((char*)block.data(),block.size());auto n=file.gcount();for(long long i=0;i<n;++i)assert(block[(size_t)i]==(unsigned char)((offset+i)%251));offset+=n;}
        assert(offset==result.bytes);
        assert(metrics.calls.load()<result.bytes/(64*1024)+4); // Coalesced writes, not 16 KiB callbacks.
        if(mode=="normal"||mode=="redirect"||mode=="datevalid")assert(metrics.maximum==std::min<long long>(kParallelDownloadConnections,(400LL*1024*1024+123+kSegmentBytes-1)/kSegmentBytes)&&metrics.reason==0);
        if(mode=="noetag"||mode=="dateinvalid"||mode=="daterecent"||mode=="dateweak")assert(metrics.reason==3&&metrics.maximum==1);
        if(mode=="norange")assert(metrics.reason==2&&metrics.maximum==1);
        if(mode=="small")assert(metrics.reason==4&&metrics.maximum==1);
    }else{
        assert(rc!=0);
        if(existing){std::ifstream file(path);std::string contents;std::getline(file,contents);assert(contents=="preserve existing file");}
        else assert(access(path.c_str(),F_OK)!=0);
    }
    assert(metrics.active==0);
    if(mode=="cancel")assert(result.kind==PROSPEROMGR_HTTP_ERR_CANCELED);
    std::cout<<"{\"case\":\""<<mode<<"\",\"ms\":"<<ms<<",\"bytes\":"<<result.bytes<<",\"writes\":"<<metrics.calls<<",\"connections\":"<<metrics.maximum<<",\"progress_calls\":"<<p.calls<<",\"verified\":true}\n";
    unlink(path.c_str());curl_slist_free_all(fixture);
}
