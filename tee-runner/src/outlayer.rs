use crate::{crypto, near::decode, workflow::Enclave, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use zeroize::Zeroize;

mod signing {
    wit_bindgen::generate!({ world: "signing-keys-host", path: "wit-signing" });
}
mod encryption {
    wit_bindgen::generate!({ world: "encryption-keys-host", path: "wit-encryption" });
}

const STATE_AAD: &[u8] = b"sealed-bounty/runner-state/1";
#[used]
#[link_section = "outlayer.manifest"]
static MANIFEST: [u8; include_bytes!("../manifest.json").len()] =
    *include_bytes!("../manifest.json");

#[derive(Serialize)]
pub struct Provisioning {
    pub signing_public_key: String,
    pub encryption_public_key: String,
    pub sealed_state: String,
}

pub struct OutLayerEnclave {
    secret: [u8; 32],
}

impl Drop for OutLayerEnclave {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

fn random<const N: usize>() -> Result<[u8; N]> {
    let bytes = wasi::random::random::get_random_bytes(N as u64);
    bytes
        .try_into()
        .map_err(|_| "Invalid TEE entropy size".into())
}

impl OutLayerEnclave {
    pub fn provision() -> Result<Provisioning> {
        let mut secret = random::<32>()?;
        let public = crypto::public_key(secret);
        let sealed = encryption::outlayer::encryption_keys::api::encrypt(
            "runner-state",
            None,
            &secret,
            STATE_AAD,
        );
        secret.zeroize();
        let sealed = sealed.map_err(|_| "Could not seal runner state")?;
        let signing = signing::outlayer::signing_keys::api::public_key("verdicts", None)
            .map_err(|_| "Could not obtain verdict public key")?;
        if signing.len() != 32 {
            return Err("Invalid runtime signing key size".into());
        }
        Ok(Provisioning {
            signing_public_key: STANDARD.encode(signing),
            encryption_public_key: STANDARD.encode(public),
            sealed_state: STANDARD.encode(sealed),
        })
    }
    pub fn load(sealed_state: &str) -> Result<Self> {
        let sealed = decode(sealed_state, 41, 1024)?;
        let mut plain = encryption::outlayer::encryption_keys::api::decrypt(
            "runner-state",
            None,
            &sealed,
            STATE_AAD,
        )
        .map_err(|_| "Could not open runner state")?;
        let secret = plain
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid runner state size");
        plain.zeroize();
        Ok(Self { secret: secret? })
    }
}

impl Enclave for OutLayerEnclave {
    fn public_key(&self) -> Result<[u8; 32]> {
        signing::outlayer::signing_keys::api::public_key("verdicts", None)
            .map_err(|_| "Signing key unavailable")?
            .try_into()
            .map_err(|_| "Invalid signing key size".into())
    }
    fn encryption_key(&self) -> [u8; 32] {
        crypto::public_key(self.secret)
    }
    fn open(&self, ciphertext: &[u8], context: &str) -> Result<Vec<u8>> {
        crypto::open(ciphertext, self.secret, context)
    }
    fn entropy(&self) -> Result<[u8; 76]> {
        random()
    }
    fn sign(&self, message: &[u8; 32]) -> Result<Vec<u8>> {
        signing::outlayer::signing_keys::api::sign("verdicts", None, message)
            .map_err(|_| "Verdict signing failed".into())
    }
}
