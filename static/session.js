'use strict';
(() => {
  function parentBridge() {
    try {
      if (window.parent !== window && window.parent.location.origin === window.location.origin) {
        return window.parent.__CPA_USAGE_BRIDGE__ || null;
      }
    } catch (_) { /* A different origin never receives session access. */ }
    return null;
  }
  function context() {
    const bridge = parentBridge();
    if (bridge) return bridge.getContext();
    try {
      const root = window.parent.document.documentElement;
      return {authenticated:false, language:root.lang || 'en', theme:root.getAttribute('data-theme') || 'light'};
    } catch (_) {
      return {authenticated:false, language:'en', theme:'light'};
    }
  }
  function subscribe(listener) {
    listener(context());
    let observer;
    try {
      observer = new MutationObserver(() => listener(context()));
      observer.observe(window.parent.document.documentElement, {attributes:true, attributeFilter:['lang','data-theme']});
    } catch (_) { /* Standalone pages redirect to the Management Center. */ }
    return () => observer?.disconnect();
  }
  async function request(path, options) {
    const bridge = parentBridge();
    if (!bridge) {
      const error = new Error('Management Center session integration is not loaded.');
      error.code='SESSION_BRIDGE_MISSING';
      throw error;
    }
    return bridge.request(path, options);
  }
  async function syncKeyNames() {
    return parentBridge()?.syncKeyNames?.() ?? false;
  }
  window.CPAUsageSession = Object.freeze({context, subscribe, request, syncKeyNames});
})();
