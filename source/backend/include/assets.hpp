#pragma once
// Serves the React frontend embedded as byte arrays (see tools/gen_assets.py).
// assets.cpp is generated — don't hand-edit it.

#include "http_server.hpp"

namespace prospero {

// Extension-less paths fall back to index.html for the React router.
HttpResponse ServeEmbeddedAsset(const std::string &url);

} // namespace prospero
