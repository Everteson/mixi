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
function buildModes() {
  els.modes.innerHTML = MODES.map((m) => `
    <button class="mode" data-mode="${m.id}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg><span>${m.label}</span>
    </button>`).join('');
  els.modes.addEventListener('click', (e) => {
    const b = e.target.closest('.mode');
    if (b) applyMode(MODES.find((x) => x.id === b.dataset.mode), false);
  });
  setMode(activeMode);
}

/** Aplica um modo. `announce`: veio de um atalho, então mostra o aviso flutuante. */
async function applyMode(m, announce) {
  setMode(m.id);
  // estado novo na hora: com o painel fechado, o `mixer` pode estar velho
  const st = await invoke('get_state').catch(() => mixer);
  if (!st) return;
  await invoke('set_master_mute', { muted: false });
  await invoke('set_master_volume', { volume: m.master });
  await Promise.all(st.apps.map((a) => {
    const cat = category(a);
    return Promise.all([
      invoke('set_app_volume', { key: a.key, volume: m.vol[cat] }),
      invoke('set_app_mute', { key: a.key, muted: m.mute.includes(cat) }),
    ]);
  }));
  holding.clear();
  poll();
  if (announce) {
    invoke('show_osd', { osd: { icon: 'mode', title: 'Modo ' + m.label, detail: 'volumes ajustados', value: null, alert: false } })
      .catch(() => {});
  }
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
  if (!open) return;
  invoke('get_autostart').then((on) => { els.autostart.checked = on; }).catch(() => {});
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
  if (kind === 'mode') opts = MODES.map((m) => ({ v: m.id, t: 'Modo ' + m.label }));
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
  else if (!els.hkView.hidden) closeHotkeys();
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
listen('panel-hidden', () => {
  stopPolling();
  setAwake(false);
  toggleMenu(false);
  toggleOutMenu(false);
  if (recording) recording.cancel(); // painel sumiu no meio da gravação: volta os atalhos
});
// Um atalho de "Ativar um modo" chegou pelo Rust (os modos moram aqui na interface).
listen('apply-mode', ({ payload }) => {
  const m = MODES.find((x) => x.id === payload);
  if (m) applyMode(m, true);
});
// Lê o estado uma vez (pra janela já nascer com o tamanho certo) e só fica consultando
// se o painel estiver aberto. Iniciado com --hidden, espera o primeiro clique na bandeja.
poll().then(fitWindow);
invoke('panel_visible')
  .then((v) => { setAwake(v); if (v) startPolling(); })
  .catch(() => startPolling());

/* ================= backend de mentira (só no navegador) ================= */
function mockInvoke(cmd, args = {}) {
  const s = (mockInvoke.s ||= {
    mic: { name: 'Microfone (USB Audio Device)', volume: 0.7, muted: false, peak: 0.08 },
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
