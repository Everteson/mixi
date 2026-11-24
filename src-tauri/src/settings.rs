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

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// Chave geral dos atalhos.
    pub shortcuts: bool,
    pub hotkeys: Vec<HotkeyDef>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { shortcuts: true, hotkeys: crate::hotkeys::defaults() }
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
