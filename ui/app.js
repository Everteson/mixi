'use strict';

/* ================= ponte com o Rust ================= */
// Dentro do app usamos o Tauri. Aberto num navegador comum, cai num "backend de mentira"
// para dar pra mexer no visual sem compilar.
const TAURI = window.__TAURI__;
const invoke = TAURI ? TAURI.core.invoke : mockInvoke;
const listen = TAURI ? TAURI.event.listen : () => Promise.resolve();

/* ================= dados fixos ================= */
const THEMES = [
  { id: 'algodao', name: 'Algodão doce', bg: '#FFF8FB', accent: '#E8679F', border: '#F2DAE6' },
  { id: 'menta', name: 'Menta', bg: '#F3FBF7', accent: '#3DBE8B', border: '#D9EDE2' },
  { id: 'noite', name: 'Noite', bg: '#211D33', accent: '#A99BFF', border: '#3A3457' },
  { id: 'pessego', name: 'Pêssego', bg: '#FFF6EF', accent: '#F4904F', border: '#F3DDCC' },
];

// Categorias pelo nome do executável (a "key" que vem do Rust).
const CATEGORIES = {
  music: ['spotify', 'deezer', 'tidal', 'vlc', 'foobar2000', 'aimp', 'musicbee', 'itunes', 'applemusic', 'amazon music', 'youtube music desktop app'],
  chat: ['discord', 'discordptb', 'discordcanary', 'ms-teams', 'teams', 'zoom', 'slack', 'whatsapp', 'telegram', 'skype'],
  browser: ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'arc'],
};

