// Native PS5 HTTPS transport — sceNet + sceSsl + sceHttp.
// HLDRIVE retains the platform TLS policy and hostname/SNI; no accept-all callback.

#if defined(PROSPEROMGR_PS5)

#include "ps5_http_bridge.h"

#include <stdint.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>

// No official headers ship these in this SDK — verified against the real exported symbols
// in libSceNet.so / libSceSsl.so / libSceHttp.so via `nm -D` before writing this file.
extern int sceNetInit(void);
extern int sceNetPoolCreate(const char *name, int size, int flags);
extern int sceNetPoolDestroy(int poolId);

extern int sceSslInit(size_t poolSize);
extern int sceSslTerm(int sslCtxId);

extern int sceHttpInit(int netPoolId, int sslCtxId, size_t poolSize);
extern int sceHttpTerm(int httpCtxId);
extern int sceHttpCreateTemplate(int httpCtxId, const char *userAgent, int httpVer, int autoProxyConf);
extern int sceHttpDeleteTemplate(int tmplId);
extern int sceHttpSetResponseHeaderMaxSize(int id, size_t headerSize);
extern int sceHttpSetAutoRedirect(int id, int enable);
extern int sceHttpsEnableOption(int id, unsigned int flags);
extern int sceHttpsGetSslError(int id, int *error, unsigned int *detail);

extern int sceHttpCreateConnectionWithURL(int tmplId, const char *url, int enableKeepAlive);
extern int sceHttpDeleteConnection(int connId);

extern int sceHttpSetConnectTimeOut(int id, unsigned int usec);
extern int sceHttpSetResolveTimeOut(int id, unsigned int usec);
extern int sceHttpSetSendTimeOut(int id, unsigned int usec);
extern int sceHttpSetRecvTimeOut(int id, unsigned int usec);
extern int sceHttpGetAllResponseHeaders(int reqId, char **header, size_t *headerSize);

extern int sceHttpCreateRequestWithURL(int connId, int method, const char *url, uint64_t contentLength);
extern int sceHttpAddRequestHeader(int reqId, const char *name, const char *value, unsigned int mode);
extern int sceHttpSendRequest(int reqId, const void *postData, size_t size);
extern int sceHttpGetStatusCode(int reqId, int *statusCode);
extern int sceHttpGetResponseContentLength(int reqId, int *contentLengthType, uint64_t *contentLength);
extern int sceHttpReadData(int reqId, void *data, size_t size);
extern int sceHttpDeleteRequest(int reqId);

#define HTTP_METHOD_GET 0
#define HTTP_TIMEOUT_US (20u * 1000u * 1000u)
#define HTTP_MAX_REDIRECTS 5

static volatile sig_atomic_t g_stage = 0;

int prosperomgr_ps5_http_stage(void) { return (int)g_stage; }


// ---- request context, torn down the same way on every exit path ----------

typedef struct {
    int net_pool;
    int ssl_ctx;
    int http_ctx;
    int tmpl;
    int conn;
    int req;
} http_ctx_t;

static void http_ctx_init(http_ctx_t *ctx) {
    ctx->net_pool = -1;
    ctx->ssl_ctx = -1;
    ctx->http_ctx = -1;
    ctx->tmpl = -1;
    ctx->conn = -1;
    ctx->req = -1;
}

// Teardown order (request, connection, template, http, ssl, net pool) is the one actually
// exercised on hardware. sceNetInit() has no matching sceNetTerm() call here, on purpose.
static void http_ctx_close(http_ctx_t *ctx) {
    g_stage = 11;
    if (ctx->req >= 0) sceHttpDeleteRequest(ctx->req);
    if (ctx->conn >= 0) sceHttpDeleteConnection(ctx->conn);
    if (ctx->tmpl >= 0) sceHttpDeleteTemplate(ctx->tmpl);
    if (ctx->http_ctx >= 0) sceHttpTerm(ctx->http_ctx);
    if (ctx->ssl_ctx >= 0) sceSslTerm(ctx->ssl_ctx);
    if (ctx->net_pool >= 0) sceNetPoolDestroy(ctx->net_pool);
    g_stage = 0;
}

