//! Coisas do sistema: iniciar com o Windows, abrir telas de configuração, instância única.

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::System::Threading::CreateMutexW;

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const VALUE: PCWSTR = w!("Mixi");

/// Retorna false se já existe outro Mixi aberto.
pub fn claim_single_instance() -> bool {
    unsafe {
        match CreateMutexW(None, true, w!("Local\\MixiVolumeSingleInstance")) {
            // O handle nunca é fechado: o mutex fica preso enquanto o app vive.
            Ok(_handle) => GetLastError() != ERROR_ALREADY_EXISTS,
            Err(_) => true,
        }
    }
}

pub fn autostart_enabled() -> bool {
    unsafe { RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, VALUE, RRF_RT_REG_SZ, None, None, None).is_ok() }
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    unsafe {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let cmd = format!("\"{}\" --hidden", exe.display());
            let data: Vec<u16> = cmd.encode_utf16().chain(std::iter::once(0)).collect();
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                RUN_KEY,
                VALUE,
                REG_SZ.0,
                Some(data.as_ptr() as _),
                (data.len() * 2) as u32,
            )
            .ok()
            .map_err(|e| e.message().to_string())
        } else {
            let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, VALUE);
            if r.is_ok() || !autostart_enabled() {
                Ok(())
            } else {
                Err("não consegui remover a inicialização automática".into())
            }
        }
    }
}

/// Abre uma tela do app Configurações (ex.: "apps-volume", "sound").
pub fn open_settings(page: &str) {
    let uri = match page {
        "sound" => "ms-settings:sound",
        _ => "ms-settings:apps-volume",
    };
    let _ = std::process::Command::new("explorer.exe").arg(uri).spawn();
}