// Volume (0–1) por categoria. "other" = jogos e o resto. mute = categorias silenciadas.
const MODES = [
  { id: 'jogo', label: 'Jogo', master: 0.85, vol: { music: 0.30, chat: 0.70, browser: 0.10, other: 0.90, system: 0.35 }, mute: [],
    icon: '<rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="18" cy="14" r="1" fill="currentColor"/>' },
  { id: 'foco', label: 'Foco', master: 0.60, vol: { music: 0.45, chat: 0.20, browser: 0.60, other: 0.30, system: 0.30 }, mute: ['other', 'system'],
    icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>' },
  { id: 'chamada', label: 'Chamada', master: 0.75, vol: { music: 0.12, chat: 0.95, browser: 0.20, other: 0.25, system: 0.30 }, mute: [],
    icon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>' },
  { id: 'soninho', label: 'Soninho', master: 0.30, vol: { music: 0.40, chat: 0.15, browser: 0.25, other: 0.20, system: 0.20 }, mute: ['system'],
    icon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>' },
];

const TILE_COLORS = ['#CDF3DA', '#DCE0FF', '#FFE6BF', '#FFD7D7', '#E3F1FF', '#F6DCFF', '#FFF0B8'];

const ICON_SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
const DEVICE_ICONS = {
  headphones: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/></svg>',
  speakers: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7.5" r="1"/></svg>',
  display: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/></svg>',
  other: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
};
const DEVICE_KIND_LABEL = { headphones: 'Fone', speakers: 'Caixa de som', display: 'Monitor / TV', other: 'Saída de áudio' };
const ICON_CHECK = '<svg class="out-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_BELL ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>';

/* ================= estado ================= */
const $ = (id) => document.getElementById(id);
const els = {
  panel: $('panel'), live: $('liveLabel'), pin: $('pinBtn'), menuBtn: $('menuBtn'), menu: $('menu'),
  autostart: $('autostart'), masterLabel: $('masterLabel'), masterSlider: $('masterSlider'),
  masterMute: $('masterMute'), deviceBtn: $('deviceBtn'), deviceName: $('deviceName'),
  deviceIcon: $('deviceIcon'), outMenu: $('outMenu'), outList: $('outList'),
  apps: $('apps'), modes: $('modes'), themes: $('themes'), themeName: $('themeName'),
};

let mixer = null;              // último estado vindo do Rust
let activeMode = localStorage.getItem('mixi.mode');
let pinned = false;
let pollTimer = null;
let polling = false;
const rows = new Map();        // key -> elementos da linha
const holding = new Map();     // key -> até quando ignorar o valor vindo do Rust (usuário mexendo)

/* ================= utilidades ================= */
const pct = (v) => Math.round(v * 100);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function category(app) {
  if (app.system) return 'system';
  for (const [cat, list] of Object.entries(CATEGORIES)) if (list.includes(app.key)) return cat;
  return 'other';
}

function tileColor(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

/** Envia o valor mais recente sem enfileirar dezenas de chamadas enquanto arrasta. */
function latestSender(fn) {
  let busy = false;
  let pending = null;
  return async function send(...args) {
    pending = args;
    if (busy) return;
    busy = true;
    while (pending) {
      const a = pending;
      pending = null;
      try { await fn(...a); } catch (e) { console.warn(e); }
    }
    busy = false;
  };
}

function hold(key) { holding.set(key, Date.now() + 600); }
function isHeld(key) { return (holding.get(key) || 0) > Date.now(); }

function setMode(id) {
  activeMode = id;
  if (id) localStorage.setItem('mixi.mode', id); else localStorage.removeItem('mixi.mode');
  for (const b of els.modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === id));
}

/* ================= volume geral ================= */
const sendMaster = latestSender((v) => invoke('set_master_volume', { volume: v }));

els.masterSlider.addEventListener('input', () => {
  const v = els.masterSlider.value / 100;
  hold('__master');
  paintMaster(v, false);
  sendMaster(v);
  if (mixer && mixer.master_muted) { mixer.master_muted = false; invoke('set_master_mute', { muted: false }); }
  setMode(null);
});
els.masterSlider.addEventListener('wheel', (e) => nudge(e, els.masterSlider), { passive: false });

els.masterMute.addEventListener('click', () => {
  if (!mixer) return;
  mixer.master_muted = !mixer.master_muted;
  hold('__master');
  paintMaster(mixer.master, mixer.master_muted);
  invoke('set_master_mute', { muted: mixer.master_muted });
});

/* ================= saída de áudio ================= */
function splitDeviceName(name) {
  // "Alto-falantes (USB Audio Device)" -> ["USB Audio Device", "Alto-falantes"]
  const m = name.match(/^(.*?) \((.*)\)$/);
  return m ? [m[2], m[1]] : [name, ''];
}

async function toggleOutMenu(open = els.outMenu.hidden) {
  if (open) toggleMenu(false);
  els.outMenu.hidden = !open;
  els.deviceBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  els.outList.innerHTML = '<div class="menu-title">procurando…</div>';
  try {
    const outputs = await invoke('list_outputs');
    els.outList.innerHTML = outputs.map((o) => {
      const [main, detail] = splitDeviceName(o.name);
      return `
        <button class="menu-item out-item" role="menuitemradio" aria-checked="${o.default}" data-id="${esc(o.id)}">
          <span class="out-icon">${DEVICE_ICONS[o.kind] || DEVICE_ICONS.other}</span>
          <span class="out-text">
            <span class="out-name">${esc(main)}</span>
            <span class="out-detail">${esc(detail || DEVICE_KIND_LABEL[o.kind] || '')}</span>
          </span>
          ${ICON_CHECK}
        </button>`;
    }).join('') || '<div class="menu-title">Nenhuma saída de áudio ativa.</div>';
  } catch (e) {
    els.outList.innerHTML = '<div class="menu-title">Não consegui listar as saídas.</div>';
  }
}

els.deviceBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOutMenu(); });
els.outMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.out-item');
  if (item) {
    if (item.getAttribute('aria-checked') === 'true') { toggleOutMenu(false); return; }
    item.classList.add('busy');
    try {
      await invoke('set_output', { id: item.dataset.id });
      for (const b of els.outList.querySelectorAll('.out-item')) b.setAttribute('aria-checked', String(b === item));
      holding.clear();
      poll();
      setTimeout(() => toggleOutMenu(false), 250);
    } catch (err) {
      item.classList.remove('busy');
      els.live.textContent = 'não consegui trocar a saída';
    }
    return;
  }
  if (e.target.closest('[data-action="sound"]')) { toggleOutMenu(false); invoke('open_settings', { page: 'sound' }); }
});

