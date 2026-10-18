// Guest Web Player: zero-install, zero-login viewing; writes are server-guarded and trigger progressive sign-in.
(() => {
  const $ = (id) => document.getElementById(id);
  const parts = location.pathname.split('/').filter(Boolean); // ['web', kind, id, view?]
  const kind = parts[1];
  const id = decodeURIComponent(parts[2] || '');
  const view = parts[3] || '';
  const params = new URLSearchParams(location.search);

  const session = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch { /* empty body */ }
    return { status: r.status, data };
  }

  // ---- guest identity (FR-4.2): issued silently, never a login wall ----
  async function guestToken() {
    let t = session.get('guest_token');
    if (!t) {
      const r = await api('/api/v1/guest/token', { method: 'POST' });
      t = r.data && r.data.guest_token;
      if (t) session.set('guest_token', t);
    }
    return t;
  }
  const memberToken = () => session.get('member_token');
  const memberUser = () => { try { return JSON.parse(session.get('member_user') || 'null'); } catch { return null; } };

  // ---- connection status pill ----
  function setConn(state) {
    const el = $('conn-status');
    el.textContent = { live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline' }[state] || state;
    el.classList.toggle('live', state === 'live');
  }

  // ---- live score: WebSocket first, SSE fallback, push only (NFR-1) ----
  function renderScore(p) {
    if (!p || p.type !== 'score') return;
    $('live-score-banner').textContent = `${p.home.score} - ${p.away.score}`;
    $('home-badge').textContent = p.home.team_id;
    $('away-badge').textContent = p.away.team_id;
    const label = { upcoming: 'Starts soon', in_progress: 'Live now', completed: 'Full time', postponed: 'Postponed', cancelled: 'Cancelled', abandoned: 'Abandoned' };
    $('match-state').textContent = label[p.status] || p.status;
  }

  function subscribe(wsPath, ssePath, onMessage) {
    let fellBack = false;
    const sse = () => {
      if (fellBack || !window.EventSource) return;
      fellBack = true;
      const es = new EventSource(ssePath);
      es.onopen = () => setConn('live');
      es.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
      es.onerror = () => setConn('reconnecting');
    };
    try {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${wsPath}`);
      ws.onopen = () => setConn('live');
      ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
      ws.onerror = sse;
      ws.onclose = sse;
    } catch {
      sse();
    }
  }

  // ---- video (HLS via hls.js, native fallback) ----
  function startVideo(streamPath) {
    const video = $('video');
    const src = `${location.protocol}//${location.hostname}:8888/${streamPath}/index.m3u8`;
    const note = $('video-note');
    const offline = () => { note.textContent = 'Stream is offline right now. Score and chat stay live.'; };
    const resumeAt = Number(session.get(`resume_at:${location.pathname}`) || 0);
    video.addEventListener('loadedmetadata', () => { if (resumeAt) video.currentTime = resumeAt; note.textContent = ''; });
    video.addEventListener('timeupdate', () => session.set(`resume_at:${location.pathname}`, String(video.currentTime)));
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: true, manifestLoadingMaxRetry: 2 });
      hls.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal) offline(); });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('error', offline);
    } else {
      offline();
    }
  }

  // ---- chat ----
  const chatRoom = `chat-${id}`;
  function appendChat(m) {
    const list = $('chat-message-list');
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = m.sender;
    li.append(who, document.createTextNode(m.text));
    list.append(li);
    list.scrollTop = list.scrollHeight;
  }

  let pending = null; // protected action waiting for sign-in: { type: 'chat', text } | { type: 'checkout' }
  async function sendChat(text) {
    const member = memberToken();
    const r = await api('/api/v1/chat', { method: 'POST', token: member || await guestToken(), body: { chat_room_id: chatRoom, text } });
    if (r.status === 201) return true; // the broadcast echo renders it
    if (r.status === 403 || r.status === 401) {
      pending = { type: 'chat', text };
      openAuth('Sign in to send chat messages. Your cart and video position are kept.');
      return false;
    }
    $('cart-msg').textContent = (r.data && r.data.error && r.data.error.message) || 'Message could not be sent.';
    return false;
  }

  // ---- guest cart staging (FR-4.4) ----
  const PINNED_VARIANT = 'var-jersey-001-L';
  function setCount(n) { $('guest-cart-count').textContent = String(n); }

  async function addToCart() {
    const el = $('guest-cart-count');
    setCount(Number(el.textContent || 0) + 1); // optimistic; corrected by the server below
    const r = await api('/api/v1/guest/cart', { method: 'POST', body: { guest_token: await guestToken(), variant_id: PINNED_VARIANT, quantity: 1 } });
    if (r.status === 200) {
      setCount(r.data.total_items);
      $('cart-msg').textContent = 'Added to your cart.';
    } else {
      setCount(Math.max(0, Number(el.textContent) - 1));
      $('cart-msg').textContent = 'Could not add this item. Please try again.';
    }
  }

  async function mergeCart() {
    const user = memberUser();
    const token = await guestToken();
    const staged = await api(`/api/v1/guest/cart?guest_token=${encodeURIComponent(token)}`);
    const items = (staged.data && staged.data.items) || [];
    if (!user || items.length === 0) return null;
    const r = await api('/audit/v1/guest/cart-merge', {
      method: 'POST',
      body: { guest_token: token, registered_user_id: user.player_id || user.user_id, guest_cart: items, test_write_block: true },
    });
    if (r.status === 200) {
      session.set('guest_token', ''); // merged tokens cannot be merged again; a fresh one is issued on demand
      return r.data.active_cart;
    }
    return null;
  }

  async function checkout() {
    if (!memberToken()) {
      pending = { type: 'checkout' };
      openAuth('Sign in to check out. Your cart and video position are kept.');
      return;
    }
    const cart = await mergeCart();
    $('cart-msg').textContent = cart ? `${cart.total_items} item(s) saved to your account cart.` : 'Your account cart is up to date.';
  }

  // ---- progressive auth modal ----
  let lastFocus = null;
  function openAuth(reason) {
    lastFocus = document.activeElement;
    $('auth-reason').textContent = reason;
    $('auth-error').textContent = '';
    $('progressive-auth-modal').hidden = false;
    $('auth-email').focus();
  }
  function closeAuth() {
    $('progressive-auth-modal').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  async function signIn(e) {
    e.preventDefault();
    const r = await api('/api/v1/auth/login', { method: 'POST', body: { email: $('auth-email').value, password: $('auth-password').value } });
    if (r.status !== 200) {
      $('auth-error').textContent = 'That email and password did not match. Please try again.';
      return;
    }
    session.set('member_token', r.data.token);
    session.set('member_user', JSON.stringify(r.data));
    const cart = await mergeCart();
    closeAuth();
    const next = pending;
    pending = null;
    if (cart) $('cart-msg').textContent = `${cart.total_items} item(s) saved to your account cart.`;
    if (next && next.type === 'chat' && await sendChat(next.text)) $('chat-input-field').value = '';
  }

  // ---- views ----
  async function matchView() {
    $('view-match').hidden = false;
    const isCostream = kind === 'costream';
    const matchId = isCostream ? (params.get('match') || 'match-m1') : id;
    $('match-title').textContent = isCostream ? `Co-stream ${id}` : `Match ${id}`;
    if (view === 'notice') $('match-state').textContent = `This match is ${params.get('state') || 'unavailable'}.`;
    document.title = `${$('match-title').textContent} · NaSCon Live`;

    const score = await api(`/api/v1/matches/${encodeURIComponent(matchId)}/score`);
    if (score.status === 200) renderScore(score.data);
    subscribe(`/ws/matches/${encodeURIComponent(matchId)}`, `/api/v1/matches/${encodeURIComponent(matchId)}/stream`, renderScore);
    subscribe(`/ws/chat/${encodeURIComponent(chatRoom)}`, `/api/v1/chat/${encodeURIComponent(chatRoom)}/stream`, (m) => { if (m.type === 'chat') appendChat(m); });
    startVideo(isCostream ? `costream/${id}` : `matches/${id}`);

    const merch = await api('/api/v1/products/pinned');
    if (merch.status === 200) {
      $('merch-name').textContent = merch.data.name;
      $('merch-meta').textContent = `Size ${merch.data.size} · ${merch.data.currency} ${(merch.data.price_minor / 100).toFixed(2)}`;
    }
    const staged = await api(`/api/v1/guest/cart?guest_token=${encodeURIComponent(await guestToken())}`);
    if (staged.status === 200 && Number($('guest-cart-count').textContent) === 0) setCount(staged.data.total_items);
  }

  async function profileView() {
    $('view-profile').hidden = false;
    const r = await api(`/api/v1/${kind}/${encodeURIComponent(id)}`);
    $('profile-kind').textContent = kind === 'players' ? 'Athlete' : 'Club';
    if (r.status !== 200) {
      $('profile-title').textContent = 'Not found';
      return;
    }
    $('profile-title').textContent = r.data.name || id;
    const dl = $('profile-details');
    for (const [k, v] of Object.entries(r.data)) {
      const dt = document.createElement('dt');
      dt.textContent = k.replace(/_/g, ' ');
      const dd = document.createElement('dd');
      if (Array.isArray(v)) dd.textContent = v.map((x) => (typeof x === 'object' ? x.name || x.player_id || x.match_id : x)).join(', ') || '—';
      else if (v && typeof v === 'object') dd.textContent = Object.entries(v).map(([a, b]) => `${a.replace(/_/g, ' ')} ${b}`).join(' · ');
      else dd.textContent = String(v ?? '—');
      dl.append(dt, dd);
    }
    setConn('live');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('add-to-guest-cart-btn').addEventListener('click', addToCart);
    $('checkout-btn').addEventListener('click', checkout);
    $('chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('chat-input-field');
      const text = input.value.trim();
      if (!text) return;
      if (await sendChat(text)) input.value = '';
    });
    $('auth-form').addEventListener('submit', signIn);
    $('auth-cancel').addEventListener('click', () => { pending = null; closeAuth(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('progressive-auth-modal').hidden) closeAuth(); });
    if (kind === 'matches' || kind === 'costream') await matchView();
    else await profileView();
  });
})();
