// HTTP client for the Mini App API. Every request carries Telegram's signed initData; the server checks it.
// The browser demo provides an object with the same methods that runs in the page instead (demo/api.js).
export function httpApi(initData) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { Authorization: `tma ${initData}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? 'generic'), { code: data.error ?? 'generic' });
    return data;
  }
  const id = (n) => Number(n);
  return {
    me: () => call('GET', '/api/me'),
    setLang: (lang) => call('POST', '/api/lang', { lang }),
    setPhone: (phone) => call('POST', '/api/phone', { phone }),
    search: (filter) => call('POST', '/api/search', { filter }),
    listing: (lid) => call('GET', `/api/listings/${id(lid)}`),
    report: (lid, reason) => call('POST', `/api/listings/${id(lid)}/report`, { reason }),
    requestViewing: (slot) => call('POST', '/api/viewings', { slot }),
    viewings: () => call('GET', '/api/viewings'),
    cancelViewing: (vid) => call('POST', `/api/viewings/${id(vid)}/cancel`),
    decide: (vid, accept) => call('POST', `/api/viewings/${id(vid)}/decide`, { accept }),
    subs: () => call('GET', '/api/subs'),
    addSub: (filter) => call('POST', '/api/subs', { filter }),
    delSub: (sid) => call('DELETE', `/api/subs/${id(sid)}`),
    landlord: () => call('GET', '/api/landlord'),
    preview: (draft) => call('POST', '/api/landlord/preview', { draft }),
    createListing: (listing) => call('POST', '/api/landlord/listings', { listing }),
    updateListing: (lid, changes) => call('POST', `/api/landlord/listings/${id(lid)}`, { changes }),
    setStatus: (lid, action) => call('POST', `/api/landlord/listings/${id(lid)}/status`, { action }),
    addSlot: (lid, startAt) => call('POST', `/api/landlord/listings/${id(lid)}/slots`, { start_at: startAt }),
    removeSlot: (lid, sid) => call('DELETE', `/api/landlord/listings/${id(lid)}/slots/${id(sid)}`),
  };
}
