/* PixelVault admin panel — vanilla JS, no build step */
(() => {
  'use strict';

  // ── Utils ────────────────────────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const nf = new Intl.NumberFormat();
  const num = (n) => nf.format(n ?? 0);
  const fmtKB = (kb) => {
    kb = Number(kb) || 0;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(kb < 10240 ? 2 : 1)} MB`;
    return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  };
  const fmtMB = (mb) => fmtKB((Number(mb) || 0) * 1024);
  const shortId = (id) => (id ? `${id.slice(0, 8)}…` : '');
  const fullDate = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const ago = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
    for (const [u, sec] of units) if (s >= sec) return `${Math.floor(s / sec)}${u} ago`;
    return 'just now';
  };
  const imgUrl = (id, variant = 'thumb') => `/image?image_id=${encodeURIComponent(id)}&variant=${variant}`;
  const savedPct = (orig, kb) => (orig ? Math.max(0, Math.round(100 * (1 - kb / orig))) : 0);

  const ICON = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    system: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    saved: '<path d="M20 6 9 17l-5-5"/>',
  };
  const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;

  function toast(msg, err = false) {
    const t = document.createElement('div');
    t.className = `toast${err ? ' err' : ''}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), err ? 5000 : 2200);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) { toast('Copy failed', true); }
  }

  // ── API ──────────────────────────────────────────────────────────────────
  class AuthError extends Error {}

  async function api(path, { method = 'GET', json, body } = {}) {
    const headers = { 'X-PixelVault': '1' };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    if (res.status === 401 && !path.startsWith('/admin/auth/')) { showLogin(); throw new AuthError('Signed out'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const d = data && data.detail;
      throw new Error(typeof d === 'string' ? d : (Array.isArray(d) ? d.map((x) => x.msg).join(', ') : res.statusText));
    }
    return data;
  }

  const fail = (e) => { if (!(e instanceof AuthError)) toast(e.message || 'Something went wrong', true); };

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    me: null,
    config: null,
    system: null,
    images: { q: '', user_id: '', sort: 'newest', page: 1, per_page: 24, view: store.get('pv-view', 'grid'), selected: new Set(), items: [], total: 0 },
    uploads: [],
  };

  const ROUTES = {
    overview: { title: 'Overview', icon: 'overview', render: renderOverview },
    images: { title: 'Images', icon: 'images', render: renderImages },
    upload: { title: 'Upload', icon: 'upload', render: renderUpload },
    lookup: { title: 'Metadata Lookup', icon: 'search', render: renderLookup },
    system: { title: 'System', icon: 'system', render: renderSystem },
  };

  // ── Auth ─────────────────────────────────────────────────────────────────
  function showLogin(message) {
    state.me = null;
    $('#boot').hidden = true;
    $('#shell').hidden = true;
    $('#login').hidden = false;
    closeOverlay();
    const errBox = $('#login-error');
    if (message) { errBox.className = 'alert'; errBox.textContent = message; errBox.hidden = false; }
    initGoogle();
  }

  let googleReady = false;
  async function initGoogle() {
    if (!state.config) {
      try { state.config = await api('/admin/auth/config'); } catch (e) { state.config = { configured: false }; }
    }
    const errBox = $('#login-error');
    if (!state.config.configured) {
      errBox.className = 'alert info';
      errBox.innerHTML = 'Google sign-in isn\'t configured. Set <code>GOOGLE_CLIENT_ID</code> and <code>ADMIN_ALLOWED_EMAILS</code> in <code>.env</code> and restart the server.';
      errBox.hidden = false;
      return;
    }
    // wait for the GIS script
    for (let i = 0; i < 100 && !(window.google && google.accounts && google.accounts.id); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!(window.google && google.accounts && google.accounts.id)) {
      errBox.className = 'alert';
      errBox.textContent = 'Couldn\'t load Google sign-in. Check your connection or ad blocker and reload.';
      errBox.hidden = false;
      return;
    }
    if (!googleReady) {
      google.accounts.id.initialize({
        client_id: state.config.client_id,
        callback: onGoogleCredential,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleReady = true;
    }
    $('#gbtn').innerHTML = '';
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 });
  }

  async function onGoogleCredential(resp) {
    const errBox = $('#login-error');
    errBox.hidden = true;
    try {
      const r = await api('/admin/auth/google', { method: 'POST', json: { credential: resp.credential } });
      state.me = r.user;
      startApp();
    } catch (e) {
      errBox.className = 'alert';
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  }

  async function logout() {
    try { await api('/admin/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    try { window.google && google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    showLogin();
  }

  // ── Shell ────────────────────────────────────────────────────────────────
  function buildShell() {
    $('#nav').innerHTML = Object.entries(ROUTES)
      .map(([k, r]) => `<a href="#/${k}" data-route="${k}">${icon(r.icon)}<span>${r.title}</span></a>`)
      .join('');
    $('#menu-btn').innerHTML = icon('menu');
    $('#topsearch-icon').outerHTML = icon('search');
    updateThemeIcon();
    $('#menu-btn').onclick = () => $('#shell').classList.toggle('nav-open');
    $('#nav').onclick = () => $('#shell').classList.remove('nav-open');
    $('#logout-btn').onclick = logout;
    $('#theme-btn').onclick = toggleTheme;
    $('#topsearch').onsubmit = (e) => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      Object.assign(state.images, { q, user_id: '', page: 1 });
      e.target.q.value = '';
      if (location.hash.startsWith('#/images')) renderRoute(); else location.hash = '#/images';
    };
  }

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function updateThemeIcon() { $('#theme-btn').innerHTML = icon(isDark() ? 'sun' : 'moon'); }
  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('pv-theme', next);
    updateThemeIcon();
  }

  let shellBuilt = false;
  async function startApp() {
    $('#boot').hidden = true;
    $('#login').hidden = true;
    $('#shell').hidden = false;
    if (!shellBuilt) { buildShell(); shellBuilt = true; }
    const me = state.me;
    $('#user-email').textContent = me.email;
    $('#avatar').innerHTML = me.picture
      ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">`
      : esc((me.name || me.email)[0].toUpperCase());
    $('#avatar').title = me.email;
    try {
      state.system = await api('/admin/api/system');
      $('#version').textContent = state.system.version;
      $('#status-dot').classList.remove('bad');
      $('#status-text').textContent = 'Online';
    } catch (e) {
      $('#status-dot').classList.add('bad');
      $('#status-text').textContent = 'Error';
    }
    if (!location.hash) location.hash = '#/overview';
    renderRoute();
  }

  function currentRoute() {
    const key = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'overview';
    return ROUTES[key] ? key : 'overview';
  }

  function renderRoute() {
    if (!state.me) return;
    const key = currentRoute();
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    $('#page-title').textContent = ROUTES[key].title;
    document.title = `${ROUTES[key].title} · PixelVault Admin`;
    closeOverlay();
    // fresh container per render so event listeners never stack up
    const page = document.createElement('div');
    $('#view').replaceChildren(page);
    ROUTES[key].render(page);
  }
  window.addEventListener('hashchange', renderRoute);

  // ── Overlay: drawer + confirm modal ──────────────────────────────────────
  function closeOverlay() { $('#overlay').innerHTML = ''; document.removeEventListener('keydown', escClose); }
  function escClose(e) {
    if (e.key !== 'Escape') return;
    if ($('#overlay .modal')) { $('#overlay .modal').dispatchEvent(new Event('cancel')); return; }
    closeOverlay();
  }

  function confirmDialog({ title, body, okLabel = 'Delete' }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="scrim top"></div>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="mb"><div class="ic">${icon('alert')}</div><div><h3>${esc(title)}</h3><p>${body}</p></div></div>
          <div class="mf"><button class="btn" data-a="cancel">Cancel</button><button class="btn danger" data-a="ok">${icon('trash')}${esc(okLabel)}</button></div>
        </div>`;
      $('#overlay').appendChild(wrap);
      const done = (v) => { wrap.remove(); resolve(v); };
      const modal = $('.modal', wrap);
      modal.addEventListener('cancel', () => done(false));
      $('.scrim', wrap).onclick = () => done(false);
      $('[data-a=cancel]', wrap).onclick = () => done(false);
      $('[data-a=ok]', wrap).onclick = () => done(true);
      document.addEventListener('keydown', escClose);
      $('[data-a=cancel]', wrap).focus();
    });
  }

  async function deleteImages(ids) {
    const many = ids.length > 1;
    const ok = await confirmDialog({
      title: many ? `Delete ${ids.length} images?` : 'Delete this image?',
      body: many
        ? 'All 3 variants and the metadata of each image will be removed. This can\'t be undone.'
        : `<span class="id">${esc(ids[0])}</span><br>All 3 variants and the metadata will be removed. This can't be undone.`,
    });
    if (!ok) return false;
    try {
      if (many) {
        const r = await api('/admin/api/images/bulk-delete', { method: 'POST', json: { image_ids: ids } });
        toast(`Deleted ${r.deleted.length} image${r.deleted.length === 1 ? '' : 's'}${r.failed.length ? `, ${r.failed.length} failed` : ''}`, !!r.failed.length);
      } else {
        await api(`/admin/api/images/${encodeURIComponent(ids[0])}`, { method: 'DELETE' });
        toast('Image deleted');
      }
      return true;
    } catch (e) { fail(e); return false; }
  }

  async function openDetail(imageId, onChange) {
    closeOverlay();
    let item;
    try { item = await api(`/admin/api/images/${encodeURIComponent(imageId)}`); } catch (e) { fail(e); return; }
    const variants = (state.system && state.system.variants) || [
      { name: 'thumb', max_px: 150, quality: 40 }, { name: 'medium', max_px: 720, quality: 72 }, { name: 'large', max_px: 1080, quality: 85 },
    ];
    let current = 'medium';
    const wrap = document.createElement('div');
    const kvRow = (label, value, copyVal, mono = true) => `
      <div><dt>${label}</dt><dd class="${mono ? 'id' : ''}" title="${esc(value)}">${esc(value)}</dd>
      ${copyVal ? `<button class="btn sm icon ghost" data-copy="${esc(copyVal)}" title="Copy">${icon('copy')}</button>` : '<span></span>'}</div>`;
    wrap.innerHTML = `
      <div class="scrim"></div>
      <aside class="drawer" role="dialog" aria-label="Image details">
        <div class="drawer-head">
          <h2>Image details</h2><span class="pill">${esc(item.user_id)}</span>
          <div style="flex:1"></div>
          <button class="btn icon ghost" data-a="close" aria-label="Close">${icon('x')}</button>
        </div>
        <div class="drawer-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="seg" id="vseg">${variants.map((v) => `<button data-v="${v.name}" class="${v.name === current ? 'on' : ''}">${v.name[0].toUpperCase() + v.name.slice(1)}</button>`).join('')}</div>
            <span class="muted" id="vsize"></span>
          </div>
          <div class="preview"><img id="vimg" alt="Preview"></div>

          <div class="section-title">Metadata</div>
          <dl class="kv">
            ${kvRow('image_id', item.image_id, item.image_id)}
            ${kvRow('meta_id', item.meta_id, item.meta_id)}
            ${kvRow('user_id', item.user_id, item.user_id)}
            ${kvRow('MD5 checksum', item.checksum || '—', item.checksum)}
            ${kvRow('Original', `${item.original_res} · ${fmtKB(item.original_kb)}`, null, false)}
            ${kvRow('Uploaded', `${fullDate(item.uploaded_at)} (${ago(item.uploaded_at)})`, item.uploaded_at, false)}
          </dl>

          <div class="section-title">Variants</div>
          <div class="card"><div class="table-wrap"><table>
            <thead><tr><th>Variant</th><th class="num">Max px</th><th class="num">Quality</th><th class="num">Size</th><th class="num">Saved</th></tr></thead>
            <tbody>${variants.map((v) => {
              const kb = (item.variants[v.name] || {}).size_kb || 0;
              return `<tr><td>${v.name}</td><td class="num">${v.max_px}</td><td class="num">${v.quality}</td><td class="num">${fmtKB(kb)}</td><td class="num"><span class="badge ok">${savedPct(item.original_kb, kb)}%</span></td></tr>`;
            }).join('')}</tbody>
          </table></div></div>
        </div>
        <div class="drawer-foot">
          <a class="btn" id="vopen" target="_blank" rel="noopener">${icon('ext')}Open</a>
          <a class="btn" id="vdl">${icon('download')}Download</a>
          <div style="flex:1"></div>
          <button class="btn danger-ghost" data-a="delete">${icon('trash')}Delete</button>
        </div>
      </aside>`;
    $('#overlay').appendChild(wrap);

    const setVariant = (name) => {
      current = name;
      const url = imgUrl(item.image_id, name);
      $('#vimg').src = url;
      $('#vopen').href = url;
      $('#vdl').href = url;
      $('#vdl').setAttribute('download', `${item.image_id}_${name}.jpg`);
      $('#vsize').textContent = fmtKB((item.variants[name] || {}).size_kb);
      $$('#vseg button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
    };
    setVariant(current);
    $('#vseg').onclick = (e) => { const b = e.target.closest('button'); if (b) setVariant(b.dataset.v); };
    $('.scrim', wrap).onclick = closeOverlay;
    $('[data-a=close]', wrap).onclick = closeOverlay;
    wrap.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copy(c.dataset.copy); });
    $('[data-a=delete]', wrap).onclick = async () => {
      if (await deleteImages([item.image_id])) { closeOverlay(); onChange && onChange(); }
    };
    document.addEventListener('keydown', escClose);
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  async function renderOverview(view) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    let s;
    try { s = await api('/admin/api/stats'); } catch (e) { fail(e); view.innerHTML = '<div class="empty">Couldn\'t load stats.</div>'; return; }
    if (currentRoute() !== 'overview') return;

    const vm = s.variant_mb;
    const vTotal = (vm.thumb + vm.medium + vm.large) || 1;
    view.innerHTML = `
      <div class="stack">
        <div class="grid stats">
          <div class="card stat"><div class="label">${icon('images')}Total images</div><div class="value">${num(s.total_images)}</div><div class="hint">+${num(s.uploads_today)} today</div></div>
          <div class="card stat"><div class="label">${icon('users')}Users</div><div class="value">${num(s.total_users)}</div><div class="hint">distinct user_id values</div></div>
          <div class="card stat"><div class="label">${icon('db')}Storage used</div><div class="value">${fmtMB(s.stored_mb)}</div><div class="hint">all variants on disk</div></div>
          <div class="card stat"><div class="label">${icon('saved')}Space saved</div><div class="value">${s.saved_pct}%</div><div class="hint">vs ${fmtMB(s.original_mb)} uploaded</div></div>
        </div>

        <div class="grid two">
          <div class="card">
            <div class="card-head"><div><h2>Uploads</h2><div class="sub">Last 30 days · ${num(s.uploads_30d)} total</div></div></div>
            <div class="card-body">${barChart(s.daily)}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Storage by variant</h2><div class="sub">${fmtMB(s.stored_mb)} total</div></div></div>
            <div class="card-body">
              <div class="split">
                <span class="v-thumb" style="width:${(vm.thumb / vTotal) * 100}%"></span>
                <span class="v-medium" style="width:${(vm.medium / vTotal) * 100}%"></span>
                <span class="v-large" style="width:${(vm.large / vTotal) * 100}%"></span>
              </div>
              <div class="legend">
                ${['thumb', 'medium', 'large'].map((k) => {
                  const v = (state.system && state.system.variants || []).find((x) => x.name === k);
                  return `<div class="legend-row"><span class="sw v-${k}"></span><span>${k} <small>${v ? `${v.max_px}px · q${v.quality}` : ''}</small></span><span class="n">${fmtMB(vm[k])}</span></div>`;
                }).join('')}
              </div>
              <div class="kpi-line"><span class="muted">Avg per image</span><span>${s.total_images ? fmtMB(s.stored_mb / s.total_images) : '—'}</span></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Recent uploads</h2><a href="#/images" class="btn sm">View all</a></div>
          ${s.recent.length ? imageTable(s.recent, false) : `<div class="empty">${icon('images')}<div>No images yet. <a href="#/upload">Upload one</a>.</div></div>`}
        </div>
      </div>`;
    bindChart(view);
    bindTable(view, renderRoute);
  }

  function barChart(daily) {
    const W = 720, H = 200, pl = 32, pr = 8, pt = 10, pb = 24;
    const max = Math.max(1, ...daily.map((d) => d.count));
    const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
    const cw = (W - pl - pr) / daily.length;
    const bw = Math.max(2, cw * 0.66);
    const y = (v) => pt + (H - pt - pb) * (1 - v / nice);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (nice / 4) * i;
      g += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
    }
    const bars = daily.map((d, i) => {
      const x = pl + i * cw + (cw - bw) / 2;
      const h = Math.max(d.count ? 2 : 0, (H - pt - pb) - (y(d.count) - pt));
      const label = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const tick = (i % 5 === 0 || i === daily.length - 1) ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${label}</text>` : '';
      return `<rect class="bar" x="${x}" y="${H - pb - h}" width="${bw}" height="${h}" rx="2" data-tip="${esc(label)} · ${num(d.count)} upload${d.count === 1 ? '' : 's'} · ${fmtMB(d.original_mb)}"/>
        <rect x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt - pb}" fill="transparent" data-tip="${esc(label)} · ${num(d.count)} upload${d.count === 1 ? '' : 's'} · ${fmtMB(d.original_mb)}"/>${tick}`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Uploads per day">${g}${bars}</svg>`;
  }

  function bindChart(root) {
    const svg = $('.chart', root);
    if (!svg) return;
    let tip;
    svg.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip && tip.remove(); tip = null; return; }
      if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip); }
      tip.textContent = t.dataset.tip;
      tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${e.clientY - 34}px`;
    });
    svg.addEventListener('mouseleave', () => { tip && tip.remove(); tip = null; });
  }

  // ── Shared image table ───────────────────────────────────────────────────
  function imageTable(items, selectable) {
    const sel = state.images.selected;
    return `<div class="table-wrap"><table>
      <thead><tr>
        ${selectable ? `<th style="width:32px"><input type="checkbox" data-selall ${items.length && items.every((i) => sel.has(i.image_id)) ? 'checked' : ''} aria-label="Select all"></th>` : ''}
        <th style="width:52px">Preview</th><th>image_id</th><th>user_id</th><th>Resolution</th>
        <th class="num">Original</th><th class="num">Thumb / Medium / Large</th><th>Uploaded</th><th style="width:40px"></th>
      </tr></thead>
      <tbody>${items.map((it) => `
        <tr class="click" data-id="${esc(it.image_id)}">
          ${selectable ? `<td><input type="checkbox" data-sel="${esc(it.image_id)}" ${sel.has(it.image_id) ? 'checked' : ''} aria-label="Select"></td>` : ''}
          <td><img class="tthumb" loading="lazy" src="${imgUrl(it.image_id)}" alt=""></td>
          <td><span class="id" title="${esc(it.image_id)}">${esc(shortId(it.image_id))}</span>
              <button class="btn sm icon ghost" data-copy="${esc(it.image_id)}" title="Copy image_id">${icon('copy')}</button></td>
          <td><span class="pill" title="${esc(it.user_id)}">${esc(it.user_id)}</span></td>
          <td class="muted">${esc(it.original_res)}</td>
          <td class="num">${fmtKB(it.original_kb)}</td>
          <td class="num muted">${['thumb', 'medium', 'large'].map((v) => fmtKB(it.variants[v].size_kb)).join(' · ')}</td>
          <td class="muted" title="${esc(fullDate(it.uploaded_at))}">${ago(it.uploaded_at)}</td>
          <td><button class="btn sm icon ghost" data-del="${esc(it.image_id)}" title="Delete">${icon('trash')}</button></td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  function bindTable(root, reload) {
    root.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { e.stopPropagation(); copy(c.dataset.copy); return; }
      const d = e.target.closest('[data-del]');
      if (d) { e.stopPropagation(); if (await deleteImages([d.dataset.del])) reload(); return; }
      if (e.target.closest('input[type=checkbox]')) return;
      const row = e.target.closest('[data-id]');
      if (row) openDetail(row.dataset.id, reload);
    });
  }

  // ── Images ───────────────────────────────────────────────────────────────
  async function renderImages(view) {
    const st = state.images;
    view.innerHTML = `
      <div class="card" id="imgcard">
        <div class="toolbar">
          <div class="grow"><input type="search" id="f-q" placeholder="Search by image_id, meta_id, user_id or checksum" value="${esc(st.q)}"></div>
          <select id="f-user" aria-label="Filter by user"><option value="">All users</option></select>
          <select id="f-sort" aria-label="Sort">
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            <option value="largest">Largest original</option><option value="smallest">Smallest original</option>
          </select>
          <div class="seg" id="f-view">
            <button data-v="grid" class="${st.view === 'grid' ? 'on' : ''}" title="Grid">${icon('grid')}</button>
            <button data-v="table" class="${st.view === 'table' ? 'on' : ''}" title="Table">${icon('list')}</button>
          </div>
          <button class="btn icon" id="f-refresh" title="Refresh">${icon('refresh')}</button>
        </div>
        <div id="img-results"><div class="empty">Loading…</div></div>
        <div class="pager" id="img-pager"></div>
      </div>
      <div id="bulk"></div>`;
    $('#f-sort').value = st.sort;

    api('/admin/api/users').then((users) => {
      const sel = $('#f-user');
      if (!sel) return;
      sel.insertAdjacentHTML('beforeend', users.map((u) => `<option value="${esc(u.user_id)}">${esc(u.user_id)} (${num(u.count)})</option>`).join(''));
      sel.value = st.user_id;
    }).catch(fail);

    let t;
    $('#f-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; loadImages(); }, 250); };
    $('#f-user').onchange = (e) => { st.user_id = e.target.value; st.page = 1; loadImages(); };
    $('#f-sort').onchange = (e) => { st.sort = e.target.value; st.page = 1; loadImages(); };
    $('#f-refresh').onclick = () => loadImages();
    $('#f-view').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      st.view = b.dataset.v; store.set('pv-view', st.view);
      $$('#f-view button').forEach((x) => x.classList.toggle('on', x === b));
      drawImages();
    };

    const results = $('#img-results');
    bindTable(results, loadImages);
    results.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.dataset.sel) { cb.checked ? st.selected.add(cb.dataset.sel) : st.selected.delete(cb.dataset.sel); drawImages(); }
      if (cb.hasAttribute('data-selall')) { st.items.forEach((i) => (cb.checked ? st.selected.add(i.image_id) : st.selected.delete(i.image_id))); drawImages(); }
    });
    results.addEventListener('click', (e) => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      const id = tile.dataset.tile;
      if (e.target.closest('.chk') || st.selected.size) {
        e.preventDefault();
        st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
        drawImages();
      } else {
        openDetail(id, loadImages);
      }
    });

    await loadImages();
  }

  async function loadImages() {
    const st = state.images;
    const p = new URLSearchParams({ q: st.q, user_id: st.user_id, sort: st.sort, page: st.page, per_page: st.per_page });
    try {
      const r = await api(`/admin/api/images?${p}`);
      if (currentRoute() !== 'images') return;
      if (!r.items.length && st.page > 1) { st.page -= 1; return loadImages(); }
      st.items = r.items; st.total = r.total;
      drawImages();
    } catch (e) { fail(e); }
  }

  function drawImages() {
    const st = state.images;
    const results = $('#img-results');
    if (!results) return;
    if (!st.items.length) {
      results.innerHTML = `<div class="empty">${icon('images')}<div>${st.q || st.user_id ? 'No images match these filters.' : 'No images yet.'}</div></div>`;
    } else if (st.view === 'table') {
      results.innerHTML = imageTable(st.items, true);
    } else {
      results.innerHTML = `<div class="gallery ${st.selected.size ? 'selecting' : ''}">${st.items.map((it) => `
        <div class="tile ${st.selected.has(it.image_id) ? 'sel' : ''}" data-tile="${esc(it.image_id)}" tabindex="0">
          <span class="chk" title="Select"><input type="checkbox" ${st.selected.has(it.image_id) ? 'checked' : ''} tabindex="-1" style="pointer-events:none"></span>
          <img class="ph" loading="lazy" src="${imgUrl(it.image_id)}" alt="">
          <div class="info">
            <span class="id" title="${esc(it.image_id)}">${esc(shortId(it.image_id))}</span>
            <div class="row"><span title="${esc(it.user_id)}">${esc(it.user_id)}</span><span>${ago(it.uploaded_at)}</span></div>
            <div class="row"><span>${esc(it.original_res)}</span><span>${fmtKB(it.original_kb)}</span></div>
          </div>
        </div>`).join('')}</div>`;
    }
    // pager
    const pages = Math.max(1, Math.ceil(st.total / st.per_page));
    const from = st.total ? (st.page - 1) * st.per_page + 1 : 0;
    const to = Math.min(st.total, st.page * st.per_page);
    $('#img-pager').innerHTML = `
      <span>Showing <b>${num(from)}–${num(to)}</b> of <b>${num(st.total)}</b></span>
      <div class="pages">
        <select id="pp" aria-label="Per page">${[24, 48, 96].map((n) => `<option ${n === st.per_page ? 'selected' : ''} value="${n}">${n} / page</option>`).join('')}</select>
        <button class="btn sm" id="pg-prev" ${st.page <= 1 ? 'disabled' : ''}>${icon('left')}Prev</button>
        <span>Page ${num(st.page)} of ${num(pages)}</span>
        <button class="btn sm" id="pg-next" ${st.page >= pages ? 'disabled' : ''}>Next${icon('right')}</button>
      </div>`;
    $('#pg-prev').onclick = () => { st.page -= 1; loadImages(); };
    $('#pg-next').onclick = () => { st.page += 1; loadImages(); };
    $('#pp').onchange = (e) => { st.per_page = +e.target.value; st.page = 1; loadImages(); };

    // bulk bar
    const bulk = $('#bulk');
    if (st.selected.size) {
      bulk.innerHTML = `<div class="bulkbar"><b>${st.selected.size} selected</b>
        <button class="btn sm ghost" id="b-all">Select page</button>
        <button class="btn sm ghost" id="b-clear">Clear</button>
        <button class="btn sm danger" id="b-del">${icon('trash')}Delete</button></div>`;
      $('#b-all').onclick = () => { st.items.forEach((i) => st.selected.add(i.image_id)); drawImages(); };
      $('#b-clear').onclick = () => { st.selected.clear(); drawImages(); };
      $('#b-del').onclick = async () => {
        if (await deleteImages([...st.selected])) { st.selected.clear(); loadImages(); }
      };
    } else bulk.innerHTML = '';
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  function renderUpload(view) {
    const maxMb = state.system ? state.system.limits.max_upload_mb : 25;
    view.innerHTML = `
      <div class="stack" style="max-width:860px">
        <div class="card">
          <div class="card-head"><div><h2>Upload images</h2><div class="sub">Each image is stored as thumb, medium and large JPEGs. The original isn't kept.</div></div></div>
          <div class="card-body stack">
            <label class="field" style="max-width:340px">user_id
              <input type="text" id="u-user" placeholder="e.g. admin or a user's ID" value="${esc(store.get('pv-upload-user', ''))}" maxlength="128">
            </label>
            <div class="drop" id="drop" tabindex="0" role="button">
              ${icon('upload')}
              <b>Drop images here or click to browse</b>
              <span>JPG, PNG, WebP, GIF, BMP, TIFF · up to ${maxMb} MB each</span>
            </div>
            <input type="file" id="u-file" accept="image/*" multiple hidden>
          </div>
        </div>
        <div class="card" id="u-queue-card" ${state.uploads.length ? '' : 'hidden'}>
          <div class="card-head"><h2>Upload queue</h2><button class="btn sm ghost" id="u-clear">Clear finished</button></div>
          <div id="u-queue"></div>
        </div>
      </div>`;
    const drop = $('#drop');
    const input = $('#u-file');
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { addUploads([...input.files]); input.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addUploads([...e.dataTransfer.files]));
    $('#u-clear').onclick = () => { state.uploads = state.uploads.filter((u) => u.status === 'uploading' || u.status === 'queued'); drawQueue(); };
    $('#u-queue').addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copy(c.dataset.copy); });
    drawQueue();
  }

  let uploadSeq = 0;
  function addUploads(files) {
    const userId = $('#u-user').value.trim();
    if (!userId) { toast('Enter a user_id first', true); $('#u-user').focus(); return; }
    store.set('pv-upload-user', userId);
    const maxBytes = (state.system ? state.system.limits.max_upload_mb : 25) * 1024 * 1024;
    for (const f of files) {
      const u = { id: ++uploadSeq, file: f, name: f.name, size: f.size, userId, status: 'queued', progress: 0, preview: URL.createObjectURL(f) };
      if (!f.type.startsWith('image/')) { u.status = 'error'; u.error = 'Not an image file'; }
      else if (f.size > maxBytes) { u.status = 'error'; u.error = 'File too large'; }
      state.uploads.unshift(u);
    }
    drawQueue();
    pumpUploads();
  }

  function pumpUploads() {
    const active = state.uploads.filter((u) => u.status === 'uploading').length;
    const next = state.uploads.filter((u) => u.status === 'queued').reverse();
    for (let i = 0; i < Math.min(2 - active, next.length); i++) sendUpload(next[i]);
  }

  function sendUpload(u) {
    u.status = 'uploading';
    const fd = new FormData();
    fd.append('file', u.file);
    fd.append('user_id', u.userId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/admin/api/upload');
    xhr.setRequestHeader('X-PixelVault', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { u.progress = e.loaded / e.total; updateQueueItem(u); } };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status === 401) { showLogin(); return; }
      if (xhr.status >= 200 && xhr.status < 300) { u.status = 'done'; u.result = data; }
      else { u.status = 'error'; u.error = (data && typeof data.detail === 'string' && data.detail) || `Upload failed (${xhr.status})`; }
      drawQueue(); pumpUploads();
    };
    xhr.onerror = () => { u.status = 'error'; u.error = 'Network error'; drawQueue(); pumpUploads(); };
    xhr.send(fd);
    drawQueue();
  }

  function queueItemHtml(u) {
    const r = u.result;
    let meta = `<span>${fmtKB(u.size / 1024)}</span><span>user_id: ${esc(u.userId)}</span>`;
    let badge = '<span class="badge wait">Queued</span>';
    if (u.status === 'uploading') badge = `<span class="badge wait">${Math.round(u.progress * 100)}%</span>`;
    if (u.status === 'error') { badge = '<span class="badge err">Failed</span>'; meta += `<span style="color:var(--danger)">${esc(u.error)}</span>`; }
    if (u.status === 'done' && r) {
      const stored = r.variants.thumb.size_kb + r.variants.medium.size_kb + r.variants.large.size_kb;
      badge = `<span class="badge ok">Saved ${savedPct(r.original_kb, r.variants.large.size_kb)}%</span>`;
      meta = `<span>${esc(r.original_res)} · ${fmtKB(r.original_kb)} → ${fmtKB(stored)}</span>
        <span>image_id <span class="id">${esc(shortId(r.image_id))}</span> <button class="btn sm icon ghost" data-copy="${esc(r.image_id)}" title="Copy image_id">${icon('copy')}</button></span>
        <span>meta_id <span class="id">${esc(shortId(r.meta_id))}</span> <button class="btn sm icon ghost" data-copy="${esc(r.meta_id)}" title="Copy meta_id">${icon('copy')}</button></span>`;
    }
    return `<img class="qthumb" src="${u.status === 'done' && r ? imgUrl(r.image_id) : u.preview}" alt="" onerror="this.style.visibility='hidden'">
      <div class="qmain"><div class="qname">${esc(u.name)}</div><div class="qmeta">${meta}</div>
      ${u.status === 'uploading' ? `<div class="progress"><span style="width:${u.progress * 100}%"></span></div>` : ''}</div>${badge}`;
  }

  function drawQueue() {
    const q = $('#u-queue');
    if (!q) return;
    $('#u-queue-card').hidden = !state.uploads.length;
    q.innerHTML = state.uploads.map((u) => `<div class="queue-item" data-u="${u.id}">${queueItemHtml(u)}</div>`).join('');
  }
  function updateQueueItem(u) {
    const el = $(`[data-u="${u.id}"]`);
    if (el) el.innerHTML = queueItemHtml(u);
  }

  // ── Lookup ───────────────────────────────────────────────────────────────
  function renderLookup(view) {
    view.innerHTML = `
      <div class="stack" style="max-width:860px">
        <div class="card">
          <div class="card-head"><div><h2>Metadata lookup</h2><div class="sub">Find the stored metadata for a meta_id or image_id.</div></div></div>
          <div class="card-body">
            <form class="lookup-form" id="lk-form">
              <select id="lk-type" aria-label="ID type"><option value="meta">meta_id</option><option value="image">image_id</option></select>
              <input type="text" id="lk-id" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false" required>
              <button class="btn primary" type="submit">${icon('search')}Look up</button>
            </form>
          </div>
        </div>
        <div id="lk-result"></div>
      </div>`;
    $('#lk-form').onsubmit = async (e) => {
      e.preventDefault();
      const type = $('#lk-type').value;
      const id = $('#lk-id').value.trim();
      const out = $('#lk-result');
      out.innerHTML = '<div class="card"><div class="empty">Looking up…</div></div>';
      try {
        const data = await api(type === 'meta' ? `/admin/api/meta/${encodeURIComponent(id)}` : `/admin/api/images/${encodeURIComponent(id)}`);
        const json = JSON.stringify(data, null, 2);
        out.innerHTML = `
          <div class="card">
            <div class="card-head"><h2>Result</h2><div style="display:flex;gap:8px">
              <button class="btn sm" id="lk-open">${icon('images')}View image</button>
              <button class="btn sm" id="lk-copy">${icon('copy')}Copy JSON</button></div></div>
            <pre class="json">${highlight(json)}</pre>
          </div>`;
        $('#lk-copy').onclick = () => copy(json);
        $('#lk-open').onclick = () => openDetail(data.image_id);
      } catch (err) {
        if (err instanceof AuthError) return;
        out.innerHTML = `<div class="card"><div class="empty">${icon('alert')}<div>${esc(err.message)}</div></div></div>`;
      }
    };
  }

  function highlight(json) {
    return esc(json).replace(
      /(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m, str, colon, bool, n) => {
        if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
        if (bool) return `<span class="b">${bool}</span>`;
        if (n) return `<span class="n">${n}</span>`;
        return m;
      },
    );
  }

  // ── System ───────────────────────────────────────────────────────────────
  async function renderSystem(view) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    let s;
    try { s = await api('/admin/api/system'); state.system = s; } catch (e) { fail(e); return; }
    if (currentRoute() !== 'system') return;
    const kv = (rows) => `<dl class="kv">${rows.map(([k, v, mono]) => `<div><dt>${k}</dt><dd class="${mono ? 'id' : ''}" title="${esc(v)}">${esc(v)}</dd><span></span></div>`).join('')}</dl>`;
    const origin = location.origin;
    view.innerHTML = `
      <div class="grid two" style="align-items:start">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Server</h2><span class="badge ok"><span class="status-dot"></span>Healthy</span></div>
            <div class="card-body">${kv([
              ['Version', s.version], ['Started', `${fullDate(s.started_at)} (${ago(s.started_at)})`],
              ['Python', s.python], ['Platform', s.platform], ['Images', num(s.total_images)],
              ['Storage dir', s.storage_dir, true], ['Metadata dir', s.meta_dir, true],
            ])}</div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Variants</h2><div class="sub">Defined in <code>core.py</code></div></div></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Name</th><th class="num">Max size</th><th class="num">JPEG quality</th></tr></thead>
              <tbody>${s.variants.map((v) => `<tr><td>${v.name}</td><td class="num">${v.max_px}px</td><td class="num">${v.quality}</td></tr>`).join('')}</tbody>
            </table></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Public API</h2></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td><span class="pill">POST</span></td><td class="id">/upload?user_id=…</td><td class="muted">Upload → metadata</td></tr>
                <tr><td><span class="pill">GET</span></td><td class="id">/image?image_id=…&amp;variant=…</td><td class="muted">Fetch a variant</td></tr>
                <tr><td><span class="pill">GET</span></td><td class="id">/image/meta?meta_id=…</td><td class="muted">Fetch metadata</td></tr>
                <tr><td><span class="pill">DELETE</span></td><td class="id">/image/{image_id}</td><td class="muted">Delete image</td></tr>
                <tr><td><span class="pill">GET</span></td><td class="id">/health</td><td class="muted">Status</td></tr>
              </tbody>
            </table></div>
            <div class="card-body" style="border-top:1px solid var(--border)"><a href="${esc(origin)}/docs" target="_blank" rel="noopener">${icon('ext')} Open API docs</a></div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h2>Admin access</h2><div class="sub">Google sign-in · edit <code>ADMIN_ALLOWED_EMAILS</code> in <code>.env</code></div></div></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Allowed email</th><th></th></tr></thead>
              <tbody>${s.access.allowed_emails.map((e) => `<tr><td>${esc(e)}</td><td class="num">${e === s.access.you ? '<span class="badge ok">You</span>' : ''}</td></tr>`).join('')}</tbody>
            </table></div>
            <div class="card-body">${kv([
              ['Session length', `${s.access.session_days} days`],
              ['Secure cookie', s.access.cookie_secure ? 'Yes (HTTPS only)' : 'No — set COOKIE_SECURE=true in production'],
              ['Signed in as', s.access.you],
            ])}</div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Limits</h2></div>
            <div class="card-body">${kv([
              ['Max upload', `${s.limits.max_upload_mb} MB`],
              ['Max image size', `${s.limits.max_image_mp} megapixels`],
            ])}</div>
          </div>
        </div>
      </div>`;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  (async function boot() {
    try {
      state.me = await api('/admin/auth/me');
      startApp();
    } catch (e) {
      showLogin();
    }
  })();
})();
