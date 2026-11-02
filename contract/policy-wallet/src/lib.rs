use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const MAX_REQUESTS: u32 = 1_024;
const STORAGE_RESERVE: u128 = 5_000_000_000_000_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq)]
pub enum Status {
    Pending,
    Paid,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Payment {
    pub recipient: AccountId,
    pub amount: U128,
    pub status: Status,
}

#[near(serializers = [json])]
pub struct Policy {
    pub allowed_recipients: Vec<AccountId>,
    pub max_transfer: U128,
    pub available: U128,
    pub request_count: u32,
    pub max_requests: u32,
    pub storage_reserve_per_request: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PolicyWallet {
    allowed_recipients: Vec<AccountId>,
    max_transfer: U128,
    available: u128,
    request_count: u32,
    payments: LookupMap<String, Payment>,
}

#[near]
impl PolicyWallet {
    #[init]
    pub fn new(allowed_recipients: Vec<AccountId>, max_transfer: U128) -> Self {
        require!(
            !allowed_recipients.is_empty() && allowed_recipients.len() <= 32,
            "allowlist must contain 1..32 accounts"
        );
        require!(max_transfer.0 > 0, "positive transfer cap required");
        let mut recipients = allowed_recipients;
        recipients.sort();
        recipients.dedup();
        Self {
            allowed_recipients: recipients,
            max_transfer,
            available: 0,
            request_count: 0,
            payments: LookupMap::new(b"p"),
        }
    }

    #[payable]
    pub fn fund(&mut self) -> U128 {
        self.available = self
            .available
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("budget overflow");
        U128(self.available)
    }

    #[private]
    pub fn pay(&mut self, request_id: String, recipient: AccountId, amount: U128) {
        require!(
            request_id.len() == 64
                && request_id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "expected 32-byte hex request id"
        );
        require!(
            self.allowed_recipients.contains(&recipient),
            "recipient denied by policy"
        );
        require!(
            amount.0 > 0 && amount.0 <= self.max_transfer.0,
            "amount denied by policy"
        );
        if let Some(existing) = self.payments.get(&request_id) {
            require!(
                existing.recipient == recipient && existing.amount == amount,
                "request arguments changed"
            );
            if existing.status != Status::Failed {
                return;
            }
        } else {
            require!(self.request_count < MAX_REQUESTS, "request limit reached");
            require!(
                self.available
                    >= amount
                        .0
                        .checked_add(STORAGE_RESERVE)
                        .expect("amount overflow"),
                "insufficient funded budget including storage"
            );
            self.available -= STORAGE_RESERVE;
            self.request_count += 1;
        }
        require!(self.available >= amount.0, "insufficient funded budget");
        require!(
            env::prepaid_gas()
                .as_gas()
                .saturating_sub(env::used_gas().as_gas())
                >= Gas::from_tgas(35).as_gas(),
            "at least 35 Tgas remaining required"
        );
        self.available -= amount.0;
        let before = env::storage_usage();
        self.payments.insert(
            request_id.clone(),
            Payment {
                recipient: recipient.clone(),
                amount,
                status: Status::Pending,
            },
        );
        self.payments.flush();
        let storage_cost = env::storage_usage().saturating_sub(before) as u128
            * env::storage_byte_cost().as_yoctonear();
        require!(storage_cost <= STORAGE_RESERVE, "storage reserve exceeded");
        Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_payment(request_id),
            )
            .detach();
    }

    #[private]
    pub fn on_payment(&mut self, request_id: String) {
        require!(
            env::promise_results_count() == 1,
            "expected transfer result"
        );
        let mut payment = self
            .payments
            .get(&request_id)
            .cloned()
            .expect("unknown payment");
        require!(payment.status == Status::Pending, "payment not pending");
        let success = env::promise_result_checked(0, 0).is_ok();
        payment.status = if success {
            Status::Paid
        } else {
            Status::Failed
        };
        if !success {
            self.available = self
                .available
                .checked_add(payment.amount.0)
                .expect("budget overflow");
        }
        self.payments.insert(request_id.clone(), payment.clone());
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard":"sealed_bounty_policy_wallet","version":"1.0.0","event":"payment",
                "data":[{"request_id":request_id,"payment":payment}]
            })
        ));
    }

    pub fn get_payment(&self, request_id: String) -> Option<Payment> {
        self.payments.get(&request_id).cloned()
    }

    pub fn get_policy(&self) -> Policy {
        Policy {
            allowed_recipients: self.allowed_recipients.clone(),
            max_transfer: self.max_transfer,
            available: U128(self.available),
            request_count: self.request_count,
            max_requests: MAX_REQUESTS,
            storage_reserve_per_request: U128(STORAGE_RESERVE),
        }
    }
}
