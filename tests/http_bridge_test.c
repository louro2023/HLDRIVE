// Real native bridge, synthetic SCE transport. Never accesses the network.
#define PROSPEROMGR_PS5
#include "../source/backend/src/ps5_http_bridge.c"
#include <assert.h>
static int mode, sends, reads, closes, sni, proxies, headersize;
int sceNetInit(void){return 0;}
int sceNetPoolCreate(const char *n,int s,int f){return 1;}
int sceNetPoolDestroy(int id){return 0;}
int sceSslInit(size_t size){return 2;}
int sceSslTerm(int id){return 0;}
int sceHttpInit(int n,int s,size_t size){assert(size>=1024*1024);return 3;}
int sceHttpTerm(int id){closes++;return 0;}
int sceHttpCreateTemplate(int c,const char *ua,int v,int proxy){proxies=proxy;return 4;}
int sceHttpDeleteTemplate(int id){return 0;}
int sceHttpSetResponseHeaderMaxSize(int id,size_t n){headersize=n;return 0;}
int sceHttpSetAutoRedirect(int id,int on){assert(!on);return 0;}
int sceHttpsEnableOption(int id,unsigned int flags){sni=flags;return 0;}
int sceHttpsGetCaList(https_ca_list_t *list){static void *certs[1]={(void *)1};list->certs=certs;list->count=1;return 0;}
int sceHttpsFreeCaList(https_ca_list_t *list){list->certs=NULL;list->count=0;return 0;}
int sceHttpsLoadCert(int id,int count,void *certs,void *cert,void *key){return 0;}
int sceHttpsUnloadCert(void){return 0;}
int sceHttpsGetSslError(int id,int *e,unsigned int *d){*e=mode==2?1:0;*d=mode==2?32:0;return 0;}
int sceHttpCreateConnectionWithURL(int t,const char *url,int keep){assert(strncmp(url,"https://drive.",14)==0);return 5;}
int sceHttpDeleteConnection(int id){return 0;}
int sceHttpSetConnectTimeOut(int id,unsigned int us){return 0;}
int sceHttpSetResolveTimeOut(int id,unsigned int us){return 0;}
int sceHttpSetSendTimeOut(int id,unsigned int us){return 0;}
int sceHttpSetRecvTimeOut(int id,unsigned int us){return 0;}
int sceHttpCreateRequestWithURL(int c,int m,const char *u,uint64_t len){return 6;}
int sceHttpAddRequestHeader(int id,const char *name,const char *v,unsigned int mode){return 0;}
int sceHttpSendRequest(int id,const void *p,size_t n){sends++;return mode==2 || (mode==1&&sends==1)?-123:0;}
int sceHttpGetStatusCode(int id,int *s){*s=mode==3?302:200;return 0;}
int sceHttpGetResponseContentLength(int id,int *t,uint64_t *n){*t=0;*n=7;return 0;}
int sceHttpReadData(int id,void *p,size_t n){if(mode==4||(mode==6&&reads>0))return -99;if(mode==5)return 0;if(reads++)return 0;assert(n>=7);memcpy(p,"payload",7);return 7;}
int sceHttpDeleteRequest(int id){return 0;}
int sceHttpGetAllResponseHeaders(int id,char **h,size_t *n){
 *h=mode==3?"Location: https://evil.example/file\r\n":mode==4||mode==7?"Content-Type: text/html\r\n":"Content-Disposition: attachment; filename=x.pkg\r\n";*n=strlen(*h);return 0;
}
static void reset(int m){mode=m;sends=reads=closes=0;}
int main(void){
 const char *url="https://drive.usercontent.google.com/download?id=test";
 struct prosperomgr_http_result r={0};char *body=NULL;size_t size=0;
 reset(1);assert(hldrive_http_probe(url,&body,&size,&r)==0);assert(sends==2&&closes==1&&body==NULL);assert(sni==0x80&&proxies==0&&headersize==65536);
 reset(2);assert(hldrive_http_probe(url,&body,&size,&r)==-1);assert(sends==1&&closes==1&&r.sce_code==-123&&r.stage==6&&r.ssl_error==1&&r.ssl_detail==32);
 reset(3);assert(hldrive_http_probe(url,&body,&size,&r)==-1);assert(sends==1&&r.http_status==403);
 reset(4);assert(hldrive_http_probe(url,&body,&size,&r)==-1);assert(r.kind==PROSPEROMGR_HTTP_ERR_READ&&r.sce_code==-99);
 reset(0);char path[]="/tmp/hldrive-http-XXXXXX";int fd=mkstemp(path);assert(fd>=0);close(fd);unlink(path);
 assert(prosperomgr_ps5_http_download(url,path,&r,NULL,NULL,NULL,NULL)==0);
 FILE *f=fopen(path,"rb");char b[8]={0};assert(f&&fread(b,1,7,f)==7&&!strcmp(b,"payload"));fclose(f);unlink(path);
 for(int m=5;m<=7;m++){reset(m);assert(prosperomgr_ps5_http_download(url,path,&r,NULL,NULL,NULL,NULL)==-1);assert(access(path,F_OK)!=0);assert(r.kind==(m==7?PROSPEROMGR_HTTP_ERR_HTTP:PROSPEROMGR_HTTP_ERR_READ));if(m!=7)assert(r.stage==10);}
 puts("HTTP bridge synthetic tests passed.");return 0;
}
