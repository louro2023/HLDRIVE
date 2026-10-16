// Actual libcurl handles, no network: a warning cookie must survive the probe
// handle and be available to both sequential and parallel download handles.
#include "../source/backend/src/curl_http_bridge.cpp"
#include <cassert>
#include <iostream>
extern "C" void console_curl_setup(CURL *){}
int main(){
    std::call_once(curl_once,init_curl);assert(curl_init_result==CURLE_OK);
    CURL *probe=curl_easy_init();Transfer t;
    assert(configure(probe,"https://drive.google.com/uc?id=test",t,nullptr,nullptr,nullptr));
    assert(curl_easy_setopt(probe,CURLOPT_COOKIELIST,"Set-Cookie: download_warning_test=confirmed; domain=.google.com; path=/; secure")==CURLE_OK);
    curl_easy_cleanup(probe);
    auto check=[](){
        CURL *download=curl_easy_init();Transfer transfer;
        assert(configure(download,"https://drive.google.com/uc?id=test&confirm=t",transfer,nullptr,nullptr,nullptr));
        curl_slist *cookies=nullptr;
        assert(curl_easy_getinfo(download,CURLINFO_COOKIELIST,&cookies)==CURLE_OK);
        bool found=false;for(auto *p=cookies;p;p=p->next)if(std::string(p->data).find("download_warning_test\tconfirmed")!=std::string::npos)found=true;
        assert(found);curl_slist_free_all(cookies);curl_easy_cleanup(download);
    };
    check();std::vector<std::thread> workers;for(int i=0;i<8;++i)workers.emplace_back(check);
    for(auto &worker:workers)worker.join();
    curl_share_cleanup(cookie_share);cookie_share=nullptr;curl_global_cleanup();
    std::cout<<"Anonymous confirmation cookies survive probe and 8 parallel handles (no network).\n";
}
