#define _GNU_SOURCE
#include <Python.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef PLUGIN_SOURCE_DIR
#error PLUGIN_SOURCE_DIR is required
#endif
#ifndef PLUGIN_PYTHON_LIBRARY
#error PLUGIN_PYTHON_LIBRARY is required
#endif

typedef struct { void *ptr; size_t len; } cliproxy_buffer;
typedef int (*host_call_fn)(void *, const char *, const uint8_t *, size_t, cliproxy_buffer *);
typedef void (*free_fn)(void *, size_t);
typedef struct { uint32_t abi_version; void *host_ctx; host_call_fn call; free_fn free_buffer; } cliproxy_host_api;
typedef int (*plugin_call_fn)(char *, uint8_t *, size_t, cliproxy_buffer *);
typedef struct { uint32_t abi_version; plugin_call_fn call; free_fn free_buffer; void (*shutdown)(void); } cliproxy_plugin_api;

static pthread_mutex_t init_lock = PTHREAD_MUTEX_INITIALIZER;
static PyObject *handler = NULL;

static int initialize_python(void) {
    pthread_mutex_lock(&init_lock);
    if (handler) { pthread_mutex_unlock(&init_lock); return 0; }
    /* Make CPython symbols visible to its standard-library extension modules. */
    if (!dlopen(PLUGIN_PYTHON_LIBRARY, RTLD_NOW | RTLD_GLOBAL)) {
        pthread_mutex_unlock(&init_lock); return 1;
    }
    int created = !Py_IsInitialized();
    if (created) Py_InitializeEx(0); /* Do not install process-wide signal handlers. */
    PyGILState_STATE gil = PyGILState_Ensure();
    PyObject *path = PySys_GetObject("path");
    PyObject *directory = PyUnicode_FromString(PLUGIN_SOURCE_DIR);
    PyObject *module = NULL;
    if (path && directory && PyList_Insert(path, 0, directory) == 0)
        module = PyImport_ImportModule("cpa_usage_ledger.plugin");
    Py_XDECREF(directory);
    if (module) handler = PyObject_GetAttrString(module, "handle");
    Py_XDECREF(module);
    int failed = !handler || !PyCallable_Check(handler);
    if (failed) { Py_XDECREF(handler); handler = NULL; PyErr_Clear(); }
    PyGILState_Release(gil);
    if (created) PyEval_SaveThread();
    pthread_mutex_unlock(&init_lock);
    return failed;
}

static int failure(cliproxy_buffer *response) {
    const char *error = "{\"ok\":false,\"error\":{\"code\":\"plugin_error\",\"message\":\"Usage plugin failed; credentials were not logged.\"}}";
    if (response) { response->len = strlen(error); response->ptr = malloc(response->len); if (response->ptr) memcpy(response->ptr, error, response->len); else response->len = 0; }
    return 1;
}

static int plugin_call(char *method, uint8_t *request, size_t length, cliproxy_buffer *response) {
    if (!response) return 1;
    response->ptr = NULL; response->len = 0;
    if (!method || (length && !request) || length > 16 * 1024 * 1024 || initialize_python()) return failure(response);
    PyGILState_STATE gil = PyGILState_Ensure();
    PyObject *name = PyUnicode_FromString(method);
    PyObject *raw = PyBytes_FromStringAndSize((const char *)request, (Py_ssize_t)length);
    PyObject *result = (name && raw) ? PyObject_CallFunctionObjArgs(handler, name, raw, NULL) : NULL;
    Py_XDECREF(name); Py_XDECREF(raw);
    char *data = NULL; Py_ssize_t size = 0;
    int failed = !result || PyBytes_AsStringAndSize(result, &data, &size) != 0;
    if (!failed) {
        response->ptr = malloc((size_t)size);
        if (!response->ptr) failed = 1;
        else { memcpy(response->ptr, data, (size_t)size); response->len = (size_t)size; }
    }
    Py_XDECREF(result);
    if (failed) PyErr_Clear(); /* Never dump request or credential values into logs. */
    PyGILState_Release(gil);
    return failed ? failure(response) : 0;
}

static void plugin_free(void *ptr, size_t length) { (void)length; free(ptr); }
static void plugin_shutdown(void) { /* The interpreter belongs to the host process; never finalize it here. */ }

__attribute__((visibility("default")))
int cliproxy_plugin_init(const cliproxy_host_api *host, cliproxy_plugin_api *plugin) {
    if (!host || host->abi_version != 1 || !plugin || initialize_python()) return 1;
    plugin->abi_version = 1;
    plugin->call = plugin_call;
    plugin->free_buffer = plugin_free;
    plugin->shutdown = plugin_shutdown;
    return 0;
}
