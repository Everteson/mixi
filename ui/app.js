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
  { id: 'pessego', name: 'Pêssego', bg: '#FFF6EF', accent: '#F4904F', border: '#F3DDCC' },
  { id: 'ceu', name: 'Céu', bg: '#F3F8FF', accent: '#5B9CF0', border: '#DCE7F5' },
  { id: 'noite', name: 'Noite', bg: '#211D33', accent: '#A99BFF', border: '#3A3457', dark: true },
  { id: 'grafite', name: 'Grafite', bg: '#1B1D22', accent: '#5FD3B0', border: '#333842', dark: true },
];
// Tema automático pelo horário: [hora de começo, tema]
const THEME_BY_HOUR = [[6, 'pessego'], [12, 'ceu'], [18, 'algodao'], [21, 'noite']];

// Categorias pelo nome do executável (a "key" que vem do Rust).
const CATEGORIES = {
  music: ['spotify', 'deezer', 'tidal', 'vlc', 'foobar2000', 'aimp', 'musicbee', 'itunes', 'applemusic', 'amazon music', 'youtube music desktop app'],
  chat: ['discord', 'discordptb', 'discordcanary', 'ms-teams', 'teams', 'zoom', 'slack', 'whatsapp', 'telegram', 'skype'],
  browser: ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'arc'],
};

// Ícones que os modos podem usar (os prontos e os criados pela pessoa).
const MODE_ICONS = {
  jogo: '<rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="18" cy="14" r="1" fill="currentColor"/>',
  foco: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  chamada: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  soninho: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  musica: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  filme: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10 8.5v5l4-2.5z"/>',
  fone: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/>',
  estrela: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"/>',
  cafe: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>',
  festa: '<path d="M4 20l5-13 8 8z"/><path d="M14 4l.5 1.5L16 6l-1.5.5L14 8l-.5-1.5L12 6l1.5-.5zM19 9l.4 1.1 1.1.4-1.1.4L19 12l-.4-1.1-1.1-.4 1.1-.4z"/>',
  livro: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/>',
  coracao: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
};

// Modos prontos: volume (0–1) por categoria. "other" = jogos e o resto. mute = categorias silenciadas.
const MODES = [
  { id: 'jogo', label: 'Jogo', master: 0.85, vol: { music: 0.30, chat: 0.70, browser: 0.10, other: 0.90, system: 0.35 }, mute: [], icon: MODE_ICONS.jogo },
  { id: 'foco', label: 'Foco', master: 0.60, vol: { music: 0.45, chat: 0.20, browser: 0.60, other: 0.30, system: 0.30 }, mute: ['other', 'system'], icon: MODE_ICONS.foco },
  { id: 'chamada', label: 'Chamada', master: 0.75, vol: { music: 0.12, chat: 0.95, browser: 0.20, other: 0.25, system: 0.30 }, mute: [], icon: MODE_ICONS.chamada },
  { id: 'soninho', label: 'Soninho', master: 0.30, vol: { music: 0.40, chat: 0.15, browser: 0.25, other: 0.20, system: 0.20 }, mute: ['system'], icon: MODE_ICONS.soninho },
];

// Modos da pessoa (vêm das preferências) e quais estão escondidos do painel.
let modesCfg = { hidden: [], custom: [] };

/** Todos os modos: os prontos + os criados. Os criados têm `custom` com os volumes salvos. */
function allModes() {
  return [
    ...MODES,
    ...modesCfg.custom.map((c) => ({ id: c.id, label: c.name, icon: MODE_ICONS[c.icon] || MODE_ICONS.estrela, custom: c })),
  ];
}
const findMode = (id) => allModes().find((m) => m.id === id);

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
const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const ICON_MIC_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/><path d="M4 4l16 16"/></svg>';
const ICON_CHECK ='<svg class="out-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_BELL ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>';

