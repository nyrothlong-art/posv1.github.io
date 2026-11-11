/* ===========================================================
   api.js — ភ្ជាប់ Frontend ទៅ Backend (Server)
   - Login តាម Server (JWT) ជំនួសការផ្ទៀងផ្ទាត់ក្នុង Browser
   - Sync ទិន្នន័យ (ទំនិញ, វិក្កយបត្រ, ចំណាយ, លុយអាប់) ទៅ Server
   - ដំណើរការ Offline: កែក្នុង Browser សិន រួច Sync ពេលមានអ៊ីនធឺណិត
   - Telegram + Gmail ផ្ញើពី Server (Token មិននៅក្នុង Browser)
   ទុក POS_API_URL ទទេក្នុង config.js => ប្រើជា Local ម្នាក់ឯងដូចដើម
   =========================================================== */
(function () {
  'use strict';
  var TOKEN_KEY = 'ptm_token', SNAP_KEY = 'ptm_snap', NQ_KEY = 'ptm_notify_q', URL_KEY = 'ptm_api_url';
  var cleanUrl = function (u) { return /^https?:\/\/[^\s]+$/i.test(u || '') ? u.replace(/\/+$/, '') : ''; };

  // ---- រកអាសយដ្ឋាន Server: 1) ?api=... ក្នុង Link  2) ដែលបានរក្សាទុក  3) config.js ----
  (function () {
    var qs = new URLSearchParams(location.search), q = cleanUrl(qs.get('api'));
    if (qs.has('api')) {
      if (q && q !== localStorage.getItem(URL_KEY)) {            // Server ថ្មី => Login ឡើងវិញ
        localStorage.setItem(URL_KEY, q);
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('ptm_app_session'); localStorage.removeItem(SNAP_KEY);
        window.__ptmReloadSession = true;
      }
      qs.delete('api');
      try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch (e) {}
    }
  })();
  var API = cleanUrl(localStorage.getItem(URL_KEY)) || cleanUrl(window.POS_API_URL);

  // ---- ប្រអប់ Server នៅលើទំព័រ Login ----
  function mountServerBox() {
    var pw = document.getElementById('login-password'); if (!pw) return;
    var form = pw.closest('form'); if (!form || document.getElementById('server-box')) return;
    var box = document.createElement('div');
    box.id = 'server-box';
    box.className = 'mt-4 text-xs text-slate-500 dark:text-slate-400';
    box.innerHTML =
      '<div class="flex items-center justify-between gap-2">' +
        '<span id="server-status">⚪ មិនទាន់កំណត់ Server</span>' +
        '<button type="button" id="server-toggle" class="underline font-bold">⚙ Server</button>' +
      '</div>' +
      '<div id="server-edit" class="hidden mt-2 flex gap-2">' +
        '<input id="server-url" type="url" placeholder="https://your-server.onrender.com" class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs">' +
        '<button type="button" id="server-save" class="px-3 py-2 rounded-xl bg-amber-500 text-white font-bold">រក្សាទុក</button>' +
      '</div>';
    form.parentNode.insertBefore(box, form.nextSibling);
    var inp = document.getElementById('server-url'); inp.value = API || '';
    document.getElementById('server-toggle').onclick = function () { document.getElementById('server-edit').classList.toggle('hidden'); };
    document.getElementById('server-save').onclick = function () {
      var u = cleanUrl(inp.value.trim());
      if (!u) { alert('សូមបញ្ចូល URL ឱ្យត្រឹមត្រូវ (ចាប់ផ្តើមដោយ https://)'); return; }
      localStorage.setItem(URL_KEY, u);
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('ptm_app_session'); localStorage.removeItem(SNAP_KEY);
      location.reload();
    };
    var st = document.getElementById('server-status');
    if (!API) return;
    st.textContent = '🟡 កំពុងភ្ជាប់ ' + API.replace(/^https?:\/\//, '') + ' ...';
    var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, 15000);
    fetch(API + '/api/health', { signal: ctl.signal }).then(function (r) {
      clearTimeout(tm);
      st.textContent = r.ok ? '🟢 ភ្ជាប់ Server រួចរាល់ (' + API.replace(/^https?:\/\//, '') + ')' : '🔴 Server ឆ្លើយតបមិនត្រឹមត្រូវ';
    }).catch(function () { st.textContent = '🔴 មិនអាចភ្ជាប់ Server បាន (ពិនិត្យអ៊ីនធឺណិត ឬ URL)'; });
  }
  document.addEventListener('DOMContentLoaded', mountServerBox);

  if (!API) return;

  var COLS = { products: KEY_PRODUCTS, invoices: KEY_INVOICES, expenses: KEY_EXPENSES, changeLogs: KEY_CHANGE_LOGS };
  var KEY2COL = {}; Object.keys(COLS).forEach(function (c) { KEY2COL[COLS[c]] = c; });

  var _fetch = window.fetch.bind(window);
  var _set = Storage.prototype.setItem;
  var _remove = Storage.prototype.removeItem;
  var rawSet = function (k, v) { _set.call(localStorage, k, v); };

  var $ = function (id) { return document.getElementById(id); };
  var notify = function (msg, type) { try { showNotification(msg, 'top', type || 'info', true); } catch (e) {} };
  var token = function () { return localStorage.getItem(TOKEN_KEY); };

  // ---------- helpers ----------
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h + ':' + s.length; }
  function getSnap() { try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || {}; } catch (e) { return {}; } }
  function saveSnap(s) { rawSet(SNAP_KEY, JSON.stringify(s)); }
  function readCol(col) { try { return JSON.parse(localStorage.getItem(COLS[col]) || '[]') || []; } catch (e) { return []; } }
  function mapOf(items) { var m = {}; items.forEach(function (x) { if (x && x.id != null) m[x.id] = hash(JSON.stringify(x)); }); return m; }
  function setGlobal(col, items) {
    if (col === 'products') products = items;
    else if (col === 'invoices') invoices = items;
    else if (col === 'expenses') expenses = items;
    else changeFundLogs = items;
  }
  function setNet(online) {
    var el = $('network-status-text');
    if (el) el.innerText = online ? 'Server Online' : 'Offline (រក្សាទុកក្នុងម៉ាស៊ីន)';
  }

  function forceLogout() {
    _remove.call(localStorage, TOKEN_KEY);
    _remove.call(localStorage, KEY_SESSION);
    location.reload();
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    var r;
    try {
      r = await _fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (e) { e.network = true; setNet(false); throw e; }
    setNet(true);
    if (r.status === 401 && path !== '/api/auth/login') { forceLogout(); throw new Error('Session expired'); }
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((j && j.error) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return j;
  }

  // ---------- push (local -> server) ----------
  function diff(col) {
    var base = getSnap()[col]; if (!base) return null;
    var cur = readCol(col), curMap = mapOf(cur), upsert = [], remove = [];
    cur.forEach(function (x) { if (x && x.id != null && base[x.id] !== curMap[x.id]) upsert.push(x); });
    Object.keys(base).forEach(function (id) { if (!(id in curMap)) remove.push(id); });
    return { upsert: upsert, remove: remove, curMap: curMap };
  }
  function hasPending(col) { var d = diff(col); return !!(d && (d.upsert.length || d.remove.length)); }

  var chain = Promise.resolve();
  function pushCol(col) {
    chain = chain.then(async function () {
      if (!token()) return;
      var d = diff(col);
      if (!d || (!d.upsert.length && !d.remove.length)) return;
      try {
        await api('/api/data/' + col, { method: 'PUT', body: { upsert: d.upsert, remove: d.remove } });
        var s = getSnap(); s[col] = d.curMap; saveSnap(s);
      } catch (e) {
        if (e.network) return;                         // Offline: Sync ពេលក្រោយ
        if (e.status === 403 || e.status === 400) {    // Server បដិសេធ => យកទិន្នន័យ Server មកវិញ
          notify(e.message, 'error');
          var s2 = getSnap(); s2[col] = mapOf(readCol(col)); saveSnap(s2);
          await pull(true).catch(function () {});
        }
      }
    });
    return chain;
  }
  async function flushAll() { for (var c in COLS) await pushCol(c); }

  var timers = {};
  function schedulePush(col) { clearTimeout(timers[col]); timers[col] = setTimeout(function () { pushCol(col); }, 600); }

  // hook: រាល់ពេល App រក្សាទុកក្នុង localStorage
  Storage.prototype.setItem = function (k, v) {
    _set.apply(this, arguments);
    if (this === localStorage && KEY2COL[k]) schedulePush(KEY2COL[k]);
  };
  Storage.prototype.removeItem = function (k) {
    _remove.apply(this, arguments);
    if (this === localStorage && k === KEY_SESSION) _remove.call(localStorage, TOKEN_KEY);
  };

  // ---------- pull (server -> local) ----------
  function renderAll() {
    ['renderPosCategoryChips', 'renderPosProducts', 'renderStockTable', 'renderInvoiceList', 'renderChangeFundTable',
     'renderExpenseTable', 'renderAdminDashboard', 'initBarcodeProductSelect'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) { console.warn(fn, e); }
    });
    try { lucide.createIcons(); } catch (e) {}
  }

  async function pull(force) {
    var d = await api('/api/data');
    var snap = getSnap(), changed = false, needPush = [];
    Object.keys(COLS).forEach(function (col) {
      var srv = d[col];
      if (!srv.init) {                                   // Server ទទេ => ផ្ញើទិន្នន័យក្នុងម៉ាស៊ីនឡើងទៅ
        if (!snap[col]) { snap[col] = {}; needPush.push(col); }
        return;
      }
      if (!force && snap[col] && hasPending(col)) return; // មានការកែ Offline មិនទាន់ Sync
      var next = JSON.stringify(srv.items);
      if (next !== JSON.stringify(readCol(col))) { rawSet(COLS[col], next); setGlobal(col, srv.items); changed = true; }
      snap[col] = mapOf(srv.items);
    });
    saveSnap(snap);
    if (changed) renderAll();
    for (var i = 0; i < needPush.length; i++) await pushCol(needPush[i]);
  }

  async function loadStaff() {
    if (!currentSession || currentSession.role !== 'ADMIN') return;
    var list = await api('/api/staff');
    staffList = list.map(function (s) { return { user: s.user, role: s.role, pass: '' }; });
    rawSet(KEY_STAFF, JSON.stringify(staffList));
    try { renderStaffTable(); } catch (e) {}
  }

  async function loadConfig() {
    var c = await api('/api/config');
    if (c.shopName) config.shopName = c.shopName;
    if (c.exchangeRate) config.exchangeRate = c.exchangeRate;
    if (typeof c.customLogo === 'string') config.customLogo = c.customLogo;
    var on = !!(c.telegram || c.email);
    config.tgToken = on ? 'server' : '';      // ដើម្បីឲ្យកូដដើមដឹងថា Notification បានកំណត់
    config.tgChatId = on ? 'server' : '';
    config.web3Key = '';
    rawSet(KEY_CONFIG, JSON.stringify(config));
    try { refreshAllBrandElements(); renderLiveBarcodePreview(); } catch (e) {}
    var t = $('cfg-tg-token'), ch = $('cfg-tg-chatid');
    if (t) t.placeholder = c.telegram ? '(បានរក្សាទុកក្នុង Server — វាយថ្មីដើម្បីប្តូរ)' : 'Bot Token';
    if (ch) ch.placeholder = c.telegram ? '(បានរក្សាទុកក្នុង Server)' : 'Chat ID';
  }

  async function bootstrap() {
    try {
      await flushAll();
      await loadConfig();
      await pull(false);
      await loadStaff();
      flushNotifyQueue();
    } catch (e) { if (!e.network) console.warn('bootstrap', e); }
  }

  // ---------- login / logout ----------
  window.handleLoginSubmit = async function (e) {
    e.preventDefault();
    var u = $('login-username').value.trim(), p = $('login-password').value;
    try {
      var j = await api('/api/auth/login', { method: 'POST', body: { user: u, pass: p } });
      rawSet(TOKEN_KEY, j.token);
      dismissLoginCardToast();
      currentSession = { user: j.user, role: j.role };
      rawSet(KEY_SESSION, JSON.stringify(currentSession));
      checkAuthSession();
      notify('ចូលប្រើប្រាស់ប្រព័ន្ធជោគជ័យ!', 'success');
      bootstrap();
    } catch (err) {
      showLoginCardToast(err.network ? 'មិនអាចភ្ជាប់ទៅ Server បានទេ — ត្រូវមានអ៊ីនធឺណិតសម្រាប់ Login លើកដំបូង' : err.message, 'error');
    }
  };

  // ---------- staff (Server) ----------
  window.handleStaffSubmit = async function (e) {
    e.preventDefault();
    try {
      await api('/api/staff', { method: 'POST', body: { user: $('staff-username').value.trim(), pass: $('staff-password').value, role: $('staff-role').value } });
      closeStaffModal();
      await loadStaff();
      notify('បានបន្ថែមគណនីបុគ្គលិកជោគជ័យ!', 'success');
    } catch (err) { notify(err.network ? 'ត្រូវមានអ៊ីនធឺណិតដើម្បីបន្ថែមបុគ្គលិក' : err.message, 'error'); }
  };
  window.confirmDeleteStaffAction = async function () {
    var user = $('delete-target-staff-user').value;
    closeDeleteStaffModal();
    try {
      await api('/api/staff/' + encodeURIComponent(user), { method: 'DELETE' });
      await loadStaff();
      notify('បានលុបគណនី ' + user + ' ជោគជ័យ!', 'info');
    } catch (err) { notify(err.network ? 'ត្រូវមានអ៊ីនធឺណិតដើម្បីលុបបុគ្គលិក' : err.message, 'error'); }
  };
  window.handleAdminPasswordChange = async function () {
    var np = $('admin-new-pass').value.trim();
    if (!np) { notify('សូមបញ្ចូលលេខសម្ងាត់ថ្មី!', 'error'); return; }
    try {
      await api('/api/staff/' + encodeURIComponent(currentSession.user) + '/password', { method: 'PUT', body: { pass: np } });
      $('admin-new-pass').value = '';
      notify('បានផ្លាស់ប្តូរលេខសម្ងាត់ជោគជ័យ!', 'success');
    } catch (err) { notify(err.message, 'error'); }
  };

  // ---------- settings ----------
  var _saveSettings = window.saveSystemSettings;
  window.saveSystemSettings = async function () {
    if (!currentSession || currentSession.role !== 'ADMIN') return _saveSettings();
    var tg = $('cfg-tg-token').value.trim(), chat = $('cfg-tg-chatid').value.trim();
    _saveSettings();                                   // រក្សាទុក Local + បង្ហាញ Notification
    var body = { shopName: config.shopName, exchangeRate: config.exchangeRate, customLogo: config.customLogo || '' };
    if (tg) body.tgToken = tg;
    if (chat) body.tgChatId = chat;
    try {
      await api('/api/config', { method: 'PUT', body: body });
      if ($('cfg-tg-token')) $('cfg-tg-token').value = '';
      await loadConfig();
    } catch (err) { notify(err.network ? 'ត្រូវមានអ៊ីនធឺណិតដើម្បីរក្សាទុកការកំណត់ទៅ Server' : err.message, 'error'); }
  };

  // ---------- notifications: ប្តូរ Telegram ផ្ទាល់ => ឆ្លងកាត់ Server (Telegram + Gmail) ----------
  function getQ() { try { return JSON.parse(localStorage.getItem(NQ_KEY)) || []; } catch (e) { return []; } }
  async function sendNotify(text) {
    try { await api('/api/notify', { method: 'POST', body: { text: text } }); }
    catch (e) {
      if (e.network) { var q = getQ(); q.push(text); rawSet(NQ_KEY, JSON.stringify(q.slice(-50))); }
    }
  }
  async function flushNotifyQueue() {
    var q = getQ(); if (!q.length || !token()) return;
    rawSet(NQ_KEY, '[]');
    for (var i = 0; i < q.length; i++) await sendNotify(q[i]);
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/^https:\/\/api\.telegram\.org\/bot[^/]*\/sendMessage/.test(url)) {
      var text = ''; try { text = JSON.parse(init.body).text; } catch (e) {}
      return sendNotify(text).then(function () { return new Response('{"ok":true}', { status: 200 }); });
    }
    return _fetch(input, init);
  };

  // ---------- startup ----------
  // លុបលេខសម្ងាត់ Plain-text ចាស់ៗចេញពី Browser
  staffList = [{ user: 'Admin', pass: '', role: 'ADMIN' }];
  _remove.call(localStorage, KEY_STAFF);
  config.web3Key = ''; config.bakongToken = '';
  // ទំនិញលំនាំដើមនៅតែក្នុង Memory រហូតដល់មានការកែ => រក្សាទុកក្នុង localStorage ដើម្បី Sync ទៅ Server បាន
  [['products', products], ['invoices', invoices], ['expenses', expenses], ['changeLogs', changeFundLogs]].forEach(function (p) {
    if (localStorage.getItem(COLS[p[0]]) === null) rawSet(COLS[p[0]], JSON.stringify(p[1]));
  });

  if (currentSession && !token()) {          // Session ចាស់ពីកំណែមុន => ត្រូវ Login តាម Server
    currentSession = null;
    _remove.call(localStorage, KEY_SESSION);
  }

  window.addEventListener('online', function () { setNet(true); flushNotifyQueue(); flushAll().then(function () { return pull(false); }).catch(function () {}); });
  window.addEventListener('offline', function () { setNet(false); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token()) flushAll().then(function () { return pull(false); }).catch(function () {}); });
  setInterval(function () {
    if (navigator.onLine && token() && !document.hidden) flushAll().then(function () { return pull(false); }).catch(function () {});
  }, 20000);

  // ---- Link ចែករំលែកសម្រាប់បុគ្គលិក (Admin ក្នុង Settings) ----
  function mountShareCard() {
    var pane = $('tab-settings'); if (!pane || $('share-card')) return;
    var link = location.origin + location.pathname + '?api=' + encodeURIComponent(API);
    var c = document.createElement('div');
    c.id = 'share-card';
    c.className = 'mt-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800';
    c.innerHTML =
      '<h4 class="font-bold text-sm mb-1">🔗 Link សម្រាប់បុគ្គលិក</h4>' +
      '<p class="text-xs text-slate-500 mb-2">ផ្ញើ Link នេះទៅបុគ្គលិក។ បើកភ្លាមត្រូវភ្ជាប់ Server ដោយស្វ័យប្រវត្តិ ហើយទិន្នន័យទាំងអស់ចូល Server ។ (Link មិនមានលេខសម្ងាត់ទេ បុគ្គលិកនៅតែត្រូវ Login។)</p>' +
      '<div class="flex gap-2"><input id="share-link" readonly class="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-xs">' +
      '<button type="button" id="share-copy" class="px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold">ចម្លង</button></div>';
    pane.appendChild(c);
    $('share-link').value = link;
    $('share-copy').onclick = function () {
      var el = $('share-link'); el.select();
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).catch(function () { document.execCommand('copy'); });
      notify('បានចម្លង Link!', 'success');
    };
  }

  document.addEventListener('DOMContentLoaded', function () { mountShareCard(); if (token() && currentSession) bootstrap(); });
})();