static void set_result(struct prosperomgr_http_result *result, int kind, long status, long long code) {
    if (!result) return;
    result->kind = kind;
    result->http_status = status;
    result->sce_code = code;
    result->stage = g_stage;
}

// Deletes just the request/connection pair, so the same net/ssl/http/template
// can be reused for the next redirect hop.
static void http_close_request(http_ctx_t *ctx) {
    if (ctx->req >= 0) sceHttpDeleteRequest(ctx->req);
    if (ctx->conn >= 0) sceHttpDeleteConnection(ctx->conn);
    ctx->req = -1;
    ctx->conn = -1;
}

// Applied at all three levels because some sceHttp builds only honor it on one — an unbounded
// wait here wedges every other transfer behind https_client_ps5.cpp's g_transfer_mu.
static void http_set_timeouts(int id) {
    sceHttpSetResolveTimeOut(id, HTTP_TIMEOUT_US);
    sceHttpSetConnectTimeOut(id, HTTP_TIMEOUT_US);
    sceHttpSetSendTimeOut(id, HTTP_TIMEOUT_US);
    sceHttpSetRecvTimeOut(id, HTTP_TIMEOUT_US);
}

// Copies the response's Location header into `out`, resolving a root-relative
// value (Gitea sends those) against `base_url`. Returns 0 when one was found.
static int http_read_location(int req, const char *base_url, char *out, size_t out_sz) {
    char *headers = NULL;
    size_t headers_len = 0;
    if (sceHttpGetAllResponseHeaders(req, &headers, &headers_len) != 0 || !headers) return -1;

    const char *end = headers + headers_len;
    for (const char *line = headers; line < end;) {
        const char *eol = memchr(line, '\n', (size_t)(end - line));
        size_t line_len = eol ? (size_t)(eol - line) : (size_t)(end - line);
        while (line_len && (line[line_len - 1] == '\r' || line[line_len - 1] == ' ')) line_len--;

        if (line_len > 9 && strncasecmp(line, "location:", 9) == 0) {
            const char *value = line + 9;
            size_t value_len = line_len - 9;
            while (value_len && (*value == ' ' || *value == '\t')) { value++; value_len--; }
            if (value_len == 0 || value_len >= out_sz) return -1;

            if (value[0] != '/') {
                snprintf(out, out_sz, "%.*s", (int)value_len, value);
                return 0;
            }
            const char *scheme_end = strstr(base_url, "://");
            if (!scheme_end) return -1;
            const char *host_end = scheme_end + 3;
            while (*host_end && *host_end != '/') host_end++;
            size_t prefix_len = (size_t)(host_end - base_url);
            if (prefix_len + value_len >= out_sz) return -1;
            snprintf(out, out_sz, "%.*s%.*s", (int)prefix_len, base_url, (int)value_len, value);
            return 0;
        }

        if (!eol) break;
        line = eol + 1;
    }
    return -1;
}

// Keep the original HTTPS hostname for DNS, SNI and certificate validation.
static int http_send_hop(http_ctx_t *ctx, const char *url, int first_hop,
                         const char *header_name, const char *header_value, int *status_out,
                         struct prosperomgr_http_result *result) {
    long long rc;
    g_stage = 4;
    if ((ctx->conn = sceHttpCreateConnectionWithURL(ctx->tmpl, url, 0)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_CONNECT, 0, ctx->conn);
        return -1;
    }
    http_set_timeouts(ctx->conn);

    g_stage = 5;
    if ((ctx->req = sceHttpCreateRequestWithURL(ctx->conn, HTTP_METHOD_GET, url, 0)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_CONNECT, 0, ctx->req);
        return -1;
    }
    http_set_timeouts(ctx->req);
    if ((rc = sceHttpAddRequestHeader(ctx->req, "Accept-Encoding", "identity", 0)) != 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_SEND, 0, rc); return -1;
    }
    // First hop only: an api.github.com token must not follow a redirect onto
    // the release-asset CDN.
    if (first_hop && header_name && header_name[0] && header_value) {
        sceHttpAddRequestHeader(ctx->req, header_name, header_value, 0);
    }

    g_stage = 6;
    if ((rc = sceHttpSendRequest(ctx->req, NULL, 0)) != 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_CONNECT, 0, rc);
        if (result) sceHttpsGetSslError(ctx->req, &result->ssl_error, &result->ssl_detail);
        return -1;
    }

    g_stage = 7;
    if ((rc = sceHttpGetStatusCode(ctx->req, status_out)) != 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_CONNECT, 0, rc);
        return -1;
    }
    return 0;
}

