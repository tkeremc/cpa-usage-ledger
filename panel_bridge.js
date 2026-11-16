/* The authenticated Management Center owns this bridge. It never returns its key. */
((authStore) => {
  'use strict';
  const prefix = '/v0/management/plugins/cpa-usage-ledger/';
  const allowed = new Map([['report', 'GET'], ['export.csv', 'GET'], ['key-name', 'POST']]);
  const bridge = Object.freeze({
    getContext() {
      const state = authStore.getState();
      return {
        authenticated: Boolean(state.isAuthenticated && state.managementKey),
        language: document.documentElement.lang || 'en',
        theme: document.documentElement.getAttribute('data-theme') || 'light'
      };
    },
    async request(path, options = {}) {
      const url = new URL(path, window.location.origin);
      const method = String(options.method || 'GET').toUpperCase();
      const endpoint = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
      if (url.origin !== window.location.origin || url.username || url.password ||
          !allowed.has(endpoint) || allowed.get(endpoint) !== method) {
        throw new Error('This bridge only serves the usage plugin.');
      }
      if (method === 'POST' && (typeof options.body !== 'string' || options.body.length > 4096)) {
        throw new Error('Invalid usage request.');
      }
      const state = authStore.getState();
      if (!state.isAuthenticated || !state.managementKey) {
        throw new Error('The Management Center session is not authenticated.');
      }
      const response = await window.fetch(url.href, {
        method,
        headers: {
          Authorization: 'Bearer ' + state.managementKey,
          ...(method === 'POST' ? {'Content-Type': 'application/json'} : {})
        },
        body: method === 'POST' ? options.body : undefined,
        signal: options.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store'
      });
      if (response.status === 401) window.dispatchEvent(new Event('unauthorized'));
      return response;
    }
  });
  Object.defineProperty(window, '__CPA_USAGE_BRIDGE__', {value: bridge, configurable: true});
})(__CPA_AUTH_STORE__);