/* ================= estado ================= */
const $ = (id) => document.getElementById(id);
const els = {
  panel: $('panel'), live: $('liveLabel'), pin: $('pinBtn'), menuBtn: $('menuBtn'), menu: $('menu'),
  autostart: $('autostart'), masterLabel: $('masterLabel'), masterSlider: $('masterSlider'),
  masterMute: $('masterMute'), deviceBtn: $('deviceBtn'), deviceName: $('deviceName'),
  deviceIcon: $('deviceIcon'), outMenu: $('outMenu'), outList: $('outList'),
  micCard: $('micCard'), micSlider: $('micSlider'), micMute: $('micMute'), micPct: $('micPct'),
  micLevel: $('micLevel'), micName: $('micName'),
  hkView: $('hkView'), hkList: $('hkList'), hkEnabled: $('hkEnabled'), hkBack: $('hkBack'),
  hkAdd: $('hkAdd'), hkReset: $('hkReset'),
  routeMenu: $('routeMenu'), routeList: $('routeList'), routeTitle: $('routeTitle'),
  apps: $('apps'), modes: $('modes'), themes: $('themes'), themeAuto: $('themeAuto'), themeMenu: $('themeMenu'),
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

/**
 * Troca o ícone de um botão só quando ele muda de verdade. O painel se redesenha a cada
 * 150 ms; trocar o ícone entre apertar e soltar o mouse fazia o Windows perder o clique.
 */
function setIcon(btn, html) {
  if (btn.dataset.icon === html) return;
  btn.dataset.icon = html;
  btn.innerHTML = html;
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

/* ================= microfone ================= */
const sendMic = latestSender((v) => invoke('set_mic_volume', { volume: v }));

els.micSlider.addEventListener('input', () => {
  if (!mixer || !mixer.mic) return;
  hold('__mic');
  mixer.mic.volume = els.micSlider.value / 100;
  paintMic(mixer.mic);
  sendMic(mixer.mic.volume);
});
els.micCard.addEventListener('wheel', (e) => nudge(e, els.micSlider), { passive: false });

els.micMute.addEventListener('click', () => {
  if (!mixer || !mixer.mic) return;
  mixer.mic.muted = !mixer.mic.muted;
  hold('__mic');
  paintMic(mixer.mic);
  invoke('set_mic_mute', { muted: mixer.mic.muted });
});

function paintMic(mic) {
  const had = !els.micCard.hidden;
  els.micCard.hidden = !mic;
  document.documentElement.classList.toggle('mic-muted', !!(mic && mic.muted));
  if (had !== !!mic) fitWindow();
  if (!mic) return;
  const v = pct(mic.volume);
  els.micSlider.value = v;
  els.micSlider.style.setProperty('--v', v + '%');
  els.micCard.classList.toggle('is-muted', mic.muted);
  els.micPct.textContent = mic.muted ? 'mudo' : v + '%';
  els.micCard.title = mic.name;
  // raiz quadrada: a fala costuma ficar com pico baixo, assim a barrinha mexe de verdade
  els.micLevel.style.width = mic.muted ? '0%' : Math.min(100, Math.round(Math.sqrt(mic.peak) * 100)) + '%';
  setIcon(els.micMute, mic.muted ? ICON_MIC_OFF : ICON_MIC);
  els.micMute.setAttribute('aria-pressed', String(mic.muted));
  els.micMute.setAttribute('aria-label', mic.muted ? 'Ligar o microfone' : 'Mutar o microfone');
}

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
  setIcon(els.masterMute, muted ? ICON_MUTED : ICON_SPEAKER);
  document.documentElement.classList.toggle('sound-muted', muted);
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
        <button class="route" aria-haspopup="true"></button>
      </div>
      <input class="slider" type="range" min="0" max="100" aria-label="Volume: ${esc(app.name)}">
    </div>
    <button class="icon-btn mute" aria-pressed="false"></button>`;
  const r = {
    el: row,
    slider: row.querySelector('.slider'),
    pct: row.querySelector('.pct'),
    mute: row.querySelector('.mute'),
    route: row.querySelector('.route'),
    muted: null,
  };
  if (app.system) r.route.remove(); // os sons do sistema sempre vão pra saída padrão

  r.route.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = mixer && mixer.apps.find((a) => a.key === app.key);
    if (cur) openRouteMenu(cur, row);
  });

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
  paintRoute(r, app);
  if (r.muted !== app.muted) {
    r.muted = app.muted;
    r.mute.innerHTML = app.muted ? ICON_MUTED : ICON_SPEAKER;
    r.mute.setAttribute('aria-pressed', String(app.muted));
    r.mute.setAttribute('aria-label', (app.muted ? 'Reativar som: ' : 'Silenciar: ') + app.name);
  }
}

/* ================= saída por app ================= */
let outputsCache = [];
let routeKey = null; // app com o menu de saída aberto

function refreshOutputs() {
  return invoke('list_outputs').then((o) => { outputsCache = o; return o; }).catch(() => outputsCache);
}

function outputName(id) {
  const o = outputsCache.find((x) => x.id === id);
  return o ? splitDeviceName(o.name)[0] : null;
}

function paintRoute(r, app) {
  if (!r.route.isConnected || app.system) return;
  let cls = '';
  let kind = 'other';
  let title = 'Saída: segue a padrão do Windows';
  if (app.route) {
    kind = app.route.kind;
    cls = app.route.connected ? 'routed' : 'off';
    title = app.route.connected
      ? `Saída: ${splitDeviceName(app.route.name)[0]} (escolhida aqui)`
      : 'A saída escolhida está desligada; tocando na padrão até ela voltar';
  } else if (app.playing_on && mixer && app.playing_on !== mixer.device_id) {
    // o próprio app escolheu outra saída (ex.: Discord com o fone configurado nele)
    const o = outputsCache.find((x) => x.id === app.playing_on);
    kind = o ? o.kind : 'other';
    cls = 'self';
    title = `Tocando em ${outputName(app.playing_on) || 'outra saída'} (escolhido pelo próprio app)`;
  }
  const state = cls + '|' + kind;
  if (r.routeState === state && r.route.title === title) return;
  r.routeState = state;
  r.route.className = 'route' + (cls ? ' ' + cls : '');
  r.route.innerHTML = DEVICE_ICONS[kind] || DEVICE_ICONS.other;
  r.route.title = title;
  r.route.setAttribute('aria-label', `${title}. Clique pra escolher onde ${app.name} toca`);
}

async function openRouteMenu(app, row) {
  if (routeKey === app.key && !els.routeMenu.hidden) return closeRouteMenu();
  toggleMenu(false);
  toggleOutMenu(false);
  routeKey = app.key;
  els.routeTitle.textContent = `Onde ${app.name} toca`;
  const outs = await refreshOutputs();
  const current = app.route ? app.route.id : null;
  const item = (id, icon, main, detail, checked) => `
    <button class="menu-item out-item" role="menuitemradio" aria-checked="${checked}" data-id="${esc(id)}">
      <span class="out-icon">${icon}</span>
      <span class="out-text"><span class="out-name">${esc(main)}</span><span class="out-detail">${esc(detail)}</span></span>
      ${ICON_CHECK}
    </button>`;
  const def = outs.find((o) => o.default);
  let html = item('', ICON_SPEAKER, 'Seguir a padrão', def ? 'agora: ' + splitDeviceName(def.name)[0] : 'a do Windows', !current);
  html += outs.map((o) => {
    const [main, detail] = splitDeviceName(o.name);
    return item(o.id, DEVICE_ICONS[o.kind] || DEVICE_ICONS.other, main, detail || DEVICE_KIND_LABEL[o.kind], o.id === current);
  }).join('');
  if (app.route && !app.route.connected) html += item(app.route.id, DEVICE_ICONS.other, 'Saída escolhida', 'desligada agora', true);
  els.routeList.innerHTML = html;

  // abre logo abaixo da linha do app (ou acima, se não couber)
  els.routeMenu.hidden = false;
  const top = row.offsetTop - els.apps.scrollTop + row.offsetHeight + 4;
  const fitsBelow = top + els.routeMenu.offsetHeight < els.panel.clientHeight - 8;
  els.routeMenu.style.top = (fitsBelow ? top : Math.max(8, row.offsetTop - els.apps.scrollTop - els.routeMenu.offsetHeight - 4)) + 'px';
}

function closeRouteMenu() {
  els.routeMenu.hidden = true;
  routeKey = null;
}

els.routeMenu.addEventListener('click', async (e) => {
  const it = e.target.closest('.out-item');
  if (!it || !routeKey) return;
  const key = routeKey;
  it.classList.add('busy');
  try {
    await invoke('set_app_output', { key, output: it.dataset.id || null });
    for (const b of els.routeList.querySelectorAll('.out-item')) b.setAttribute('aria-checked', String(b === it));
    poll();
    setTimeout(closeRouteMenu, 250);
  } catch (err) {
    it.classList.remove('busy');
    els.live.textContent = 'não consegui trocar a saída desse app';
    console.error(err);
  }
});

/* ================= desenhar o estado ================= */
function render(state) {
  // Enquanto o usuário arrasta, o valor da tela manda (o Rust pode estar um passo atrás).
  if (mixer) {
    if (isHeld('__master')) { state.master = Number(els.masterSlider.value) / 100; state.master_muted = mixer.master_muted; }
    if (isHeld('__mic') && state.mic && mixer.mic) { state.mic.volume = mixer.mic.volume; state.mic.muted = mixer.mic.muted; }
    for (const a of state.apps) {
      if (!isHeld(a.key)) continue;
      const old = mixer.apps.find((o) => o.key === a.key);
      if (old) { a.volume = old.volume; a.muted = old.muted; }
    }
  }
  mixer = state;

  paintMaster(state.master, state.master_muted);
  paintMic(state.mic);
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
/** Desenha os botões de modo do painel (só os visíveis). */
function renderModes() {
  const list = allModes().filter((m) => !modesCfg.hidden.includes(m.id));
  els.modes.innerHTML = list.map((m) => `
    <button class="mode" data-mode="${esc(m.id)}" aria-pressed="false" title="${esc(m.label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg><span>${esc(m.label)}</span>
    </button>`).join('');
  els.modes.hidden = !list.length;
  setMode(activeMode);
  fitWindow();
}

function buildModes() {
  els.modes.addEventListener('click', (e) => {
    const b = e.target.closest('.mode');
    const m = b && findMode(b.dataset.mode);
    if (m) applyMode(m, false);
  });
  renderModes();
}

function loadModes() {
  return invoke('get_modes')
    .then((c) => { modesCfg = { hidden: c.hidden || [], custom: c.custom || [] }; renderModes(); return modesCfg; })
    .catch(() => modesCfg);
}

/** Aplica um modo. `announce`: veio de um atalho, então mostra o aviso flutuante. */
async function applyMode(m, announce) {
  setMode(m.id);
  // estado novo na hora: com o painel fechado, o `mixer` pode estar velho
  const st = await invoke('get_state').catch(() => mixer);
  if (!st) return;
  if (m.custom) {
    // modo da pessoa: volumes exatos de cada app salvo; os outros apps não mudam
    const c = m.custom;
    if (c.master != null) {
      await invoke('set_master_mute', { muted: false });
      await invoke('set_master_volume', { volume: c.master });
    }
    const running = new Set(st.apps.map((a) => a.key));
    await Promise.all(c.apps.filter((a) => running.has(a.key) && !isProtected(a.key)).map((a) => Promise.all([
      invoke('set_app_volume', { key: a.key, volume: a.volume }),
      invoke('set_app_mute', { key: a.key, muted: !!a.muted }),
    ])));
  } else {
    await invoke('set_master_mute', { muted: false });
    await invoke('set_master_volume', { volume: m.master });
    // apps que escutam o som (LEDs, visualizadores…) ficam de fora
    await Promise.all(st.apps.filter((a) => !isProtected(a.key)).map((a) => {
      const cat = category(a);
      return Promise.all([
        invoke('set_app_volume', { key: a.key, volume: m.vol[cat] }),
        invoke('set_app_mute', { key: a.key, muted: m.mute.includes(cat) }),
      ]);
    }));
  }
  holding.clear();
  poll();
  if (announce) {
    invoke('show_osd', { osd: { icon: 'mode', title: 'Modo ' + m.label, detail: 'volumes ajustados', value: null, alert: false } })
      .catch(() => {});
  }
}

/* ================= temas ================= */
// mixi.themeMode: "fixo" | "windows" | "horario"
// mixi.fixedTheme: o escolhido nas bolinhas · mixi.lightTheme / mixi.darkTheme: usados no "windows"
// mixi.theme: o tema aplicado agora (o aviso flutuante lê esse)
const THEME_MODE_INFO = {
  fixo: { label: 'Eu escolho', detail: 'o tema das bolinhas',
    icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/>' },
  windows: { label: 'Seguir o Windows', detail: 'claro ou escuro, igual ao sistema',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>' },
  horario: { label: 'Mudar com o horário', detail: 'Pêssego de manhã, Céu à tarde, Algodão no fim do dia, Noite à noite',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>' },
};
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = localStorage.getItem('mixi.themeMode') || 'fixo';

function themeById(id) { return THEMES.find((x) => x.id === id) || THEMES[0]; }

function themeForHour(h) {
  let pick = THEME_BY_HOUR[THEME_BY_HOUR.length - 1][1]; // antes das 6h: o da noite
  for (const [start, id] of THEME_BY_HOUR) if (h >= start) pick = id;
  return pick;
}

/** Qual tema usar agora, conforme o jeito escolhido. */
function resolveTheme() {
  if (themeMode === 'windows') {
    return darkQuery.matches ? (localStorage.getItem('mixi.darkTheme') || 'noite') : (localStorage.getItem('mixi.lightTheme') || 'algodao');
  }
  if (themeMode === 'horario') return themeForHour(new Date().getHours());
  return localStorage.getItem('mixi.fixedTheme') || localStorage.getItem('mixi.theme') || 'algodao';
}

function applyTheme(id) {
  const t = themeById(id);
  document.documentElement.dataset.theme = t.id;
  localStorage.setItem('mixi.theme', t.id);
  for (const b of els.themes.children) b.setAttribute('aria-pressed', String(b.dataset.theme === t.id));
  const info = THEME_MODE_INFO[themeMode];
  els.themeAuto.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${info.icon}</svg>`;
  els.themeAuto.classList.toggle('on', themeMode !== 'fixo');
  els.themeAuto.title = `Tema: ${t.name} · ${info.label}`;
  els.themeAuto.setAttribute('aria-label', `Jeito de escolher o tema (agora: ${info.label}, ${t.name})`);
}

function refreshTheme() { applyTheme(resolveTheme()); }

function setThemeMode(mode) {
  themeMode = mode;
  localStorage.setItem('mixi.themeMode', mode);
  refreshTheme();
  renderThemeMenu();
}

function renderThemeMenu() {
  els.themeMenu.innerHTML = '<div class="menu-title">Tema</div>' + Object.entries(THEME_MODE_INFO).map(([id, m]) => `
    <button class="menu-item out-item" role="menuitemradio" aria-checked="${id === themeMode}" data-mode="${id}">
      <span class="out-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg></span>
      <span class="out-text"><span class="out-name">${m.label}</span><span class="out-detail">${m.detail}</span></span>
      ${ICON_CHECK}
    </button>`).join('');
}

function toggleThemeMenu(open = els.themeMenu.hidden) {
  els.themeMenu.hidden = !open;
  els.themeAuto.setAttribute('aria-expanded', String(open));
  if (open) renderThemeMenu();
}

function buildThemes() {
  els.themes.innerHTML = THEMES.map((t) => `
    <button class="swatch" data-theme="${t.id}" aria-label="Tema ${t.name}" title="${t.name}" aria-pressed="false">
      <span style="background:${t.bg}; border:1px solid ${t.border}; --sw-accent:${t.accent}"></span>
    </button>`).join('');
  els.themes.addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    const t = themeById(b.dataset.theme);
    // escolher uma bolinha fixa o tema, e vira a preferência clara/escura pro "seguir o Windows"
    localStorage.setItem('mixi.fixedTheme', t.id);
    localStorage.setItem(t.dark ? 'mixi.darkTheme' : 'mixi.lightTheme', t.id);
    setThemeMode('fixo');
  });
  els.themeAuto.addEventListener('click', (e) => { e.stopPropagation(); toggleThemeMenu(); });
  els.themeMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) { setThemeMode(b.dataset.mode); setTimeout(() => toggleThemeMenu(false), 200); }
  });
  darkQuery.addEventListener('change', refreshTheme);   // Windows mudou de claro pra escuro
  setInterval(() => { if (themeMode === 'horario') refreshTheme(); }, 60 * 1000);
  refreshTheme();
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
  if (!open) return;
  invoke('get_autostart').then((on) => { els.autostart.checked = on; }).catch(() => {});
}

