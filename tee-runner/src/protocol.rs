use crate::{
    rule::{Op, Rule, Var},
    Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Policy {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_recipients: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_transfer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule: Option<String>,
}

impl Policy {
    pub fn rule(&self) -> Result<Rule> {
        match (&self.rule, &self.max_transfer) {
            (Some(text), None) if self.allowed_recipients.is_empty() => Rule::parse(text),
            (None, Some(max)) => {
                if !(1..=256).contains(&self.allowed_recipients.len()) {
                    return Err("Invalid recipients".into());
                }
                let mut unique = HashSet::new();
                for recipient in &self.allowed_recipients {
                    account(recipient)?;
                    if !unique.insert(recipient) {
                        return Err("Duplicate recipient".into());
                    }
                }
                Ok(Rule::And(
                    Box::new(Rule::In(self.allowed_recipients.clone())),
                    Box::new(Rule::Cmp(Var::Amount, Op::Le, amount(max)?)),
                ))
            }
            _ => Err("Invalid policy".into()),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TargetConfig {
    pub model: String,
    pub prompt: String,
    pub policy: Policy,
    pub initial_balance: String,
    pub enforce_policy: bool,
    pub max_steps: u8,
    pub timeout_ms: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_policy_hash: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub network: String,
    pub contract: String,
    pub bounty: String,
    pub hunter: String,
    pub submission: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verdict {
    pub version: String,
    pub network: String,
    pub contract: String,
    pub bounty: String,
    pub hunter: String,
    pub submission: String,
    pub rules_hash: String,
    pub report_hash: String,
    pub valid: bool,
    pub disclosure_hash: String,
    pub expires: String,
}

pub fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_field(value: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err("Invalid hash".into())
    }
}

pub fn amount(value: &str) -> Result<u128> {
    if value.is_empty()
        || value.len() > 39
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("Invalid amount".into());
    }
    value.parse().map_err(|_| "Amount exceeds u128".into())
}

pub fn account(value: &str) -> Result<()> {
    let mut separator = true;
    if !(2..=64).contains(&value.len()) {
        return Err("Invalid account".into());
    }
    for b in value.bytes() {
        if b.is_ascii_lowercase() || b.is_ascii_digit() {
            separator = false;
        } else if b"._-".contains(&b) && !separator {
            separator = true;
        } else {
            return Err("Invalid account".into());
        }
    }
    if separator {
        return Err("Invalid account".into());
    }
    Ok(())
}

pub fn canonical(value: &Value) -> Result<String> {
    match value {
        Value::Array(items) => Ok(format!(
            "[{}]",
            items
                .iter()
                .map(canonical)
                .collect::<Result<Vec<_>>>()?
                .join(",")
        )),
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            let pairs = keys
                .into_iter()
                .map(|key| {
                    Ok(format!(
                        "{}:{}",
                        serde_json::to_string(key).map_err(|_| "JSON key")?,
                        canonical(&map[key])?
                    ))
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(format!("{{{}}}", pairs.join(",")))
        }
        Value::Number(number) if number.as_i64().is_none() && number.as_u64().is_none() => {
            Err("Only integer JSON numbers are supported".into())
        }
        _ => serde_json::to_string(value).map_err(|_| "Invalid JSON".into()),
    }
}

impl TargetConfig {
    pub fn validate(&self) -> Result<()> {
        if self.model.is_empty()
            || self.model.chars().count() > 256
            || self.prompt.len() > 65536
            || !(1..=20).contains(&self.max_steps)
            || !(1..=120000).contains(&self.timeout_ms)
            || self
                .model_policy_hash
                .as_ref()
                .is_some_and(|hash| hash_field(hash).is_err())
        {
            return Err("Invalid target limits".into());
        }
        self.policy.rule()?;
        amount(&self.initial_balance)?;
        Ok(())
    }
    pub fn rules_hash(&self) -> Result<String> {
        self.validate()?;
        Ok(hex(&digest(canonical(&json!(self))?.as_bytes())))
    }
}

impl Context {
    pub fn validate(&self) -> Result<()> {
        if self.network != "mainnet" && self.network != "testnet" {
            return Err("Invalid network".into());
        }
        account(&self.contract)?;
        account(&self.hunter)?;
        if amount(&self.bounty)? > u64::MAX as u128 {
            return Err("Invalid bounty".into());
        }
        hash_field(&self.submission)
    }
    pub fn commitment(&self, nonce: &str, attack: &str) -> Result<String> {
        self.validate()?;
        hash_field(nonce)?;
        if attack.len() > 65536 {
            return Err("Attack too large".into());
        }
        Ok(hex(&digest(
            canonical(&json!(["sealed-bounty/report/1", self, nonce, attack]))?.as_bytes(),
        )))
    }
}

impl Verdict {
    pub fn message(&self) -> Result<[u8; 32]> {
        Context {
            network: self.network.clone(),
            contract: self.contract.clone(),
            bounty: self.bounty.clone(),
            hunter: self.hunter.clone(),
            submission: self.submission.clone(),
        }
        .validate()?;
        if self.version != "1" || amount(&self.expires)? > u64::MAX as u128 {
            return Err("Invalid verdict".into());
        }
        for field in [&self.rules_hash, &self.report_hash, &self.disclosure_hash] {
            hash_field(field)?;
        }
        let encoded = serde_json::to_vec(&json!([
            "sealed-bounty/verdict/1",
            self.network,
            self.contract,
            self.bounty,
            self.hunter,
            self.submission,
            self.rules_hash,
            self.report_hash,
            self.valid,
            self.disclosure_hash,
            self.expires
        ]))
        .map_err(|_| "Invalid verdict JSON")?;
        Ok(digest(&encoded))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn funded_rules_hash_matches_typescript_with_model_policy_pin() {
        let mut config: TargetConfig =
            serde_json::from_str(include_str!("../../fixtures/targets/vulnerable.json")).unwrap();
        config.model_policy_hash =
            Some("4f1190fd7dc6ed7c65e718bc85909591c7f1658512ba534871e07f4d9481b087".into());
        assert_eq!(
            config.rules_hash().unwrap(),
            "2ccc7beec3839dc02622b5151c20756f731af54ee2d3f6fbbb0ae506f956a2a3"
        );
    }
}
