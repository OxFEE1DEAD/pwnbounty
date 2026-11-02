use crate::{protocol::hex, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305,
};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use serde_json::Value;
use sha2::{Digest, Sha256, Sha512};
use x25519_dalek::{x25519, X25519_BASEPOINT_BYTES};
use zeroize::Zeroize;

pub struct E2eeSession {
    model_montgomery: [u8; 32],
    model_edwards: [u8; 32],
    response_secret: [u8; 32],
    response_public: [u8; 32],
}
impl Drop for E2eeSession {
    fn drop(&mut self) {
        self.response_secret.zeroize();
    }
}
fn cipher(shared: &mut [u8; 32]) -> Result<XChaCha20Poly1305> {
    if shared.iter().all(|b| *b == 0) {
        return Err("Invalid model ECDH peer".into());
    }
    let mut key = [0; 32];
    let derived = Hkdf::<Sha256>::new(None, shared).expand(b"ed25519_encryption", &mut key);
    shared.zeroize();
    derived.map_err(|_| "Model HKDF failed")?;
    let result = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| "Model cipher failed".into());
    key.zeroize();
    result
}
pub(crate) fn decode_hex(value: &str) -> Result<Vec<u8>> {
    if value.len() > 2_100_000 || value.len() % 2 != 0 || !value.is_ascii() {
        return Err("Invalid encrypted field size".into());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16)
                .map_err(|_| "Invalid encrypted field encoding".into())
        })
        .collect()
}
fn allowed(value: &Value, names: &[&str]) -> Result<()> {
    let object = value.as_object().ok_or("Expected E2EE object")?;
    if object.keys().any(|key| !names.contains(&key.as_str())) {
        return Err("Unsupported E2EE field".into());
    }
    Ok(())
}

