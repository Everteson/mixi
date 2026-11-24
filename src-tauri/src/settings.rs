//! Preferências que o Rust precisa saber antes da interface abrir.
//! Ficam em %APPDATA%\com.mixi.volume\settings.json.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Um atalho criado pela pessoa: teclas + o que ele faz (+ em quem, quando precisa).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HotkeyDef {
    /// Ex.: "Ctrl+Alt+KeyM". A última parte é o `KeyboardEvent.code` da tecla.
    pub keys: String,
    /// Ex.: "mic-mute", "app-mute", "output", "mode"…
    pub action: String,
    /// App (nome do .exe), id da saída ou id do modo, pras ações que precisam.
    #[serde(default)]
    pub target: Option<String>,
    /// Nome bonito do alvo, pra mostrar mesmo quando ele não está ligado agora.
    #[serde(default)]
    pub label: Option<String>,
}

/// "Abaixar a música quando alguém fala".
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Ducking {
    pub enabled: bool,
    /// Pra quanto a música desce (0,3 = 30% do volume que ela tinha).
    pub level: f32,
    /// Escolha da tela ("music", "music-browser", "all"); o Rust usa as listas abaixo.
    pub what: String,
    /// Apps cuja voz faz a música abaixar (Discord, Teams…).
    pub triggers: Vec<String>,
    /// Apps que abaixam.
    pub targets: Vec<String>,
    /// Abaixa tudo, menos quem fala, os sons do sistema e os apps protegidos.
    pub everything: bool,
}

impl Default for Ducking {
    fn default() -> Self {
        Self { enabled: false, level: 0.3, what: "music".into(), triggers: Vec::new(), targets: Vec::new(), everything: false }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct AutoRule {
    /// Nome do .exe sem a extensão, em minúsculas (ex.: "valorant").
    pub app: String,
    /// Id do modo (jogo, foco, chamada, soninho…).
    pub mode: String,
}

/// "Quando um app abre, ativar um modo".
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AutoModes {
    pub enabled: bool,
    /// Ao fechar o app, voltar os volumes de antes.
    pub restore: bool,
    pub rules: Vec<AutoRule>,
}

impl Default for AutoModes {
    fn default() -> Self {
        Self { enabled: false, restore: true, rules: Vec::new() }
    }
}

/// Volume de um app dentro de um modo personalizado.
#[derive(Serialize, Deserialize, Clone)]
pub struct ModeApp {
    pub key: String,
    /// Nome bonito, pra mostrar mesmo com o app fechado.
    #[serde(default)]
    pub name: String,
    pub volume: f32,
    #[serde(default)]
    pub muted: bool,
}

/// Um modo criado pela pessoa a partir dos volumes do momento.
#[derive(Serialize, Deserialize, Clone)]
pub struct CustomMode {
    pub id: String,
    pub name: String,
    pub icon: String,
    /// Volume geral; None = o modo não mexe nele.
    #[serde(default)]
    pub master: Option<f32>,
    #[serde(default)]
    pub apps: Vec<ModeApp>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Modes {
    /// Ids dos modos (prontos ou não) escondidos do painel.
    pub hidden: Vec<String>,
    pub custom: Vec<CustomMode>,
}

/// Apps que escutam o som (LEDs, visualizadores, filtros de microfone). Eles ouvem com o
/// volume da própria sessão: abaixar ou mutar faz pararem de funcionar. Os modos e o
/// abaixar automático não mexem neles.
pub fn default_protected() -> Vec<String> {
    [
        "halo-studio", "wallpaper32", "wallpaper64", "nvidia broadcast", "signalrgb", "openrgb",
        "obs64", "obs32", "voicemeeter", "voicemeeterpro", "voicemeeter8", "voicemeeter8x64",
        "audiorelay", "equalizerapo", "lghub", "icue",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// Chave geral dos atalhos.
    pub shortcuts: bool,
    pub hotkeys: Vec<HotkeyDef>,
    pub ducking: Ducking,
    pub auto_modes: AutoModes,
    pub protected: Vec<String>,
    pub modes: Modes,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcuts: true,
            hotkeys: crate::hotkeys::defaults(),
            ducking: Ducking::default(),
            auto_modes: AutoModes::default(),
            protected: default_protected(),
            modes: Modes::default(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let Some(p) = path(app) else { return Settings::default() };
    let Ok(text) = std::fs::read_to_string(&p) else { return Settings::default() };
    // O Bloco de Notas (e o PowerShell) às vezes gravam com BOM no começo.
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(s) => s,
        Err(_) => {
            // Arquivo estragado: guarda uma cópia antes que o próximo "salvar" passe por cima.
            let _ = std::fs::copy(&p, p.with_file_name("settings.invalido.json"));
            Settings::default()
        }
    }
}

pub fn save(app: &AppHandle, settings: &Settings) {
    let Some(p) = path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(p, json);
    }
}

pub fn get(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

pub fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) {
    let state = app.state::<SettingsState>();
    let mut s = state.0.lock().unwrap();
    change(&mut s);
    save(app, &s);
}
