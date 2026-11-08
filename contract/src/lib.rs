mod interface;
pub use interface::*;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError,
};

const BOUNTY_STORAGE: u128 = 10_000_000_000_000_000_000_000;
const CLAIM_STORAGE: u128 = 100_000_000_000_000_000_000_000;
const MAX_PROGRAM: usize = 16_384;
const MAX_ABOUT: usize = 1_024;
const MAX_CIPHERTEXT: usize = 65_536;
const MAX_DISCLOSURE: usize = 8_192;
const CALLBACK_GAS: Gas = Gas::from_tgas(80);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    network: String,
    runner: Runner,
    verifier: Option<Verifier>,
    sealed_state: String,
    next_id: u64,
    bounties: LookupMap<u64, Bounty>,
    programs: LookupMap<u64, String>,
    commitments: LookupMap<String, Commitment>,
    disclosures: LookupMap<String, Base64VecU8>,
    hunters: LookupMap<AccountId, Vec<ClaimRef>>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(network: String, runner: Runner) -> Self {
        require!(
            network == "testnet" || network == "mainnet",
            "invalid network"
        );
        hash(&runner.version);
        Self {
            network,
            runner,
            verifier: None,
            sealed_state: String::new(),
            next_id: 0,
            bounties: LookupMap::new(b"b"),
            programs: LookupMap::new(b"p"),
            commitments: LookupMap::new(b"c"),
            disclosures: LookupMap::new(b"d"),
            hunters: LookupMap::new(b"h"),
        }
    }

    #[payable]
    pub fn provision(&mut self) -> Promise {
        require!(self.verifier.is_none(), "already provisioned");
        self.run(
            json!({"action":"provision"}).to_string(),
            json!({"max_instructions":10_000_000_000u64,"max_memory_mb":128,"max_execution_seconds":30}),
            false,
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(20))
                .on_provision(),
        )
    }

    #[private]
    pub fn on_provision(
        &mut self,
        #[callback_result] result: Result<Option<Provisioned>, PromiseError>,
    ) {
        require!(self.verifier.is_none(), "already provisioned");
        let Ok(Some(p)) = result else {
            env::panic_str("provisioning failed")
        };
        require!(
            p.signing_public_key.0.len() == 32
                && p.encryption_public_key.0.len() == 32
                && !p.sealed_state.is_empty()
                && p.sealed_state.len() <= 1_400,
            "invalid provisioning"
        );
        self.verifier = Some(Verifier {
            public_key: p.signing_public_key,
            encryption_key: p.encryption_public_key,
            attestation_hash: self.runner.version.clone(),
        });
        self.sealed_state = p.sealed_state;
        event("provisioned", json!({"verifier":self.verifier}));
    }

    #[payable]
    pub fn create(
        &mut self,
        rules_hash: String,
        team_key: Base64VecU8,
        reward: U128,
        expires: U64,
        settle_until: U64,
        program: String,
        about: Option<String>,
    ) -> U64 {
        hash(&rules_hash);
        let verifier = self.verifier.clone().expect("verifier not provisioned");
        require!(team_key.0.len() == 32, "invalid key");
        require!(
            program.len() <= MAX_PROGRAM
                && serde_json::from_str::<Value>(&program).is_ok_and(|v| v.is_object()),
            "invalid program"
        );
        require!(
            about.as_deref().is_none_or(|a| a.len() <= MAX_ABOUT
                && serde_json::from_str::<Value>(a).is_ok_and(|v| v.is_object())),
            "invalid about"
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
        let bytes = program.len() + about.as_ref().map_or(0, String::len);
        let storage = BOUNTY_STORAGE + bytes as u128 * env::storage_byte_cost().as_yoctonear();
        let required = reward.0.checked_add(storage).expect("deposit overflow");
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
                about,
            },
        );
        self.programs.insert(id, program);
        self.bounties.flush();
        self.programs.flush();
        storage_budget(before, storage, 128);
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
        let hunter = env::predecessor_account_id();
        let key = claim_key(bounty.0, &hunter, &submission);
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
        let mut claims = self.hunters.get(&hunter).cloned().unwrap_or_default();
        claims.push(ClaimRef {
            bounty,
            submission: submission.clone(),
        });
        self.hunters.insert(hunter.clone(), claims);
        self.commitments.flush();
        self.hunters.flush();
        storage_budget(before, CLAIM_STORAGE, 1_024);
        event(
            "committed",
            near_sdk::serde_json::json!({"bounty":bounty,"hunter":hunter,"submission":submission}),
        );
    }

    #[payable]
    pub fn claim(&mut self, bounty: U64, submission: String, ciphertext: String) -> Promise {
        require!(ciphertext.len() <= MAX_CIPHERTEXT, "ciphertext too large");
        let hunter = env::predecessor_account_id();
        let b = self.bounty(bounty.0);
        require!(
            b.state == PaymentState::Available && env::block_height() < b.settle_until.0,
            "program not open"
        );
        let c = self
            .commitments
            .get(&claim_key(bounty.0, &hunter, &submission))
            .cloned()
            .expect("unknown claim");
        require!(!c.settled, "already settled");
        let report = json!({
            "network": self.network,
            "contract": env::current_account_id(),
            "bounty": bounty.0.to_string(),
            "hunter": hunter,
            "submission": submission,
            "report_hash": c.report_hash,
            "ciphertext": ciphertext,
        });
        let input = format!(
            r#"{{"action":"verify","report":{},"config":{},"sealed_state":{}}}"#,
            report,
            self.programs.get(&bounty.0).expect("unknown program"),
            Value::String(self.sealed_state.clone())
        );
        self.run(input, Self::claim_limits(), true).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_verdict(bounty, hunter, submission),
        )
    }

    #[private]
    pub fn on_verdict(
        &mut self,
        bounty: U64,
        hunter: AccountId,
        submission: String,
        #[callback_result] result: Result<Option<RunnerOutput>, PromiseError>,
    ) {
        let Ok(Some(out)) = result else {
            event(
                "claim_failed",
                json!({"bounty":bounty,"hunter":hunter,"submission":submission}),
            );
            return;
        };
        require!(
            out.verdict.bounty == bounty
                && out.verdict.hunter == hunter
                && out.verdict.submission == submission,
            "verdict for another claim"
        );
        require!(
            hex(&env::sha256(&out.disclosure_ciphertext.0)) == out.verdict.disclosure_hash,
            "disclosure mismatch"
        );
        self.settle(out.verdict, out.signature);
        if out.disclosure_ciphertext.0.len() <= MAX_DISCLOSURE {
            self.disclosures.insert(
                claim_key(bounty.0, &hunter, &submission),
                out.disclosure_ciphertext,
            );
        }
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
            storage_byte_cost: U128(env::storage_byte_cost().as_yoctonear()),
            verifier_registration: "outlayer_project_pinned_version".to_string(),
            runner: self.runner.clone(),
            verifier: self.verifier.clone(),
            claim_limits: Self::claim_limits(),
        }
    }

    pub fn get_program(&self, bounty: U64) -> Option<String> {
        self.programs.get(&bounty.0).cloned()
    }

    pub fn get_disclosure(
        &self,
        bounty: U64,
        hunter: AccountId,
        submission: String,
    ) -> Option<Base64VecU8> {
        self.disclosures
            .get(&claim_key(bounty.0, &hunter, &submission))
            .cloned()
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

    pub fn get_hunter_commitments(
        &self,
        hunter: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<HunterCommitment> {
        let limit = limit.unwrap_or(20);
        require!(limit > 0 && limit <= 50, "limit must be 1..50");
        let Some(claims) = self.hunters.get(&hunter) else {
            return vec![];
        };
        claims
            .iter()
            .skip(from_index.unwrap_or(U64(0)).0 as usize)
            .take(limit as usize)
            .filter_map(|claim| {
                self.commitments
                    .get(&claim_key(claim.bounty.0, &hunter, &claim.submission))
                    .cloned()
                    .map(|commitment| HunterCommitment {
                        bounty: claim.bounty,
                        submission: claim.submission.clone(),
                        commitment,
                    })
            })
            .collect()
    }
}
impl Contract {
    fn bounty(&self, id: u64) -> Bounty {
        self.bounties.get(&id).cloned().expect("unknown bounty")
    }
    fn claim_limits() -> Value {
        json!({"max_instructions":100_000_000_000u64,"max_memory_mb":256,"max_execution_seconds":170})
    }
    fn run(&self, input: String, limits: Value, secrets: bool) -> Promise {
        let args = json!({
            "source": {"Project": {"project_id": self.runner.project, "version_key": self.runner.version}},
            "resource_limits": limits,
            "input_data": input,
            "secrets_ref": secrets.then(|| json!({"profile": self.runner.secrets_profile, "account_id": self.runner.secrets_owner})),
            "response_format": "Json",
            "payer_account_id": env::predecessor_account_id(),
        });
        Promise::new(self.runner.outlayer.clone()).function_call_weight(
            "request_execution",
            serde_json::to_vec(&args).expect("serialize request"),
            env::attached_deposit(),
            Gas::from_tgas(50),
            GasWeight(1),
        )
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
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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

    const PROGRAM: &str = r#"{"model":"m"}"#;

    fn test_contract() -> Contract {
        let mut contract = Contract::new(
            "testnet".into(),
            Runner {
                outlayer: "outlayer.testnet".parse().unwrap(),
                project: "owner.testnet/runner".into(),
                version: "4".repeat(64),
                secrets_owner: "owner.testnet".parse().unwrap(),
                secrets_profile: "default".into(),
            },
        );
        contract.verifier = Some(Verifier {
            public_key: Base64VecU8(vec![2; 32]),
            encryption_key: Base64VecU8(vec![3; 32]),
            attestation_hash: "4".repeat(64),
        });
        contract
    }

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
        let mut contract = test_contract();
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
                about: None,
            },
        );
        contract
    }

    #[test]
    fn create_requires_full_reward_in_escrow() {
        let reward = 10u128.pow(24);
        context(
            "sponsor.testnet",
            10,
            reward + BOUNTY_STORAGE + PROGRAM.len() as u128 * 10u128.pow(19),
        );
        let mut contract = test_contract();
        let id = contract.create(
            "0".repeat(64),
            Base64VecU8(vec![1; 32]),
            U128(reward),
            U64(100),
            U64(200),
            PROGRAM.into(),
            None,
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
        test_contract().create(
            "0".repeat(64),
            Base64VecU8(vec![1; 32]),
            U128(10u128.pow(24)),
            U64(100),
            U64(200),
            PROGRAM.into(),
            None,
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
