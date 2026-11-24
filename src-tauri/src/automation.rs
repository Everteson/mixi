//! O que o Mixi faz sozinho, mesmo com o painel fechado:
//! - abaixar a música quando alguém fala (Discord, Teams…) e voltar depois;
//! - avisar a interface quando um app de uma regra abre ou fecha (modo automático).
//!
//! Roda numa thread própria. Os objetos de áudio (COM) são criados e usados só nela.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::audio::{self, LiteSession};
use crate::settings::{self, Settings};

/// Acima disso no medidor do app de chamada, consideramos que alguém está falando.
const VOICE_THRESHOLD: f32 = 0.02;
/// Quanto tempo depois da última fala a música começa a voltar.
const HOLD: Duration = Duration::from_millis(1500);
/// Passo do laço quando o abaixar está ligado (rápido pra reagir à voz).
const FAST_TICK: Duration = Duration::from_millis(100);
/// Passo quando só o modo automático está ligado.
const SLOW_TICK: Duration = Duration::from_millis(1000);
/// De quanto em quanto tempo relemos as sessões, os programas abertos e as preferências.
const REFRESH: Duration = Duration::from_secs(2);

/// Um app que o Mixi abaixou: o volume que ele tinha e o último que o Mixi pôs.
struct Managed {
    original: f32,
    applied: f32,
}

/// Fica fora da thread pra dar pra devolver tudo quando o Mixi fecha.
static MANAGED: LazyLock<Mutex<HashMap<String, Managed>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
struct AutoModeEvent {
    app: String,
    mode: String,
    started: bool,
    restore: bool,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || run(app));
}

fn run(app: AppHandle) {
    let mut prefs: Settings = settings::get(&app);
    let mut cache: Vec<LiteSession> = Vec::new();
    let mut last_refresh: Option<Instant> = None;
    let mut last_voice: Option<Instant> = None;
    // modo automático: quais apps das regras estavam abertos na última olhada (None = 1ª vez)
    let mut running: Option<HashSet<String>> = None;

    loop {
        let now = Instant::now();
        if last_refresh.is_none_or(|t| now.duration_since(t) >= REFRESH) {
            last_refresh = Some(now);
            prefs = settings::get(&app);
            let ducking_on = prefs.ducking.enabled || !MANAGED.lock().unwrap().is_empty();
            cache = if ducking_on { audio::lite_sessions().unwrap_or_default() } else { Vec::new() };
            running = check_rules(&app, &prefs, running);
        }

        let ducking_on = prefs.ducking.enabled || !MANAGED.lock().unwrap().is_empty();
        if ducking_on {
            duck_step(&prefs, &cache, &mut last_voice, now);
        }
        std::thread::sleep(if ducking_on { FAST_TICK } else { SLOW_TICK });
    }
}

// ---------- abaixar a música ----------

fn peak(s: &LiteSession) -> f32 {
    s.meter.as_ref().and_then(|m| unsafe { m.GetPeakValue() }.ok()).unwrap_or(0.0)
}

fn duck_step(prefs: &Settings, cache: &[LiteSession], last_voice: &mut Option<Instant>, now: Instant) {
    let d = &prefs.ducking;
    let protected: HashSet<&str> = prefs.protected.iter().map(String::as_str).collect();
    let triggers: HashSet<&str> = d.triggers.iter().map(String::as_str).collect();
    let targets: HashSet<&str> = d.targets.iter().map(String::as_str).collect();

    let speaking = d.enabled && cache.iter().any(|s| triggers.contains(s.key.as_str()) && peak(s) > VOICE_THRESHOLD);
    if speaking {
        *last_voice = Some(now);
    }
    let duck = d.enabled && last_voice.is_some_and(|t| now.duration_since(t) < HOLD);

    // agrupa as sessões dos apps que abaixam
    let mut by_key: HashMap<&str, Vec<&LiteSession>> = HashMap::new();
    for s in cache {
        let k = s.key.as_str();
        let is_target = if d.everything {
            k != audio::SYSTEM_KEY && !triggers.contains(k)
        } else {
            targets.contains(k)
        };
        if is_target && !protected.contains(k) {
            by_key.entry(k).or_default().push(s);
        }
    }

    let mut managed = MANAGED.lock().unwrap();
    // app que fechou (ou deixou de ser alvo): esquece
    managed.retain(|k, _| by_key.contains_key(k.as_str()));

    for (key, list) in by_key {
        let Ok(current) = (unsafe { list[0].volume.GetMasterVolume() }) else { continue };
        match managed.get(key) {
            None if !duck => continue,
            None => {
                managed.insert(key.to_string(), Managed { original: current, applied: current });
            }
            // A pessoa mexeu no volume no meio: o dela vale, o Mixi para de cuidar desse app.
            Some(m) if (current - m.applied).abs() > 0.02 => {
                managed.remove(key);
                continue;
            }
            Some(_) => {}
        }
        let m = managed.get_mut(key).unwrap();
        let goal = if duck { m.original * d.level.clamp(0.0, 1.0) } else { m.original };
        // desce rápido (≈0,2 s) e volta devagar (≈0,8 s), pra não dar tranco
        let speed = if duck { 0.55 } else { 0.25 };
        let next = if (goal - m.applied).abs() < 0.01 { goal } else { m.applied + (goal - m.applied) * speed };
        if (next - m.applied).abs() > f32::EPSILON {
            for s in &list {
                let _ = unsafe { s.volume.SetMasterVolume(next, std::ptr::null()) };
            }
            m.applied = next;
        }
        if !duck && (m.applied - m.original).abs() < 0.005 {
            managed.remove(key);
        }
    }
}

/// Devolve o volume de quem estava abaixado (chamado quando o Mixi fecha).
pub fn restore_all() {
    let saved: Vec<(String, f32)> = MANAGED.lock().unwrap().drain().map(|(k, m)| (k, m.original)).collect();
    for (key, original) in saved {
        let _ = audio::set_app_volume(&key, original);
    }
}

// ---------- modo automático ----------

fn check_rules(app: &AppHandle, prefs: &Settings, before: Option<HashSet<String>>) -> Option<HashSet<String>> {
    let auto = &prefs.auto_modes;
    if !auto.enabled || auto.rules.is_empty() {
        return None; // desligado: na volta, a 1ª olhada vira a base de novo
    }
    let open = crate::sys::running_exes();
    let now: HashSet<String> = auto.rules.iter().map(|r| r.app.clone()).filter(|a| open.contains(a)).collect();
    // Na 1ª olhada só anotamos o que já estava aberto: não dispara modo por app antigo.
    if let Some(before) = before {
        for rule in &auto.rules {
            let (was, is) = (before.contains(&rule.app), now.contains(&rule.app));
            if was != is {
                let _ = app.emit_to(
                    "main",
                    "auto-mode",
                    AutoModeEvent { app: rule.app.clone(), mode: rule.mode.clone(), started: is, restore: auto.restore },
                );
            }
        }
    }
    Some(now)
}
