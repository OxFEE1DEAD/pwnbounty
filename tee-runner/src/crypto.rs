use crate::Result;
use aes_gcm::{
    aead::{AeadInPlace, KeyInit},
    Aes256Gcm, Nonce, Tag,
};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{x25519, X25519_BASEPOINT_BYTES};

pub fn public_key(secret: [u8; 32]) -> [u8; 32] {
    x25519(secret, X25519_BASEPOINT_BYTES)
}

fn cipher(secret: [u8; 32], peer: [u8; 32], salt: &[u8]) -> Result<Aes256Gcm> {
    let shared = x25519(secret, peer);
    if shared == [0; 32] {
        return Err("Invalid X25519 peer".into());
    }
    let mut key = [0; 32];
    Hkdf::<Sha256>::new(Some(salt), &shared)
        .expand(b"sealed-bounty/envelope/1", &mut key)
        .map_err(|_| "Invalid HKDF")?;
    Aes256Gcm::new_from_slice(&key).map_err(|_| "Invalid AES key".into())
}

pub fn open(envelope: &[u8], secret: [u8; 32], context: &str) -> Result<Vec<u8>> {
    if !(93..=1_048_576).contains(&envelope.len()) || envelope[0] != 1 {
        return Err("Invalid envelope".into());
    }
    let peer = envelope[1..33].try_into().map_err(|_| "Invalid peer")?;
    let cipher = cipher(secret, peer, &envelope[33..65])?;
    let mut body = envelope[93..].to_vec();
    cipher
        .decrypt_in_place_detached(
            Nonce::from_slice(&envelope[65..77]),
            context.as_bytes(),
            &mut body,
            Tag::from_slice(&envelope[77..93]),
        )
        .map_err(|_| "Envelope authentication failed")?;
    Ok(body)
}

pub fn seal(
    plain: &[u8],
    recipient: [u8; 32],
    context: &str,
    entropy: &[u8; 76],
) -> Result<Vec<u8>> {
    if plain.len() > 1_048_576 - 93 {
        return Err("Plaintext too large".into());
    }
    let secret: [u8; 32] = entropy[..32].try_into().map_err(|_| "Invalid entropy")?;
    let cipher = cipher(secret, recipient, &entropy[32..64])?;
    let mut body = plain.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(
            Nonce::from_slice(&entropy[64..]),
            context.as_bytes(),
            &mut body,
        )
        .map_err(|_| "Encryption failed")?;
    let mut envelope = Vec::with_capacity(93 + body.len());
    envelope.push(1);
    envelope.extend_from_slice(&public_key(secret));
    envelope.extend_from_slice(&entropy[32..]);
    envelope.extend_from_slice(&tag);
    envelope.extend_from_slice(&body);
    Ok(envelope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::Deserialize;
    use sha2::Digest;

    #[derive(Deserialize)]
    struct Vector {
        context: String,
        plaintext: String,
        ciphertext: String,
    }

    #[test]
    fn opens_typescript_envelope_and_rejects_tampering() {
        let vector: Vector =
            serde_json::from_str(include_str!("../../fixtures/interop-report.json")).unwrap();
        let secret: [u8; 32] =
            Sha256::digest(b"sealed-bounty interop fixture only, never use as a real key").into();
        let envelope = STANDARD.decode(&vector.ciphertext).unwrap();
        assert_eq!(
            open(&envelope, secret, &vector.context).unwrap(),
            vector.plaintext.as_bytes()
        );
        assert!(open(&envelope, secret, "wrong context").is_err());
        let mut altered = envelope;
        let last = altered.len() - 1;
        altered[last] ^= 1;
        assert!(open(&altered, secret, &vector.context).is_err());
    }
}
