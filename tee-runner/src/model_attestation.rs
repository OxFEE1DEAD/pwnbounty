use crate::{
    model_e2ee::decode_hex,
    protocol::{canonical, digest, hex},
    Result,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use p256::ecdsa::{signature::Verifier, Signature as P256Signature, VerifyingKey as P256Key};
use p384::ecdsa::{Signature as P384Signature, VerifyingKey as P384Key};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256, Sha384};
use x509_cert::{
    der::{oid::ObjectIdentifier, Decode, Encode},
    Certificate,
};

#[derive(Deserialize, Serialize, Clone)]
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

impl ModelPolicy {
    pub fn hash(&self) -> Result<String> {
        let value = serde_json::to_value(self).map_err(|_| "Invalid model policy")?;
        Ok(hex(&digest(canonical(&value)?.as_bytes())))
    }
    pub fn require_hash(&self, expected: &str) -> Result<()> {
        crate::protocol::hash_field(expected)?;
        if self.hash()? != expected {
            return Err("Model policy differs from funded bounty".into());
        }
        Ok(())
    }
}

pub struct AttestedModel {
    pub key: [u8; 32],
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
const INTEL_ROOT_SHA256: &str = "44a0196b2b99f889b8e149e95b807a350e7424964399e885a7cbb8ccfab674d3";
const INTEL_QE_MRSIGNER: &str = "dc9e2a7c6f948f17474e34a7fc43ed030f7c1563f1babddf6340c82e0e54a8c5";
const ECDSA_SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.2");

fn field(body: &[u8], offset: usize, len: usize) -> String {
    hex(&body[offset..offset + len])
}

fn bytes(data: &[u8], start: usize, len: usize) -> Result<&[u8]> {
    start
        .checked_add(len)
        .and_then(|end| data.get(start..end))
        .ok_or_else(|| "Truncated attestation evidence".into())
}

fn le(data: &[u8], at: usize, len: usize) -> Result<usize> {
    Ok(bytes(data, at, len)?
        .iter()
        .rev()
        .fold(0, |n, b| n << 8 | *b as usize))
}

fn p256_signature(raw: &[u8]) -> Result<P256Signature> {
    P256Signature::from_slice(raw).map_err(|_| "Invalid P-256 signature".into())
}

fn subject_key(cert: &Certificate) -> Result<P256Key> {
    P256Key::from_sec1_bytes(
        cert.tbs_certificate
            .subject_public_key_info
            .subject_public_key
            .raw_bytes(),
    )
    .map_err(|_| "Invalid certificate key".into())
}

fn pck_key(pem: &[u8], now: u64) -> Result<P256Key> {
    let pem = std::str::from_utf8(pem).map_err(|_| "Invalid PCK chain")?;
    let chain = pem
        .split("-----BEGIN CERTIFICATE-----")
        .skip(1)
        .map(|block| {
            let body = block.split("-----END CERTIFICATE-----").next();
            let der = STANDARD
                .decode(body.unwrap_or_default().split_whitespace().collect::<String>())
                .map_err(|_| "Invalid PCK certificate")?;
            let cert = Certificate::from_der(&der).map_err(|_| "Invalid PCK certificate")?;
            Ok((hex(&Sha256::digest(&der)), cert))
        })
        .collect::<Result<Vec<_>>>()?;
    if chain.len() != 3 || chain[2].0 != INTEL_ROOT_SHA256 {
        return Err("PCK chain does not end at pinned Intel root".into());
    }
    for (i, (_, cert)) in chain.iter().enumerate() {
        let issuer = &chain[(i + 1).min(2)].1;
        let tbs = &cert.tbs_certificate;
        let signed = tbs.to_der().map_err(|_| "Invalid PCK certificate")?;
        let signature = P256Signature::from_der(cert.signature.raw_bytes())
            .map_err(|_| "Invalid PCK certificate signature")?;
        if tbs.issuer != issuer.tbs_certificate.subject
            || cert.signature_algorithm.oid != ECDSA_SHA256
            || tbs.validity.not_before.to_unix_duration().as_secs() > now
            || tbs.validity.not_after.to_unix_duration().as_secs() < now
            || subject_key(issuer)?.verify(&signed, &signature).is_err()
        {
            return Err("Invalid PCK certificate chain".into());
        }
    }
    subject_key(&chain[0].1)
}

fn verify_quote_signature(quote: &[u8], now: u64) -> Result<()> {
    let data = bytes(quote, QUOTE_MIN + 4, le(quote, QUOTE_MIN, 4)?)?;
    if le(data, 128, 2)? != 6 {
        return Err("Unsupported quote certification data".into());
    }
    let certification = bytes(data, 134, le(data, 130, 4)?)?;
    let qe_report = bytes(certification, 0, 384)?;
    let auth_len = le(certification, 448, 2)?;
    let qe_auth = bytes(certification, 450, auth_len)?;
    let auth_end = 450 + auth_len;
    if le(certification, auth_end, 2)? != 5 {
        return Err("Missing PCK certificate chain".into());
    }
    let pem = bytes(certification, auth_end + 6, le(certification, auth_end + 2, 4)?)?;
    let qe_signature = p256_signature(bytes(certification, 384, 64)?)?;
    if pck_key(pem, now)?.verify(qe_report, &qe_signature).is_err() {
        return Err("Invalid QE report signature".into());
    }
    if hex(&qe_report[128..160]) != INTEL_QE_MRSIGNER {
        return Err("Unexpected quoting enclave signer".into());
    }
    let attestation_key = bytes(data, 64, 64)?;
    let binding = Sha256::new()
        .chain_update(attestation_key)
        .chain_update(qe_auth)
        .finalize();
    if qe_report[320..352] != binding[..] || qe_report[352..384].iter().any(|b| *b != 0) {
        return Err("Attestation key not bound to QE report".into());
    }
    let attestation_key = P256Key::from_sec1_bytes(&[&[4u8][..], attestation_key].concat())
        .map_err(|_| "Invalid attestation key")?;
    if attestation_key
        .verify(&quote[..QUOTE_MIN], &p256_signature(bytes(data, 0, 64)?)?)
        .is_err()
    {
        return Err("Invalid quote signature".into());
    }
    Ok(())
}

fn jwt(token: &str, keys: &[(String, P384Key)], nonce: &[u8; 32], now: u64) -> Result<Value> {
    let invalid = || "Invalid NRAS token".to_string();
    let mut parts = token.split('.');
    let (Some(header), Some(claims), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid());
    };
    let decode = |part: &str| -> Result<Value> {
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).map_err(|_| invalid())?)
            .map_err(|_| invalid())
    };
    let (header_json, claims_json) = (decode(header)?, decode(claims)?);
    let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| invalid())?;
    let signature = P384Signature::from_slice(&signature).map_err(|_| invalid())?;
    let key = keys
        .iter()
        .find(|(kid, _)| header_json["kid"] == kid.as_str())
        .map(|(_, key)| key);
    if header_json["alg"] != "ES384"
        || !key.is_some_and(|key| {
            key.verify(format!("{header}.{claims}").as_bytes(), &signature)
                .is_ok()
        })
    {
        return Err("Invalid NRAS token signature".into());
    }
    if claims_json["iss"] != "https://nras.attestation.nvidia.com"
        || claims_json["eat_nonce"] != hex(nonce).as_str()
        || !claims_json["exp"].as_u64().is_some_and(|exp| exp > now)
        || !claims_json["nbf"].as_u64().is_some_and(|nbf| nbf <= now + 60)
    {
        return Err("Stale or foreign NRAS token".into());
    }
    Ok(claims_json)
}

