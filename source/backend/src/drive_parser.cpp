#include "drive_parser.hpp"
#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <stdexcept>
namespace hldrive {
namespace {
bool Id(const std::string &s) {
    return !s.empty() && s.size() <= 200 && std::all_of(s.begin(), s.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
    });
}
std::string Decode(const std::string &s) {
    std::string out;
    for (size_t i=0; i<s.size(); ++i) {
        if (s[i]!='&') { out+=s[i]; continue; }
        size_t end=s.find(';',i+1);
        if (end==std::string::npos || end-i>16) { out+='&'; continue; }
        std::string ent=s.substr(i+1,end-i-1);
        if (ent=="amp") out+='&'; else if(ent=="quot") out+='"';
        else if(ent=="apos" || ent=="#39") out+='\'';
        else if(ent=="lt") out+='<'; else if(ent=="gt") out+='>';
        else if(ent=="nbsp") out+=' ';
        else if(!ent.empty() && ent[0]=='#') {
            try {
                bool hex=ent.size()>1 && (ent[1]=='x'||ent[1]=='X');
                auto number=ent.substr(hex?2:1); size_t used=0;
                unsigned long cp=std::stoul(number,&used,hex?16:10);
                if(used!=number.size() || cp==0 || cp>0x10ffff || (cp>=0xd800&&cp<=0xdfff)) throw std::runtime_error("entity");
                if(cp<0x80) out+=char(cp);
                else if(cp<0x800) {out+=char(0xc0|(cp>>6));out+=char(0x80|(cp&63));}
                else if(cp<0x10000) {out+=char(0xe0|(cp>>12));out+=char(0x80|((cp>>6)&63));out+=char(0x80|(cp&63));}
                else {out+=char(0xf0|(cp>>18));out+=char(0x80|((cp>>12)&63));out+=char(0x80|((cp>>6)&63));out+=char(0x80|(cp&63));}
            } catch(...) {out+=s.substr(i,end-i+1);}
        } else {out+=s.substr(i,end-i+1);}
        i=end;
    }
    return out;
}
std::string Text(const std::string &s) {
    std::string out; bool tag=false;
    for(char c:s) {if(c=='<') tag=true; else if(c=='>') tag=false; else if(!tag) out+=c;}
    return Decode(out);
}
// Small bounded HTML tokenizer: handles either quote style and attribute order.
std::map<std::string,std::string> Attrs(const std::string &tag) {
    std::map<std::string,std::string> attrs;
    size_t p=tag.find_first_of(" \t\r\n");
    while(p!=std::string::npos && p<tag.size()) {
        while(p<tag.size() && (std::isspace((unsigned char)tag[p])||tag[p]=='/')) ++p;
        size_t begin=p;
        while(p<tag.size() && (std::isalnum((unsigned char)tag[p])||tag[p]=='-'||tag[p]=='_')) ++p;
        if(p==begin) break;
        std::string key=tag.substr(begin,p-begin);
        while(p<tag.size() && std::isspace((unsigned char)tag[p])) ++p;
        if(p>=tag.size()||tag[p]!='=') continue;
        ++p; while(p<tag.size() && std::isspace((unsigned char)tag[p])) ++p;
        if(p>=tag.size()) break;
        char quote=tag[p]; bool quoted=quote=='"'||quote=='\'';
        begin=quoted?++p:p;
        while(p<tag.size() && (quoted?tag[p]!=quote:!std::isspace((unsigned char)tag[p])&&tag[p]!='>')) ++p;
        attrs[key]=Decode(tag.substr(begin,p-begin));
        if(quoted&&p<tag.size()) ++p;
    }
    return attrs;
}
std::string Key(const std::string &url) {
    auto p=url.find("resourcekey="); if(p==std::string::npos) return {};
    p+=12; auto end=url.find_first_of("&#",p); auto key=url.substr(p,end-p);
    return Id(key)?key:std::string();
}
}
std::string Encode(const std::string &s) {
    std::string out; const char *h="0123456789ABCDEF";
    for(unsigned char c:s) {
        if(std::isalnum(c)||c=='-'||c=='_'||c=='.'||c=='~') out+=char(c);
        else {out+='%';out+=h[c>>4];out+=h[c&15];}
    } return out;
}
bool SafeName(const std::string &s) {
    return !s.empty() && s.size()<=240 && s!="." && s!=".." &&
        std::none_of(s.begin(),s.end(),[](unsigned char c){return c<32||c==127||c=='/'||c=='\\';});
}
bool SafeGoogleUrl(const std::string &s) {
    if(s.size()>8000 || s.rfind("https://",0)!=0) return false;
    auto end=s.find('/',8); auto host=s.substr(8,end-8);
    return host=="drive.google.com"||host=="docs.google.com"||host=="drive.usercontent.google.com"||
        (host.size()>22 && host.ends_with(".googleusercontent.com") && host.find_first_of("@:\\?#")==std::string::npos);
}
bool ParseDriveFolder(const std::string &url, DriveRef *out) {
    const std::string prefix="https://drive.google.com/drive/";
    if(url.rfind(prefix,0)!=0) return false;
    auto start=url.find("folders/",prefix.size());
    if(start==std::string::npos) return false;
    auto middle=url.substr(prefix.size(),start-prefix.size());
    if(!middle.empty() && middle!="u/0/" && middle!="u/1/") return false;
    start+=8; auto end=url.find_first_of("/?#",start);
    out->id=url.substr(start,end-start);out->resource_key=Key(url);
    return Id(out->id);
}
bool ParseDriveListing(const std::string &html, DriveListing *out, std::string *error) {
    out->entries.clear(); out->name.clear();
    if(html.find("flip-entries")==std::string::npos || html.size()>8*1024*1024) {
        *error="Não foi possível listar a pasta pública. Verifique o compartilhamento; a página do Google também pode ter mudado."; return false;
    }
    auto title=html.find("<title>"); auto title_end=html.find("</title>",title);
    if(title!=std::string::npos && title_end!=std::string::npos) out->name=Text(html.substr(title+7,title_end-title-7));
    std::set<std::string> seen;
    size_t pos=0;
    while((pos=html.find("<a ",pos))!=std::string::npos) {
        auto end=html.find('>',pos), close=html.find("</a>",end);
        if(end==std::string::npos||close==std::string::npos) break;
        auto attrs=Attrs(html.substr(pos,end-pos+1));
        auto url=attrs["href"]; DriveEntry entry;
        entry.folder=ParseDriveFolder(url,&entry.ref);
        if(!entry.folder) {
            const std::string prefix="https://drive.google.com/file/d/";
            if(url.rfind(prefix,0)!=0) {pos=close+4;continue;}
            auto stop=url.find_first_of("/?#",prefix.size());
            entry.ref.id=url.substr(prefix.size(),stop-prefix.size()); entry.ref.resource_key=Key(url);
        }
        entry.name=Text(html.substr(end+1,close-end-1));
        if(!Id(entry.ref.id)||!SafeName(entry.name)) { *error="A pasta contém um nome incompatível com o filesystem do console.";return false; }
        if(seen.insert(entry.ref.id).second) out->entries.push_back(entry);
        if(out->entries.size()>10000) {*error="Pasta excede o limite de 10.000 itens.";return false;}
        pos=close+4;
    }
    return true;
}
std::string DownloadConfirmation(const std::string &html, const std::string &expected_id) {
    size_t pos=0;
    while((pos=html.find("<form",pos))!=std::string::npos) {
        auto end=html.find('>',pos); if(end==std::string::npos) break;
        auto attrs=Attrs(html.substr(pos,end-pos+1));pos=end+1;
        if(attrs["id"]!="download-form") continue;
        auto action=attrs["action"];
        if(action!="https://drive.usercontent.google.com/download") return {};
        auto close=html.find("</form>",pos);if(close==std::string::npos)return {};
        std::map<std::string,std::string> params;
        while((pos=html.find("<input",pos))!=std::string::npos && pos<close) {
            end=html.find('>',pos);if(end==std::string::npos||end>close)return {};
            auto input=Attrs(html.substr(pos,end-pos+1));pos=end+1;
            if(input["type"]=="hidden") params[input["name"]]=input["value"];
        }
        if(params["id"]!=expected_id || params["confirm"].empty()) return {};
        action+='?';
        for(const auto &[key,value]:params) {if(key.size()>100||value.size()>2048)return {};action+=Encode(key)+"="+Encode(value)+"&";}
        return SafeGoogleUrl(action)?action:std::string();
    }
    return {};
}
}
