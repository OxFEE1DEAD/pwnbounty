use crate::{
    ledger::{Ledger, Snapshot},
    protocol::TargetConfig,
    Result,
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolCall {
    pub id: String,
    pub recipient: String,
    pub amount: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: &'static str,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

pub struct ModelReply {
    pub message: String,
    pub calls: Vec<ToolCall>,
}

pub trait Model {
    fn complete(
        &mut self,
        model: &str,
        messages: &[Message],
        timeout: Duration,
    ) -> Result<ModelReply>;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub messages: Vec<Message>,
    #[serde(flatten)]
    pub ledger: Snapshot,
    pub budget_exhausted: bool,
    pub valid: bool,
}

fn message(role: &'static str, content: String) -> Message {
    Message {
        role,
        content,
        calls: None,
        tool_call_id: None,
    }
}

pub fn run_agent(config: &TargetConfig, attack: &str, model: &mut impl Model) -> Result<Trace> {
    config.validate()?;
    if attack.len() > 65536 {
        return Err("Attack too large".into());
    }
    let start = Instant::now();
    let budget = Duration::from_millis(config.timeout_ms.into());
    let mut ledger = Ledger::new(config)?;
    let mut messages = vec![
        message("system", config.prompt.clone()),
        message("user", attack.into()),
    ];
    let mut exhausted = true;
    for _ in 0..config.max_steps {
        let remaining = budget
            .checked_sub(start.elapsed())
            .filter(|d| !d.is_zero())
            .ok_or("Execution timeout")?;
        let response = model.complete(&config.model, &messages, remaining)?;
        if start.elapsed() >= budget {
            return Err("Execution timeout".into());
        }
        if response.calls.len() > 8 || response.message.len() > 65536 {
            return Err("Model output limit".into());
        }
        let mut ids = std::collections::HashSet::new();
        for call in &response.calls {
            if call.id.is_empty() || call.id.len() > 128 || !ids.insert(&call.id) {
                return Err("Invalid tool call ID".into());
            }
        }
        messages.push(Message {
            role: "assistant",
            content: response.message,
            calls: Some(response.calls.clone()),
            tool_call_id: None,
        });
        if response.calls.is_empty() {
            exhausted = false;
            break;
        }
        for call in response.calls {
            if start.elapsed() >= budget {
                return Err("Execution timeout".into());
            }
            let content = match ledger.transfer(&call.recipient, &call.amount) {
                Ok(op) => serde_json::to_string(&op).map_err(|_| "Invalid operation JSON")?,
                Err(_) => "{\"error\":\"Invalid payment arguments\"}".into(),
            };
            messages.push(Message {
                role: "tool",
                content,
                calls: None,
                tool_call_id: Some(call.id),
            });
        }
    }
    Ok(Trace {
        messages,
        ledger: ledger.snapshot(),
        budget_exhausted: exhausted,
        valid: ledger.violation()?,
    })
}
