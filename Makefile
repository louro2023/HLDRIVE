PS5_PAYLOAD_SDK ?= /opt/ps5-payload-sdk
include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
SRC := source/backend/src
INC := source/backend/include
THIRD := source/backend/third_party
CXXFLAGS := -std=c++20 -O2 -Wall -DPROSPEROMGR_PS5 -D_UNIX -I$(INC) -I$(THIRD) -MMD -MP
SOURCES := $(wildcard $(SRC)/*.cpp)
OBJECTS := $(patsubst $(SRC)/%.cpp,build/obj/%.o,$(SOURCES)) build/obj/ps5_http_bridge.o build/obj/miniz.o
UNRAR := archive arcread blake2s cmddata consio crc crypt dll encname errhnd extinfo extract filcreat file filefn filestr find getbits global hash headers largepage match options pathfn qopen rar rarpch rarvm rawread rdwrfn rijndael rs16 rs scantree secpassword sha1 sha256 smallfn strfn strlist system threadpool timefn ui unicode unpack volume
OBJECTS += $(addprefix build/obj/unrar/,$(addsuffix .o,$(UNRAR)))
.PHONY: all frontend deploy
all: build/HLDRIVE.elf
build/HLDRIVE.elf: $(OBJECTS)
	$(CXX) -o $@ $^ $(PS5_PAYLOAD_SDK)/target/lib/libmicrohttpd.a -lpthread -lkernel_sys -lSceNetCtl -lSceHttp -lSceSsl -lSceNet -lSceSystemService -lSceUserService -lSceAppInstUtil
build/obj/media_shortcut.o: source/launcher/param.json source/launcher/icon0.png
build/obj/%.o: $(SRC)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c $< -o $@
build/obj/ps5_http_bridge.o: $(SRC)/ps5_http_bridge.c
	@mkdir -p $(dir $@)
	$(CC) -O2 -Wall -DPROSPEROMGR_PS5 -I$(INC) -MMD -MP -c $< -o $@
build/obj/miniz.o: $(THIRD)/miniz.c
	@mkdir -p $(dir $@)
	$(CC) -O2 -w -c $< -o $@
build/obj/unrar/%.o: $(THIRD)/unrar/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) -std=c++20 -O2 -w -DRARDLL -D_UNIX -DSILENT -I$(THIRD)/unrar -c $< -o $@
frontend:
	cd source/frontend && npm ci && npm run build && npm run check:i18n
	python3 source/tools/gen_assets.py
deploy: build/HLDRIVE.elf
	$(PS5_DEPLOY) -h $(PS5_HOST) -p 9021 $<
-include $(OBJECTS:.o=.d)
