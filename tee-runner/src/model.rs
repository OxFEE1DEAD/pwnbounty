use crate::{
    agent::{Message, Model, ModelReply, ToolCall},
    http,
    model_attestation::{self, AttestedModel, ModelPolicy},
    model_e2ee::E2eeSession,
    Result,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};

pub struct NearAiModel {
    api_key: String,
    e2ee: Option<(String, E2eeSession)>,
}

fn entropy() -> Result<[u8; 56]> {
    wasi::random::random::get_random_bytes(56)
        .try_into()
        .map_err(|_| "Invalid TEE entropy size".into())
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Payment {
    recipient: String,
    amount: String,
}

impl NearAiModel {
    pub fn development(api_key: String) -> Result<Self> {
        if api_key.is_empty() || api_key.len() > 4096 || api_key.contains(['\r', '\n']) {
            return Err("Invalid NEAR AI API key".into());
        }
        Ok(Self {
            api_key,
            e2ee: None,
        })
    }
    pub fn attested(
        api_key: String,
        policy: &ModelPolicy,
        nonce: [u8; 32],
        seed: [u8; 32],
    ) -> Result<(Self, AttestedModel)> {
        let mut model = Self::development(api_key)?;
        let attested = model_attestation::fetch(&model.api_key, policy, &nonce)?;
        model.e2ee = Some((policy.model.clone(), E2eeSession::new(attested.key, seed)?));
        Ok((model, attested))
    }
}

impl Model for NearAiModel {
    fn complete(
        &mut self,
        model: &str,
        messages: &[Message],
        timeout: Duration,
    ) -> Result<ModelReply> {
        let messages: Vec<Value> = messages.iter().map(|message| {
            let mut value = json!({"role": message.role, "content": message.content});
            if let Some(id) = &message.tool_call_id { value["tool_call_id"] = json!(id); }
            if let Some(calls) = &message.calls {
                if !calls.is_empty() {
                    value["tool_calls"] = json!(calls.iter().map(|call| json!({
                        "id": call.id, "type": "function", "function": {"name": "transfer",
                        "arguments": json!({"recipient":call.recipient,"amount":call.amount}).to_string()}
                    })).collect::<Vec<_>>());
                }
            }
            value
        }).collect();
        let mut body = json!({
            "model":model,"max_tokens":8192,"messages":messages,
            "tools":[{"type":"function","function":{"name":"transfer",
                "description":"Execute a payment in the isolated test ledger.",
                "parameters":{"type":"object","properties":{"recipient":{"type":"string"},
                    "amount":{"type":"string","description":"Positive integer units as decimal string"}},
                    "required":["recipient","amount"],"additionalProperties":false}}}]
        });
        let authorization = format!("Bearer {}", self.api_key);
        let mut headers = vec![("authorization", authorization)];
        if let Some((attested, session)) = &self.e2ee {
            if attested != model {
                return Err("Model differs from attested policy".into());
            }
            body = session.encrypt_chat(body, entropy)?;
            headers.extend(session.headers());
        }
        let body = serde_json::to_vec(&body).map_err(|_| "Invalid model request")?;
        let headers: Vec<(&str, &str)> = headers.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let response = http::post_json(
            "cloud-api.near.ai",
            "/v1/chat/completions",
            &headers,
            &body,
            timeout,
            262144,
        )?;
        if !(200..300).contains(&response.status) {
            return Err(format!("NEAR AI HTTP {}", response.status));
        }
        let mut data: Value =
            serde_json::from_slice(&response.body).map_err(|_| "Invalid model response JSON")?;
        if let Some((_, session)) = &self.e2ee {
            data = session.decrypt_chat(data)?;
        }
        let choice = data
            .get("choices")
            .and_then(|choices| choices.get(0))
            .ok_or("Missing model choice")?;
        if choice.get("finish_reason").and_then(Value::as_str) == Some("length") {
            return Err("Model response truncated".into());
        }
        let message = choice
            .get("message")
            .and_then(Value::as_object)
            .ok_or("Missing model message")?;
        let text = match message.get("content") {
            Some(Value::Null) => String::new(),
            Some(Value::String(text)) if text.len() <= 65536 => text.clone(),
            _ => return Err("Invalid model message content".into()),
        };
        let raw = match message.get("tool_calls") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(calls)) if calls.len() <= 8 => calls.clone(),
            _ => return Err("Invalid model tool calls".into()),
        };
        let mut ids = HashSet::new();
        let mut calls = Vec::new();
        for call in raw {
            let id = call
                .get("id")
                .and_then(Value::as_str)
                .ok_or("Missing tool call ID")?;
            if id.is_empty()
                || id.len() > 128
                || !ids.insert(id.to_owned())
                || call.get("type").and_then(Value::as_str) != Some("function")
            {
                return Err("Invalid tool call".into());
            }
            let function = call.get("function").ok_or("Missing tool function")?;
            if function.get("name").and_then(Value::as_str) != Some("transfer") {
                return Err("Unsupported tool function".into());
            }
            let args = function
                .get("arguments")
                .and_then(Value::as_str)
                .ok_or("Missing tool arguments")?;
            let payment: Payment = serde_json::from_str(args).unwrap_or_default();
            calls.push(ToolCall {
                id: id.into(),
                recipient: payment.recipient,
                amount: payment.amount,
            });
        }
        Ok(ModelReply {
            message: text,
            calls,
        })
    }
}
