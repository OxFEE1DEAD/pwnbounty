use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Verifier {
    pub public_key: Base64VecU8,
    pub encryption_key: Base64VecU8,
    pub attestation_hash: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq)]
pub enum PaymentState {
    Available,
    Pending,
    Retryable,
    Paid,
    Refunding,
    Closed,
}
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Bounty {
    pub owner: AccountId,
    pub rules_hash: String,
    pub team_key: Base64VecU8,
    pub reward: U128,
    pub expires: U64,
    pub settle_until: U64,
    pub verifier: Verifier,
    pub state: PaymentState,
    pub winner: Option<AccountId>,
    pub about: Option<String>,
}
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Commitment {
    pub report_hash: String,
    pub settled: bool,
    pub verdict: Option<Verdict>,
    pub settled_at: Option<U64>,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq)]
pub struct Verdict {
    pub version: String,
    pub network: String,
    pub contract: AccountId,
    pub bounty: U64,
    pub hunter: AccountId,
    pub submission: String,
    pub rules_hash: String,
    pub report_hash: String,
    pub valid: bool,
    pub disclosure_hash: String,
    pub expires: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ClaimRef {
    pub bounty: U64,
    pub submission: String,
}
#[near(serializers = [json])]
pub struct HunterCommitment {
    pub bounty: U64,
    pub submission: String,
    pub commitment: Commitment,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Runner {
    pub outlayer: AccountId,
    pub project: String,
    pub version: String,
    pub secrets_owner: AccountId,
    pub secrets_profile: String,
}

#[near(serializers = [json])]
pub struct Provisioned {
    pub signing_public_key: Base64VecU8,
    pub encryption_public_key: Base64VecU8,
    pub sealed_state: String,
}

#[near(serializers = [json])]
pub struct RunnerOutput {
    pub verdict: Verdict,
    pub signature: Base64VecU8,
    pub disclosure_ciphertext: Base64VecU8,
}

#[near(serializers = [json])]
pub struct ContractConfig {
    pub network: String,
    pub protocol_version: String,
    pub bounty_count: U64,
    pub bounty_storage_deposit: U128,
    pub claim_storage_deposit: U128,
    pub storage_byte_cost: U128,
    pub verifier_registration: String,
    pub runner: Runner,
    pub verifier: Option<Verifier>,
    pub claim_limits: near_sdk::serde_json::Value,
}

#[near(serializers = [json])]
pub struct BountyEntry {
    pub id: U64,
    pub bounty: Bounty,
}