// Builds the full request pipeline, following any redirects itself. Returns
// 0 on success; on failure the caller must still call http_ctx_close().
static int drive_url_allowed(const char *url) {
    if (strncmp(url, "https://", 8) != 0 || strlen(url) >= 8000) return 0;
    const char *end = strchr(url + 8, '/');
    if (!end) return 0;
    size_t n = (size_t)(end - url - 8);
    const char *host = url + 8;
    if ((n == 16 && strncmp(host, "drive.google.com", n) == 0) ||
        (n == 15 && strncmp(host, "docs.google.com", n) == 0) ||
        (n == 28 && strncmp(host, "drive.usercontent.google.com", n) == 0)) return 1;
    const char *suffix = ".googleusercontent.com";
    size_t len = strlen(suffix);
    if (n <= len || strncmp(end - len, suffix, len) != 0) return 0;
    for (size_t i = 0; i < n; ++i) if (!isalnum((unsigned char)host[i]) && host[i] != '-' && host[i] != '.') return 0;
    return 1;
}

static int http_open(http_ctx_t *ctx, const char *url, const char *header_name, const char *header_value,
                     struct prosperomgr_http_result *result) {
    long long rc;

    g_stage = 1;
    if ((rc = sceNetInit()) < 0) { set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, rc); return -1; }
    if ((ctx->net_pool = sceNetPoolCreate("prosperomgr_http", 512 * 1024, 0)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, ctx->net_pool);
        return -1;
    }

    g_stage = 2;
    if ((ctx->ssl_ctx = sceSslInit(384 * 1024)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, ctx->ssl_ctx);
        return -1;
    }

    g_stage = 3;
    if ((ctx->http_ctx = sceHttpInit(ctx->net_pool, ctx->ssl_ctx, 1024 * 1024)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, ctx->http_ctx);
        return -1;
    }
    if ((ctx->tmpl = sceHttpCreateTemplate(ctx->http_ctx, "HLDRIVE/1.1", 2, 0)) < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, ctx->tmpl);
        return -1;
    }
    // SNI is necessary for virtual HTTPS hosts. Keep CA and hostname verification.
    // Flag ABI: OpenOrbis/shadPS4 network/http.h (SNI = 0x80).
    if ((rc = sceHttpsEnableOption(ctx->tmpl, 0x80)) != 0 ||
        (rc = sceHttpSetResponseHeaderMaxSize(ctx->tmpl, 64 * 1024)) != 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, rc); return -1;
    }
    // Follow redirects ourselves to validate the destination host at each hop.
    sceHttpSetAutoRedirect(ctx->tmpl, 0);
    http_set_timeouts(ctx->tmpl);

    char current[8192];
    snprintf(current, sizeof(current), "%s", url);

    for (int hop = 0;; hop++) {
        if (!drive_url_allowed(current)) {
            set_result(result, PROSPEROMGR_HTTP_ERR_HTTP, 403, 0);
            return -1;
        }
        int plain = strncmp(current, "http://", 7) == 0;
        if (!plain && strncmp(current, "https://", 8) != 0) {
            set_result(result, PROSPEROMGR_HTTP_ERR_INIT, 0, 0);
            return -1;
        }

        // Use the hostname so Google receives SNI and the platform can validate it.
        int status = 0;
        if (result) { result->ssl_error = 0; result->ssl_detail = 0; }
        if (http_send_hop(ctx, current, hop == 0, header_name, header_value, &status, result) != 0) {
            // Retry connection setup once, before opening a destination file.
            // A certificate failure is not transient and is never bypassed.
            if (!result || result->kind != PROSPEROMGR_HTTP_ERR_CONNECT || result->ssl_error || result->ssl_detail) return -1;
            http_close_request(ctx);
            if (http_send_hop(ctx, current, hop == 0, header_name, header_value, &status, result) != 0) return -1;
        }

        if (status >= 300 && status < 400 && hop < HTTP_MAX_REDIRECTS) {
            char next[8192];
            if (http_read_location(ctx->req, current, next, sizeof(next)) == 0) {
                snprintf(current, sizeof(current), "%s", next);
                http_close_request(ctx);
                continue;
            }
        }
        if (status < 200 || status >= 300) {
            set_result(result, PROSPEROMGR_HTTP_ERR_HTTP, status, 0);
            return -1;
        }

        set_result(result, PROSPEROMGR_HTTP_OK, status, 0);
        return 0;
    }
}