pub fn verify_gpu(nras: &[u8], jwks: &[u8], nonce: &[u8; 32], now: u64) -> Result<()> {
    let jwks: Value = serde_json::from_slice(jwks).map_err(|_| "Invalid NVIDIA JWKS")?;
    let keys: Vec<(String, P384Key)> = jwks["keys"]
        .as_array()
        .ok_or("Invalid NVIDIA JWKS")?
        .iter()
        .filter(|k| k["kty"] == "EC" && k["crv"] == "P-384")
        .filter_map(|k| {
            let x = URL_SAFE_NO_PAD.decode(k["x"].as_str()?).ok()?;
            let y = URL_SAFE_NO_PAD.decode(k["y"].as_str()?).ok()?;
            let key = P384Key::from_sec1_bytes(&[&[4u8][..], &x, &y].concat()).ok()?;
            Some((k["kid"].as_str()?.to_string(), key))
        })
        .collect();
    let nras: Value = serde_json::from_slice(nras).map_err(|_| "Invalid NRAS response")?;
    let (Some("JWT"), Some(token), Some(gpus)) = (
        nras[0][0].as_str(),
        nras[0][1].as_str(),
        nras[1].as_object(),
    ) else {
        return Err("Invalid NRAS response".into());
    };
    let overall = jwt(token, &keys, nonce, now)?;
    if overall["x-nvidia-overall-att-result"] != true {
        return Err("GPU attestation failed".into());
    }
    if gpus.is_empty() || overall["submods"].as_object().map(|s| s.len()) != Some(gpus.len()) {
        return Err("GPU set mismatch".into());
    }
    for token in gpus.values() {
        let claims = jwt(
            token.as_str().ok_or("Invalid NRAS response")?,
            &keys,
            nonce,
            now,
        )?;
        let verified = claims.as_object().is_some_and(|claims| {
            claims
                .iter()
                .filter(|(name, _)| {
                    name.starts_with("x-nvidia-")
                        && ["-verified", "-validated", "-match"]
                            .iter()
                            .any(|suffix| name.ends_with(suffix))
                })
                .all(|(_, value)| *value == true)
        });
        if claims["measres"] != "success"
            || claims["secboot"] != true
            || claims["dbgstat"] != "disabled"
            || !claims
                .get("x-nvidia-attestation-warning")
                .is_some_and(Value::is_null)
            || !verified
        {
            return Err("GPU claims rejected".into());
        }
    }
    Ok(())
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

fn check(
    attestation: &Attestation,
    policy: &ModelPolicy,
    nonce: &[u8; 32],
    now: u64,
) -> Result<[u8; 32]> {
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
    verify_quote_signature(&quote, now)?;
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

pub fn verify(
    report: &[u8],
    policy: &ModelPolicy,
    nonce: &[u8; 32],
    now: u64,
) -> Result<([u8; 32], String)> {
    let report: Report =
        serde_json::from_slice(report).map_err(|_| "Invalid model attestation report")?;
    report
        .model_attestations
        .iter()
        .take(16)
        .find_map(|attestation| {
            check(attestation, policy, nonce, now)
                .ok()
                .map(|key| (key, attestation.nvidia_payload.clone()))
        })
        .ok_or("No model attestation satisfies policy".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_hash_matches_typescript_canonical_hash() {
        let policy: ModelPolicy =
            serde_json::from_str(include_str!("../../fixtures/model-policy/qwen3.8-27b.json"))
                .unwrap();
        assert_eq!(
            policy.hash().unwrap(),
            "4903e892169b6638b8c9c2f1fffc0fb3da6b6a486ac744cdef113f2f5ec8c94c"
        );
        policy
            .require_hash("4903e892169b6638b8c9c2f1fffc0fb3da6b6a486ac744cdef113f2f5ec8c94c")
            .unwrap();
        assert!(policy.require_hash(&"0".repeat(64)).is_err());
    }
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
    let now = wasi::clocks::wall_clock::now().seconds;
    let mut attempts = 5;
    let (key, gpu_evidence) = loop {
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
        attempts -= 1;
        match verify(&response.body, policy, nonce, now) {
            Err(_) if attempts > 0 => continue,
            result => break result?,
        }
    };
    let timeout = std::time::Duration::from_secs(30);
    let host = "nras.attestation.nvidia.com";
    let nras = crate::http::post_json(
        host,
        "/v3/attest/gpu",
        &[],
        gpu_evidence.as_bytes(),
        timeout,
        1_000_000,
    )?;
    let jwks = crate::http::get(host, "/.well-known/jwks.json", &[], timeout, 1_000_000)?;
    if nras.status != 200 || jwks.status != 200 {
        return Err(format!("GPU attestation HTTP {}/{}", nras.status, jwks.status));
    }
    verify_gpu(&nras.body, &jwks.body, nonce, now)?;
    Ok(AttestedModel { key })
}
