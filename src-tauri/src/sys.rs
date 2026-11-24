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

/// Nomes dos programas abertos agora (o .exe sem extensão, em minúsculas).
pub fn running_exes() -> std::collections::HashSet<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = std::collections::HashSet::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
                out.insert(name.strip_suffix(".exe").unwrap_or(&name).to_string());
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn enxerga_os_programas_abertos() {
        let open = super::running_exes();
        // o próprio teste está rodando, e o Windows sempre tem o explorer/svchost
        let me = std::env::current_exe().unwrap();
        let me = me.file_stem().unwrap().to_string_lossy().to_lowercase();
        assert!(open.contains(&me), "não achei o próprio processo ({me})");
        assert!(open.contains("svchost"));
        assert!(open.iter().all(|n| n == &n.to_lowercase() && !n.ends_with(".exe")));
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