static long long monotonic_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

static long long monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

int prosperomgr_ps5_http_size(const char *url, long long *out_size,
                              struct prosperomgr_http_result *result) {
    http_ctx_t ctx;
    http_ctx_init(&ctx);
    if (out_size) *out_size = -1;

    if (http_open(&ctx, url, NULL, NULL, result) != 0) {
        http_ctx_close(&ctx);
        return -1;
    }
    int cl_type = 1;
    uint64_t content_length = 0;
    int have = sceHttpGetResponseContentLength(ctx.req, &cl_type, &content_length) == 0 && cl_type == 0;
    http_ctx_close(&ctx);

    // No length means no random access, so the caller has to stage the file instead.
    if (!have || content_length == 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_HTTP, result ? result->http_status : 0, 0);
        return -1;
    }
    if (out_size) *out_size = (long long)content_length;
    return 0;
}

int prosperomgr_ps5_http_range(const char *url, long long start, long long end, char *buf, size_t buf_size,
                               size_t *out_len, struct prosperomgr_http_result *result) {
    char range[64];
    snprintf(range, sizeof(range), "bytes=%lld-%lld", start, end);

    http_ctx_t ctx;
    http_ctx_init(&ctx);
    if (out_len) *out_len = 0;

    if (http_open(&ctx, url, "Range", range, result) != 0) {
        http_ctx_close(&ctx);
        return -1;
    }

    size_t off = 0;
    int ok = 1;
    while (off < buf_size) {
        int n = sceHttpReadData(ctx.req, buf + off, buf_size - off);
        if (n < 0) { ok = 0; break; }
        if (n == 0) break;
        off += (size_t)n;
    }
    http_ctx_close(&ctx);

    if (!ok) {
        set_result(result, PROSPEROMGR_HTTP_ERR_READ, result ? result->http_status : 0, 0);
        return -1;
    }
    if (out_len) *out_len = off;
    return 0;
}

int prosperomgr_ps5_http_get(const char *url, char **out_body, size_t *out_len, size_t max_body_bytes,
                             const char *header_name, const char *header_value,
                             struct prosperomgr_http_result *result) {
    http_ctx_t ctx;
    http_ctx_init(&ctx);
    if (out_body) *out_body = NULL;
    if (out_len) *out_len = 0;

    if (http_open(&ctx, url, header_name, header_value, result) != 0) {
        http_ctx_close(&ctx);
        return -1;
    }

    g_stage = 8;
    int cl_type = 1;
    uint64_t content_length = 0;
    sceHttpGetResponseContentLength(ctx.req, &cl_type, &content_length);

    size_t cap = (cl_type == 0 && content_length > 0 && content_length < max_body_bytes)
                     ? (size_t)content_length + 1
                     : 65536;
    char *buf = (char *)malloc(cap);
    if (!buf) {
        http_ctx_close(&ctx);
        set_result(result, PROSPEROMGR_HTTP_ERR_OTHER, result ? result->http_status : 0, 0);
        return -1;
    }

    g_stage = 10;
    size_t off = 0;
    int ok = 1;
    for (;;) {
        if (off + 65536 > cap) {
            size_t new_cap = cap * 2;
            if (new_cap > max_body_bytes + 1) new_cap = max_body_bytes + 1;
            if (new_cap <= cap) { ok = 0; break; } // hit the cap
            char *nb = (char *)realloc(buf, new_cap);
            if (!nb) { ok = 0; break; }
            buf = nb;
            cap = new_cap;
        }
        int n = sceHttpReadData(ctx.req, buf + off, cap - off);
        if (n < 0) { set_result(result, PROSPEROMGR_HTTP_ERR_READ, result ? result->http_status : 0, n); ok = 0; break; }
        if (n == 0) break;
        off += (size_t)n;
        if (off > max_body_bytes) { ok = 0; break; }
    }

    http_ctx_close(&ctx);

    if (!ok) {
        free(buf);
        if (result && result->kind == PROSPEROMGR_HTTP_OK) set_result(result, PROSPEROMGR_HTTP_ERR_OTHER, result->http_status, 0);
        return -1;
    }
    if (out_body) *out_body = buf; else free(buf);
    if (out_len) *out_len = off;
    return 0;
}

