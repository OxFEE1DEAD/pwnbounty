use crate::{model_e2ee::decode_hex, protocol::hex, Result};
use serde::Deserialize;
use sha2::{Digest, Sha384};

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct ModelPolicy {
    pub model: String,
    pub mrtd: String,
    pub rtmr0: String,
    pub rtmr1: String,
    pub rtmr2: String,
    pub os_image_hash: String,
    pub compose_hash: String,
}

pub struct AttestedModel {
    pub key: [u8; 32],
    pub quote_signature_verified: bool,
    pub gpu_verified: bool,
}

#[derive(Deserialize)]
struct Report {
    model_attestations: Vec<Attestation>,
}
#[derive(Deserialize)]
struct Attestation {
    model_name: String,
    signing_algo: String,
    signing_public_key: String,
    request_nonce: String,
    intel_quote: String,
    nvidia_payload: String,
    info: Info,
}
#[derive(Deserialize)]
struct Info {
    tcb_info: Tcb,
}
#[derive(Deserialize)]
struct Tcb {
    event_log: Vec<Event>,
}
#[derive(Deserialize)]
struct Event {
    imr: u32,
    event_type: u32,
    digest: String,
    event: String,
    event_payload: String,
}
#[derive(Deserialize)]
struct Nvidia {
    nonce: String,
}

const BODY: usize = 48;
const QUOTE_MIN: usize = BODY + 584;

fn field(body: &[u8], offset: usize, len: usize) -> String {
    hex(&body[offset..offset + len])
}

fn replay_rtmr3(events: &[Event], policy: &ModelPolicy) -> Result<String> {
    let mut rtmr = [0u8; 48];
    let (mut compose, mut image) = (false, false);
    for event in events.iter().filter(|e| e.imr == 3) {
        let payload = decode_hex(&event.event_payload)?;
        let mut digest = Sha384::new();
        digest.update(event.event_type.to_le_bytes());
        digest.update(b":");
        digest.update(event.event.as_bytes());
        digest.update(b":");
        digest.update(&payload);
        let digest = digest.finalize();
        if hex(&digest) != event.digest {
            return Err("Event log digest mismatch".into());
        }
        match event.event.as_str() {
            "compose-hash" => compose = hex(&payload) == policy.compose_hash,
            "os-image-hash" => image = hex(&payload) == policy.os_image_hash,
            _ => {}
        }
        let mut next = Sha384::new();
        next.update(rtmr);
        next.update(digest);
        rtmr = next.finalize().into();
    }
    if !compose || !image {
        return Err("Model compose or OS image is not pinned".into());
    }
    Ok(hex(&rtmr))
}

fn check(attestation: &Attestation, policy: &ModelPolicy, nonce: &[u8; 32]) -> Result<[u8; 32]> {
    let key: [u8; 32] = decode_hex(&attestation.signing_public_key)?
        .try_into()
        .map_err(|_| "Invalid model key")?;
    if attestation.model_name != policy.model
        || attestation.signing_algo != "ed25519"
        || attestation.request_nonce != hex(nonce)
    {
        return Err("Model attestation identity or nonce mismatch".into());
    }
    let nvidia: Nvidia =
        serde_json::from_str(&attestation.nvidia_payload).map_err(|_| "Invalid GPU evidence")?;
    if nvidia.nonce != hex(nonce) {
        return Err("GPU evidence nonce mismatch".into());
    }
    let quote = decode_hex(&attestation.intel_quote)?;
    if quote.len() < QUOTE_MIN
        || quote[0..2] != [4, 0]
        || quote[2..4] != [2, 0]
        || quote[4..8] != [0x81, 0, 0, 0]
    {
        return Err("Unsupported TDX quote".into());
    }
    let body = &quote[BODY..QUOTE_MIN];
    if body[120] & 1 != 0 {
        return Err("Debug TD is not allowed".into());
    }
    if body[520..552] != key || body[552..584] != *nonce {
        return Err("TDX report data does not bind model key and nonce".into());
    }
    if field(body, 136, 48) != policy.mrtd
        || field(body, 328, 48) != policy.rtmr0
        || field(body, 376, 48) != policy.rtmr1
        || field(body, 424, 48) != policy.rtmr2
        || field(body, 472, 48) != replay_rtmr3(&attestation.info.tcb_info.event_log, policy)?
    {
        return Err("TDX measurements do not match model policy".into());
    }
    Ok(key)
}

pub fn verify(report: &[u8], policy: &ModelPolicy, nonce: &[u8; 32]) -> Result<AttestedModel> {
    let report: Report =
        serde_json::from_slice(report).map_err(|_| "Invalid model attestation report")?;
    report
        .model_attestations
        .iter()
        .take(16)
        .find_map(|attestation| check(attestation, policy, nonce).ok())
        .map(|key| AttestedModel {
            key,
            quote_signature_verified: false,
            gpu_verified: false,
        })
        .ok_or("No model attestation satisfies policy".into())
}

#[cfg(all(target_arch = "wasm32", target_os = "wasi"))]
pub fn fetch(api_key: &str, policy: &ModelPolicy, nonce: &[u8; 32]) -> Result<AttestedModel> {
    let model: String = policy
        .model
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    let path = format!(
        "/v1/attestation/report?model={model}&signing_algo=ed25519&nonce={}",
        hex(nonce)
    );
    let authorization = format!("Bearer {api_key}");
    let response = crate::http::get(
        "cloud-api.near.ai",
        &path,
        &[("authorization", &authorization)],
        std::time::Duration::from_secs(30),
        1_000_000,
    )?;
    if response.status != 200 {
        return Err(format!("Model attestation HTTP {}", response.status));
    }
    verify(&response.body, policy, nonce)
}