/* ================= versão nova ================= */
// A única conexão do Mixi com a internet: perguntar ao GitHub qual é a última versão.
const RELEASES_API = 'https://api.github.com/repos/Everteson/mixi/releases/latest';
const UPDATE_EVERY = 24 * 60 * 60 * 1000;
const els4 = {
  bar: $('updateBar'), version: $('updateVersion'), get: $('updateGet'), later: $('updateLater'),
  toggle: $('checkUpdates'), line: $('versionLine'),
};
let appVersion = '0.0.0';
let latest = null; // { version, url }

/** a > b, comparando "1.2.3" número a número */
function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

const updatesOn = () => localStorage.getItem('mixi.checkUpdates') !== 'false';

function showUpdate() {
  const skip = localStorage.getItem('mixi.skipVersion');
  const show = !!latest && updatesOn() && latest.version !== skip && isNewer(latest.version, appVersion);
  els4.bar.hidden = !show;
  if (show) els4.version.textContent = latest.version;
  fitWindow();
}

async function checkUpdates() {
  if (!updatesOn() || !TAURI) return;
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return; // 404 = ainda não tem versão publicada; sem internet = tenta amanhã
    const rel = await r.json();
    const v = String(rel.tag_name || '').replace(/^v/, '');
    if (/^\d+\.\d+\.\d+$/.test(v)) latest = { version: v, url: rel.html_url };
    showUpdate();
  } catch { /* sem internet: tudo bem */ }
}

