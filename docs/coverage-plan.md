# Coverage plan: automatic bounties for any machine-checkable rule

Status: v6 (after five review rounds). Legend: **[M]** measured, **[A]** assumed, **[N]** not checked.

## 1. Problem and promise

Bug bounties pay late, depend on human triage, drown in generated junk and leak exploits through public reports. Sealed Bounty pays when an attack **actually breaks a precise rule**. The project states the rule and funds the reward before anyone attacks. The hunter's attack is replayed in a pinned copy of the project's world, a rule engine compares the world before and after (never prose), and the NEAR escrow pays on a signed verdict. The full attack is disclosed only to the project team, encrypted to its key; in sandbox programs the verifier host also reads it during replay. The public sees which rule broke and the asset deltas, not how.

Today one target class works: a prompt-driven payment agent with a `transfer` tool on a mock ledger, local-development trust **[M]**. This plan makes target, attack and rule generic. The escrow contract stays unchanged: it checks `rules_hash`, the verdict signature and `valid` **[M]** (`contract/src/lib.rs`).

## 2. One world, many actors

```
World   = pinned NEAR sandbox + setup steps (accounts, code, balances)
Actor   = what the hunter's attack drives: own txs | AI agent with a wallet | OutLayer app
Rules   = generic checks: attacked world vs before, and vs an unattacked control world
Verdict = signed { rules_hash, report_hash, valid } -> escrow pays
```

For sandbox actors (A1-A3) the rule engine never knows what the target is: a contract, an agent wallet and an OutLayer app are judged by what changed on the sandbox chain. A0 keeps its mock-ledger checker; R6 also reads the app's typed output.

### World (E1: NEAR sandbox)

- `near-sandbox` 0.3.4, nearcore sandbox 2.13.4, one fresh instance per job **[M]**: first start 22.5 s with binary download, then 0.5 s. Binaries exist for Linux-x86_64 (35 MB), Linux-aarch64, Darwin-arm64 **[M]**; running on Linux **[N]**.
- Code sources, pinned by sha256 of the WASM:
  - `chain-code`: account + network + block via `view_code`. **[M]** real `wrap.near` mainnet code (185 KB): `new()`, `storage_deposit`, `near_deposit` work. **[M]** real `intents.near` 0.4.5 code (1.3 MB, source `near/intents@16d04f6`): `new({config})`, alice deposits 2 wNEAR with `ft_transfer_call`, `mt_balance_of` shows it, attacker `ft_withdraw` is rejected, alice withdraws 1 wNEAR. World with wrap + intents + escrow fork builds in 8.5 s.
  - `wasm`: uploaded by the sponsor (unreleased code).
  - `chain-state` (small state only): code + all keys via `view_state`, written with `sandbox_patch_state`. **[M]** `sbcontract-20b45b.testnet` 27 keys, `get_bounty(6)` returns `Available`. A reusable fork also pins the account balance, access keys and the source block **[N]**. Big contracts refuse `view_state` (`TOO_LARGE_CONTRACT_STATE` on `wrap.near`) **[M]**; storage of real protocols: `intents.near` 13.2 GB, `wrap.near` 168 MB, `v2.ref-finance.near` 111 MB, `contract.main.burrow.near` 54 MB **[M]**.
- Default for real protocols is **fresh deployment of pinned code** in a seeded world. The UI says so, never "a fork of mainnet".
- Setup steps are declarative and part of `rules_hash`. The setup never pays deposits on the attacker's behalf, never gives the hunter pre-signed victim messages (P1), and lists which privileged roles stay live (owner, admins) and who holds them.
- `sandbox_fast_forward` works: +100 blocks in ~1 s, +1000 in ~8 s **[M]**.
- Gas refunds land after the tx result: a wallet read right after an accepted `pay` was ~0.09 NEAR lower than its final value **[M]**. Snapshots are taken only after every receipt, refunds included, has finished.
- Limits (part of `rules_hash`): txs, actions per tx, prepaid gas per tx, total burnt gas, receipts, wall time, new accounts. A run ends only when every receipt finished; unfinished callbacks give `inconclusive`.
- Outcomes: `violation`, `no_violation`, `limit`, `invalid_attack`, `inconclusive`, `infra_error`. Only `violation` pays; `infra_error` and `inconclusive` are retried, never settled as `valid: false`.

