use crate::{
    agent::{run_agent, Model},
    crypto,
    near::{decode, NearRpc},
    protocol::{canonical, digest, hex, Context, TargetConfig, Verdict},
    Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SealedReport {
    pub network: String,
    pub contract: String,
    pub bounty: String,
    pub hunter: String,
    pub submission: String,
    pub report_hash: String,
    pub ciphertext: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyRequest {
    pub action: String,
    pub report: SealedReport,
    pub config: TargetConfig,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PlainReport {
    nonce: String,
    attack: String,
}

#[derive(Serialize)]
pub struct VerifyOutput {
    pub verdict: Verdict,
    pub signature: String,
    pub disclosure_ciphertext: String,
}

pub trait Enclave {
    fn public_key(&self) -> Result<[u8; 32]>;
    fn encryption_key(&self) -> [u8; 32];
    fn open(&self, ciphertext: &[u8], context: &str) -> Result<Vec<u8>>;
    fn entropy(&self) -> Result<[u8; 76]>;
    fn sign(&self, message: &[u8; 32]) -> Result<Vec<u8>>;
}

pub fn verify(
    request: VerifyRequest,
    enclave: &impl Enclave,
    model: &mut impl Model,
    policy_hash: &str,
) -> Result<VerifyOutput> {
    if request.action != "verify" {
        return Err("Unsupported runner action".into());
    }
    let report = request.report;
    let context = Context {
        network: report.network,
        contract: report.contract,
        bounty: report.bounty,
        hunter: report.hunter,
        submission: report.submission,
    };
    context.validate()?;
    let ciphertext = decode(&report.ciphertext, 93, 1_048_576)?;
    let rpc = NearRpc::new(&context.network)?;
    let approved = rpc.approve(
        &context,
        &report.report_hash,
        &request.config,
        &enclave.public_key()?,
        &enclave.encryption_key(),
        policy_hash,
    )?;
    let aad = canonical(&json!(context))?;
    let plain = enclave.open(&ciphertext, &aad)?;
    if plain.len() > 131072 {
        return Err("Plain report too large".into());
    }
    let plain: PlainReport =
        serde_json::from_slice(&plain).map_err(|_| "Invalid decrypted report")?;
    if context.commitment(&plain.nonce, &plain.attack)? != report.report_hash {
        return Err("Report commitment mismatch".into());
    }
    let trace = run_agent(&request.config, &plain.attack, model)?;
    let valid = trace.valid;
    let disclosure = canonical(&json!({"context":context,"attack":plain.attack,"trace":trace}))?;
    let disclosure = crypto::seal(
        disclosure.as_bytes(),
        approved.team_key,
        &aad,
        &enclave.entropy()?,
    )?;
    let verdict = Verdict {
        version: "1".into(),
        network: context.network,
        contract: context.contract,
        bounty: context.bounty,
        hunter: context.hunter,
        submission: context.submission,
        rules_hash: approved.rules_hash,
        report_hash: report.report_hash,
        valid,
        disclosure_hash: hex(&digest(&disclosure)),
        expires: approved.verdict_expires,
    };
    let signature = enclave.sign(&verdict.message()?)?;
    if signature.len() != 64 {
        return Err("Invalid runtime signature size".into());
    }
    Ok(VerifyOutput {
        verdict,
        signature: STANDARD.encode(signature),
        disclosure_ciphertext: STANDARD.encode(disclosure),
    })
}