els4.get.addEventListener('click', () => {
  if (latest) invoke('open_release_page', { url: latest.url }).catch(() => {});
});
els4.later.addEventListener('click', () => {
  if (latest) localStorage.setItem('mixi.skipVersion', latest.version);
  showUpdate();
});
els4.toggle.addEventListener('change', () => {
  localStorage.setItem('mixi.checkUpdates', String(els4.toggle.checked));
  if (els4.toggle.checked) checkUpdates(); else showUpdate();
});
invoke('app_version').then((v) => {
  appVersion = v;
  els4.line.textContent = 'Mixi ' + v;
  els4.toggle.checked = updatesOn();
  checkUpdates();
  setInterval(checkUpdates, UPDATE_EVERY);
}).catch(() => {});

/* ================= tela Modos ================= */
const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
const CAT_LABEL = { music: 'música', chat: 'chat', browser: 'navegador', other: 'jogos e outros', system: 'sistema' };
const els3 = {
  view: $('modesView'), back: $('modesBack'), list: $('modeList'), form: $('modeForm'), title: $('mfTitle'),
  name: $('mfName'), icons: $('mfIcons'), master: $('mfMaster'), masterLabel: $('mfMasterLabel'), apps: $('mfApps'),
  nowRow: $('mfNowRow'), now: $('mfNow'), save: $('mfSave'), cancel: $('mfCancel'), add: $('modeNew'),
};
let editing = null; // { id (null = novo), icon, saved, rows: [...] }

function modeSummary(m) {
  const vol = (v, muted) => (muted ? 'mudo' : pct(v) + '%');
  if (m.custom) {
    const c = m.custom;
    const parts = [];
    if (c.master != null) parts.push('geral ' + vol(c.master));
    c.apps.forEach((a) => parts.push((a.name || appName(a.key)) + ' ' + vol(a.volume, a.muted)));
    return parts.join(' · ') || 'não mexe em nenhum app';
  }
  return 'geral ' + vol(m.master) + ' · ' + Object.entries(m.vol).map(([k, v]) => CAT_LABEL[k] + ' ' + vol(v, m.mute.includes(k))).join(' · ');
}

function renderModesView() {
  els3.list.innerHTML = allModes().map((m) => {
    const hidden = modesCfg.hidden.includes(m.id);
    return `
      <div class="mode-item${hidden ? ' hidden-mode' : ''}">
        <span class="mode-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg></span>
        <div class="auto-text">
          <div class="auto-title">${esc(m.label)}${m.custom ? '' : '<span class="tag">pronto</span>'}</div>
          <div class="auto-desc">${esc(modeSummary(m))}</div>
        </div>
        ${m.custom ? `
          <button class="icon-btn edit" data-id="${esc(m.id)}" aria-label="Editar ${esc(m.label)}">${ICON_EDIT}</button>
          <button class="icon-btn del" data-id="${esc(m.id)}" aria-label="Apagar ${esc(m.label)}">${ICON_TRASH}</button>` : ''}
        <label class="switch switch-only" title="Mostrar no painel">
          <input type="checkbox" data-show="${esc(m.id)}"${hidden ? '' : ' checked'} aria-label="Mostrar ${esc(m.label)} no painel">
          <span class="knob" aria-hidden="true"></span>
        </label>
      </div>`;
  }).join('');
  fitWindow();
}

async function saveModes() {
  try {
    const c = await invoke('set_modes', { modes: modesCfg });
    modesCfg = { hidden: c.hidden || [], custom: c.custom || [] };
  } catch (e) { console.error(e); }
  renderModes();
  renderModesView();
}

async function openModes() {
  toggleMenu(false);
  toggleOutMenu(false);
  els.panel.classList.add('editing');
  els3.view.hidden = false;
  els3.view.classList.add('open');
  await loadModes();
  renderModesView();
}

function closeModes() {
  closeForm();
  els.panel.classList.remove('editing');
  els3.view.hidden = true;
  els3.view.classList.remove('open');
  fitWindow();
}

/** Abre o formulário: `mode` = um modo da pessoa (editar) ou null (novo, com os volumes de agora). */
function openForm(mode) {
  const c = mode && mode.custom;
  editing = { id: c ? c.id : null, icon: c ? c.icon : 'estrela', saved: c || null };
  els3.title.textContent = c ? `Editar "${c.name}"` : 'Novo modo com os volumes de agora';
  els3.name.value = c ? c.name : '';
  els3.nowRow.hidden = !c;
  els3.now.checked = !c;
  els3.icons.innerHTML = Object.entries(MODE_ICONS).map(([k, svg]) => `
    <button role="radio" aria-checked="${k === editing.icon}" data-icon="${k}" aria-label="Ícone ${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></button>`).join('');
  els3.master.checked = c ? c.master != null : true;
  // apps: os que estão com som agora + os salvos que estão fechados (protegidos ficam de fora)
  const rows = new Map();
  (mixer ? mixer.apps : []).filter((a) => !isProtected(a.key)).forEach((a) => {
    rows.set(a.key, { key: a.key, name: a.name, volume: a.volume, muted: a.muted, live: true,
      on: c ? c.apps.some((x) => x.key === a.key) : !a.system });
  });
  if (c) {
    c.apps.forEach((a) => {
      if (rows.has(a.key)) rows.get(a.key).saved = a;
      else rows.set(a.key, { ...a, live: false, on: true, saved: a });
    });
  }
  editing.rows = [...rows.values()];
  renderForm();
  els3.form.hidden = false;
  els3.add.hidden = true;
  els3.name.focus();
  fitWindow();
}

/** O valor que vai ser salvo pra uma linha: o de agora ou o já salvo. */
const formValue = (r) => (!els3.now.checked && r.saved ? r.saved : r);

function renderForm() {
  const old = editing.saved;
  const master = !els3.now.checked && old && old.master != null ? old.master : (mixer ? mixer.master : 1);
  els3.masterLabel.textContent = `Volume geral (${pct(master)}%)`;
  els3.apps.innerHTML = editing.rows.map((r, i) => {
    const v = formValue(r);
    return `
      <label class="auto-check">
        <input type="checkbox" data-i="${i}"${r.on ? ' checked' : ''}>
        <span>${esc(r.name || appName(r.key))}</span>
        <span class="val">${v.muted ? 'mudo' : pct(v.volume) + '%'}${r.live ? '' : ' <span class="off">(fechado)</span>'}</span>
      </label>`;
  }).join('') || '<div class="rule-empty">Nenhum app com som agora. Dê play em algo e volte aqui.</div>';
}

function closeForm() {
  editing = null;
  els3.form.hidden = true;
  els3.add.hidden = false;
  fitWindow();
}