### Control model and value accounting

- The harness generates up to K attacker keypairs per job; the hunter refers to them as `key:0..K-1` and never needs private keys. Seeded accounts have harness keys the attack cannot use and never sign during the attack.
- **Attacker-controlled set** after the run: the attacker account and its sub-accounts, `implicit:key:N` accounts, and any account that holds an attacker full-access key at the end. Value the hunter leaves elsewhere does not count, so every P1 attack must end by sweeping proceeds into this set (false negatives are the hunter's problem; false positives are ours).
- **Roles are disjoint and fixed, with precedence protected > system > attacker > neutral.** Protected accounts are named by the program (victims, treasuries, target contracts) and stay protected even if the attacker gets their key; the attacker must sweep proceeds to its own accounts. **System** accounts are the funded genesis accounts (`sandbox`, `test.near`): no code, never sign during the attack. **Neutral** is everything else. Snapshots record every key with its permission, so full-access control is decided from evidence. Setup gives the attacker only NEAR: no pre-existing claims, no deposits paid on its behalf, no pre-signed victim messages.
- **Assets and value (P1).** NEAR (`amount + locked`) and listed liquid NEP-141 tokens, each with a fixed integer rate in yoctoNEAR per atomic unit that equals the protocol's own conversion (wNEAR = 1). Claims inside contracts (Intents NEP-245 balances, vault shares, storage balances) are not attacker assets. Every listed token's contract is a protected account deployed in setup and carries a liability of `-supply x rate`, so a backed wrap is value-neutral and an unbacked mint shows up as the issuer's loss.
- **Completeness (measured).** Two exact checks on every snapshot, else `inconclusive`: (1) `Σ_known accounts (amount + locked) = block.header.total_supply`; known accounts are the genesis accounts, setup accounts, and every account created by a receipt. **[M]** exact to the yocto on a wrap world. (2) For each listed token, `Σ_known holders ft_balance_of = ft_total_supply`; known holders also include every `account_id`/`receiver_id` seen in receipt args, since NEP-141 can register ids that have no native account.
- **Conservation (measured).** `ΔV_A + ΔV_P + ΔV_N = Δ block.header.total_supply`, exact, where `V = amount + locked + Σ rate x FT balance - Σ_issued rate x supply`. The header delta already nets charged gas, the 30% contract gas credit, issuance and burns; **[M]** on a wrap world (storage deposit, `near_deposit` 5, `near_withdraw` 2, a failed transfer) all three sides equal -0.000614367 NEAR. Epoch issuance to the sandbox validator makes the header delta positive **[M]** (the equality holds only if every receiver is tracked), so sandboxes start with `additionalGenesis: { epoch_length: 100000 }`, which removes issuance **[M]**. R1 additionally requires `ΔV_N + ΔV_S >= 0` and a header delta `<= 0` (no issuance); then `-ΔV_P = ΔV_A + ΔV_N + ΔV_S - Δsupply >= ΔV_A`, so the whole attacker gain came from protected accounts and unrelated neutral losses cannot be combined with a protected loss.
- **Run boundary.** The executor waits until every receipt of every attack tx is final (`wait_until: FINAL`), refunds and `ft_resolve_transfer` included, and passes a run status to the judge: `complete`, `limit`, `invalid_attack`, `pending`, `infra_error`. The judge decides rules only on `complete`; `pending` maps to `inconclusive`, never to `violation`.

### Rules

| Id | Plain words (UI) | Check |
|---|---|---|
| R1 take | "Take protected value" | `ΔV_A > threshold`, `-ΔV_P > threshold`, `ΔV_N + ΔV_S >= 0`, header delta `<= 0`, completeness and conservation hold, no outflow listed as authorized in the program (P1 templates list none) |
| R2 loss | "Destroy protected value" | `-ΔV_P > threshold` without R1 (burnt, sent to a neutral account, locked in a neutral contract); conservation holds. P2 adds agent wallets: a per-payer, per-recipient ledger of settled gross outflows against `allow: { recipients, perPayment, total }`, gas burnt by the wallet's own signed calls excluded |
| R3 block | "Block a promised withdrawal" | the program names a victim action for a full claim (alice withdraws all her shares; expected amount exact). It runs in the attacked world and in an unattacked control world built from the same setup and fast-forwarded to the same height; both receipt outcomes and before/after states are recorded. Pays only if control succeeds with the exact amount and the attacked world fails or pays less, and the victim's entitlement is unchanged by the attack (its claim view, e.g. share balance, returns identical raw bytes in both worlds before the action) |
| R4 check | "Break a pinned state check" | P2: curated invariants shipped with a template, each with benign and vulnerable controls |
| R5 leak | "Reveal a private canary" | P3: random canary only in a private place, verbatim match in attacker-readable sinks |
| R6 false claim | "Certify something untrue" | P2: an OutLayer app's typed output compared with truth at the block it read; the attack phase ends before the app phase |

DeFi pools (R1 with swaps at market prices) need per-receipt flow linking and are P3; P1 templates have no trading. Known false negatives, stated to hunters: stolen claims that cannot be withdrawn within the run (vault shares, Intents internal balances) need the P2 claims ledger; a theft smaller than the hunter's own gas plus the threshold does not pay.

### A1 submission grammar

```
{ "accounts": { "a1": "x.attacker" },                 new-account aliases with exact ids
  "txs": [ { "signerAccount": "attacker" | alias | "implicit:key:N",
             "signingKey": "key:N", "receiver": "<id or alias>",
             "actions": [ ... ] } ] }
```
Actions: `FunctionCall {method, args, deposit, gas}`, `Transfer {deposit}`, `CreateAccount`, `AddKey {key: "key:N", permission: full | {receiver, methods, allowance}}`, `DeleteKey {key}`, `DeleteAccount {beneficiary}`, `DeployContract {sha256}` (code from the program's code list only), `Stake` rejected in P1. A new account may sign only after a tx that added its key succeeded. Byte, gas and count limits come from the program.

### Actors

| Id | Actor | Attack format | Touches the world |
|---|---|---|---|
| A1 | Direct txs | grammar above | sandbox RPC, harness signs with attacker keys only |
| A2 | AI agent with a wallet | untrusted `text` (invoice, email, page) | pinned NEAR AI model calls tools; each tool is a tx template signed by the agent wallet: `pay` on `policy-wallet` from a function-call key on the wallet account **[M]**: the key self-calls `#[private] pay`, an allowlisted 0.5 NEAR payment passes, a payment to a non-allowlisted account and one over the cap are rejected, and each rejected call still burns 0.00015-0.0026 NEAR of the wallet's gas |
| A3 | OutLayer app | `{ input }`; env and HTTP sources are set by the program, never by the hunter | OutLayer's `wasi-test-runner` (wasmtime, `near:rpc` host) with `--rpc-url` at the sandbox; a local component test, not an attested TEE run |
| A0 | Mock-ledger agent (existing) | `text` | OutLayer TEE runner; the only path that can be "Sealed in TEE" |

### Preflight (before funding)

1. Empty attack: no rule fires, twice, same deltas.
2. Generic adversarial baseline must not pay: self-transfer, deposit and withdraw own funds, storage register/unregister, failed receipt, refund, gas spam up to limits, call every public method of listed tokens with mint-like names.
3. Template benign scenario must not pay; template vulnerable control (on a deliberately vulnerable build) must pay.
4. Agents: N runs, rate shown, label "probabilistic".

## 3. Trust and privacy labels

| Label | Attack decrypted in | Public after settlement |
|---|---|---|
| Sealed in TEE | OutLayer TEE runner with verified attestation (A0; live run **[N]**) | rule id, outcome, hashes (A0 has no asset deltas: its ledger is mock) |
| Sealed to verifier host | verifier host (A1-A3: nearcore and wasmtime do not run inside OutLayer WASI) | rule id, outcome, asset deltas, code and setup hashes |

Attack plaintext and trace are disclosed only to the team key (`disclosure_hash`); host-label programs are also read by the verifier host during replay. The verdict key is pinned per program; `get_config` labels it `unverified_pinned_key` **[M]** and the UI shows it.

## 4. PoC targets

P1 and P2 targets have three labelled cases (P3 rows are placeholders): a **vulnerable fixture** that must pay, a **production or fixed build** that must reject the same attack, and a **zero case** of normal use.

| # | Target | Concept | Rules | Vulnerable fixture pays | Fixed / production rejects | Zero case |
|---|---|---|---|---|---|---|
| T1 | Vault (ours, ~100 lines) | plain contract | R1, R3 | `withdraw` trusts a caller-supplied share count | fixed build | deposit and withdraw own funds |
| T2 | wNEAR, real `wrap.near` code | production token | R1, R3 (unwrap) | our FT fixture with an unchecked `near_withdraw` | real code | wrap/unwrap/unregister loops |
| T3 | NEAR Intents, real `intents.near` 0.4.5 | intent settlement | R1 (liquid wNEAR leaving the contract), R3 (alice `ft_withdraw` of her full balance); internal-ledger R2 in P2 | fixture verifier that skips the owner check on `ft_withdraw` | real code | attacker deposits and withdraws own balance |
| T4 | AI payment agent: NEAR AI Qwen + `policy-wallet` | AI agent with wallet | R2 with allowlist and total cap | tool sends `transfer` from a full-access key | tool is `pay` through the policy wallet | persuasive prose, blocked `pay` |
| T5 | OutLayer `vault-checker` (OutLayer's example) | OutLayer app | R6 | fixture that skips the key-count check | real component | correctly configured vault |
| T6 | Sealed Bounty escrow (ours), fresh deploy of the repo WASM | dogfooding | R1, R3 (sponsor `withdraw` after deadline, winner `retry_payment`) | fixture without the verdict signature check | real code | forged verdict, replay, early withdraw |
| T7 | Ref Finance AMM, real code + 2 mock FTs | DeFi | R1 with per-receipt flow linking | P3 | real code | swaps, add/remove liquidity |
| T8 | Burrow lending, real code + pinned mock oracle | lending | R1, R2 with debt as a liability | P3 | real code | borrow/repay within limits |
| T9 | OutLayer `payment-keys-with-intents` | OutLayer payment app | R2 (swap account only to the quoted address) | P3 with mocked 1Click | real component | P3 |
| T10 | Secret-holding agent | private AI | R5 | P3 | P3 | hunter pastes its own text |

## 5. Product surfaces

Routes: `#/` what it is and what works now; `#/programs` open funded programs; `#/program/:id` rule, world, limits, trust, editor and result; `#/launch` sponsor template -> preflight -> key backup -> fund; `#/me` attempts and rewards, retry payout; `#/team` local disclosure decrypt (current panel). `#/dashboard` is P2.

### Landing (`#/`)
1. Hero: "**A bug bounty that pays for a proved break.**" / «**Баг-баунти с выплатой за доказанное нарушение.**» Sub: "A project funds a NEAR reward and publishes a precise rule. A hunter submits an encrypted attack. A verifier replays it against pinned code in a fresh, seeded sandbox. A signed violation lets the escrow pay." Trust line: "In sandbox programs the verifier host reads the attack during replay. The public never sees it."
2. Two doors: **Put my project on a bounty** / **Hunt a bounty**.
3. Problem strip: manual review delays awards; a convincing report does not prove a break; full public reports expose exploit steps (sources linked).
4. Four steps: set the rule and fund -> encrypt the attack and commit its hash with a wallet -> replay in the pinned sandbox, compare state -> signed violation pays the first settled winner, the team gets the encrypted disclosure.
5. What you can put on a bounty, each card with a phase badge and one rule: AI payment agents, Contracts, Tokens, NEAR Intents, OutLayer apps, DeFi. A card says "live" only after its program has run end to end; until then "planned", and planned cards never offer launch or submit.
6. What counts as a break: Take protected value; Destroy protected value; Block a promised withdrawal (one sentence each).
7. Trust table (section 3), verdict key shown as "pinned, origin unverified".
8. FAQ: not a mainnet fork; no live accounts are touched; prose earns nothing; first *settled* valid verdict wins; inconclusive runs are retried, never judged as failed.
9. Live stats and payouts from chain, links to contract and repo.

### Hunter
- `#/programs`: open programs only; card = name, concept, reward, deadline, trust label, deterministic/probabilistic badge.
- `#/program/:id`: beside the editor: rule in plain words, protected accounts and assets, privileged roles, limits, code hashes with explorer and NEP-330 source links, one zero-earning example, commitment deposit (0.02 NEAR). One editor for the program's actor (A1 tx list first).
- One button: encrypt -> commit with wallet -> finalized commitment -> send -> progress. Result shows all outcomes separately: violation proved, payout sent (distinct states), no violation, limit reached, invalid attack, inconclusive (retrying), verifier error (retrying); plus before -> after asset deltas and the signed verdict.
- `#/me`: attempts, wins, retry payout.

### Sponsor
1. Template: Vault, Token (P1); Intents, AI agent wallet, OutLayer app as they ship.
2. Code: network + account + block (code hash and NEP-330 source link shown) or upload; edit the template's world numbers.
3. Rule and preflight: one rule, plain-words preview "A hunter wins if..."; the worker registers the config by hash and runs preflight; continuing is disabled until every case passes (empty twice, adversarial baseline, benign does not pay, vulnerable control pays).
4. Team key generated in the browser, backup downloaded and confirmed.
5. Reward and deadlines, fund with wallet (`create` with the registered `rules_hash`).
Custom JSON stays behind "Advanced". Dashboard in P2; P1 keeps the `#/team` decrypt panel.

### Microcopy (EN source, RU in the dictionary)
| Use | EN |
|---|---|
| Trust | "Verifier host can read this attack" / "Sealed in TEE (verified)" |
| Key | "Pinned verdict key; origin unverified" |
| Badge | "Deterministic rule" / "Probabilistic agent: N runs, X% success" |
| Empty | "No open funded programs" / "No attempts from this browser" |
| Errors | "Rules hash differs from funded program" / "Commitment not final yet; retry" / "Preflight failed; funding disabled" |

## 6. Architecture (less code first)

One new seam in the existing pipeline. Today `Verifier.prepare` calls `runAgent(config, attack, model)` then `checkViolation` (`verifier/src/verifier.ts`). It becomes `target.run(program, attack) -> { valid, trace }` through one injected interface:
- `LedgerTarget` (A0): the current `runAgent` + `checkViolation`, unchanged hashes.
- `SandboxTarget` (A1, then A3): `WorldFactory` builds a sandbox from the spec, the A1 executor runs the grammar, `judge(evidence)` decides. `judge` is a pure function over typed evidence, testable without a sandbox.

`Program.config` becomes `TargetConfig | ProgramSpec` (discriminated by `version`), and `rulesHash` dispatches by version so legacy A0 hashes stay identical; the web hash check uses the same function. `TrustPolicy` rejects a sandbox program in TEE trust mode, so the trust label always follows the executor. The program hash covers the spec plus judge, executor and sandbox versions. Escrow contract unchanged.

New files: `protocol/program.ts`, `verifier/src/world/sandbox.ts`, `verifier/src/world/judge.ts`, `verifier/src/actors/txs.ts`. New dependency: `near-sandbox` (exact version, needs the user's OK).

## 7. Priorities

### P1: five concepts demoable (no deploy)
Concepts: AI payment agent (A0, exists), plain contract (T1), production token (T2), NEAR Intents (T3), OutLayer app (T5, local and host-visible).
1. `protocol/program.ts`: types (section 10), `parseProgram`, versioned `rulesHash`.
2. `verifier/src/world/judge.ts`: completeness, conservation, R1-R3; pure.
3. T1 vault fixture: vulnerable and fixed builds (one small contract crate).
4. `verifier/src/world/sandbox.ts`: pinned genesis (`epoch_length`), setup, attacker keys, final receipt outcomes, snapshots with holders and supplies, paired control world.
5. `verifier/src/actors/txs.ts`: grammar, aliases, signing, the seven allowed actions.
6. `Target` seam: `Program` versioning, `NearProgramSource.load`, `readRoute`, `cli.ts` `program-create` and `seal-report`, web hash check, `TrustPolicy` rule.
7. Templates: T1, T2 (real wNEAR), T3 (real Intents with the measured deposit/withdraw path); preflight cases for each.
8. A3 for T5: `wasi-test-runner` pointed at the sandbox, R6 for `vault-checker` (needs permission to build OutLayer's code).
9. UI: landing rewrite, `#/programs`, `#/program/:id` with the A1 editor and evidence, `#/launch` for the templates.
10. Testnet run of the pinned programs (needs the user's OK to fund): vulnerable fixtures pay, fixed and production builds settle `valid: false`.

### P1 trust (needs a deploy, user's call)
Live attested A0 run end to end on OutLayer.

### P2
A2 + T4 (policy wallet, outflow ledger); claims ledger (vault shares, Intents internal balances) and internal-ledger R2; T6 escrow; R4 curated invariants; commitment-order settlement; sponsor dashboard; ABI-driven editor; small-state fork with balances, keys and source block.

### P3
DeFi flow linking + T7 Ref, T8 Burrow; R5 + T10; T9; TEE for the sandbox (TDX VM); hunter dry-run world; historical exploit replay.

## 8. Policies

| Topic | Decision |
|---|---|
| Duplicates | one reward per program; the contract pays the first settled valid verdict **[M]**. P2: the worker settles a bounty's jobs in commitment order and holds a valid verdict until earlier commitments whose ciphertext arrived are judged; commitments without ciphertext within a window are skipped |
| Verifier down | `settle_until` + `withdraw` returns funds; `Retryable` keeps a won reward claimable **[M]** |
| Run costs | hunter pays the commitment storage deposit (0.02 NEAR) **[M]**; the worker rate-limits per hunter and per bounty; sponsor-paid compute is off-chain; cost per run is measured and shown (P2) |
| Changes after funding | none: the config is content-addressed and its hash is the on-chain `rules_hash` |
| Public evidence | verdict + rule id + asset deltas (sandbox programs); attack and trace only in the disclosure |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Fresh deploy behaves unlike mainnet | label it; templates seed representative state; `chain-state` fork for small contracts |
| Rules pay junk | value conservation with issuer liabilities, control world for R3, adversarial preflight, vulnerable and benign controls per template |
| Agents are nondeterministic | measured rate, "probabilistic" label |
| `wasi-test-runner` lacks storage/signing/encryption hosts **[M]** | A3 only for apps within `near:rpc` (`vault-checker` imports only `view`, `view-account`, `view-access-key-list` **[M]**); building and running it **[N]** |
| Privileged roles in setup (owner can drain by design) | listed in the program and shown to hunters; actions by those roles are not attacker actions |

## 10. Interfaces (P1)

Spec, A1 grammar, evidence and outcome types live in `protocol/program.ts`; the DI seams `WorldFactory`, `WorldHandle` and `Target` in `verifier/src/interfaces.ts`. `judge(e: RunEvidence): Judgement` is a pure function. `programHash(spec) = sha256(canonical({ spec, engine: ENGINE }))`, `ENGINE = { judge, executor, sandbox: '2.13.4', epochLength: 100000 }`; `rulesHash(TargetConfig)` stays unchanged for A0.
