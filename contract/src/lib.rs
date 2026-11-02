mod interface;
pub use interface::*;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const BOUNTY_STORAGE: u128 = 10_000_000_000_000_000_000_000;
const CLAIM_STORAGE: u128 = 20_000_000_000_000_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    network: String,
    next_id: u64,
    bounties: LookupMap<u64, Bounty>,
    commitments: LookupMap<String, Commitment>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(network: String) -> Self {
        require!(
            network == "testnet" || network == "mainnet",
            "invalid network"
        );
        Self {
            network,
            next_id: 0,
            bounties: LookupMap::new(b"b"),
            commitments: LookupMap::new(b"c"),
        }
    }

    #[payable]
    pub fn create(
        &mut self,
        rules_hash: String,
        team_key: Base64VecU8,
        reward: U128,
        expires: U64,
        settle_until: U64,
        verifier: Verifier,
    ) -> U64 {
        hash(&rules_hash);
        hash(&verifier.attestation_hash);
        require!(
            team_key.0.len() == 32
                && verifier.public_key.0.len() == 32
                && verifier.encryption_key.0.len() == 32,
            "invalid key"
        );
        require!(reward.0 > 0, "zero reward");
        require!(
            expires.0 > env::block_height() && settle_until.0 > expires.0,
            "invalid deadlines"
        );
        require!(
            settle_until.0 - expires.0 <= 100_000,
            "settlement window too long"
        );
        let required = reward
            .0
            .checked_add(BOUNTY_STORAGE)
            .expect("deposit overflow");
        require!(
            env::attached_deposit().as_yoctonear() == required,
            "attach reward plus storage budget exactly"
        );
        let id = self.next_id;
        self.next_id = id.checked_add(1).expect("id overflow");
        let before = env::storage_usage();
        self.bounties.insert(
            id,
            Bounty {
                owner: env::predecessor_account_id(),
                rules_hash,
                team_key,
                reward,
                expires,
                settle_until,
                verifier,
                state: PaymentState::Available,
                winner: None,
            },
        );
        self.bounties.flush();
        storage_budget(before, BOUNTY_STORAGE, 128);
        event(
            "created",
            near_sdk::serde_json::json!({"bounty":id.to_string()}),
        );
        U64(id)
    }

    #[payable]
    pub fn commit(&mut self, bounty: U64, submission: String, report_hash: String) {
        hash(&report_hash);
        hash(&submission);
        let b = self.bounty(bounty.0);
        require!(
            b.state == PaymentState::Available && env::block_height() < b.expires.0,
            "program not open"
        );
        require!(
            env::attached_deposit().as_yoctonear() == CLAIM_STORAGE,
            "attach claim storage budget exactly"
        );
        let key = claim_key(bounty.0, &env::predecessor_account_id(), &submission);
        require!(!self.commitments.contains_key(&key), "duplicate submission");
        let before = env::storage_usage();
        self.commitments.insert(
            key,
            Commitment {
                report_hash,
                settled: false,
                verdict: None,
                settled_at: None,
            },
        );
        self.commitments.flush();
        storage_budget(before, CLAIM_STORAGE, 1_024);
        event(
            "committed",
            near_sdk::serde_json::json!({"bounty":bounty,"hunter":env::predecessor_account_id(),"submission":submission}),
        );
    }

    pub fn settle(&mut self, verdict: Verdict, signature: Base64VecU8) {
        let mut b = self.bounty(verdict.bounty.0);
        require!(
            verdict.version == "1"
                && verdict.network == self.network
                && verdict.contract == env::current_account_id(),
            "wrong domain"
        );
        require!(verdict.rules_hash == b.rules_hash, "wrong rules");
        hash(&verdict.disclosure_hash);
        hash(&verdict.submission);
        hash(&verdict.report_hash);
        let key = claim_key(verdict.bounty.0, &verdict.hunter, &verdict.submission);
        let mut c = self.commitments.get(&key).cloned().expect("unknown claim");
        require!(c.report_hash == verdict.report_hash, "claim mismatch");
        if c.settled {
            require!(
                c.verdict.as_ref() == Some(&verdict),
                "different verdict already settled"
            );
            return;
        }
        require!(
            b.state == PaymentState::Available,
            "reward already assigned"
        );
        require!(
            env::block_height() <= verdict.expires.0 && verdict.expires.0 <= b.settle_until.0,
            "expired verdict"
        );
        require!(verified(&verdict, &signature, &b.verifier), "bad signature");
        if verdict.valid {
            transfer_gas();
        }
        c.settled = true;
        c.verdict = Some(verdict.clone());
        c.settled_at = Some(U64(env::block_height()));
        self.commitments.insert(key, c);
        if verdict.valid {
            b.winner = Some(verdict.hunter.clone());
            b.state = PaymentState::Pending;
            self.bounties.insert(verdict.bounty.0, b.clone());
            self.transfer(verdict.bounty.0, verdict.hunter.clone(), b.reward, false);
        }
        event("verdict", near_sdk::serde_json::json!({"verdict":verdict}));
    }

    pub fn retry_payment(&mut self, bounty: U64) {
        transfer_gas();
        let mut b = self.bounty(bounty.0);
        require!(b.state == PaymentState::Retryable, "not retryable");
        let winner = b.winner.clone().expect("no winner");
        require!(env::predecessor_account_id() == winner, "only winner");
        b.state = PaymentState::Pending;
        self.bounties.insert(bounty.0, b.clone());
        self.transfer(bounty.0, winner, b.reward, false);
    }

    pub fn withdraw(&mut self, bounty: U64) {
        transfer_gas();
        let mut b = self.bounty(bounty.0);
        require!(env::predecessor_account_id() == b.owner, "only owner");
        require!(
            env::block_height() > b.settle_until.0 && b.state == PaymentState::Available,
            "reward reserved"
        );
        b.state = PaymentState::Refunding;
        self.bounties.insert(bounty.0, b.clone());
        self.transfer(bounty.0, b.owner, b.reward, true);
    }

    #[private]
    pub fn on_transfer(&mut self, bounty: U64, refund: bool) {
        require!(
            env::promise_results_count() == 1,
            "expected transfer result"
        );
        let mut b = self.bounty(bounty.0);
        require!(
            b.state
                == if refund {
                    PaymentState::Refunding
                } else {
                    PaymentState::Pending
                },
            "wrong payment state"
        );
        let success = env::promise_result_checked(0, 0).is_ok();
        b.state = match (refund, success) {
            (true, true) => PaymentState::Closed,
            (true, false) => PaymentState::Available,
            (false, true) => PaymentState::Paid,
            (false, false) => PaymentState::Retryable,
        };
        self.bounties.insert(bounty.0, b);
        event(
            "transfer",
            near_sdk::serde_json::json!({"bounty":bounty,"refund":refund,"success":success}),
        );
    }

    pub fn get_config(&self) -> ContractConfig {
        ContractConfig {
            network: self.network.clone(),
            protocol_version: "1".to_string(),
            bounty_count: U64(self.next_id),
            bounty_storage_deposit: U128(BOUNTY_STORAGE),
            claim_storage_deposit: U128(CLAIM_STORAGE),
            verifier_registration: "unverified_pinned_key".to_string(),
        }
    }

    pub fn get_bounties(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<BountyEntry> {
        let start = from_index.unwrap_or(U64(0)).0;
        let limit = limit.unwrap_or(20);
        require!(limit > 0 && limit <= 50, "limit must be 1..50");
        let end = start.saturating_add(limit as u64).min(self.next_id);
        (start..end)
            .filter_map(|id| {
                self.bounties.get(&id).cloned().map(|bounty| BountyEntry {
                    id: U64(id),
                    bounty,
                })
            })
            .collect()
    }

    pub fn get_bounty(&self, bounty: U64) -> Option<Bounty> {
        self.bounties.get(&bounty.0).cloned()
    }
    pub fn get_commitment(
        &self,
        bounty: U64,
        hunter: AccountId,
        submission: String,
    ) -> Option<Commitment> {
        self.commitments
            .get(&claim_key(bounty.0, &hunter, &submission))
            .cloned()
    }
}
impl Contract {
    fn bounty(&self, id: u64) -> Bounty {
        self.bounties.get(&id).cloned().expect("unknown bounty")
    }
    fn transfer(&self, id: u64, recipient: AccountId, reward: U128, refund: bool) {
        Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(reward.0))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_transfer(U64(id), refund),
            )
            .detach();
    }
}
fn claim_key(id: u64, hunter: &AccountId, submission: &str) -> String {
    format!("{id}:{hunter}:{submission}")
}
fn hash(s: &str) {
    require!(
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "expected hex hash"
    );
}
fn storage_budget(before: u64, budget: u128, reserved_bytes: u64) {
    let used = env::storage_usage()
        .saturating_sub(before)
        .checked_add(reserved_bytes)
        .expect("storage overflow") as u128
        * env::storage_byte_cost().as_yoctonear();
    require!(used <= budget, "storage budget exceeded");
}
fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({"standard":"sealed_bounty","version":"1.0.0","event":name,"data":[data]})
    ));
}
fn verified(v: &Verdict, signature: &Base64VecU8, verifier: &Verifier) -> bool {
    let message = verdict_message(v);
    let (Ok(sig), Ok(key)) = (
        <[u8; 64]>::try_from(signature.0.as_slice()),
        <[u8; 32]>::try_from(verifier.public_key.0.as_slice()),
    ) else {
        return false;
    };
    env::ed25519_verify(&sig, &message, &key)
}
fn verdict_message(v: &Verdict) -> Vec<u8> {
    let payload = near_sdk::serde_json::json!([
        "sealed-bounty/verdict/1",
        v.network,
        v.contract,
        v.bounty.0.to_string(),
        v.hunter,
        v.submission,
        v.rules_hash,
        v.report_hash,
        v.valid,
        v.disclosure_hash,
        v.expires.0.to_string()
    ]);
    env::sha256(&near_sdk::serde_json::to_vec(&payload).expect("serialize verdict"))
}