async function saveForm() {
  const name = els3.name.value.trim();
  if (!name) {
    els3.name.placeholder = 'Dê um nome pro modo';
    els3.name.focus();
    return;
  }
  const old = editing.saved;
  const apps = editing.rows.filter((r) => r.on).map((r) => {
    const v = formValue(r);
    return { key: r.key, name: r.name || appName(r.key), volume: v.volume, muted: !!v.muted };
  });
  const master = !els3.master.checked ? null
    : (!els3.now.checked && old && old.master != null ? old.master : (mixer ? mixer.master : 1));
  const mode = { id: editing.id || 'meu-' + Date.now().toString(36), name, icon: editing.icon, master, apps };
  const i = modesCfg.custom.findIndex((c) => c.id === mode.id);
  if (i >= 0) modesCfg.custom[i] = mode; else modesCfg.custom.push(mode);
  closeForm();
  await saveModes();
}

els.menu.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="modes"]')) openModes();
});
els3.back.addEventListener('click', closeModes);
els3.add.addEventListener('click', () => openForm(null));
els3.cancel.addEventListener('click', closeForm);
els3.save.addEventListener('click', saveForm);
els3.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveForm(); });
els3.now.addEventListener('change', renderForm);
els3.icons.addEventListener('click', (e) => {
  const b = e.target.closest('[data-icon]');
  if (!b || !editing) return;
  editing.icon = b.dataset.icon;
  for (const x of els3.icons.children) x.setAttribute('aria-checked', String(x === b));
});
els3.apps.addEventListener('change', (e) => {
  const r = editing && editing.rows[Number(e.target.dataset.i)];
  if (r) r.on = e.target.checked;
});
els3.list.addEventListener('click', (e) => {
  const edit = e.target.closest('.edit');
  if (edit) return openForm(findMode(edit.dataset.id));
  const del = e.target.closest('.del');
  if (del) {
    modesCfg.custom = modesCfg.custom.filter((c) => c.id !== del.dataset.id);
    modesCfg.hidden = modesCfg.hidden.filter((id) => id !== del.dataset.id);
    if (activeMode === del.dataset.id) setMode(null);
    saveModes();
  }
});
els3.list.addEventListener('change', (e) => {
  const id = e.target.dataset.show;
  if (!id) return;
  modesCfg.hidden = e.target.checked ? modesCfg.hidden.filter((x) => x !== id) : [...modesCfg.hidden, id];
  saveModes();
});

/* ================= automático ================= */
const AUTO_DEFAULT = {
  ducking: { enabled: false, level: 0.3, what: 'music', triggers: [], targets: [], everything: false },
  auto_modes: { enabled: false, restore: true, rules: [] },
  protected: ['halo-studio', 'wallpaper32', 'wallpaper64', 'nvidia broadcast', 'signalrgb', 'openrgb', 'obs64', 'obs32'],
};
// nomes bonitos pros apps conhecidos que podem não estar tocando agora
const APP_NAMES = {
  'halo-studio': 'Halo Studio', wallpaper32: 'Wallpaper Engine (32)', wallpaper64: 'Wallpaper Engine',
  'nvidia broadcast': 'NVIDIA Broadcast', signalrgb: 'SignalRGB', openrgb: 'OpenRGB', obs64: 'OBS', obs32: 'OBS (32)',
  voicemeeter: 'Voicemeeter', voicemeeterpro: 'Voicemeeter Banana', voicemeeter8: 'Voicemeeter Potato',
  voicemeeter8x64: 'Voicemeeter Potato', audiorelay: 'AudioRelay', equalizerapo: 'Equalizer APO', lghub: 'Logitech G HUB', icue: 'iCUE',
};
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let autoCfg = AUTO_DEFAULT;
const els2 = {
  view: $('autoView'), back: $('autoBack'), duckOn: $('duckOn'), duckBody: $('duckBody'), duckLevel: $('duckLevel'),
  duckLevelLabel: $('duckLevelLabel'), duckWhat: $('duckWhat'), autoOn: $('autoOn'), autoBody: $('autoBody'),
  ruleList: $('ruleList'), ruleAdd: $('ruleAdd'), autoRestore: $('autoRestore'), protList: $('protList'),
  protInput: $('protInput'), protAdd: $('protAdd'), appChoices: $('appChoices'),
};

function isProtected(key) { return (autoCfg.protected || []).includes(key); }

