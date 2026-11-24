//! Atalhos globais de teclado, criados pela própria pessoa no painel.
//! Funcionam com o painel fechado e dentro de jogos (menos os em tela cheia exclusiva,
//! onde o aviso não aparece, mas a ação acontece).

use std::str::FromStr;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::audio;
use crate::osd::{self, Osd};
use crate::settings::{self, HotkeyDef};

fn def(keys: &str, action: &str) -> HotkeyDef {
    HotkeyDef { keys: keys.into(), action: action.into(), target: None, label: None }
}

/// Os atalhos de fábrica (e o "restaurar padrão").
pub fn defaults() -> Vec<HotkeyDef> {
    vec![
        def("Ctrl+Alt+KeyM", "mic-mute"),
        def("Ctrl+Alt+PageUp", "focus-up"),
        def("Ctrl+Alt+PageDown", "focus-down"),
        def("Ctrl+Alt+KeyO", "next-output"),
        def("Ctrl+Alt+KeyV", "open-panel"),
    ]
}

/// "Ctrl+Alt+KeyM" -> Shortcut. Exige Ctrl, Alt ou Win (ou uma tecla F sozinha).
pub fn parse(keys: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = keys.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    let Some((key, mods)) = parts.split_last() else { return Err("sem teclas".into()) };
    let mut m = Modifiers::empty();
    for p in mods {
        m |= match p.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => Modifiers::CONTROL,
            "alt" => Modifiers::ALT,
            "shift" => Modifiers::SHIFT,
            "win" | "super" | "meta" => Modifiers::SUPER,
            _ => return Err(format!("tecla desconhecida: {p}")),
        };
    }
    let code = Code::from_str(key).map_err(|_| format!("tecla desconhecida: {key}"))?;
    let is_f_key = key.starts_with('F') && key[1..].parse::<u8>().is_ok();
    if !(m.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER) || is_f_key) {
        return Err("use Ctrl, Alt ou Win junto".into());
    }
    Ok(Shortcut::new((!m.is_empty()).then_some(m), code))
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn aceita_as_teclas_do_editor() {
        for k in [
            "Ctrl+Alt+KeyM", "Ctrl+Alt+PageUp", "Ctrl+Alt+PageDown", "Ctrl+Shift+Digit1",
            "Alt+F5", "F9", "Win+Alt+KeyK", "Ctrl+Alt+ArrowUp", "Ctrl+Alt+Numpad5",
            "Ctrl+Alt+Space", "Ctrl+Alt+Minus", "Ctrl+Alt+Equal", "Ctrl+Alt+Backquote",
        ] {
            assert!(parse(k).is_ok(), "{k}: {:?}", parse(k).err());
        }
    }

    #[test]
    fn recusa_o_que_atrapalharia_digitar() {
        assert!(parse("KeyM").is_err());
        assert!(parse("Shift+KeyM").is_err());
        assert!(parse("Ctrl+Alt+NaoExiste").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn mesma_combinacao_mesmo_id() {
        assert_eq!(parse("Ctrl+Alt+KeyM").unwrap().id(), parse("alt+ctrl+KeyM").unwrap().id());
    }
}

/// Situação de cada atalho depois de registrar: "ok", "ocupado", "repetido", "inválido"…
#[derive(Default)]
pub struct Registered(pub Mutex<Registry>);

#[derive(Default)]
pub struct Registry {
    /// id do Shortcut registrado -> posição na lista
    by_id: Vec<(u32, usize)>,
    status: Vec<String>,
}

#[derive(Serialize)]
pub struct HotkeyInfo {
    #[serde(flatten)]
    def: HotkeyDef,
    status: String,
}

#[derive(Serialize)]
pub struct HotkeysState {
    enabled: bool,
    list: Vec<HotkeyInfo>,
}

/// Tira todos os atalhos do Windows e registra de novo a partir das preferências.
pub fn apply(app: &AppHandle) {
    let prefs = settings::get(app);
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut reg = Registry::default();
    for (i, d) in prefs.hotkeys.iter().enumerate() {
        let status = if !prefs.shortcuts {
            "desligado".to_string()
        } else {
            match parse(&d.keys) {
                Err(e) => e,
                Ok(sc) if reg.by_id.iter().any(|(id, _)| *id == sc.id()) => "repetido".into(),
                Ok(sc) => match gs.register(sc) {
                    Ok(()) => {
                        reg.by_id.push((sc.id(), i));
                        "ok".into()
                    }
                    Err(_) => "ocupado".into(),
                },
            }
        };
        reg.status.push(status);
    }
    *app.state::<Registered>().0.lock().unwrap() = reg;
}

/// Solta todos os atalhos (enquanto a pessoa grava uma combinação nova).
pub fn pause(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
    app.state::<Registered>().0.lock().unwrap().by_id.clear();
}

pub fn state(app: &AppHandle) -> HotkeysState {
    let prefs = settings::get(app);
    let reg = app.state::<Registered>();
    let reg = reg.0.lock().unwrap();
    let list = prefs
        .hotkeys
        .into_iter()
        .enumerate()
        .map(|(i, def)| HotkeyInfo { def, status: reg.status.get(i).cloned().unwrap_or_else(|| "ok".into()) })
        .collect();
    HotkeysState { enabled: prefs.shortcuts, list }
}

pub fn handle(app: &AppHandle, shortcut: &Shortcut) {
    let index = {
        let reg = app.state::<Registered>();
        let reg = reg.0.lock().unwrap();
        reg.by_id.iter().find(|(id, _)| *id == shortcut.id()).map(|(_, i)| *i)
    };
    let Some(d) = index.and_then(|i| settings::get(app).hotkeys.get(i).cloned()) else { return };
    let app = app.clone();
    // O trabalho de áudio sai da thread de eventos.
    std::thread::spawn(move || run(&app, &d));
}

fn short_name(name: &str) -> String {
    // "Microfone (USB Audio Device)" -> "USB Audio Device"
    match (name.find(" ("), name.ends_with(')')) {
        (Some(i), true) => name[i + 2..name.len() - 1].to_string(),
        _ => name.to_string(),
    }
}

fn note(icon: &str, title: impl Into<String>, detail: impl Into<String>) -> Osd {
    Osd { icon: icon.into(), title: title.into(), detail: detail.into(), value: None, alert: false }
}

fn volume_note(title: impl Into<String>, v: f32) -> Osd {
    Osd {
        icon: if v == 0.0 { "volume-off" } else { "volume" }.into(),
        title: title.into(),
        detail: format!("{}%", (v * 100.0).round()),
        value: Some(v),
        alert: false,
    }
}

fn mute_note(title: impl Into<String>, muted: bool) -> Osd {
    Osd {
        icon: if muted { "volume-off" } else { "volume" }.into(),
        title: title.into(),
        detail: if muted { "mudo".into() } else { "som ligado".into() },
        value: None,
        alert: muted,
    }
}

fn target_label(d: &HotkeyDef) -> String {
    d.label.clone().or_else(|| d.target.clone()).unwrap_or_default()
}

fn run(app: &AppHandle, d: &HotkeyDef) {
    let target = d.target.clone().unwrap_or_default();
    let shown = match d.action.as_str() {
        "mic-mute" => {
            let n = match audio::toggle_mic_mute() {
                Ok(Some((name, muted))) => Osd {
                    icon: if muted { "mic-off" } else { "mic" }.into(),
                    title: if muted { "Microfone mudo".into() } else { "Microfone ligado".into() },
                    detail: short_name(&name),
                    value: None,
                    alert: muted,
                },
                Ok(None) => note("mic-off", "Nenhum microfone", ""),
                Err(e) => note("mic-off", "Não consegui mudar o microfone", e),
            };
            Some(n)
        }
        "focus-up" | "focus-down" => {
            let delta = if d.action == "focus-up" { 0.05 } else { -0.05 };
            match audio::foreground_key().and_then(|k| audio::nudge_app(&k, delta).ok().flatten()) {
                Some((name, v)) => Some(volume_note(name, v)),
                // O app da frente não tem som: mexe no volume geral.
                None => audio::nudge_master(delta).ok().map(|v| volume_note("Volume geral", v)),
            }
        }
        "focus-mute" => match audio::foreground_key().and_then(|k| audio::toggle_app_mute(&k).ok().flatten()) {
            Some((name, muted)) => Some(mute_note(name, muted)),
            None => audio::toggle_master_mute().ok().map(|m| mute_note("Volume geral", m)),
        },
        "app-up" | "app-down" => {
            let delta = if d.action == "app-up" { 0.05 } else { -0.05 };
            match audio::nudge_app(&target, delta) {
                Ok(Some((name, v))) => Some(volume_note(name, v)),
                _ => Some(note("volume-off", target_label(d), "não está tocando agora")),
            }
        }
        "app-mute" => match audio::toggle_app_mute(&target) {
            Ok(Some((name, muted))) => Some(mute_note(name, muted)),
            _ => Some(note("volume-off", target_label(d), "não está tocando agora")),
        },
        "master-up" | "master-down" => {
            let delta = if d.action == "master-up" { 0.05 } else { -0.05 };
            audio::nudge_master(delta).ok().map(|v| volume_note("Volume geral", v))
        }
        "master-mute" => audio::toggle_master_mute().ok().map(|m| mute_note("Volume geral", m)),
        "next-output" => Some(match audio::next_output() {
            Ok((name, kind)) => note(kind, short_name(&name), "Tocando por aqui agora"),
            Err(e) => note("other", "Não troquei a saída", e),
        }),
        "output" => {
            let found = audio::list_outputs().unwrap_or_default().into_iter().find(|o| o.id == target);
            Some(match found {
                Some(o) => match audio::set_output(&o.id) {
                    Ok(()) => note(o.kind, short_name(&o.name), "Tocando por aqui agora"),
                    Err(e) => note("other", "Não troquei a saída", e),
                },
                None => note("other", target_label(d), "essa saída não está conectada"),
            })
        }
        // Os modos moram na interface; ela aplica e mostra o aviso.
        "mode" => {
            let _ = app.emit_to("main", "apply-mode", target);
            None
        }
        "open-panel" => {
            crate::toggle_panel(app);
            None
        }
        _ => None,
    };
    if let Some(n) = shown {
        osd::show(app, n);
    }
    // mudo do microfone ou do som muda a cara do mascote na bandeja
    crate::trayface::refresh(app);
}
