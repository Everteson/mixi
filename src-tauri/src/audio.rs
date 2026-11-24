//! Acesso ao áudio do Windows (Core Audio / WASAPI): volume geral e volume por app.
//!
//! Cada chamada cria os objetos COM na hora. É barato (poucos ms) e evita guardar
//! objetos COM entre threads.

// A interface IPolicyConfig abaixo precisa dos nomes do Windows (PascalCase).
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use base64::Engine;
use serde::Serialize;
use std::ffi::c_void;

use windows::core::{Interface, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{eCommunications, eMultimedia, ERole, DEVICE_STATE_ACTIVE};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, S_OK};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS,
};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateExpired, IAudioSessionControl2, IAudioSessionManager2,
    IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::SHDefExtractIconW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

// ---------- trocar a saída padrão ----------
// O Windows não tem API pública pra isso. Todo app que faz (EarTrumpet, SoundSwitch…) usa a
// interface interna IPolicyConfig, que existe do Windows 7 ao 11. A ordem dos métodos importa.
#[windows_core::interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: windows_core::IUnknown {
    fn GetMixFormat(&self, id: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    fn GetDeviceFormat(&self, id: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
    fn ResetDeviceFormat(&self, id: PCWSTR) -> HRESULT;
    fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
    fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, def: *mut i64, min: *mut i64) -> HRESULT;
    fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut i64) -> HRESULT;
    fn GetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn SetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
    fn GetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
    fn SetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
    fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
    fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
}
const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
/// PKEY_AudioEndpoint_FormFactor: diz se a saída é fone, caixa de som, monitor HDMI…
const PKEY_FORM_FACTOR: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e),
    pid: 0,
};

#[derive(Serialize)]
pub struct Output {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub default: bool,
}

pub const SYSTEM_KEY: &str = "__system";
const ICON_SIZE: i32 = 64;

#[derive(Serialize, Clone)]
pub struct AppInfo {
    pub key: String,
    pub name: String,
    pub icon: Option<String>,
    pub volume: f32,
    pub muted: bool,
    pub peak: f32,
    pub system: bool,
}

#[derive(Serialize)]
pub struct MixerState {
    pub device: String,
    pub device_kind: &'static str,
    pub master: f32,
    pub master_muted: bool,
    pub master_peak: f32,
    pub apps: Vec<AppInfo>,
}

struct Session {
    key: String,
    exe: Option<String>,
    system: bool,
    volume: ISimpleAudioVolume,
    meter: Option<IAudioMeterInformation>,
}

/// Nome bonito e ícone por executável (calcular o ícone custa um pouco, então guardamos).
static EXE_CACHE: LazyLock<Mutex<HashMap<String, (String, Option<String>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

type R<T> = Result<T, String>;

fn err(e: windows::core::Error) -> String {
    e.message().to_string()
}

fn com_init() {
    // Pode retornar S_FALSE / RPC_E_CHANGED_MODE se a thread já estiver iniciada; tudo bem.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn default_device() -> R<IMMDevice> {
    com_init();
    unsafe {
        let en: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(err)?;
        en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(err)
    }
}

fn device_name(dev: &IMMDevice) -> String {
    unsafe {
        dev.OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "Saída de áudio".to_string())
    }
}

fn device_id(dev: &IMMDevice) -> Option<String> {
    unsafe {
        let p = dev.GetId().ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

fn device_kind(dev: &IMMDevice) -> &'static str {
    let factor = unsafe {
        dev.OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_FORM_FACTOR))
            .ok()
            .and_then(|v| u32::try_from(&v).ok())
    };
    match factor {
        Some(3) | Some(5) => "headphones", // fone / headset
        Some(1) => "speakers",
        Some(7) => "display", // monitor / TV via HDMI ou DisplayPort
        _ => "other",
    }
}

/// Saídas de áudio ativas (fones, caixas, monitor…), marcando a padrão.
pub fn list_outputs() -> R<Vec<Output>> {
    com_init();
    unsafe {
        let en: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(err)?;
        let default_id = en
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|d| device_id(&d));
        let col = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).map_err(err)?;
        let mut out = Vec::new();
        for i in 0..col.GetCount().map_err(err)? {
            let Ok(dev) = col.Item(i) else { continue };
            let Some(id) = device_id(&dev) else { continue };
            out.push(Output {
                default: default_id.as_deref() == Some(id.as_str()),
                name: device_name(&dev),
                kind: device_kind(&dev),
                id,
            });
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
}