function appName(key) {
  const a = mixer && mixer.apps.find((x) => x.key === key);
  if (a) return a.name;
  if (APP_NAMES[key]) return APP_NAMES[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

/** Texto digitado (nome do app ou do .exe) -> key no formato do Rust. */
function toKey(text) {
  const t = text.trim();
  if (!t) return '';
  const byName = mixer && mixer.apps.find((a) => a.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.key;
  return t.toLowerCase().replace(/\.exe$/, '');
}

function loadAutomation() {
  return invoke('get_automation').then((c) => { autoCfg = c; return c; }).catch(() => autoCfg);
}

async function saveAutomation() {
  const d = autoCfg.ducking;
  // quem fala = apps de chamada; quem abaixa sai da escolha "O que abaixa"
  d.triggers = CATEGORIES.chat;
  d.everything = d.what === 'all';
  d.targets = d.what === 'music-browser' ? [...CATEGORIES.music, ...CATEGORIES.browser] : d.what === 'all' ? [] : CATEGORIES.music;
  autoCfg.auto_modes.rules = autoCfg.auto_modes.rules.filter((r) => r.app);
  try {
    autoCfg = await invoke('set_automation', { ducking: d, autoModes: autoCfg.auto_modes, protected: autoCfg.protected });
  } catch (e) { console.error(e); }
}

function renderAuto() {
  const { ducking: d, auto_modes: am } = autoCfg;
  els2.duckOn.checked = d.enabled;
  els2.duckBody.classList.toggle('off', !d.enabled);
  els2.duckLevel.value = Math.round(d.level * 100);
  els2.duckLevel.style.setProperty('--v', ((d.level * 100 - 5) / 75 * 100) + '%');
  els2.duckLevelLabel.textContent = Math.round(d.level * 100) + '%';
  els2.duckWhat.value = d.what || 'music';
  els2.autoOn.checked = am.enabled;
  els2.autoBody.classList.toggle('off', !am.enabled);
  els2.autoRestore.checked = am.restore;

  const modeOpts = (sel) => allModes().map((m) => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>Modo ${esc(m.label)}</option>`).join('');
  els2.ruleList.innerHTML = am.rules.map((r, i) => `
    <div class="rule" data-i="${i}">
      <input class="auto-input rule-app" list="appChoices" value="${esc(r.app ? appName(r.app) : '')}" placeholder="app (ex.: Valorant)" aria-label="App da regra" data-i="${i}">
      <span class="arrow" aria-hidden="true">→</span>
      <select class="rule-mode" data-i="${i}" aria-label="Modo da regra">${modeOpts(r.mode)}</select>
      <button class="icon-btn del" data-i="${i}" aria-label="Apagar regra">${ICON_TRASH}</button>
    </div>`).join('') || '<div class="rule-empty">Nenhuma regra ainda.</div>';

  els2.protList.innerHTML = autoCfg.protected.map((k) => `
    <span class="chip">${esc(appName(k))}<button data-key="${esc(k)}" aria-label="Deixar o Mixi mexer em ${esc(appName(k))}">${ICON_X}</button></span>`).join('')
    || '<div class="rule-empty">Nenhum. Os modos mexem em todos os apps.</div>';

  // sugestões: apps com som agora + os conhecidos
  const opts = new Map();
  (mixer ? mixer.apps : []).filter((a) => !a.system).forEach((a) => opts.set(a.key, a.name));
  Object.entries(APP_NAMES).forEach(([k, n]) => { if (!opts.has(k)) opts.set(k, n); });
  els2.appChoices.innerHTML = [...opts.values()].map((n) => `<option value="${esc(n)}"></option>`).join('');
  fitWindow();
}

async function openAuto() {
  toggleMenu(false);
  toggleOutMenu(false);
  els.panel.classList.add('editing');
  els2.view.hidden = false;
  els2.view.classList.add('open');
  await loadAutomation();
  renderAuto();
}

function closeAuto() {
  els.panel.classList.remove('editing');
  els2.view.hidden = true;
  els2.view.classList.remove('open');
  fitWindow();
}

els.menu.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="auto"]')) openAuto();
});
els2.back.addEventListener('click', closeAuto);
els2.duckOn.addEventListener('change', () => { autoCfg.ducking.enabled = els2.duckOn.checked; renderAuto(); saveAutomation(); });
els2.duckLevel.addEventListener('input', () => {
  autoCfg.ducking.level = els2.duckLevel.value / 100;
  els2.duckLevelLabel.textContent = els2.duckLevel.value + '%';
  els2.duckLevel.style.setProperty('--v', ((els2.duckLevel.value - 5) / 75 * 100) + '%');
});
els2.duckLevel.addEventListener('change', saveAutomation);
els2.duckWhat.addEventListener('change', () => { autoCfg.ducking.what = els2.duckWhat.value; saveAutomation(); });
els2.autoOn.addEventListener('change', () => { autoCfg.auto_modes.enabled = els2.autoOn.checked; renderAuto(); saveAutomation(); });
els2.autoRestore.addEventListener('change', () => { autoCfg.auto_modes.restore = els2.autoRestore.checked; saveAutomation(); });
els2.ruleAdd.addEventListener('click', () => {
  autoCfg.auto_modes.rules.push({ app: '', mode: 'jogo' });
  renderAuto();
  const inputs = els2.ruleList.querySelectorAll('.rule-app');
  inputs[inputs.length - 1].focus();
});
els2.ruleList.addEventListener('change', (e) => {
  const i = Number(e.target.dataset.i);
  const r = autoCfg.auto_modes.rules[i];
  if (!r) return;
  if (e.target.classList.contains('rule-app')) r.app = toKey(e.target.value);
  if (e.target.classList.contains('rule-mode')) r.mode = e.target.value;
  if (r.app) saveAutomation();
});
els2.ruleList.addEventListener('click', (e) => {
  const del = e.target.closest('.del');
  if (!del) return;
  autoCfg.auto_modes.rules.splice(Number(del.dataset.i), 1);
  renderAuto();
  saveAutomation();
});
function addProtected() {
  const k = toKey(els2.protInput.value);
  if (!k) return;
  if (!autoCfg.protected.includes(k)) autoCfg.protected.push(k);
  els2.protInput.value = '';
  renderAuto();
  saveAutomation();
}
els2.protAdd.addEventListener('click', addProtected);
els2.protInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProtected(); });
els2.protList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-key]');
  if (!b) return;
  autoCfg.protected = autoCfg.protected.filter((k) => k !== b.dataset.key);
  renderAuto();
  saveAutomation();
});

// Modo automático: o Rust avisa quando um app de uma regra abre ou fecha.
let autoActive = new Set();
let autoSnapshot = null;

async function takeSnapshot() {
  const st = await invoke('get_state');
  return { master: st.master, master_muted: st.master_muted, apps: st.apps.map((a) => ({ key: a.key, volume: a.volume, muted: a.muted })) };
}

async function restoreSnapshot(snap) {
  await invoke('set_master_volume', { volume: snap.master });
  await invoke('set_master_mute', { muted: snap.master_muted });
  await Promise.all(snap.apps.filter((a) => !isProtected(a.key)).map((a) => Promise.all([
    invoke('set_app_volume', { key: a.key, volume: a.volume }),
    invoke('set_app_mute', { key: a.key, muted: a.muted }),
  ])));
  setMode(null);
  holding.clear();
  poll();
}

const osd = (title, detail) => invoke('show_osd', { osd: { icon: 'mode', title, detail, value: null, alert: false } }).catch(() => {});

listen('auto-mode', ({ payload }) => onAutoMode(payload));

/** p = { app, mode, started, restore }, mandado pelo automation.rs */
async function onAutoMode(p) {
  const m = findMode(p.mode);
  if (p.started) {
    if (!m) return;
    if (!autoActive.size) autoSnapshot = await takeSnapshot().catch(() => null);
    autoActive.add(p.app);
    await applyMode(m, false);
    osd('Modo ' + m.label, appName(p.app) + ' abriu');
  } else {
    autoActive.delete(p.app);
    if (!autoActive.size && autoSnapshot && p.restore) {
      await restoreSnapshot(autoSnapshot);
      osd('Volumes de volta', appName(p.app) + ' fechou');
    }
    if (!autoActive.size) autoSnapshot = null;
  }
}

/* ================= editor de atalhos ================= */
// Os ids batem com os do hotkeys.rs. `target`: o que mais a ação precisa escolher.
const HK_ACTIONS = [
  { id: 'mic-mute', label: 'Mudo do microfone' },
  { id: 'focus-up', label: 'Aumentar o app na tela' },
  { id: 'focus-down', label: 'Diminuir o app na tela' },
  { id: 'focus-mute', label: 'Mudo do app na tela' },
  { id: 'app-up', label: 'Aumentar um app…', target: 'app' },
  { id: 'app-down', label: 'Diminuir um app…', target: 'app' },
  { id: 'app-mute', label: 'Mudo de um app…', target: 'app' },
  { id: 'master-up', label: 'Aumentar o volume geral' },
  { id: 'master-down', label: 'Diminuir o volume geral' },
  { id: 'master-mute', label: 'Mudo de tudo' },
  { id: 'next-output', label: 'Próxima saída de áudio' },
  { id: 'output', label: 'Tocar numa saída…', target: 'output' },
  { id: 'mode', label: 'Ativar um modo…', target: 'mode' },
  { id: 'open-panel', label: 'Abrir o Mixi' },
];
const HK_STATUS = {
  ok: '',
  desligado: '',
  ocupado: 'Outro programa já usa essa combinação.',
  repetido: 'Repetido: outro atalho daqui já usa essas teclas.',
  'sem teclas': 'Clique nas teclas pra gravar uma combinação.',
};
const KEY_NAMES = {
  PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Espaço', Minus: '-', Equal: '=', Backquote: '\'', BracketLeft: '´', BracketRight: '[',
  Backslash: ']', Semicolon: 'Ç', Quote: '~', Comma: ',', Period: '.', Slash: ';', IntlRo: '/',
  Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', Enter: 'Enter', Tab: 'Tab',
  Backspace: '⌫', PrintScreen: 'PrtSc', Pause: 'Pause', ScrollLock: 'ScrLk',
};
const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>';

let hk = { enabled: true, list: [] };
let hkOutputs = [];
let recording = null;

function keyLabel(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return KEY_NAMES[code] || code;
}

function keysHtml(keys) {
  if (!keys) return '<span class="ph">clique e aperte as teclas</span>';
  return keys.split('+').map((k) => `<kbd>${esc(['Ctrl', 'Alt', 'Shift', 'Win'].includes(k) ? k : keyLabel(k))}</kbd>`)
    .join('<span class="plus">+</span>');
}

function targetOptions(kind, current, label) {
  let opts = [];
  if (kind === 'app') opts = (mixer ? mixer.apps : []).map((a) => ({ v: a.key, t: a.name }));
  if (kind === 'output') opts = hkOutputs.map((o) => ({ v: o.id, t: splitDeviceName(o.name)[0] }));
  if (kind === 'mode') opts = allModes().map((m) => ({ v: m.id, t: 'Modo ' + m.label }));
  // o alvo salvo pode não estar ligado agora (app fechado, fone desconectado): mantém na lista
  if (current && !opts.some((o) => o.v === current)) opts.unshift({ v: current, t: (label || current) + ' (fora agora)' });
  if (!current) opts.unshift({ v: '', t: kind === 'app' ? 'Escolha o app…' : kind === 'output' ? 'Escolha a saída…' : 'Escolha o modo…' });
  return opts.map((o) => `<option value="${esc(o.v)}"${o.v === current ? ' selected' : ''}>${esc(o.t)}</option>`).join('');
}

function renderHk() {
  els.hkEnabled.checked = hk.enabled;
  els.hkList.classList.toggle('off', !hk.enabled);
  els.hkList.innerHTML = hk.list.map((d, i) => {
    const act = HK_ACTIONS.find((a) => a.id === d.action) || HK_ACTIONS[0];
    const isRec = recording && recording.i === i;
    let status = isRec ? 'Aperte as teclas agora…' : (HK_STATUS[d.status] ?? d.status ?? '');
    if (!isRec && act.target && !d.target) status = 'Escolha ' + (act.target === 'app' ? 'o app.' : act.target === 'output' ? 'a saída.' : 'o modo.');
    return `
      <div class="hk-card${status && !isRec ? ' bad' : ''}" data-i="${i}">
        <div class="hk-row1">
          <button class="keys${isRec ? ' recording' : ''}" data-i="${i}" aria-label="Teclas do atalho, clique pra gravar">${
            isRec ? '<span class="ph">aperte as teclas…</span>' : keysHtml(d.keys)}</button>
          <button class="icon-btn del" data-i="${i}" aria-label="Apagar este atalho">${ICON_TRASH}</button>
        </div>
        <div class="hk-row2">
          <select class="act" data-i="${i}" aria-label="O que o atalho faz">${
            HK_ACTIONS.map((a) => `<option value="${a.id}"${a.id === act.id ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>
          ${act.target ? `<select class="tgt" data-i="${i}" aria-label="Em quem">${targetOptions(act.target, d.target, d.label)}</select>` : ''}
        </div>
        ${status ? `<div class="hk-status">${esc(status)}</div>` : ''}
      </div>`;
  }).join('') || '<div class="empty">Nenhum atalho. Crie o primeiro aqui embaixo.</div>';
  fitWindow();
}

async function saveHk() {
  const list = hk.list.map(({ keys, action, target, label }) => ({ keys, action, target: target || null, label: label || null }));
  try { hk = await invoke('set_hotkeys', { list }); } catch (e) { console.error(e); }
  renderHk();
}

async function openHotkeys() {
  toggleMenu(false);
  toggleOutMenu(false);
  els.panel.classList.add('editing');
  els.hkView.hidden = false;
  els.hkView.classList.add('open');
  [hk, hkOutputs] = await Promise.all([
    invoke('get_hotkeys'),
    invoke('list_outputs').catch(() => []),
  ]);
  renderHk();
}

function closeHotkeys() {
  if (recording) recording.cancel();
  els.panel.classList.remove('editing');
  els.hkView.hidden = true;
  els.hkView.classList.remove('open');
  fitWindow();
}

async function record(i) {
  if (recording) recording.cancel();
  await invoke('pause_hotkeys', { paused: true }); // senão a combinação dispara em vez de ser gravada
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Win');
    const btn = els.hkList.querySelector(`.keys[data-i="${i}"]`);
    if (['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'].includes(e.key)) {
      if (btn) btn.innerHTML = keysHtml(mods.join('+')) + '<span class="plus">+</span><span class="ph">…</span>';
      return;
    }
    if (e.key === 'Escape' && !mods.length) return finish(null);
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mods.length) return finish('');
    const isF = /^F\d{1,2}$/.test(e.code);
    if (!mods.some((m) => m !== 'Shift') && !isF) {
      if (btn) btn.innerHTML = '<span class="ph">use Ctrl, Alt ou Win junto</span>';
      return;
    }
    finish([...mods, e.code].join('+'));
  };
  const finish = (keys) => {
    window.removeEventListener('keydown', onKey, true);
    recording = null;
    if (keys !== null) hk.list[i].keys = keys;
    saveHk(); // salva e registra tudo de novo (isso também "despausa" os atalhos)
  };
  recording = { i, cancel: () => finish(null) };
  window.addEventListener('keydown', onKey, true);
  renderHk();
}

els.menu.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="hotkeys"]')) openHotkeys();
});
els.hkBack.addEventListener('click', closeHotkeys);
els.hkEnabled.addEventListener('change', async () => {
  hk = await invoke('set_hotkeys_enabled', { enabled: els.hkEnabled.checked });
  renderHk();
});
els.hkAdd.addEventListener('click', () => {
  hk.list.push({ keys: '', action: 'mic-mute', target: null, label: null, status: 'sem teclas' });
  record(hk.list.length - 1);
  requestAnimationFrame(() => { els.hkList.scrollTop = els.hkList.scrollHeight; });
});
els.hkReset.addEventListener('click', async () => {
  if (recording) recording.cancel();
  hk = await invoke('reset_hotkeys');
  renderHk();
});
els.hkList.addEventListener('click', (e) => {
  const keys = e.target.closest('.keys');
  if (keys) return record(Number(keys.dataset.i));
  const del = e.target.closest('.del');
  if (del) {
    if (recording) recording.cancel();
    hk.list.splice(Number(del.dataset.i), 1);
    saveHk();
  }
});
els.hkList.addEventListener('change', (e) => {
  const sel = e.target;
  const d = hk.list[Number(sel.dataset.i)];
  if (!d) return;
  if (sel.classList.contains('act')) {
    const before = HK_ACTIONS.find((a) => a.id === d.action);
    d.action = sel.value;
    const after = HK_ACTIONS.find((a) => a.id === d.action);
    // trocou o tipo de alvo (ex.: de app pra saída): o alvo antigo não serve mais
    if (!after.target || !before || before.target !== after.target) { d.target = null; d.label = null; }
  } else if (sel.classList.contains('tgt')) {
    d.target = sel.value || null;
    d.label = sel.value ? sel.selectedOptions[0].textContent.replace(/ \(fora agora\)$/, '') : null;
  }
  saveHk();
});
els.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => {
  if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false);
  if (!els.outMenu.hidden && !els.outMenu.contains(e.target)) toggleOutMenu(false);
  if (!els.routeMenu.hidden && !els.routeMenu.contains(e.target)) closeRouteMenu();
  if (!els.themeMenu.hidden && !els.themeMenu.contains(e.target)) toggleThemeMenu(false);
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
  if (!els.routeMenu.hidden) closeRouteMenu();
  else if (!els.themeMenu.hidden) toggleThemeMenu(false);
  else if (!els.outMenu.hidden) toggleOutMenu(false);
  else if (!els.menu.hidden) toggleMenu(false);
  else if (!els.hkView.hidden) closeHotkeys();
  else if (!els2.view.hidden) closeAuto();
  else if (!els3.view.hidden) { if (editing) closeForm(); else closeModes(); }
  else invoke('close_panel');
});