function paintMaster(v, muted) {
  els.masterSlider.value = pct(v);
  els.masterSlider.style.setProperty('--v', pct(v) + '%');
  els.masterSlider.classList.toggle('is-muted', muted);
  els.masterLabel.textContent = muted ? 'mudo' : pct(v) + '%';
  els.masterMute.innerHTML = muted ? ICON_MUTED : ICON_SPEAKER;
  els.masterMute.setAttribute('aria-pressed', String(muted));
  els.masterMute.setAttribute('aria-label', muted ? 'Reativar todo o som' : 'Silenciar tudo');
}

/* ================= linhas dos apps ================= */
const sendApp = new Map(); // key -> sender

function senderFor(key) {
  if (!sendApp.has(key)) sendApp.set(key, latestSender((v) => invoke('set_app_volume', { key, volume: v })));
  return sendApp.get(key);
}

function nudge(e, slider) {
  e.preventDefault();
  const step = e.deltaY < 0 ? 2 : -2;
  slider.value = Math.max(0, Math.min(100, Number(slider.value) + step));
  slider.dispatchEvent(new Event('input'));
}

function createRow(app) {
  const row = document.createElement('div');
  row.className = 'row';
  const tile = app.icon
    ? `<img src="${app.icon}" alt="">`
    : app.system ? ICON_BELL : esc(app.name.charAt(0).toUpperCase());
  row.innerHTML = `
    <div class="tile" style="background:${app.icon ? 'var(--soft)' : tileColor(app.key)}">${tile}</div>
    <div class="mid">
      <div class="line">
        <span class="name">${esc(app.name)}</span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="pct"></span>
      </div>
      <input class="slider" type="range" min="0" max="100" aria-label="Volume: ${esc(app.name)}">
    </div>
    <button class="icon-btn mute" aria-pressed="false"></button>`;
  const r = {
    el: row,
    slider: row.querySelector('.slider'),
    pct: row.querySelector('.pct'),
    mute: row.querySelector('.mute'),
    muted: null,
  };

  r.slider.addEventListener('input', () => {
    const v = r.slider.value / 100;
    hold(app.key);
    const cur = mixer && mixer.apps.find((a) => a.key === app.key);
    if (cur) {
      cur.volume = v;
      if (cur.muted) { cur.muted = false; invoke('set_app_mute', { key: app.key, muted: false }); }
      paintRow(r, cur);
    }
    senderFor(app.key)(v);
    setMode(null);
  });
  row.addEventListener('wheel', (e) => nudge(e, r.slider), { passive: false });

  r.mute.addEventListener('click', () => {
    const cur = mixer && mixer.apps.find((a) => a.key === app.key);
    if (!cur) return;
    cur.muted = !cur.muted;
    hold(app.key);
    paintRow(r, cur);
    invoke('set_app_mute', { key: app.key, muted: cur.muted });
  });
  return r;
}

function paintRow(r, app) {
  const v = pct(app.volume);
  r.slider.value = v;
  r.slider.style.setProperty('--v', v + '%');
  r.pct.textContent = app.muted ? 'mudo' : v + '%';
  r.el.classList.toggle('is-muted', app.muted || mixer.master_muted);
  r.el.classList.toggle('playing', !app.muted && !mixer.master_muted && app.peak > 0.01 && app.volume > 0);
  if (r.muted !== app.muted) {
    r.muted = app.muted;
    r.mute.innerHTML = app.muted ? ICON_MUTED : ICON_SPEAKER;
    r.mute.setAttribute('aria-pressed', String(app.muted));
    r.mute.setAttribute('aria-label', (app.muted ? 'Reativar som: ' : 'Silenciar: ') + app.name);
  }
}