static int drive_is_attachment(int req) {
    char *headers = NULL; size_t size = 0;
    if (sceHttpGetAllResponseHeaders(req, &headers, &size) != 0 || !headers) return 0;
    for (size_t i = 0; i + 20 < size; ++i) {
        if ((i == 0 || headers[i-1] == '\n') && strncasecmp(headers+i, "content-disposition:", 20) == 0) {
            size_t p=i+20;
            while(p<size && (headers[p]==' ' || headers[p]=='\t')) ++p;
            return p+10<=size && strncasecmp(headers+p,"attachment",10)==0;
        }
    }
    return 0;
}

int hldrive_http_probe(const char *url, char **out_body, size_t *out_len, struct prosperomgr_http_result *result) {
    http_ctx_t ctx; http_ctx_init(&ctx); *out_body=NULL; *out_len=0;
    if(http_open(&ctx,url,NULL,NULL,result)!=0) {http_ctx_close(&ctx);return -1;}
    if(drive_is_attachment(ctx.req)) {http_ctx_close(&ctx);return 0;}
    g_stage = 10;
    size_t cap=256*1024, used=0;
    char *buf=malloc(cap);
    if(!buf) {set_result(result, PROSPEROMGR_HTTP_ERR_OTHER, result ? result->http_status : 0, 0);http_ctx_close(&ctx);return -1;}
    for(;;) {
        if(used==cap) {set_result(result, PROSPEROMGR_HTTP_ERR_OTHER, result ? result->http_status : 0, 0);free(buf);http_ctx_close(&ctx);return -1;}
        int n=sceHttpReadData(ctx.req,buf+used,cap-used);
        if(n<0) {set_result(result, PROSPEROMGR_HTTP_ERR_READ, result ? result->http_status : 0, n);free(buf);http_ctx_close(&ctx);return -1;}
        if(n==0) break;
        used+=(size_t)n;
    }
    http_ctx_close(&ctx);*out_body=buf;*out_len=used;return 0;
}

