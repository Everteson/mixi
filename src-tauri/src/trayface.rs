//! A cara do mascote na bandeja. Dois sinais independentes:
//! - a expressão: acordado, dormindo (nada tocando faz um tempo) ou com o selo de microfone mudo;
//! - os fones: cinza quando o som (volume geral) está mudo.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::AppHandle;

use crate::audio;

#[derive(Clone, Copy, PartialEq)]
enum Expression {
    Awake,
    Sleep,
    MicMuted,
}

#[derive(Clone, Copy, PartialEq)]
struct Face {
    expression: Expression,
    sound_muted: bool,
}

/// Quanto tempo sem som até o mascote dormir.
const SLEEP_AFTER: Duration = Duration::from_secs(20);
/// De quanto em quanto tempo olhamos o áudio com o painel fechado (é bem leve).
const CHECK_EVERY: Duration = Duration::from_millis(1500);

static CURRENT: Mutex<Option<Face>> = Mutex::new(None);
static LAST_SOUND: Mutex<Option<Instant>> = Mutex::new(None);

fn icon_bytes(face: Face) -> &'static [u8] {
    match (face.expression, face.sound_muted) {
        (Expression::Awake, false) => include_bytes!("../icons/tray.png"),
        (Expression::Sleep, false) => include_bytes!("../icons/tray-sleep.png"),
        (Expression::MicMuted, false) => include_bytes!("../icons/tray-muted.png"),
        (Expression::Awake, true) => include_bytes!("../icons/tray-off.png"),
        (Expression::Sleep, true) => include_bytes!("../icons/tray-off-sleep.png"),
        (Expression::MicMuted, true) => include_bytes!("../icons/tray-off-muted.png"),
    }
}

fn tooltip(face: Face) -> &'static str {
    match (face.expression, face.sound_muted) {
        (Expression::MicMuted, true) => "Mixi · som e microfone mudos",
        (Expression::MicMuted, false) => "Mixi · microfone mudo",
        (_, true) => "Mixi · som mudo",
        (Expression::Sleep, false) => "Mixi · tudo quietinho",
        (Expression::Awake, false) => "Mixi · volume dos apps",
    }
}

fn set(app: &AppHandle, face: Face) {
    {
        let mut cur = CURRENT.lock().unwrap();
        if *cur == Some(face) {
            return;
        }
        *cur = Some(face);
    }
    let Some(tray) = app.tray_by_id(crate::TRAY_ID) else { return };
    if let Ok(img) = Image::from_bytes(icon_bytes(face)) {
        let _ = tray.set_icon(Some(img));
    }
    let _ = tray.set_tooltip(Some(tooltip(face)));
}

fn compute() -> Face {
    let now = Instant::now();
    let sound_muted = audio::master_muted();
    let mut last = LAST_SOUND.lock().unwrap();
    if (!sound_muted && audio::any_playing()) || last.is_none() {
        *last = Some(now);
    }
    let expression = if audio::mic_muted() {
        Expression::MicMuted
    } else if last.is_some_and(|t| now.duration_since(t) > SLEEP_AFTER) {
        Expression::Sleep
    } else {
        Expression::Awake
    };
    Face { expression, sound_muted }
}

/// Recalcula agora (ex.: logo depois de um mudo).
pub fn refresh(app: &AppHandle) {
    set(app, compute());
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        set(&app, compute());
        std::thread::sleep(CHECK_EVERY);
    });
}
