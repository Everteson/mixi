//! Aviso flutuante (tipo o do volume do Windows) usado pelos atalhos.
//!
//! É uma janelinha transparente que aparece sem roubar o foco (WS_EX_NOACTIVATE) e deixa
//! o clique passar, pra não tirar ninguém do jogo.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

const LABEL: &str = "osd";
const WIDTH: f64 = 340.0;
const HEIGHT: f64 = 100.0;
/// Distância do aviso até a barra de tarefas (px lógicos).
const BOTTOM_GAP: f64 = 28.0;
const VISIBLE_FOR: Duration = Duration::from_millis(1500);

static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone)]
pub struct Osd {
    /// mic | mic-off | volume | volume-off | headphones | speakers | display | mode | other
    pub icon: String,
    pub title: String,
    pub detail: String,
    /// 0–1 desenha a barrinha; None esconde.
    pub value: Option<f32>,
    /// Destaca o ícone (usado no "mudo").
    pub alert: bool,
}

fn hwnd(app: &AppHandle) -> Option<HWND> {
    let win = app.get_webview_window(LABEL)?;
    // A versão do crate `windows` do Tauri pode ser outra; passamos pelo ponteiro cru.
    Some(HWND(win.hwnd().ok()?.0 as _))
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("osd.html".into()))
        .title("Mixi")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    let _ = win.set_ignore_cursor_events(true);
    if let Some(h) = hwnd(app) {
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            SetWindowLongPtrW(h, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
        }
    }
    Ok(())
}

pub fn show(app: &AppHandle, osd: Osd) {
    let Some(win) = app.get_webview_window(LABEL) else { return };

    // Centro, logo acima da barra de tarefas, no monitor onde está o mouse.
    let monitor = win
        .cursor_position()
        .ok()
        .and_then(|p| win.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    if let (Some(mon), Ok(size)) = (monitor, win.outer_size()) {
        let area = mon.work_area();
        let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
        let y = area.position.y + area.size.height as i32
            - size.height as i32
            - (BOTTOM_GAP * mon.scale_factor()) as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    let _ = app.emit_to(LABEL, "osd", osd);
    if let Some(h) = hwnd(app) {
        unsafe {
            let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    // Some sozinho; se outro aviso chegar antes, ele é que decide quando sumir.
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(VISIBLE_FOR);
        if GENERATION.load(Ordering::SeqCst) == generation {
            if let Some(win) = app.get_webview_window(LABEL) {
                let _ = win.hide();
            }
        }
    });
}