int prosperomgr_ps5_http_download(const char *url, const char *out_path, struct prosperomgr_http_result *result,
                                  prosperomgr_ps5_http_progress_fn progress, void *progress_opaque,
                                  prosperomgr_ps5_http_cancel_fn cancel, void *cancel_opaque) {
    http_ctx_t ctx;
    http_ctx_init(&ctx);

    if (http_open(&ctx, url, NULL, NULL, result) != 0) {
        http_ctx_close(&ctx);
        return -1;
    }

    // Never save a quota/login/confirmation HTML page under a game's filename.
    if (!drive_is_attachment(ctx.req)) {
        set_result(result, PROSPEROMGR_HTTP_ERR_HTTP, 409, 0);
        http_ctx_close(&ctx);
        return -1;
    }

    g_stage = 8;
    int cl_type = 1;
    uint64_t content_length = 0;
    int have_length = (sceHttpGetResponseContentLength(ctx.req, &cl_type, &content_length) == 0 && cl_type == 0);
    long long total = have_length ? (long long)content_length : -1;

    if (progress) progress(0, total, progress_opaque);
    if (cancel && cancel(cancel_opaque)) {
        set_result(result, PROSPEROMGR_HTTP_ERR_CANCELED, result ? result->http_status : 0, 0);
        http_ctx_close(&ctx);
        return -1;
    }

    g_stage = 9;
    int fd = open(out_path, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0) {
        set_result(result, PROSPEROMGR_HTTP_ERR_WRITE, result ? result->http_status : 0, errno);
        http_ctx_close(&ctx);
        return -1;
    }

    const size_t kChunk = 256 * 1024;
    unsigned char *chunk = (unsigned char *)malloc(kChunk);
    if (!chunk) {
        close(fd);
        unlink(out_path);
        http_ctx_close(&ctx);
        set_result(result, PROSPEROMGR_HTTP_ERR_OTHER, result ? result->http_status : 0, 0);
        return -1;
    }

    g_stage = 10;
    long long loaded = 0;
    long long last_progress_ms = monotonic_ms();
    long long last_data_ms = last_progress_ms;
    const long long kStallTimeoutMs = 25000;
    int fail_kind = PROSPEROMGR_HTTP_OK;
    long long fail_code = 0;
    long long loop_start_us = monotonic_us();
    long long read_us = 0;
    long long write_us = 0;

    for (;;) {
        if (cancel && cancel(cancel_opaque)) { fail_kind = PROSPEROMGR_HTTP_ERR_CANCELED; break; }

        long long before_read_us = monotonic_us();
        int n = sceHttpReadData(ctx.req, chunk, kChunk);
        long long after_read_us = monotonic_us();
        read_us += after_read_us - before_read_us;
        if (n < 0) { fail_kind = PROSPEROMGR_HTTP_ERR_READ; fail_code = n; break; }
        if (n == 0) break; // clean EOF

        last_data_ms = monotonic_ms();

        ssize_t written = 0;
        while (written < n) {
            ssize_t w = write(fd, chunk + written, (size_t)(n - written));
            if (w < 0 && errno == EINTR) continue;
            if (w <= 0) { fail_kind = PROSPEROMGR_HTTP_ERR_WRITE; fail_code = errno; break; }
            written += w;
        }
        write_us += monotonic_us() - after_read_us;
        if (fail_kind != PROSPEROMGR_HTTP_OK) break;

        loaded += n;

        if (progress) {
            long long now = monotonic_ms();
            if (now - last_progress_ms >= 80) {
                progress(loaded, total, progress_opaque);
                last_progress_ms = now;
            }
        }

        if (monotonic_ms() - last_data_ms > kStallTimeoutMs) { fail_kind = PROSPEROMGR_HTTP_ERR_TIMEOUT; break; }
    }

    free(chunk);
    if (fsync(fd) != 0 && fail_kind == PROSPEROMGR_HTTP_OK) {fail_kind = PROSPEROMGR_HTTP_ERR_WRITE;fail_code = errno;}
    if (close(fd) != 0 && fail_kind == PROSPEROMGR_HTTP_OK) {fail_kind = PROSPEROMGR_HTTP_ERR_WRITE;fail_code = errno;}
    if (fail_kind == PROSPEROMGR_HTTP_OK && have_length && loaded != total) fail_kind = PROSPEROMGR_HTTP_ERR_READ;
    if (fail_kind != PROSPEROMGR_HTTP_OK) set_result(result, fail_kind, result ? result->http_status : 0, fail_code);
    http_ctx_close(&ctx);

    if (result) {
        result->bytes = loaded;
        result->total_ms = (monotonic_us() - loop_start_us) / 1000;
        result->read_ms = read_us / 1000;
        result->write_ms = write_us / 1000;
    }

    if (fail_kind != PROSPEROMGR_HTTP_OK) {
        unlink(out_path);
        return -1;
    }

    if (progress) progress(loaded, total, progress_opaque); // always report the final state
    return 0;
}

#endif // PROSPEROMGR_PS5