/* ================= desenhar o estado ================= */
function render(state) {
  // Enquanto o usuário arrasta, o valor da tela manda (o Rust pode estar um passo atrás).
  if (mixer) {
    if (isHeld('__master')) { state.master = Number(els.masterSlider.value) / 100; state.master_muted = mixer.master_muted; }
    for (const a of state.apps) {
      if (!isHeld(a.key)) continue;
      const old = mixer.apps.find((o) => o.key === a.key);
      if (old) { a.volume = old.volume; a.muted = old.muted; }
    }
  }
  mixer = state;

  paintMaster(state.master, state.master_muted);
  els.deviceName.textContent = splitDeviceName(state.device)[0];
  if (els.deviceIcon.dataset.kind !== state.device_kind) {
    els.deviceIcon.dataset.kind = state.device_kind;
    els.deviceIcon.innerHTML = DEVICE_ICONS[state.device_kind] || DEVICE_ICONS.other;
  }
  els.deviceBtn.setAttribute('aria-label', `Trocar saída de áudio (atual: ${state.device})`);

  let changed = false;
  const seen = new Set();
  for (const app of state.apps) {
    seen.add(app.key);
    let r = rows.get(app.key);
    if (!r) { r = createRow(app); rows.set(app.key, r); changed = true; }
    paintRow(r, app);
  }
  for (const [key, r] of rows) {
    if (!seen.has(key)) { r.el.remove(); rows.delete(key); changed = true; }
  }
  if (changed) {
    // Mantém a ordem que veio do Rust.
    els.apps.replaceChildren(...state.apps.map((a) => rows.get(a.key).el));
    if (!state.apps.length) els.apps.innerHTML = '<div class="empty">Nenhum app usando o som agora.<br>Dá play em alguma coisa!</div>';
    fitWindow();
  }

  const live = state.apps.filter((a) => !a.system && !a.muted && a.peak > 0.01).length;
  els.live.textContent = state.master_muted ? 'tudo no mudo'
    : live === 0 ? 'tudo quietinho' : live === 1 ? '1 app tocando' : `${live} apps tocando`;
}

async function poll() {
  if (polling) return;
  polling = true;
  try { render(await invoke('get_state')); }
  catch (e) { els.live.textContent = 'não consegui ler o áudio'; console.error(e); }
  finally { polling = false; }
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, 150);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

function fitWindow() {
  requestAnimationFrame(() => {
    const h = Math.ceil(els.panel.getBoundingClientRect().height) + 28; // padding do body
    invoke('fit_window', { height: h }).catch(() => {});
  });
}

/* ================= modos ================= */
function buildModes() {
  els.modes.innerHTML = MODES.map((m) => `
    <button class="mode" data-mode="${m.id}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg><span>${m.label}</span>
    </button>`).join('');
  els.modes.addEventListener('click', async (e) => {
    const b = e.target.closest('.mode');
    if (!b || !mixer) return;
    const m = MODES.find((x) => x.id === b.dataset.mode);
    setMode(m.id);
    await invoke('set_master_mute', { muted: false });
    await invoke('set_master_volume', { volume: m.master });
    await Promise.all(mixer.apps.map((a) => {
      const cat = category(a);
      return Promise.all([
        invoke('set_app_volume', { key: a.key, volume: m.vol[cat] }),
        invoke('set_app_mute', { key: a.key, muted: m.mute.includes(cat) }),
      ]);
    }));
    holding.clear();
    poll();
  });
  setMode(activeMode);
}

/* ================= temas ================= */
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  localStorage.setItem('mixi.theme', t.id);
  els.themeName.textContent = t.name;
  for (const b of els.themes.children) b.setAttribute('aria-pressed', String(b.dataset.theme === t.id));
}

function buildThemes() {
  els.themes.innerHTML = THEMES.map((t) => `
    <button class="swatch" data-theme="${t.id}" aria-label="Tema ${t.name}" title="${t.name}" aria-pressed="false">
      <span style="background:${t.bg}; border:1px solid ${t.border}; --sw-accent:${t.accent}"></span>
    </button>`).join('');
  els.themes.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (b) applyTheme(b.dataset.theme);
  });
  applyTheme(localStorage.getItem('mixi.theme') || 'algodao');
}

/* ================= cabeçalho e menu ================= */
function paintPin() {
  els.pin.setAttribute('aria-pressed', String(pinned));
  els.pin.setAttribute('aria-label', pinned ? 'Soltar painel' : 'Manter painel aberto');
}
els.pin.addEventListener('click', () => {
  pinned = !pinned;
  paintPin();
  invoke('set_pinned', { pinned });
});
invoke('get_pinned').then((p) => { pinned = !!p; paintPin(); }).catch(() => {});

