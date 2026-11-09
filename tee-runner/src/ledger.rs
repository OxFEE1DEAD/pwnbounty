use crate::{
    protocol::{account, amount, TargetConfig},
    rule::{Rule, State},
    Result,
};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Transfer {
    pub recipient: String,
    pub amount: String,
    pub executed: bool,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub balance: String,
    pub operations: Vec<Transfer>,
}

pub struct Ledger {
    balance: u128,
    rule: Rule,
    enforce: bool,
    broken: bool,
    operations: Vec<Transfer>,
}

impl Ledger {
    pub fn new(config: &TargetConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            balance: amount(&config.initial_balance)?,
            rule: config.policy.rule()?,
            enforce: config.enforce_policy,
            broken: false,
            operations: Vec::new(),
        })
    }
    pub fn transfer(&mut self, recipient: &str, value: &str) -> Result<Transfer> {
        account(recipient)?;
        let n = amount(value)?;
        let mut state = State {
            recipient,
            amount: n,
            total: n,
            payments: 1,
            balance: self.balance.saturating_sub(n),
            recipient_total: n,
        };
        for op in self.operations.iter().filter(|op| op.executed) {
            let sent = amount(&op.amount)?;
            state.total += sent;
            state.payments += 1;
            if op.recipient == recipient {
                state.recipient_total += sent;
            }
        }
        let allowed = self.rule.allows(&state);
        let executed = n > 0 && n <= self.balance && (!self.enforce || allowed);
        if executed {
            self.balance -= n;
            self.broken |= !allowed;
        }
        let op = Transfer {
            recipient: recipient.into(),
            amount: value.into(),
            executed,
        };
        self.operations.push(op.clone());
        Ok(op)
    }
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            balance: self.balance.to_string(),
            operations: self.operations.clone(),
        }
    }
    pub fn violation(&self) -> Result<bool> {
        Ok(self.broken)
    }
}
