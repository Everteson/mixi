#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod hotkeys;
mod osd;
mod settings;
mod sys;
mod trayface;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

pub const TRAY_ID: &str = "mixi";

/// Largura da janela: painel (380) + margem transparente para a sombra.
const WINDOW_WIDTH: f64 = 420.0;
/// Distância entre a janela e a barra de tarefas / borda da tela (px lógicos).
const EDGE_GAP: f64 = 4.0;

struct Ui {
    last_hide: Mutex<Instant>,
    pinned: Mutex<bool>,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Encosta a janela no canto inferior direito da área de trabalho (acima da barra de tarefas).
fn place(win: &WebviewWindow) {
    let monitor = win
        .cursor_position()
        .ok()
        .and_then(|p| win.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let (Some(mon), Ok(size)) = (monitor, win.outer_size()) else { return };
    let area = mon.work_area();
    let gap = (EDGE_GAP * mon.scale_factor()) as i32;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - gap;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - gap;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn show_panel(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    place(&win);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit("panel-shown", ());
}

fn hide_panel(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    let _ = win.hide();
    *app.state::<Ui>().last_hide.lock().unwrap() = Instant::now();
    let _ = app.emit("panel-hidden", ());
}

pub fn toggle_panel(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    if win.is_visible().unwrap_or(false) {
        hide_panel(app);
        return;
    }
    // Clicar no ícone com o painel aberto: o painel perde o foco e some antes do clique chegar.
    // Sem isso, ele reabriria na mesma hora.
    if app.state::<Ui>().last_hide.lock().unwrap().elapsed() < Duration::from_millis(300) {
        return;
    }
    show_panel(app);
}

// ---------- comandos chamados pela interface ----------

#[tauri::command]
async fn get_state() -> Result<audio::MixerState, String> {
    audio::get_state()
}

#[tauri::command]
async fn set_app_volume(key: String, volume: f32) -> Result<(), String> {
    audio::set_app_volume(&key, volume)
}

#[tauri::command]
async fn set_app_mute(key: String, muted: bool) -> Result<(), String> {
    audio::set_app_mute(&key, muted)
}

#[tauri::command]
async fn set_master_volume(volume: f32) -> Result<(), String> {
    audio::set_master_volume(volume)
}

#[tauri::command]
async fn set_master_mute(app: AppHandle, muted: bool) -> Result<(), String> {
    audio::set_master_mute(muted)?;
    trayface::refresh(&app);
    Ok(())
}

#[tauri::command]
async fn set_mic_volume(volume: f32) -> Result<(), String> {
    audio::set_mic_volume(volume)
}

#[tauri::command]
async fn set_mic_mute(app: AppHandle, muted: bool) -> Result<(), String> {
    audio::set_mic_mute(muted)?;
    trayface::refresh(&app);
    Ok(())
}

#[tauri::command]
fn get_hotkeys(app: AppHandle) -> hotkeys::HotkeysState {
    hotkeys::state(&app)
}

/// Salva a lista inteira de atalhos (o editor manda tudo a cada mudança) e registra de novo.
#[tauri::command]
fn set_hotkeys(app: AppHandle, list: Vec<settings::HotkeyDef>) -> hotkeys::HotkeysState {
    settings::update(&app, |s| s.hotkeys = list);
    hotkeys::apply(&app);
    hotkeys::state(&app)
}

#[tauri::command]
fn set_hotkeys_enabled(app: AppHandle, enabled: bool) -> hotkeys::HotkeysState {
    settings::update(&app, |s| s.shortcuts = enabled);
    hotkeys::apply(&app);
    hotkeys::state(&app)
}

#[tauri::command]
fn reset_hotkeys(app: AppHandle) -> hotkeys::HotkeysState {
    settings::update(&app, |s| s.hotkeys = hotkeys::defaults());
    hotkeys::apply(&app);
    hotkeys::state(&app)
}

/// Enquanto a pessoa grava uma combinação, os atalhos ficam soltos (senão eles disparam).
#[tauri::command]
fn pause_hotkeys(app: AppHandle, paused: bool) {
    if paused {
        hotkeys::pause(&app);
    } else {
        hotkeys::apply(&app);
    }
}

/// Teste da combinação antes de salvar: devolve o erro, se tiver.
#[tauri::command]
fn check_keys(keys: String) -> Option<String> {
    hotkeys::parse(&keys).err()
}

#[tauri::command]
fn show_osd(app: AppHandle, osd: osd::Osd) {
    osd::show(&app, osd);
}

#[tauri::command]
async fn list_outputs() -> Result<Vec<audio::Output>, String> {
    audio::list_outputs()
}

#[tauri::command]
async fn set_output(id: String) -> Result<(), String> {
    audio::set_output(&id)
}

#[tauri::command]
fn fit_window(window: WebviewWindow, height: f64) {
    let _ = window.set_size(LogicalSize::new(WINDOW_WIDTH, height.clamp(200.0, 1200.0)));
    place(&window);
}

#[tauri::command]
fn set_pinned(app: AppHandle, pinned: bool) {
    *app.state::<Ui>().pinned.lock().unwrap() = pinned;
}

#[tauri::command]
fn panel_visible(window: WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false)
}

#[tauri::command]
fn get_pinned(app: AppHandle) -> bool {
    *app.state::<Ui>().pinned.lock().unwrap()
}

#[tauri::command]
fn close_panel(app: AppHandle) {
    hide_panel(&app);
}

#[tauri::command]
fn open_settings(page: String) {
    sys::open_settings(&page);
}

#[tauri::command]
fn get_autostart() -> bool {
    sys::autostart_enabled()
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    sys::set_autostart(enabled)?;
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
        let _ = item.set_checked(enabled);
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn main() {
    // `mixi --set <app|geral> <0-100>`: muda um volume pela linha de comando e sai.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--set") {
        let (Some(key), Some(vol)) = (args.get(i + 1), args.get(i + 2).and_then(|v| v.parse::<f32>().ok())) else {
            eprintln!("uso: mixi --set <app|geral> <0-100>");
            std::process::exit(2);
        };
        let v = vol / 100.0;
        let r = if key == "geral" { audio::set_master_volume(v) } else { audio::set_app_volume(&key.to_lowercase(), v) };
        if let Err(e) = r {
            eprintln!("erro: {e}");
            std::process::exit(1);
        }
        return;
    }
    // `mixi --outputs`: lista as saídas. `mixi --output <parte do nome>`: troca a saída padrão.
    if args.iter().any(|a| a == "--outputs") {
        match audio::list_outputs() {
            Ok(list) => println!("{}", serde_json::to_string_pretty(&list).unwrap_or_default()),
            Err(e) => eprintln!("erro: {e}"),
        }
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--output") {
        let wanted = args.get(i + 1).map(|s| s.to_lowercase()).unwrap_or_default();
        let found = audio::list_outputs()
            .unwrap_or_default()
            .into_iter()
            .find(|o| !wanted.is_empty() && o.name.to_lowercase().contains(&wanted));
        let Some(out) = found else {
            eprintln!("nenhuma saída com \"{wanted}\" no nome (veja `mixi --outputs`)");
            std::process::exit(2);
        };
        if let Err(e) = audio::set_output(&out.id) {
            eprintln!("erro: {e}");
            std::process::exit(1);
        }
        println!("saída agora: {}", out.name);
        return;
    }
    // `mixi --dump`: imprime o que o app enxerga do áudio e sai (ajuda a depurar).
    // Com `--icons`, os ícones vêm inteiros (data URL) em vez do tamanho.
    if args.iter().any(|a| a == "--dump") {
        let full_icons = args.iter().any(|a| a == "--icons");
        match audio::get_state() {
            Ok(mut s) => {
                if !full_icons {
                    for a in &mut s.apps {
                        a.icon = a.icon.as_ref().map(|i| format!("<png {} bytes>", i.len()));
                    }
                }
                println!("{}", serde_json::to_string_pretty(&s).unwrap_or_default());
            }
            Err(e) => eprintln!("erro: {e}"),
        }
        return;
    }
    if !sys::claim_single_instance() {
        return;
    }
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    // `--pinned`: começa com o painel fixado (não some ao perder o foco). Bom pra desenvolver.
    let start_pinned = std::env::args().any(|a| a == "--pinned");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        hotkeys::handle(app, shortcut);
                    }
                })
                .build(),
        )
        .manage(Ui {
            last_hide: Mutex::new(Instant::now() - Duration::from_secs(5)),
            pinned: Mutex::new(start_pinned),
        })
        .manage(hotkeys::Registered::default())
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_app_volume,
            set_app_mute,
            set_master_volume,
            set_master_mute,
            set_mic_volume,
            set_mic_mute,
            get_hotkeys,
            set_hotkeys,
            set_hotkeys_enabled,
            reset_hotkeys,
            pause_hotkeys,
            check_keys,
            show_osd,
            list_outputs,
            set_output,
            fit_window,
            set_pinned,
            get_pinned,
            panel_visible,
            close_panel,
            open_settings,
            get_autostart,
            set_autostart,
            quit_app
        ])
        .setup(move |app| {
            let open = MenuItem::with_id(app, "open", "Abrir Mixi", true, None::<&str>)?;
            let mixer = MenuItem::with_id(app, "mixer", "Mixer do Windows", true, None::<&str>)?;
            let autostart = CheckMenuItem::with_id(
                app,
                "autostart",
                "Iniciar com o Windows",
                true,
                sys::autostart_enabled(),
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open,
                    &PredefinedMenuItem::separator(app)?,
                    &mixer,
                    &autostart,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            app.manage(autostart.clone());

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .tooltip("Mixi · volume dos apps")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_panel(app),
                    "mixer" => sys::open_settings("apps-volume"),
                    "autostart" => {
                        let on = !sys::autostart_enabled();
                        let _ = sys::set_autostart(on);
                        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
                            let _ = item.set_checked(sys::autostart_enabled());
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            app.manage(settings::SettingsState(Mutex::new(settings::load(&handle))));
            hotkeys::apply(&handle);
            osd::create(&handle)?;
            trayface::start(handle.clone());

            if !start_hidden {
                show_panel(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Só o painel some ao perder o foco; o aviso flutuante cuida de si.
            if window.label() != "main" {
                return;
            }
            let app = window.app_handle();
            match event {
                WindowEvent::Focused(false) => {
                    if !*app.state::<Ui>().pinned.lock().unwrap() {
                        hide_panel(app);
                    }
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    hide_panel(app);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Mixi");
}
