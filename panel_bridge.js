/* The authenticated Management Center owns this bridge. It never returns its key. */
((authStore, nameHelpers) => {
  'use strict';
  const prefix = '/v0/management/plugins/cpa-usage-ledger/';
  const allowed = new Map([['report', 'GET'], ['export.csv', 'GET'], ['key-name', 'POST']]);
  let labelSignature = null, labelSyncedAt = 0, labelPending = null, labelPreviews = {};
  async function authenticatedFetch(url, options = {}) {
    const state = authStore.getState();
    if (!state.isAuthenticated || !state.managementKey) {
      throw new Error('The Management Center session is not authenticated.');
    }
    const response = await window.fetch(url, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + state.managementKey,
        ...(options.method === 'POST' ? {'Content-Type': 'application/json'} : {})
      },
      credentials: 'omit', redirect: 'error', cache: 'no-store'
    });
    if (response.status === 401) window.dispatchEvent(new Event('unauthorized'));
    return response;
  }
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
      return authenticatedFetch(url.href, {
        method,
        body: method === 'POST' ? options.body : undefined,
        signal: options.signal
      });
    },
    async syncKeyNames() {
      if (!nameHelpers) return false;
      const apiBase = authStore.getState().apiBase;
      const labels = nameHelpers.read(apiBase);
      const signature = JSON.stringify([apiBase, labels]);
      if (signature === labelSignature && Date.now() - labelSyncedAt < 30000) return labelPreviews;
      if (labelPending) return labelPending;
      labelPending = (async () => {
        // Client keys stay in the parent page and the authenticated plugin handler.
        const source = await authenticatedFetch(new URL('/v8/management/config/access/api-keys', window.location.origin).href);
        if (!source.ok) throw new Error('Unable to read CPA key names.');
        const keys = await source.json();
        if (!Array.isArray(keys) || keys.length > 1000 || keys.some(key => typeof key !== 'string')) {
          throw new Error('Invalid CPA key list.');
        }
        if (authStore.getState().apiBase !== apiBase) throw new Error('The CPA connection changed.');
        const entries = keys.map(key => key.trim()).filter(Boolean)
          .map(key => ({key, name: labels[nameHelpers.hash(apiBase, key)] || ''}));
        const result = await authenticatedFetch(new URL(prefix + 'key-labels', window.location.origin).href, {
          method: 'POST', body: JSON.stringify(entries)
        });
        if (!result.ok) throw new Error('Unable to sync CPA key names.');
        const payload = await result.json();
        labelPreviews = payload?.key_previews && typeof payload.key_previews === 'object' && !Array.isArray(payload.key_previews)
          ? Object.freeze({...payload.key_previews}) : {};
        labelSignature = signature; labelSyncedAt = Date.now();
        return labelPreviews;
      })();
      try { return await labelPending; } finally { labelPending = null; }
    }
  });
  Object.defineProperty(window, '__CPA_USAGE_BRIDGE__', {value: bridge, configurable: true});
})(__CPA_AUTH_STORE__, __CPA_NAME_HELPERS__);
