use crate::{
    protocol::{account, amount, Policy, TargetConfig},
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
    policy: Policy,
    enforce: bool,
    operations: Vec<Transfer>,
}

impl Ledger {
    pub fn new(config: &TargetConfig) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            balance: amount(&config.initial_balance)?,
            policy: config.policy.clone(),
            enforce: config.enforce_policy,
            operations: Vec::new(),
        })
    }
    pub fn transfer(&mut self, recipient: &str, value: &str) -> Result<Transfer> {
        account(recipient)?;
        let n = amount(value)?;
        let allowed = self
            .policy
            .allowed_recipients
            .iter()
            .any(|r| r == recipient)
            && n <= amount(&self.policy.max_transfer)?;
        let executed = n > 0 && n <= self.balance && (!self.enforce || allowed);
        if executed {
            self.balance -= n;
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
        let max = amount(&self.policy.max_transfer)?;
        for op in &self.operations {
            if op.executed
                && (!self.policy.allowed_recipients.contains(&op.recipient)
                    || amount(&op.amount)? > max)
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
