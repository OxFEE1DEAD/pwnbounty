use crate::{
    http,
    protocol::{account, amount, hash_field, Context, TargetConfig},
    Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

pub struct Snapshot {
    pub hash: String,
    pub height: u64,
}

pub struct ApprovedProgram {
    pub rules_hash: String,
    pub team_key: [u8; 32],
    pub verdict_expires: String,
}

#[derive(Deserialize)]
struct Config {
    network: String,
    protocol_version: String,
}
#[derive(Deserialize)]
struct Verifier {
    public_key: String,
    encryption_key: String,
    attestation_hash: String,
}
#[derive(Deserialize)]
struct Bounty {
    owner: String,
    rules_hash: String,
    team_key: String,
    reward: String,
    expires: String,
    settle_until: String,
    state: String,
    verifier: Verifier,
}
#[derive(Deserialize)]
struct Commitment {
    report_hash: String,
    settled: bool,
}

pub fn decode(value: &str, min: usize, max: usize) -> Result<Vec<u8>> {
    if value.len() > max.div_ceil(3) * 4 {
        return Err("Base64 value too large".into());
    }
    let bytes = STANDARD.decode(value).map_err(|_| "Invalid base64")?;
    if bytes.len() < min || bytes.len() > max || STANDARD.encode(&bytes) != value {
        return Err("Invalid base64 size or encoding".into());
    }
    Ok(bytes)
}

fn height(value: &str) -> Result<u64> {
    u64::try_from(amount(value)?).map_err(|_| "Invalid block height".into())
}

pub struct NearRpc {
    network: String,
    host: &'static str,
}

impl NearRpc {
    pub fn new(network: &str) -> Result<Self> {
        let host = match network {
            "mainnet" => "rpc.mainnet.fastnear.com",
            "testnet" => "rpc.testnet.fastnear.com",
            _ => return Err("Unsupported NEAR network".into()),
        };
        Ok(Self {
            network: network.into(),
            host,
        })
    }
    fn call(&self, method: &str, params: Value) -> Result<Value> {
        let body = serde_json::to_vec(
            &json!({"jsonrpc":"2.0","id":"sealed-bounty","method":method,"params":params}),
        )
        .map_err(|_| "Invalid RPC request")?;
        let response = http::post_json(
            self.host,
            "/",
            &[],
            &body,
            Duration::from_secs(15),
            1_500_000,
        )?;
        if response.status != 200 {
            return Err(format!("NEAR RPC HTTP {}", response.status));
        }
        let value: Value =
            serde_json::from_slice(&response.body).map_err(|_| "Invalid RPC JSON")?;
        if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
            || value.get("id").and_then(Value::as_str) != Some("sealed-bounty")
            || value.get("error").is_some()
        {
            return Err("NEAR RPC rejected request or returned wrong envelope".into());
        }
        value
            .get("result")
            .cloned()
            .ok_or("Missing RPC result".into())
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let status = self.call("status", json!({}))?;
        if status.get("chain_id").and_then(Value::as_str) != Some(&self.network) {
            return Err("NEAR RPC network mismatch".into());
        }
        let block = self.call("block", json!({"finality":"final"}))?;
        let header = block.get("header").ok_or("Missing block header")?;
        let hash = header
            .get("hash")
            .and_then(Value::as_str)
            .ok_or("Missing block hash")?;
        if hash.len() < 32
            || hash.len() > 44
            || !hash
                .bytes()
                .all(|b| b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(&b))
        {
            return Err("Invalid block hash".into());
        }
        let height = header
            .get("height")
            .and_then(Value::as_u64)
            .ok_or("Invalid block height")?;
        Ok(Snapshot {
            hash: hash.into(),
            height,
        })
    }
    fn view(
        &self,
        contract: &str,
        method: &str,
        args: Value,
        snapshot: &Snapshot,
    ) -> Result<Value> {
        account(contract)?;
        let args =
            STANDARD.encode(serde_json::to_vec(&args).map_err(|_| "Invalid view arguments")?);
        let response = self.call("query", json!({"request_type":"call_function","account_id":contract,"method_name":method,"args_base64":args,"block_id":snapshot.hash}))?;
        if response.get("block_hash").and_then(Value::as_str) != Some(&snapshot.hash)
            || response.get("block_height").and_then(Value::as_u64) != Some(snapshot.height)
        {
            return Err("NEAR view snapshot mismatch".into());
        }
        let bytes: Vec<u8> = serde_json::from_value(
            response
                .get("result")
                .cloned()
                .ok_or("Missing view bytes")?,
        )
        .map_err(|_| "Invalid view bytes")?;
        if bytes.len() > 131072 {
            return Err("View result too large".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "Invalid view result JSON".into())
    }
    pub fn approve(
        &self,
        context: &Context,
        report_hash: &str,
        config: &TargetConfig,
        signing_key: &[u8; 32],
        encryption_key: &[u8; 32],
        policy_hash: &str,
    ) -> Result<ApprovedProgram> {
        context.validate()?;
        hash_field(report_hash)?;
        hash_field(policy_hash)?;
        if context.network != self.network {
            return Err("Submission network mismatch".into());
        }
        let snapshot = self.snapshot()?;
        let cfg: Config = serde_json::from_value(self.view(
            &context.contract,
            "get_config",
            json!({}),
            &snapshot,
        )?)
        .map_err(|_| "Invalid contract configuration")?;
        if cfg.network != self.network || cfg.protocol_version != "1" {
            return Err("Contract protocol mismatch".into());
        }
        let bounty: Bounty = serde_json::from_value(self.view(
            &context.contract,
            "get_bounty",
            json!({"bounty":context.bounty}),
            &snapshot,
        )?)
        .map_err(|_| "Invalid or missing bounty")?;
        let claim: Commitment = serde_json::from_value(self.view(&context.contract, "get_commitment", json!({"bounty":context.bounty,"hunter":context.hunter,"submission":context.submission}), &snapshot)?).map_err(|_| "Invalid or missing commitment")?;
        account(&bounty.owner)?;
        if amount(&bounty.reward)? == 0 {
            return Err("Invalid reward".into());
        }
        let expires = height(&bounty.expires)?;
        let settle_until = height(&bounty.settle_until)?;
        if bounty.state != "Available" || settle_until <= expires || snapshot.height > settle_until
        {
            return Err("Bounty unavailable for verification".into());
        }
        if claim.settled || claim.report_hash != report_hash {
            return Err("Commitment settled or mismatched".into());
        }
        if decode(&bounty.verifier.public_key, 32, 32)? != signing_key
            || decode(&bounty.verifier.encryption_key, 32, 32)? != encryption_key
            || bounty.verifier.attestation_hash != policy_hash
        {
            return Err("Pinned verifier mismatch".into());
        }
        if config.rules_hash()? != bounty.rules_hash {
            return Err("Pinned target configuration mismatch".into());
        }
        let team_key = decode(&bounty.team_key, 32, 32)?
            .try_into()
            .map_err(|_| "Invalid team key")?;
        Ok(ApprovedProgram {
            rules_hash: bounty.rules_hash,
            team_key,
            verdict_expires: snapshot
                .height
                .saturating_add(1000)
                .min(settle_until)
                .to_string(),
        })
    }
}
