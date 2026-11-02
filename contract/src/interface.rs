use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{near, AccountId, BlockHeight};

pub type BountyId = u64;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Bounty {
    pub owner: AccountId,
    pub scope: String,
    pub rules_hash: String,
    pub team_key: String,
    pub reward: U128,
    pub expires: BlockHeight,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Commitment {
    pub bounty: BountyId,
    pub hunter: AccountId,
    pub block: BlockHeight,
    pub settled: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Verdict {
    pub bounty: BountyId,
    pub report_hash: String,
    pub hunter: AccountId,
    pub valid: bool,
    pub disclosure_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Verifier {
    pub public_key: Base64VecU8,
    pub attestation_hash: String,
}

pub trait SealedBounty {
    fn create(&mut self, scope: String, rules_hash: String, team_key: String, reward: U128, expires: BlockHeight) -> BountyId;
    fn fund(&mut self, bounty: BountyId);
    fn commit(&mut self, bounty: BountyId, report_hash: String);
    fn settle(&mut self, verdict: Verdict, signature: Base64VecU8) -> U128;
    fn withdraw(&mut self, bounty: BountyId) -> U128;
    fn set_verifier(&mut self, verifier: Verifier);
    fn get_bounty(&self, bounty: BountyId) -> Option<Bounty>;
    fn get_pool(&self, bounty: BountyId) -> U128;
    fn get_commitment(&self, report_hash: String) -> Option<Commitment>;
    fn get_verifier(&self) -> Option<Verifier>;
}
