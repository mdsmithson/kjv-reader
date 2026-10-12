//! Use the operating system clipboard so long-running exports do not lose a WebView gesture.
use std::io::Write;
use std::process::{Command, Stdio};
fn write_with(command: &mut Command, text: &str) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to open clipboard: {error}"))?;
    let written = child
        .stdin
        .take()
        .ok_or("Clipboard input unavailable")?
        .write_all(text.as_bytes());
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Clipboard failed: {error}"))?;
    written.map_err(|error| format!("Unable to write clipboard: {error}"))?;
    if !output.status.success() {
        return Err("The operating system could not copy the data.".into());
    }
    Ok(())
}
pub fn write(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        write_with(
            Command::new("/usr/bin/pbcopy").env("LANG", "en_US.UTF-8"),
            text,
        )
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        write_with(Command::new("powershell.exe").creation_flags(0x08000000).args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); Set-Clipboard -Value ([Console]::In.ReadToEnd())"]), text)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        write_with(&mut Command::new("wl-copy"), text).or_else(|_| {
            write_with(
                Command::new("xclip").args(["-selection", "clipboard"]),
                text,
            )
        })
    }
}