/* ================= início ================= */
buildModes();
buildThemes();
function setAwake(awake) { document.documentElement.classList.toggle('asleep', !awake); }

listen('panel-shown', () => {
  setAwake(true);
  refreshOutputs();
  els.panel.classList.remove('enter');
  void els.panel.offsetWidth; // reinicia a animação
  els.panel.classList.add('enter');
  startPolling();
  fitWindow();
});
listen('panel-hidden', () => {
  stopPolling();
  setAwake(false);
  toggleMenu(false);
  toggleOutMenu(false);
  closeRouteMenu();
  toggleThemeMenu(false);
  if (recording) recording.cancel(); // painel sumiu no meio da gravação: volta os atalhos
});
// Um atalho de "Ativar um modo" chegou pelo Rust (os modos moram aqui na interface).
listen('apply-mode', ({ payload }) => {
  const m = findMode(payload);
  if (m) applyMode(m, true);
});
// Lê o estado uma vez (pra janela já nascer com o tamanho certo) e só fica consultando
// se o painel estiver aberto. Iniciado com --hidden, espera o primeiro clique na bandeja.
refreshOutputs();
loadAutomation(); // os modos precisam saber quais apps são protegidos
loadModes();
poll().then(fitWindow);
invoke('panel_visible')
  .then((v) => { setAwake(v); if (v) startPolling(); })
  .catch(() => startPolling());

