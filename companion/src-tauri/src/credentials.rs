//! The only boundary that can read the cloud credential or call Anthropic.
//! Secrets never enter Tauri events, logs, the WebView, or persisted app data.

use serde::Deserialize;

const SERVICE: &str = "ai.eudonomia.companion";
const ACCOUNT: &str = "anthropic-api-key";
const SUPPORTED_MODEL: &str = "claude-sonnet-5";
const MAX_TOKENS: u32 = 700;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRequest {
    pub prompt: String,
}

fn valid_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 512 || !key.starts_with("sk-") {
        return Err("invalid Anthropic API key".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn read_key() -> Result<String, String> {
    security_framework::passwords::get_generic_password(SERVICE, ACCOUNT)
        .map_err(|_| "Anthropic API key is not configured".to_string())
        .and_then(|bytes| String::from_utf8(bytes).map_err(|_| "stored Anthropic API key is invalid".to_string()))
}

#[cfg(target_os = "macos")]
pub fn set_cloud_api_key(key: String) -> Result<(), String> {
    valid_key(&key)?;
    security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, key.trim().as_bytes())
        .map_err(|_| "could not save Anthropic API key to Keychain".to_string())
}

#[cfg(target_os = "macos")]
pub fn delete_cloud_api_key() -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()), // errSecItemNotFound
        Err(_) => Err("could not remove Anthropic API key from Keychain".to_string()),
    }
}

#[cfg(target_os = "macos")]
pub fn has_cloud_api_key() -> Result<bool, String> {
    match security_framework::passwords::get_generic_password(SERVICE, ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(|key| !key.trim().is_empty())
            .map_err(|_| "stored Anthropic API key is invalid".to_string()),
        Err(error) if error.code() == -25300 => Ok(false),
        Err(_) => Err("could not read Anthropic API key from Keychain".to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn has_cloud_api_key() -> Result<bool, String> { Ok(false) }

#[cfg(target_os = "macos")]
fn call_cloud_model_blocking(request: CloudRequest) -> Result<String, String> {
    if request.prompt.len() > 32_000 {
        return Err("invalid cloud model request".to_string());
    }
    let key = read_key()?;
    let body = serde_json::json!({
        "model": SUPPORTED_MODEL,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "user", "content": request.prompt}],
    });
    let mut response = ureq::post("https://api.anthropic.com/v1/messages")
        .header("content-type", "application/json")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .config().timeout_global(Some(std::time::Duration::from_secs(12))).build()
        .send(body.to_string())
        .map_err(|_| "Anthropic request failed".to_string())?;
    let value: serde_json::Value = response.body_mut().read_json()
        .map_err(|_| "Anthropic returned invalid JSON".to_string())?;
    value.get("content").and_then(|content| content.as_array())
        .map(|items| items.iter().filter_map(|item| item.get("text").and_then(|text| text.as_str())).collect::<String>())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Anthropic returned no text".to_string())
}

/// Keep TLS and Keychain calls off Tauri's async executor thread.
#[cfg(target_os = "macos")]
pub async fn call_cloud_model(request: CloudRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || call_cloud_model_blocking(request))
        .await
        .map_err(|_| "cloud request worker failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::valid_key;
    #[test] fn rejects_empty_or_wrong_key() {
        assert!(valid_key("").is_err());
        assert!(valid_key("api-key").is_err());
    }
    #[test] fn accepts_anthropic_key_shape() { assert!(valid_key("sk-test").is_ok()); }
}
