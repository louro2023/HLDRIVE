#include "drive_parser.hpp"
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
using namespace hldrive;
int main(int argc,char **argv) {
    DriveRef ref;
    assert(ParseDriveFolder("https://drive.google.com/drive/folders/abc_123?resourcekey=key-1",&ref));
    assert(ref.id=="abc_123"&&ref.resource_key=="key-1");
    assert(!ParseDriveFolder("https://drive.google.com.evil.test/drive/folders/abc",&ref));
    assert(!ParseDriveFolder("https://evil.test/?https://drive.google.com/drive/folders/abc",&ref));
    assert(!ParseDriveFolder("file:///data/abc",&ref));
    assert(!SafeGoogleUrl("https://drive.google.com@evil.test/download"));
    assert(!SafeGoogleUrl("https://drive.google.com.evil.test/download"));
    assert(!SafeGoogleUrl("http://drive.google.com/download"));
    assert(SafeGoogleUrl("https://drive.usercontent.google.com/download?id=abc"));
    assert(!SafeName("../foo"));assert(!SafeName(".."));assert(!SafeName(std::string("a\0b",3)));
    DriveListing list;std::string error;
    assert(!ParseDriveListing("<title>Sign in</title>",&list,&error));
    assert(ParseDriveListing("<title>Empty</title><div class='flip-entries'></div>",&list,&error));assert(list.entries.empty());
    std::string html="<title>Biblioteca</title><div class='flip-entries'><a href='https://drive.google.com/file/d/test/view'><div>A &amp; B &#x1F600;.pkg</div></a><a href='https://drive.google.com/drive/folders/folder?resourcekey=secret'>Subpasta</a></div>";
    assert(ParseDriveListing(html,&list,&error));assert(list.entries.size()==2);
    assert(list.entries[0].name=="A & B 😀.pkg");assert(list.entries[1].folder);assert(list.entries[1].ref.resource_key=="secret");
    assert(!ParseDriveListing("<div class='flip-entries'><a href='https://drive.google.com/file/d/test/view'>../escape</a></div>",&list,&error));
    std::string form="<form action='https://drive.usercontent.google.com/download' id='download-form'><input value='test' name='id' type='hidden'><input type='hidden' name='confirm' value='t'><input type='hidden' name='uuid' value='a&amp;b'></form>";
    assert(DownloadConfirmation(form,"test").find("uuid=a%26b")!=std::string::npos);
    assert(DownloadConfirmation(form,"other").empty());
    assert(DownloadConfirmation("<form id='download-form' action='https://evil.test/'></form>","test").empty());
    assert(!DownloadConfirmation("<form id='download-form' action='https://drive.usercontent.google.com/download?export=download&amp;id=test'><input type='hidden' name='confirm' value='t'></form>","test").empty());
    auto legacy=DownloadConfirmation("<a href='/uc?export=download&amp;confirm=token&amp;id=test'>Download anyway</a>","test");
    assert(legacy.find("confirm=token")!=std::string::npos);
    assert(DownloadConfirmation("<a href='/uc?confirm=t&amp;id=other'>Download</a>","test").empty());
    assert(DownloadConfirmation("<a href='https://evil.test/uc?confirm=t&amp;id=test'>Download</a>","test").empty());
    assert(DownloadConfirmation("<a href='https://drive.google.com/drive/folders/test?confirm=t&amp;id=test'>Download</a>","test").empty());
    auto json=DownloadConfirmation(R"({"downloadUrl":"https:\/\/drive.usercontent.google.com\/download?id\u003dtest\u0026confirm\u003dt"})","test");
    assert(!json.empty());
    assert(DownloadConfirmation(std::string(256*1024+1,'x')+form,"test").empty());
    assert(DownloadConfirmation("<form id='download-form' method='POST' action='https://drive.usercontent.google.com/download'><input type='hidden' name='id' value='test'><input type='hidden' name='confirm' value='t'></form>","test").empty());
    assert(DownloadPageError("<p class='uc-error-subcaption'>Too many users have <b>downloaded</b> this file &amp; quota exceeded.</p>")=="Too many users have downloaded this file & quota exceeded.");
    std::cout<<"Parser and validation tests passed\n";
    for(int i=1;i<argc;++i) {
        std::ifstream input(argv[i]);std::string body((std::istreambuf_iterator<char>(input)),{});
        assert(input.good()||input.eof());assert(ParseDriveListing(body,&list,&error));
        std::cout<<list.name<<": "<<list.entries.size()<<" entries\n";
        for(const auto &e:list.entries) std::cout<<(e.folder?"folder ":"file ")<<e.ref.id<<" "<<e.name<<"\n";
    }
}