/* ================= backend de mentira (só no navegador) ================= */
function mockInvoke(cmd, args = {}) {
  const s = (mockInvoke.s ||= {
    mic: { name: 'Microfone (USB Audio Device)', volume: 0.7, muted: false, peak: 0.08 },
    device: 'Fones de ouvido (Bluetooth)', device_kind: 'headphones', device_id: 'a', master: 0.8, master_muted: false, master_peak: 0.5,
    apps: [
      { key: 'chrome', name: 'Chrome', icon: null, volume: 0.3, muted: false, peak: 0.2, system: false },
      { key: 'discord', name: 'Discord', icon: null, volume: 0.55, muted: false, peak: 0.3, system: false },
      { key: 'spotify', name: 'Spotify', icon: null, volume: 0.72, muted: false, peak: 0.4, system: false, playing_on: 'b', route: { id: 'b', name: 'Alto-falantes (Realtek Audio)', kind: 'speakers', connected: true } },
      { key: 'valorant', name: 'Valorant', icon: null, volume: 0.84, muted: false, peak: 0.5, system: false, playing_on: 'c', route: null },
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
    case 'set_mic_volume': s.mic.volume = args.volume; break;
    case 'set_mic_mute': s.mic.muted = args.muted; break;
    case 'get_hotkeys':
    case 'set_hotkeys':
    case 'set_hotkeys_enabled':
    case 'reset_hotkeys': {
      // imita o Rust: valida as teclas, acha repetidos e finge que Ctrl+Alt+KeyV está ocupado
      const defaults = () => [
        { keys: 'Ctrl+Alt+KeyM', action: 'mic-mute' }, { keys: 'Ctrl+Alt+PageUp', action: 'focus-up' },
        { keys: 'Ctrl+Alt+PageDown', action: 'focus-down' }, { keys: 'Ctrl+Alt+KeyO', action: 'next-output' },
        { keys: 'Ctrl+Alt+KeyV', action: 'open-panel' },
      ].map((d) => ({ ...d, target: null, label: null }));
      if (!mockInvoke.hk) mockInvoke.hk = { enabled: true, list: defaults() };
      if (cmd === 'set_hotkeys') mockInvoke.hk.list = args.list;
      if (cmd === 'set_hotkeys_enabled') mockInvoke.hk.enabled = args.enabled;
      if (cmd === 'reset_hotkeys') mockInvoke.hk.list = defaults();
      const seen = new Set();
      const list = mockInvoke.hk.list.map((d) => {
        let status = 'ok';
        if (!mockInvoke.hk.enabled) status = 'desligado';
        else if (!d.keys) status = 'sem teclas';
        else if (seen.has(d.keys)) status = 'repetido';
        else if (d.keys === 'Ctrl+Alt+KeyV') status = 'ocupado';
        seen.add(d.keys);
        return { ...d, status };
      });
      return Promise.resolve({ enabled: mockInvoke.hk.enabled, list });
    }
    case 'pause_hotkeys': case 'show_osd': return Promise.resolve();
    case 'app_version': return Promise.resolve('0.2.0');
    case 'open_release_page': mockInvoke.opened = args.url; return Promise.resolve();
    case 'get_modes':
      return Promise.resolve(JSON.parse(JSON.stringify(mockInvoke.modes || { hidden: [], custom: [] })));
    case 'set_modes':
      mockInvoke.modes = JSON.parse(JSON.stringify(args.modes));
      return Promise.resolve(JSON.parse(JSON.stringify(mockInvoke.modes)));
    case 'get_automation':
      if (!mockInvoke.auto) mockInvoke.auto = JSON.parse(JSON.stringify(AUTO_DEFAULT));
      return Promise.resolve(JSON.parse(JSON.stringify(mockInvoke.auto)));
    case 'set_automation':
      mockInvoke.auto = { ducking: args.ducking, auto_modes: args.autoModes, protected: args.protected };
      return Promise.resolve(JSON.parse(JSON.stringify(mockInvoke.auto)));
    case 'list_outputs':
      if (mockInvoke.outputs) return Promise.resolve(mockInvoke.outputs.map((o) => ({ ...o, default: o.name === s.device })));
      return Promise.resolve([
      { id: 'a', name: 'Fones de ouvido (Bluetooth)', kind: 'headphones', default: s.device.startsWith('Fones') },
      { id: 'b', name: 'Alto-falantes (Realtek Audio)', kind: 'speakers', default: s.device.startsWith('Alto') },
      { id: 'c', name: 'LG TV (NVIDIA High Definition Audio)', kind: 'display', default: s.device.startsWith('LG') },
    ]);
    case 'set_app_output': {
      const outs = { a: ['Fones de ouvido (Bluetooth)', 'headphones'], b: ['Alto-falantes (Realtek Audio)', 'speakers'], c: ['LG TV (NVIDIA High Definition Audio)', 'display'] };
      app.route = args.output ? { id: args.output, name: outs[args.output][0], kind: outs[args.output][1], connected: true } : null;
      app.playing_on = args.output || s.device_id;
      break;
    }
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