function toggleMenu(open = els.menu.hidden) {
  if (open) toggleOutMenu(false);
  els.menu.hidden = !open;
  els.menuBtn.setAttribute('aria-expanded', String(open));
  if (open) invoke('get_autostart').then((on) => { els.autostart.checked = on; }).catch(() => {});
}
els.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => {
  if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false);
  if (!els.outMenu.hidden && !els.outMenu.contains(e.target)) toggleOutMenu(false);
});
els.autostart.addEventListener('change', () => {
  invoke('set_autostart', { enabled: els.autostart.checked }).catch(() => { els.autostart.checked = !els.autostart.checked; });
});
els.menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  toggleMenu(false);
  if (action === 'mixer') invoke('open_settings', { page: 'apps-volume' });
  if (action === 'sound') invoke('open_settings', { page: 'sound' });
  if (action === 'quit') invoke('quit_app');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.outMenu.hidden) toggleOutMenu(false);
  else if (!els.menu.hidden) toggleMenu(false);
  else invoke('close_panel');
});

/* ================= início ================= */
buildModes();
buildThemes();
function setAwake(awake) { document.documentElement.classList.toggle('asleep', !awake); }

listen('panel-shown', () => {
  setAwake(true);
  els.panel.classList.remove('enter');
  void els.panel.offsetWidth; // reinicia a animação
  els.panel.classList.add('enter');
  startPolling();
  fitWindow();
});
listen('panel-hidden', () => { stopPolling(); setAwake(false); toggleMenu(false); toggleOutMenu(false); });
// Lê o estado uma vez (pra janela já nascer com o tamanho certo) e só fica consultando
// se o painel estiver aberto. Iniciado com --hidden, espera o primeiro clique na bandeja.
poll().then(fitWindow);
invoke('panel_visible')
  .then((v) => { setAwake(v); if (v) startPolling(); })
  .catch(() => startPolling());

/* ================= backend de mentira (só no navegador) ================= */
function mockInvoke(cmd, args = {}) {
  const s = (mockInvoke.s ||= {
    device: 'Fones de ouvido (Bluetooth)', device_kind: 'headphones', master: 0.8, master_muted: false, master_peak: 0.5,
    apps: [
      { key: 'chrome', name: 'Chrome', icon: null, volume: 0.3, muted: false, peak: 0.2, system: false },
      { key: 'discord', name: 'Discord', icon: null, volume: 0.55, muted: false, peak: 0.3, system: false },
      { key: 'spotify', name: 'Spotify', icon: null, volume: 0.72, muted: false, peak: 0.4, system: false },
      { key: 'valorant', name: 'Valorant', icon: null, volume: 0.84, muted: false, peak: 0.5, system: false },
      { key: '__system', name: 'Sons do sistema', icon: null, volume: 0.4, muted: false, peak: 0, system: true },
    ],
  });
  const app = s.apps.find((a) => a.key === args.key);
  switch (cmd) {
    case 'get_state': return Promise.resolve(JSON.parse(JSON.stringify(s)));
    case 'set_app_volume': app.volume = args.volume; break;
    case 'set_app_mute': app.muted = args.muted; break;
    case 'set_master_volume': s.master = args.volume; break;
    case 'set_master_mute': s.master_muted = args.muted; break;
    case 'get_autostart': return Promise.resolve(false);
    case 'panel_visible': return Promise.resolve(true);
    case 'list_outputs':
      if (mockInvoke.outputs) return Promise.resolve(mockInvoke.outputs.map((o) => ({ ...o, default: o.name === s.device })));
      return Promise.resolve([
      { id: 'a', name: 'Fones de ouvido (Bluetooth)', kind: 'headphones', default: s.device.startsWith('Fones') },
      { id: 'b', name: 'Alto-falantes (Realtek Audio)', kind: 'speakers', default: s.device.startsWith('Alto') },
      { id: 'c', name: 'LG TV (NVIDIA High Definition Audio)', kind: 'display', default: s.device.startsWith('LG') },
    ]);
    case 'set_output': {
      const real = (mockInvoke.outputs || []).find((o) => o.id === args.id);
      if (real) { s.device = real.name; s.device_kind = real.kind; break; }
      const names = { a: ['Fones de ouvido (Bluetooth)', 'headphones'], b: ['Alto-falantes (Realtek Audio)', 'speakers'], c: ['LG TV (NVIDIA High Definition Audio)', 'display'] };
      [s.device, s.device_kind] = names[args.id];
      break;
    }
  }
  return Promise.resolve();
}