/// Torna `id` a saída padrão do Windows (para música/jogos e também para chamadas).
pub fn set_output(id: &str) -> R<()> {
    com_init();
    unsafe {
        let pc: IPolicyConfig =
            CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL).map_err(err)?;
        let w = wide(id);
        for role in [eConsole, eMultimedia, eCommunications] {
            pc.SetDefaultEndpoint(PCWSTR(w.as_ptr()), role).ok().map_err(err)?;
        }
    }
    Ok(())
}

fn exe_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn exe_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn known_name(stem: &str) -> Option<&'static str> {
    Some(match stem {
        "spotify" => "Spotify",
        "discord" | "discordptb" | "discordcanary" => "Discord",
        "chrome" => "Chrome",
        "msedge" => "Edge",
        "firefox" => "Firefox",
        "opera" | "opera_gx" => "Opera",
        "brave" => "Brave",
        "vivaldi" => "Vivaldi",
        "steam" | "steamwebhelper" => "Steam",
        "vlc" => "VLC",
        "ms-teams" | "teams" => "Teams",
        "zoom" => "Zoom",
        "slack" => "Slack",
        "whatsapp" => "WhatsApp",
        "telegram" => "Telegram",
        "obs64" => "OBS",
        "wallpaper32" | "wallpaper64" => "Wallpaper Engine",
        _ => return None,
    })
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Lê o "FileDescription" do executável (ex.: "Google Chrome").
fn file_description(path: &str) -> Option<String> {
    unsafe {
        let w = wide(path);
        let size = GetFileVersionInfoSizeW(PCWSTR(w.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(w.as_ptr()), None, size, data.as_mut_ptr() as _).ok()?;

        let mut ptr: *mut std::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let q = wide("\\VarFileInfo\\Translation");
        if !VerQueryValueW(data.as_ptr() as _, PCWSTR(q.as_ptr()), &mut ptr, &mut len).as_bool() || len < 4 {
            return None;
        }
        let lang = *(ptr as *const u16);
        let cp = *(ptr as *const u16).add(1);
        let q = wide(&format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription"));
        if !VerQueryValueW(data.as_ptr() as _, PCWSTR(q.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
            return None;
        }
        let slice = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let s = String::from_utf16_lossy(slice).trim_end_matches('\0').trim().to_string();
        (!s.is_empty()).then_some(s)
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Extrai o ícone do .exe e devolve como data URL PNG.
fn icon_data_url(path: &str) -> Option<String> {
    unsafe {
        let w = wide(path);
        let mut hicon = HICON::default();
        SHDefExtractIconW(PCWSTR(w.as_ptr()), 0, 0, Some(&mut hicon), None, ICON_SIZE as u32)
            .ok()
            .ok()?;
        if hicon.is_invalid() {
            return None;
        }
        let mut info = ICONINFO::default();
        let got = GetIconInfo(hicon, &mut info);
        let mut px = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];
        let mut lines = 0;
        if got.is_ok() {
            let hdc = CreateCompatibleDC(None);
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: ICON_SIZE,
                    biHeight: -ICON_SIZE,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            lines = GetDIBits(
                hdc,
                info.hbmColor,
                0,
                ICON_SIZE as u32,
                Some(px.as_mut_ptr() as _),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(hdc);
            let _ = DeleteObject(info.hbmColor.into());
            let _ = DeleteObject(info.hbmMask.into());
        }
        let _ = DestroyIcon(hicon);
        if lines == 0 {
            return None;
        }
        let has_alpha = px.chunks(4).any(|c| c[3] != 0);
        for c in px.chunks_mut(4) {
            c.swap(0, 2); // BGRA -> RGBA
            if !has_alpha {
                c[3] = 255;
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, ICON_SIZE as u32, ICON_SIZE as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().ok()?;
            wr.write_image_data(&px).ok()?;
        }
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&out)
        ))
    }
}

fn exe_meta(path: &str) -> (String, Option<String>) {
    if let Some(hit) = EXE_CACHE.lock().unwrap().get(path) {
        return hit.clone();
    }
    let stem = exe_stem(path);
    let name = known_name(&stem)
        .map(str::to_string)
        .or_else(|| file_description(path))
        .unwrap_or_else(|| capitalize(&stem));
    let meta = (name, icon_data_url(path));
    EXE_CACHE.lock().unwrap().insert(path.to_string(), meta.clone());
    meta
}

fn sessions(dev: &IMMDevice) -> R<Vec<Session>> {
    unsafe {
        let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None).map_err(err)?;
        let list = mgr.GetSessionEnumerator().map_err(err)?;
        let n = list.GetCount().map_err(err)?;
        let mut out = Vec::new();
        for i in 0..n {
            let Ok(ctl) = list.GetSession(i) else { continue };
            if matches!(ctl.GetState(), Ok(s) if s == AudioSessionStateExpired) {
                continue;
            }
            let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
            let Ok(volume) = ctl.cast::<ISimpleAudioVolume>() else { continue };
            let meter = ctl.cast::<IAudioMeterInformation>().ok();
            let system = ctl2.IsSystemSoundsSession() == S_OK;
            if system {
                out.push(Session { key: SYSTEM_KEY.into(), exe: None, system, volume, meter });
                continue;
            }
            let pid = ctl2.GetProcessId().unwrap_or(0);
            let Some(exe) = exe_path(pid) else { continue };
            // Agrupa pelo nome do executável: as várias abas/processos do Chrome viram um só.
            let key = exe_stem(&exe);
            let key = match key.as_str() {
                "steamwebhelper" => "steam".to_string(),
                _ => key,
            };
            out.push(Session { key, exe: Some(exe), system, volume, meter });
        }
        Ok(out)
    }
}

pub fn get_state() -> R<MixerState> {
    let dev = default_device()?;
    unsafe {
        let ep: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None).map_err(err)?;
        let master = ep.GetMasterVolumeLevelScalar().map_err(err)?;
        let master_muted = ep.GetMute().map(|b| b.as_bool()).unwrap_or(false);
        let master_peak = dev
            .Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
            .and_then(|m| m.GetPeakValue())
            .unwrap_or(0.0);

        let mut apps: Vec<AppInfo> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        for s in sessions(&dev)? {
            let peak = s.meter.as_ref().and_then(|m| m.GetPeakValue().ok()).unwrap_or(0.0);
            if let Some(&i) = index.get(&s.key) {
                let a = &mut apps[i];
                a.peak = a.peak.max(peak);
                continue;
            }
            let (name, icon) = match &s.exe {
                Some(p) => exe_meta(p),
                None => ("Sons do sistema".to_string(), None),
            };
            index.insert(s.key.clone(), apps.len());
            apps.push(AppInfo {
                key: s.key.clone(),
                name,
                icon,
                volume: s.volume.GetMasterVolume().unwrap_or(1.0),
                muted: s.volume.GetMute().map(|b| b.as_bool()).unwrap_or(false),
                peak,
                system: s.system,
            });
        }
        apps.sort_by(|a, b| a.system.cmp(&b.system).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));

        Ok(MixerState { device: device_name(&dev), device_kind: device_kind(&dev), master, master_muted, master_peak, apps })
    }
}

pub fn set_app_volume(key: &str, volume: f32) -> R<()> {
    let dev = default_device()?;
    let v = volume.clamp(0.0, 1.0);
    for s in sessions(&dev)?.into_iter().filter(|s| s.key == key) {
        unsafe {
            s.volume.SetMasterVolume(v, std::ptr::null()).map_err(err)?;
        }
    }
    Ok(())
}

pub fn set_app_mute(key: &str, muted: bool) -> R<()> {
    let dev = default_device()?;
    for s in sessions(&dev)?.into_iter().filter(|s| s.key == key) {
        unsafe {
            s.volume.SetMute(muted, std::ptr::null()).map_err(err)?;
        }
    }
    Ok(())
}

pub fn set_master_volume(volume: f32) -> R<()> {
    let dev = default_device()?;
    unsafe {
        let ep: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None).map_err(err)?;
        ep.SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0), std::ptr::null()).map_err(err)
    }
}

pub fn set_master_mute(muted: bool) -> R<()> {
    let dev = default_device()?;
    unsafe {
        let ep: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None).map_err(err)?;
        ep.SetMute(muted, std::ptr::null()).map_err(err)
    }
}
