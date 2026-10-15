PS5_PAYLOAD_SDK ?= /opt/ps5-payload-sdk
include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
SRC := source/backend/src
INC := source/backend/include
THIRD := source/backend/third_party
PACBREW_HOME := $(PS5_PAYLOAD_SDK)/target/user/homebrew
CURL_CFLAGS := -I$(PACBREW_HOME)/include
CURL_LIBS := -L$(PACBREW_HOME)/lib -Wl,--start-group -lcurl -lssl -lcrypto -lz -lzstd -lpsl -Wl,--end-group
CXXFLAGS := -std=c++20 -O2 -Wall -DPROSPEROMGR_PS5 -D_UNIX -I$(INC) -I$(THIRD) $(CURL_CFLAGS) -MMD -MP
SOURCES := $(filter-out $(SRC)/curl_http_bridge.cpp,$(wildcard $(SRC)/*.cpp)) $(SRC)/curl_http_bridge.cpp
OBJECTS := $(patsubst $(SRC)/%.cpp,build/obj/%.o,$(SOURCES)) build/obj/console_curl.o build/obj/miniz.o
UNRAR := archive arcread blake2s cmddata consio crc crypt dll encname errhnd extinfo extract filcreat file filefn filestr find getbits global hash headers largepage match options pathfn qopen rar rarpch rarvm rawread rdwrfn rijndael rs16 rs scantree secpassword sha1 sha256 smallfn strfn strlist system threadpool timefn ui unicode unpack volume
OBJECTS += $(addprefix build/obj/unrar/,$(addsuffix .o,$(UNRAR)))
.PHONY: all frontend deploy
all: build/HLDRIVE.elf
build/HLDRIVE.elf: $(OBJECTS) | .deps/pacbrew/.complete
	$(CXX) -o $@ $^ $(PS5_PAYLOAD_SDK)/target/lib/libmicrohttpd.a $(CURL_LIBS) -Wl,--wrap=fcntl -lpthread -lkernel_sys -lSceNetCtl -lSceNet -lSceSystemService -lSceUserService -lSceAppInstUtil
.deps/pacbrew/.complete: tools/setup-pacbrew.sh
	bash tools/setup-pacbrew.sh
$(OBJECTS): | .deps/pacbrew/.complete
build/obj/media_shortcut.o: source/launcher/param.json source/launcher/icon0.png
build/obj/%.o: $(SRC)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c $< -o $@
build/obj/ps5_http_bridge.o: $(SRC)/ps5_http_bridge.c
	@mkdir -p $(dir $@)
	$(CC) -O2 -Wall -DPROSPEROMGR_PS5 -I$(INC) -MMD -MP -c $< -o $@
build/obj/console_curl.o: $(SRC)/console_curl.c
	@mkdir -p $(dir $@)
	$(CC) -O2 -Wall -DPROSPEROMGR_PS5 $(CURL_CFLAGS) -I$(INC) -MMD -MP -c $< -o $@
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