impl E2eeSession {
    pub fn new(model_key: [u8; 32], seed: [u8; 32]) -> Result<Self> {
        let mut seed = zeroize::Zeroizing::new(seed);
        let point = CompressedEdwardsY(model_key)
            .decompress()
            .ok_or("Invalid Ed25519 model key")?;
        if point.is_small_order() || !point.is_torsion_free() {
            return Err("Invalid Ed25519 model subgroup".into());
        }
        let response_public = SigningKey::from_bytes(&seed).verifying_key().to_bytes();
        let mut expanded = Sha512::digest(*seed);
        seed.zeroize();
        let mut response_secret = [0; 32];
        response_secret.copy_from_slice(&expanded[..32]);
        expanded.as_mut_slice().zeroize();
        Ok(Self {
            model_montgomery: point.to_montgomery().to_bytes(),
            model_edwards: model_key,
            response_secret,
            response_public,
        })
    }
    pub fn headers(&self) -> Vec<(&'static str, String)> {
        vec![
            ("x-signing-algo", "ed25519".into()),
            ("x-client-pub-key", hex(&self.response_public)),
            ("x-model-pub-key", hex(&self.model_edwards)),
            ("x-encryption-version", "2".into()),
            ("x-encrypt-all-fields", "true".into()),
            ("x-no-aliasing", "true".into()),
        ]
    }
    pub fn encrypt_field(&self, value: &str, mut entropy: [u8; 56]) -> Result<String> {
        if value.len() > 1_048_576 {
            entropy.zeroize();
            return Err("Model field too large".into());
        }
        let mut secret = [0; 32];
        secret.copy_from_slice(&entropy[..32]);
        let public = x25519(secret, X25519_BASEPOINT_BYTES);
        let mut shared = x25519(secret, self.model_montgomery);
        secret.zeroize();
        let encrypted = cipher(&mut shared).and_then(|c| {
            c.encrypt(entropy[32..].as_ref().into(), value.as_bytes())
                .map_err(|_| "Model encryption failed".into())
        });
        let mut wire = Vec::with_capacity(value.len() + 72);
        wire.extend_from_slice(&public);
        wire.extend_from_slice(&entropy[32..]);
        entropy.zeroize();
        wire.extend_from_slice(&encrypted?);
        Ok(hex(&wire))
    }
    pub fn decrypt_field(&self, value: &str) -> Result<String> {
        if value.is_empty() {
            return Ok(String::new());
        }
        let bytes = decode_hex(value)?;
        if bytes.len() < 72 {
            return Err("Truncated model encrypted field".into());
        }
        let peer = bytes[..32].try_into().map_err(|_| "Invalid model peer")?;
        let mut shared = x25519(self.response_secret, peer);
        let plain = cipher(&mut shared)?
            .decrypt(bytes[32..56].as_ref().into(), &bytes[56..])
            .map_err(|_| "Model field authentication failed")?;
        String::from_utf8(plain).map_err(|_| "Invalid model field UTF-8".into())
    }
    pub fn encrypt_chat(
        &self,
        mut body: Value,
        mut random: impl FnMut() -> Result<[u8; 56]>,
    ) -> Result<Value> {
        allowed(&body, &["model", "max_tokens", "messages", "tools"])?;
        let messages = body
            .get_mut("messages")
            .and_then(Value::as_array_mut)
            .ok_or("Missing messages")?;
        for message in messages {
            allowed(message, &["role", "content", "tool_calls", "tool_call_id"])?;
            if let Some(content) = message.get_mut("content") {
                if let Some(text) = content.as_str() {
                    *content = Value::String(self.encrypt_field(text, random()?)?);
                } else if !content.is_null() {
                    return Err("Unsupported message content".into());
                }
            }
            if let Some(calls) = message.get_mut("tool_calls") {
                for call in calls.as_array_mut().ok_or("Invalid tool calls")? {
                    allowed(call, &["id", "type", "function"])?;
                    let function = call.get_mut("function").ok_or("Missing tool function")?;
                    allowed(function, &["name", "arguments"])?;
                    for field in ["name", "arguments"] {
                        let value = function.get_mut(field).ok_or("Missing tool field")?;
                        *value = Value::String(self.encrypt_field(
                            value.as_str().ok_or("Invalid tool field")?,
                            random()?,
                        )?);
                    }
                }
            }
        }
        if let Some(tools) = body.get_mut("tools") {
            for tool in tools.as_array_mut().ok_or("Invalid tools")? {
                allowed(tool, &["type", "function"])?;
                let function = tool.get_mut("function").ok_or("Missing tool schema")?;
                allowed(function, &["name", "description", "parameters"])?;
                for field in ["name", "description"] {
                    if let Some(value) = function.get_mut(field) {
                        *value = Value::String(self.encrypt_field(
                            value.as_str().ok_or("Invalid tool schema field")?,
                            random()?,
                        )?);
                    }
                }
                if let Some(schema) = function.get_mut("parameters") {
                    *schema = Value::String(self.encrypt_field(&schema.to_string(), random()?)?);
                }
            }
        }
        Ok(body)
    }
    pub fn decrypt_chat(&self, mut body: Value) -> Result<Value> {
        let choices = body
            .get_mut("choices")
            .and_then(Value::as_array_mut)
            .ok_or("Missing model choices")?;
        for choice in choices {
            let message = choice
                .get_mut("message")
                .ok_or("Missing model response message")?;
            for field in ["content", "reasoning_content", "reasoning", "refusal"] {
                if let Some(value) = message.get_mut(field) {
                    if let Some(text) = value.as_str() {
                        *value = Value::String(self.decrypt_field(text)?);
                    } else if !value.is_null() {
                        return Err("Unsupported encrypted response field".into());
                    }
                }
            }
            if let Some(calls) = message.get_mut("tool_calls") {
                for call in calls.as_array_mut().ok_or("Invalid encrypted tool calls")? {
                    let function = call
                        .get_mut("function")
                        .ok_or("Missing encrypted tool function")?;
                    for field in ["name", "arguments"] {
                        let value = function
                            .get_mut(field)
                            .ok_or("Missing encrypted tool field")?;
                        *value = Value::String(self.decrypt_field(
                            value.as_str().ok_or("Invalid encrypted tool field")?,
                        )?);
                    }
                }
            }
        }
        Ok(body)
    }
}
