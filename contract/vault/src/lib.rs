use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    shares: LookupMap<AccountId, u128>,
}

#[near]
impl Vault {
    #[init]
    pub fn new() -> Self {
        Self {
            shares: LookupMap::new(b"s"),
        }
    }

    #[payable]
    pub fn deposit(&mut self) -> U128 {
        let owner = env::predecessor_account_id();
        let total = self.shares.get(&owner).copied().unwrap_or(0) + env::attached_deposit().as_yoctonear();
        self.shares.insert(owner, total);
        U128(total)
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let owner = env::predecessor_account_id();
        let held = self.shares.get(&owner).copied().unwrap_or(0);
        if !cfg!(feature = "vulnerable") {
            require!(amount.0 <= held, "amount exceeds shares");
        }
        self.shares.insert(owner.clone(), held.saturating_sub(amount.0));
        Promise::new(owner).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn shares_of(&self, account_id: AccountId) -> U128 {
        U128(self.shares.get(&account_id).copied().unwrap_or(0))
    }
}
