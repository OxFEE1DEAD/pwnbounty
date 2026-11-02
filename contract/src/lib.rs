mod interface;

pub use interface::*;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BlockHeight, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Bounties,
    Pools,
    Commitments,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    verifier: Option<Verifier>,
    next_id: BountyId,
    bounties: LookupMap<BountyId, Bounty>,
    pools: LookupMap<BountyId, NearToken>,
    commitments: LookupMap<String, Commitment>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(admin: AccountId) -> Self {
        Self {
            admin,
            verifier: None,
            next_id: 0,
            bounties: LookupMap::new(Key::Bounties),
            pools: LookupMap::new(Key::Pools),
            commitments: LookupMap::new(Key::Commitments),
        }
    }
}

#[near]
impl SealedBounty for Contract {
    #[payable]
    fn create(&mut self, scope: String, rules_hash: String, team_key: String, reward: U128, expires: BlockHeight) -> BountyId {
        require!(expires > env::block_height(), "expiry must be in the future");
        require!(reward.0 > 0, "reward must be positive");
        let id = self.next_id;
        self.next_id += 1;
        let owner = env::predecessor_account_id();
        self.bounties.insert(id, Bounty { owner, scope, rules_hash, team_key, reward, expires });
        self.pools.insert(id, env::attached_deposit());
        id
    }

    #[payable]
    fn fund(&mut self, bounty: BountyId) {
        self.bounty(bounty);
        let pool = self.pool(bounty).saturating_add(env::attached_deposit());
        self.pools.insert(bounty, pool);
    }

    fn commit(&mut self, bounty: BountyId, report_hash: String) {
        require!(self.bounty(bounty).expires > env::block_height(), "bounty expired");
        require!(!self.commitments.contains_key(&report_hash), "report already committed");
        let hunter = env::predecessor_account_id();
        self.commitments.insert(report_hash, Commitment { bounty, hunter, block: env::block_height(), settled: false });
    }

    fn settle(&mut self, verdict: Verdict, signature: Base64VecU8) -> U128 {
        let verifier = self.verifier.clone().unwrap_or_else(|| env::panic_str("no verifier"));
        require!(verified(&verdict, &signature, &verifier), "bad verifier signature");
        let mut commitment = self.commitments.get(&verdict.report_hash).cloned().unwrap_or_else(|| env::panic_str("unknown report"));
        require!(!commitment.settled, "report already settled");
        require!(commitment.bounty == verdict.bounty && commitment.hunter == verdict.hunter, "verdict does not match commitment");
        commitment.settled = true;
        self.commitments.insert(verdict.report_hash.clone(), commitment);
        let paid = if verdict.valid { self.pay(&verdict) } else { NearToken::from_yoctonear(0) };
        env::log_str(&format!(
            "SETTLE bounty={} hunter={} valid={} paid={} disclosure={}",
            verdict.bounty,
            verdict.hunter,
            verdict.valid,
            paid.as_yoctonear(),
            verdict.disclosure_hash
        ));
        U128(paid.as_yoctonear())
    }

    fn withdraw(&mut self, bounty: BountyId) -> U128 {
        let record = self.bounty(bounty);
        require!(env::predecessor_account_id() == record.owner, "only the bounty owner");
        require!(env::block_height() >= record.expires, "bounty not expired");
        let pool = self.pool(bounty);
        self.pools.insert(bounty, NearToken::from_yoctonear(0));
        if !pool.is_zero() {
            Promise::new(record.owner).transfer(pool).detach();
        }
        U128(pool.as_yoctonear())
    }

    fn set_verifier(&mut self, verifier: Verifier) {
        require!(env::predecessor_account_id() == self.admin, "only admin");
        require!(verifier.public_key.0.len() == 32, "ed25519 key must be 32 bytes");
        self.verifier = Some(verifier);
    }

    fn get_bounty(&self, bounty: BountyId) -> Option<Bounty> {
        self.bounties.get(&bounty).cloned()
    }

    fn get_pool(&self, bounty: BountyId) -> U128 {
        U128(self.pool(bounty).as_yoctonear())
    }

    fn get_commitment(&self, report_hash: String) -> Option<Commitment> {
        self.commitments.get(&report_hash).cloned()
    }

    fn get_verifier(&self) -> Option<Verifier> {
        self.verifier.clone()
    }
}

impl Contract {
    fn bounty(&self, id: BountyId) -> Bounty {
        self.bounties.get(&id).cloned().unwrap_or_else(|| env::panic_str("unknown bounty"))
    }

    fn pool(&self, id: BountyId) -> NearToken {
        self.pools.get(&id).copied().unwrap_or(NearToken::from_yoctonear(0))
    }

    fn pay(&mut self, verdict: &Verdict) -> NearToken {
        let reward = NearToken::from_yoctonear(self.bounty(verdict.bounty).reward.0).min(self.pool(verdict.bounty));
        self.pools.insert(verdict.bounty, self.pool(verdict.bounty).saturating_sub(reward));
        if !reward.is_zero() {
            Promise::new(verdict.hunter.clone()).transfer(reward).detach();
        }
        reward
    }
}

fn verified(verdict: &Verdict, signature: &Base64VecU8, verifier: &Verifier) -> bool {
    let message = env::sha256(&serde_json::to_vec(verdict).unwrap_or_else(|_| env::panic_str("unserializable verdict")));
    let (Ok(signature), Ok(key)) = (<[u8; 64]>::try_from(signature.0.as_slice()), <[u8; 32]>::try_from(verifier.public_key.0.as_slice())) else {
        return false;
    };
    env::ed25519_verify(&signature, &message, &key)
}
