// @flow

// OhStem Game Studio must not contact GDevelop's own services (accounts, store,
// recommendations, AI settings, analytics). Their CORS policy already rejects this
// origin, so nothing works anyway, but the requests still leave the learner's
// browser. This guard refuses them before they are sent; callers see the same
// network error they get today from CORS.

const blockedHostPatterns = [
  /^api(-dev)?\.gdevelop\.io$/,
  /^public-resources\.gdevelop\.io$/,
  /^(api|analytics)\.gdevelop-app\.com$/,
];

export const isBlockedUpstreamUrl = (url: mixed, base?: string): boolean => {
  if (typeof url !== 'string' && !(url instanceof URL)) return false;
  try {
    const hostname = new URL(String(url), base).hostname;
    return blockedHostPatterns.some(pattern => pattern.test(hostname));
  } catch (error) {
    return false;
  }
};

const blockedError = (url: string) =>
  new TypeError(`OhStem: blocked request to GDevelop services (${url})`);

export const installOhStemNetworkGuard = (win: any): void => {
  if (!win || win.__ohstemNetworkGuard) return;
  win.__ohstemNetworkGuard = true;
  const base = win.location && win.location.href;

  if (typeof win.fetch === 'function') {
    const originalFetch = win.fetch.bind(win);
    win.fetch = (input: any, init?: any) => {
      const url = input && typeof input === 'object' && 'url' in input ? input.url : input;
      if (isBlockedUpstreamUrl(url, base))
        return Promise.reject(blockedError(String(url)));
      return originalFetch(input, init);
    };
  }

  const XHR = win.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    XHR.prototype.open = function(this: any, method: string, url: any, ...rest: Array<any>) {
      this.__ohstemBlockedUrl = isBlockedUpstreamUrl(url, base) ? String(url) : null;
      return originalOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function(this: any, ...args: Array<any>) {
      if (!this.__ohstemBlockedUrl) return originalSend.apply(this, args);
      // Fail like a network/CORS error, without sending anything.
      setTimeout(() => {
        if (typeof this.onerror === 'function') this.onerror(blockedError(this.__ohstemBlockedUrl));
        if (typeof this.onloadend === 'function') this.onloadend();
      }, 0);
    };
  }

  if (win.navigator && typeof win.navigator.sendBeacon === 'function') {
    const originalBeacon = win.navigator.sendBeacon.bind(win.navigator);
    win.navigator.sendBeacon = (url: any, data?: any) =>
      isBlockedUpstreamUrl(url, base) ? false : originalBeacon(url, data);
  }
};
