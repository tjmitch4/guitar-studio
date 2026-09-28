// In-memory fake of the Dropbox endpoints Guitar Studio uses. Test pages only — never loaded by the app.
// Replaces window.fetch for *.dropboxapi.com URLs; everything else goes to the real fetch.
// State can persist across reloads (persist:true) so the full app can be tested in tests/app-mock.html.
window.DropboxMock = (() => {
  const realFetch = window.fetch.bind(window);
  const PERSIST_KEY = 'gsMock.server';
  const fresh = () => ({
    files: {},            // canonical lower-case path -> {name, path_display, content(string), rev, size, client_modified, server_modified}
    folders: {},          // canonical lower-case folder path -> display path
    rev: 0, tokenN: 0,
    team: false,          // true: account is a Business team member (home_path /TJ Mitchell under root ns 100)
    homeBroken: false,    // true: lookups without the Path-Root header can't see the member folder (forces the fallback)
    offline: false, revoked: false,
    validTokens: [], refreshTokens: [],
    calls: [], nonAsciiHeaders: 0, sessions: {},
  });
  let S = fresh(), persist = false;
  let beforeUpload = null; // test hook: async (path) => {} runs before an upload is applied (simulate another device)
  const save = () => { if (persist) { try { localStorage.setItem(PERSIST_KEY, JSON.stringify(S)); } catch (e) {} } };
  const lower = (p) => String(p || '').toLowerCase();
  const json = (status, obj, headers) => new Response(obj === undefined ? 'null' : JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  const err409 = (summary) => json(409, { error_summary: summary, error: { '.tag': summary.split('/')[0] } });
  const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Map a request path + optional path-root namespace to one canonical absolute path.
  function canon(path, ns) {
    const p = String(path || '');
    if (ns) return lower(p);                                // explicit root namespace: path is absolute from the team root
    if (S.team) return lower('/TJ Mitchell' + p);           // home namespace = the member folder
    return lower(p);
  }
  function parentsOf(p) { const parts = p.split('/').filter(Boolean); const out = []; for (let i = 1; i < parts.length; i++) out.push('/' + parts.slice(0, i).join('/')); return out; }
  function addFolder(display) { const c = lower(display); S.folders[c] = display; parentsOf(c).forEach(pp => { if (!S.folders[pp]) S.folders[pp] = pp; }); }
  function putFile(canonPath, display, content, clientModified) {
    parentsOf(canonPath).forEach(pp => { if (!S.folders[pp]) S.folders[pp] = pp; });
    const rev = 'r' + (++S.rev).toString(16).padStart(9, '0');
    const size = typeof content === 'string' ? new Blob([content]).size : content.size;
    S.files[canonPath] = { name: display.split('/').pop(), path_display: display, content, rev, size, client_modified: clientModified || nowIso(), server_modified: nowIso() };
    return fileMeta(canonPath);
  }
  function fileMeta(c) { const f = S.files[c]; return { '.tag': 'file', name: f.name, path_lower: c, path_display: f.path_display, id: 'id:' + c, rev: f.rev, size: f.size, client_modified: f.client_modified, server_modified: f.server_modified }; }
  function readBody(body) {
    if (body == null) return Promise.resolve('');
    if (typeof body === 'string') return Promise.resolve(body);
    if (body instanceof Blob) return Promise.resolve(body);
    if (body instanceof URLSearchParams) return Promise.resolve(body.toString());
    return Promise.resolve(String(body));
  }
  const blobText = async (b) => (typeof b === 'string' ? b : await b.text());

  async function handle(url, init) {
    const u = new URL(url); const ep = u.pathname.replace(/^\/2\//, '');
    const h = {}; const hdr = (init && init.headers) || {};
    Object.keys(hdr).forEach(k => { h[k.toLowerCase()] = hdr[k]; });
    Object.values(h).forEach(v => { if (/[^\x00-\x7f]/.test(String(v))) S.nonAsciiHeaders++; });
    const body = await readBody(init && init.body);
    const rec = { ep, arg: h['dropbox-api-arg'] ? JSON.parse(h['dropbox-api-arg']) : null, pathRoot: h['dropbox-api-path-root'] || null, t: Date.now() };
    S.calls.push(rec);
    if (S.offline) { save(); throw new TypeError('Failed to fetch'); }

    if (u.pathname === '/oauth2/token') {
      const p = new URLSearchParams(body); rec.params = Object.fromEntries(p.entries());
      if (!p.get('client_id')) return json(400, { error: 'invalid_request', error_description: 'missing client_id' });
      if (p.get('grant_type') === 'authorization_code') {
        if (!p.get('code_verifier') || !p.get('code')) return json(400, { error: 'invalid_grant' });
        const at = 'at-' + (++S.tokenN), rt = 'rt-' + S.tokenN;
        S.validTokens.push(at); S.refreshTokens.push(rt); S.revoked = false; save();
        return json(200, { access_token: at, token_type: 'bearer', expires_in: 14400, refresh_token: rt, account_id: 'dbid:mock', uid: '1' });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (S.revoked || !S.refreshTokens.includes(p.get('refresh_token'))) return json(400, { error: 'invalid_grant', error_description: 'refresh token is invalid or revoked' });
        const at = 'at-' + (++S.tokenN); S.validTokens.push(at); save();
        return json(200, { access_token: at, token_type: 'bearer', expires_in: 14400 });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    // everything else needs a live access token
    const tok = (h['authorization'] || '').replace(/^Bearer /, '');
    if (!S.validTokens.includes(tok)) { save(); return json(401, { error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } }); }
    const ns = rec.pathRoot ? JSON.parse(rec.pathRoot).root : null;
    const rpcArg = () => { try { return JSON.parse(body || 'null'); } catch (e) { return null; } };
    let res;
    switch (ep) {
      case 'auth/token/revoke': S.validTokens = []; S.revoked = true; res = json(200, null); break;
      case 'users/get_current_account':
        res = json(200, { account_id: 'dbid:mock', name: { display_name: 'TJ' }, root_info: S.team ? { '.tag': 'team', root_namespace_id: '100', home_namespace_id: '200', home_path: '/TJ Mitchell' } : { '.tag': 'user', root_namespace_id: '200', home_namespace_id: '200' } });
        break;
      case 'files/get_metadata': {
        const a = rpcArg(); if (!ns && S.homeBroken) { res = err409('path/not_found/'); break; }
        const c = canon(a.path, ns);
        if (S.files[c]) res = json(200, fileMeta(c));
        else if (S.folders[c]) res = json(200, { '.tag': 'folder', name: c.split('/').pop(), path_lower: c, path_display: S.folders[c], id: 'id:' + c });
        else res = err409('path/not_found/');
        break;
      }
      case 'files/download': {
        const c = canon(rec.arg.path, ns); const f = S.files[c];
        if (!f) { res = err409('path/not_found/'); break; }
        res = new Response(f.content, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Result': JSON.stringify(fileMeta(c)) } });
        break;
      }
      case 'files/upload': {
        const a = rec.arg; let c = canon(a.path, ns); let display = a.path;
        if (beforeUpload) { const fn = beforeUpload; beforeUpload = null; await fn(a.path); }
        const mode = a.mode || 'add'; const cur = S.files[c];
        if (mode === 'add' || (mode['.tag'] || mode) === 'add') {
          if (cur) { if (!a.autorename) { res = err409('path/conflict/file/'); break; } let n = 1; const base = display.replace(/(\.[^.\/]+)?$/, ''), ext = (display.match(/\.[^.\/]+$/) || [''])[0]; while (S.files[canon(base + ' (' + n + ')' + ext, ns)]) n++; display = base + ' (' + n + ')' + ext; c = canon(display, ns); }
        } else if (mode['.tag'] === 'update') {
          if (!cur || cur.rev !== mode.update) { res = err409('path/conflict/file/'); break; }
        }
        const content = body instanceof Blob && /\.json$/i.test(display) ? await body.text() : body;
        res = json(200, putFile(c, S.team && !ns ? '/TJ Mitchell' + display : display, content, a.client_modified));
        break;
      }
      case 'files/upload_session/start': { const id = 'sess' + Object.keys(S.sessions).length; S.sessions[id] = { parts: [body], offset: body.size }; S.sessionBlobs = S.sessionBlobs || {}; res = json(200, { session_id: id }); break; }
      case 'files/upload_session/append_v2': {
        const cur = rec.arg.cursor; const s = S.sessions[cur.session_id];
        if (!s || s.offset !== cur.offset) { res = err409('incorrect_offset/'); break; }
        s.parts.push(body); s.offset += body.size; res = json(200, null); break;
      }
      case 'files/upload_session/finish': {
        const cur = rec.arg.cursor; const s = S.sessions[cur.session_id];
        if (!s || s.offset !== cur.offset) { res = err409('lookup_failed/incorrect_offset/'); break; }
        s.parts.push(body); const blob = new Blob(s.parts); const cm = rec.arg.commit;
        let c = canon(cm.path, ns), display = cm.path;
        if (S.files[c] && cm.autorename) { display = display.replace(/(\.[^.\/]+)$/, ' (1)$1'); c = canon(display, ns); }
        res = json(200, putFile(c, display, blob, cm.client_modified)); break;
      }
      case 'files/list_folder': {
        const a = rpcArg(); const c = canon(a.path, ns);
        if (!S.folders[c]) { res = err409('path/not_found/'); break; }
        const entries = Object.keys(S.files).filter(k => k.slice(0, k.lastIndexOf('/')) === c).map(fileMeta);
        // page it in twos so list_folder/continue gets exercised
        S.pages = { cursor: 'cur1', rest: entries.slice(2) };
        res = json(200, { entries: entries.slice(0, 2), cursor: 'cur1', has_more: entries.length > 2 }); break;
      }
      case 'files/list_folder/continue': { const rest = (S.pages && S.pages.rest) || []; S.pages = null; res = json(200, { entries: rest, cursor: 'cur2', has_more: false }); break; }
      case 'files/get_temporary_link': { const a = rpcArg(); const c = ns ? lower(a.path) : a.path; const f = S.files[c]; if (!f) { res = err409('path/not_found/'); break; } res = json(200, { metadata: fileMeta(c), link: 'https://dl.dropboxusercontent.com/mock' + encodeURI(c) }); break; }
      case 'files/delete_v2': { const a = rpcArg(); const c = ns ? lower(a.path) : a.path; if (!S.files[c]) { res = err409('path_lookup/not_found/'); break; } const m = fileMeta(c); delete S.files[c]; res = json(200, { metadata: m }); break; }
      default: res = json(400, { error_summary: 'unknown endpoint ' + ep });
    }
    save();
    return res;
  }

  function install({ persistState = false } = {}) {
    persist = persistState;
    if (persist) { try { const v = JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null'); if (v) S = Object.assign(fresh(), v); } catch (e) {} }
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (/^https:\/\/(api|content)\.dropboxapi\.com\//.test(url)) return handle(url, init);
      return realFetch(input, init);
    };
  }
  return {
    install,
    reset: () => { S = fresh(); beforeUpload = null; save(); },
    state: () => S,
    set: (patch) => { Object.assign(S, patch); save(); },
    beforeUpload: (fn) => { beforeUpload = fn; },
    expireTokens: () => { S.validTokens = []; save(); },
    addFolder: (p) => { addFolder(p); save(); },
    // Write/read a file as "another device" would (display path, as seen from the account root)
    put: (path, content) => { const m = putFile(lower(path), path, content); save(); return m; },
    get: (path) => { const f = S.files[lower(path)]; return f ? f.content : null; },
    getJSON: async (path) => { const f = S.files[lower(path)]; return f ? JSON.parse(await blobText(f.content)) : null; },
    calls: (ep) => S.calls.filter(c => !ep || c.ep === ep),
    clearCalls: () => { S.calls = []; save(); },
  };
})();
