use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::{PtyExited, PtyOutput};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    active: Arc<std::sync::atomic::AtomicBool>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create_session(
        &self,
        tab_id: &str,
        shell: Option<String>,
        cwd: Option<&str>,
        app: AppHandle,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell_cmd = shell.unwrap_or_else(|| default_shell());
        let mut cmd = CommandBuilder::new(&shell_cmd);
        cmd.env("TERM", "xterm-256color");
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let _child = pair.slave.spawn_command(cmd)?;
        // Drop the slave side - we only interact via master
        drop(pair.slave);

        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        let active = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let active_clone = active.clone();
        let tab_id_owned = tab_id.to_string();

        // Spawn reader thread to stream output to frontend
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF - process exited
                        active_clone.store(false, std::sync::atomic::Ordering::SeqCst);
                        let _ = app.emit(
                            &format!("pty:exited:{}", tab_id_owned),
                            PtyExited {
                                tab_id: tab_id_owned.clone(),
                                exit_code: None,
                            },
                        );
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(
                            &format!("pty:output:{}", tab_id_owned),
                            PtyOutput {
                                tab_id: tab_id_owned.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => {
                        active_clone.store(false, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
                }
            }
        });

        let session = PtySession {
            writer,
            master: pair.master,
            active,
        };

        self.sessions
            .lock()
            .insert(tab_id.to_string(), session);

        Ok(())
    }

    pub fn write_to_session(
        &self,
        tab_id: &str,
        data: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(tab_id)
            .ok_or("Session not found")?;
        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize_session(
        &self,
        tab_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(tab_id)
            .ok_or("Session not found")?;
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn close_session(
        &self,
        tab_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.remove(tab_id) {
            session.active.store(false, std::sync::atomic::Ordering::SeqCst);
            // Dropping the session will close the PTY
            drop(session);
        }
        Ok(())
    }

    pub fn all_sessions_status(&self) -> Vec<(String, bool)> {
        let sessions = self.sessions.lock();
        sessions
            .iter()
            .map(|(id, s)| {
                (
                    id.clone(),
                    s.active.load(std::sync::atomic::Ordering::SeqCst),
                )
            })
            .collect()
    }

    pub fn is_active(&self, tab_id: &str) -> bool {
        let sessions = self.sessions.lock();
        sessions
            .get(tab_id)
            .map(|s| s.active.load(std::sync::atomic::Ordering::SeqCst))
            .unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

#[cfg(target_os = "windows")]
fn default_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}
