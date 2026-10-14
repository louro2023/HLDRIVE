#pragma once
#include <stdint.h>
int kernel_dynlib_handle(int, const char *, uint32_t *);
uintptr_t kernel_dynlib_resolve(int, uint32_t, const char *);