fn transfer_gas() {
    require!(
        env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas())
            >= Gas::from_tgas(35).as_gas(),
        "at least 35 Tgas remaining required for transfer and callback"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
    use near_sdk::{testing_env, PromiseResult};

    fn context(actor: &str, height: u64, deposit: u128) {
        let mut builder = VMContextBuilder::new();
        builder.current_account_id("bounty.testnet".parse().unwrap());
        builder.predecessor_account_id(actor.parse().unwrap());
        builder.block_height(height);
        builder.attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(builder.build());
    }

    fn setup(state: PaymentState) -> Contract {
        let mut context = VMContextBuilder::new();
        context.current_account_id("bounty.testnet".parse().unwrap());
        context.predecessor_account_id("sponsor.testnet".parse().unwrap());
        context.block_height(201);
        testing_env!(context.build());
        let mut contract = Contract::new("testnet".into());
        contract.bounties.insert(
            0,
            Bounty {
                owner: "sponsor.testnet".parse().unwrap(),
                rules_hash: "0".repeat(64),
                team_key: Base64VecU8(vec![0; 32]),
                reward: U128(10u128.pow(24)),
                expires: U64(100),
                settle_until: U64(200),
                verifier: Verifier {
                    public_key: Base64VecU8(vec![0; 32]),
                    encryption_key: Base64VecU8(vec![0; 32]),
                    attestation_hash: "0".repeat(64),
                },
                state,
                winner: Some("hunter.testnet".parse().unwrap()),
            },
        );
        contract
    }

    #[test]
    fn create_requires_full_reward_in_escrow() {
        let reward = 10u128.pow(24);
        context("sponsor.testnet", 10, reward + BOUNTY_STORAGE);
        let mut contract = Contract::new("testnet".into());
        let id = contract.create(
            "0".repeat(64),
            Base64VecU8(vec![1; 32]),
            U128(reward),
            U64(100),
            U64(200),
            Verifier {
                public_key: Base64VecU8(vec![2; 32]),
                encryption_key: Base64VecU8(vec![3; 32]),
                attestation_hash: "4".repeat(64),
            },
        );
        assert_eq!(id.0, 0);
        let bounty = contract.get_bounty(id).unwrap();
        assert_eq!(bounty.reward.0, reward);
        assert!(bounty.state == PaymentState::Available);
        assert_eq!(bounty.owner.as_str(), "sponsor.testnet");
    }

    #[test]
    #[should_panic(expected = "attach reward plus storage budget exactly")]
    fn create_rejects_underfunded_reward() {
        context("sponsor.testnet", 10, BOUNTY_STORAGE);
        Contract::new("testnet".into()).create(
            "0".repeat(64),
            Base64VecU8(vec![1; 32]),
            U128(10u128.pow(24)),
            U64(100),
            U64(200),
            Verifier {
                public_key: Base64VecU8(vec![2; 32]),
                encryption_key: Base64VecU8(vec![3; 32]),
                attestation_hash: "4".repeat(64),
            },
        );
    }

    #[test]
    #[should_panic(expected = "reward reserved")]
    fn sponsor_cannot_withdraw_awarded_reward_after_failed_transfer() {
        setup(PaymentState::Retryable).withdraw(U64(0));
    }

    #[test]
    #[should_panic(expected = "reward reserved")]
    fn sponsor_cannot_withdraw_while_payment_is_pending() {
        setup(PaymentState::Pending).withdraw(U64(0));
    }

    #[test]
    fn sponsor_can_withdraw_unawarded_reward_after_deadline() {
        let mut contract = setup(PaymentState::Available);
        contract.withdraw(U64(0));
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Refunding);
    }

    fn committed_program() -> (Contract, SigningKey, Verdict) {
        let mut contract = setup(PaymentState::Available);
        let seed: [u8; 32] = env::sha256(b"sealed-bounty contract test signer only")
            .try_into()
            .unwrap();
        let signing = SigningKey::from_bytes(&seed);
        let mut bounty = contract.get_bounty(U64(0)).unwrap();
        bounty.verifier.public_key = Base64VecU8(signing.verifying_key().to_bytes().to_vec());
        bounty.winner = None;
        contract.bounties.insert(0, bounty);
        contract.bounties.flush();
        context("hunter.testnet", 50, CLAIM_STORAGE);
        contract.commit(U64(0), "1".repeat(64), "2".repeat(64));
        let verdict = Verdict {
            version: "1".into(),
            network: "testnet".into(),
            contract: "bounty.testnet".parse().unwrap(),
            bounty: U64(0),
            hunter: "hunter.testnet".parse().unwrap(),
            submission: "1".repeat(64),
            rules_hash: "0".repeat(64),
            report_hash: "2".repeat(64),
            valid: true,
            disclosure_hash: "3".repeat(64),
            expires: U64(150),
        };
        (contract, signing, verdict)
    }

    fn signature(signing: &SigningKey, verdict: &Verdict) -> Base64VecU8 {
        Base64VecU8(signing.sign(&verdict_message(verdict)).to_bytes().to_vec())
    }

    fn failed_transfer_context() {
        let mut builder = VMContextBuilder::new();
        builder.current_account_id("bounty.testnet".parse().unwrap());
        builder.predecessor_account_id("bounty.testnet".parse().unwrap());
        builder.block_height(61);
        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
    }

    fn successful_transfer_context() {
        let mut builder = VMContextBuilder::new();
        builder.current_account_id("bounty.testnet".parse().unwrap());
        builder.predecessor_account_id("bounty.testnet".parse().unwrap());
        builder.block_height(61);
        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(vec![])]
        );
    }

    #[test]
    fn accepted_valid_verdict_assigns_full_reward_once() {
        let (mut contract, signing, verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        let sig = signature(&signing, &verdict);
        contract.settle(verdict.clone(), sig.clone());
        let bounty = contract.get_bounty(U64(0)).unwrap();
        assert!(bounty.state == PaymentState::Pending);
        assert_eq!(bounty.winner.unwrap().as_str(), "hunter.testnet");
        assert_eq!(bounty.reward.0, 10u128.pow(24));
        assert!(
            contract
                .get_commitment(U64(0), verdict.hunter.clone(), verdict.submission.clone())
                .unwrap()
                .settled
        );
        let receipts = get_created_receipts();
        let hunter_receipt = receipts
            .iter()
            .find(|r| r.receiver_id == verdict.hunter)
            .unwrap();
        assert!(hunter_receipt.actions.iter().any(|action| matches!(action,
            MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == 10u128.pow(24)
        )));
        contract.settle(verdict.clone(), sig);
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Pending);
        assert_eq!(get_created_receipts().len(), receipts.len());
    }

    #[test]
    #[should_panic(expected = "unknown claim")]
    fn verdict_cannot_steal_another_hunters_commitment() {
        let (mut contract, signing, mut verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        verdict.hunter = "thief.testnet".parse().unwrap();
        contract.settle(verdict.clone(), signature(&signing, &verdict));
    }

    #[test]
    #[should_panic(expected = "different verdict already settled")]
    fn replay_cannot_change_accepted_verdict() {
        let (mut contract, signing, mut verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        contract.settle(verdict.clone(), signature(&signing, &verdict));
        verdict.valid = false;
        contract.settle(verdict.clone(), signature(&signing, &verdict));
    }

    #[test]
    #[should_panic(expected = "bad signature")]
    fn invalid_signature_cannot_award_reward() {
        let (mut contract, _signing, verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        contract.settle(verdict, Base64VecU8(vec![0; 64]));
    }

    #[test]
    fn failed_payout_stays_reserved_and_winner_can_retry() {
        let (mut contract, signing, verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        contract.settle(verdict.clone(), signature(&signing, &verdict));
        failed_transfer_context();
        contract.on_transfer(U64(0), false);
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Retryable);
        context("hunter.testnet", 201, 0);
        contract.retry_payment(U64(0));
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Pending);
        let receipts = get_created_receipts();
        let hunter_receipt = receipts
            .iter()
            .find(|r| r.receiver_id == verdict.hunter)
            .unwrap();
        assert!(hunter_receipt.actions.iter().any(|action| matches!(action,
            MockAction::Transfer { deposit, .. } if deposit.as_yoctonear()==10u128.pow(24)
        )));
    }

    #[test]
    fn successful_transfer_callback_marks_reward_paid() {
        let (mut contract, signing, verdict) = committed_program();
        context("relayer.testnet", 60, 0);
        contract.settle(verdict.clone(), signature(&signing, &verdict));
        successful_transfer_context();
        contract.on_transfer(U64(0), false);
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Paid);
    }

    #[test]
    fn invalid_verdict_closes_only_its_claim_without_payment() {
        let (mut contract, signing, mut verdict) = committed_program();
        verdict.valid = false;
        context("relayer.testnet", 60, 0);
        contract.settle(verdict.clone(), signature(&signing, &verdict));
        assert!(contract.get_bounty(U64(0)).unwrap().state == PaymentState::Available);
        assert!(
            contract
                .get_commitment(U64(0), verdict.hunter, verdict.submission)
                .unwrap()
                .settled
        );
        assert!(get_created_receipts().is_empty());
    }
}
