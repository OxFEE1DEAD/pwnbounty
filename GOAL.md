# Sealed Bounty: goal

**Target:** 1st place in **AI Security & Defense** ($10K), also submitted to **Privacy & Private AI**. Grand prize is a stretch.
What and why: [SUMMARY.md](SUMMARY.md). Judging rules: [JUDGING.md](../JUDGING.md).

Execution plan and access requests: [WIN_PLAN.ru.md](WIN_PLAN.ru.md). Decision 2026-10-30: pursue the full scope below; sequence extensions behind the working core. External pilot is high priority but optional and does not block submission.

Legend: **[M]** measured, **[A]** assumed, **[N]** not checked. Status: ✅ done, 🟡 partial, ⬜ not started.

## Definition of done

### P1: without this we don't place

1. 🟡 **A payment agent actually breaks a frozen rule.** Pin the model/version, prompt, tools, policy and initial state before funding. The hunter controls only an allowed attack surface, such as an untrusted invoice. The runner executes it from fresh state and checks for an actual transfer outside the allowed recipients in an isolated ledger. Uploaded transcripts and model prose cannot authorize payment. A local-development testnet payout for an over-limit transfer is measured; the remote model deployment and confidential runner are not yet pinned end to end.
2. 🟡 **Real confidential execution and a verified attestation.** Run the target and the checker inside the attested boundary; verify evidence that binds the signing key, the encryption key and the approved code. Any remote model serving needs a verified confidentiality boundary too. Pin that policy per bounty, and bind verdicts to the network, contract, target/config, rules and hunter. Prove this path first: a local signature does not pass this gate.
3. 🟡 **A funded reward the sponsor cannot evade.** Valid report → accepted verdict → full reward received on testnet; invalid report → no payout. Reserve funds for claims, bound the settlement time, recover failed transfers, and remove the sponsor's upgrade access to the funded contract. Test stolen commitments, replay, double settlement, and withdrawal during pending claims. Prove payment with receipts and balances.
4. 🟡 **Private disclosure without a public exploit.** Bind the commitment to the hunter, bounty and submission with a secret nonce, and verify it inside the runner. Encrypt the reproduction and trace to the team's pinned key, make the ciphertext retrievable, and demonstrate decryption. No plaintext in public receipts or host logs. The local-development testnet path demonstrates encrypted disclosure and team decryption **[M]**; remote inference confidentiality and live OutLayer execution remain unverified.
5. ⬜ **One demo a judge understands in two minutes.** One small page: funded policy → encrypted attack → attested violation → bounty balance received → team opens the report. Then show plausible AI junk earning zero and the attack blocked by an enforced spending policy, with the exact tool action that separates the outcomes.
6. 🟡 **Evidence with a baseline.** `npm run cli -- corpus` runs 14 cases (attacks, boundary, duplicate, out-of-scope, junk, fabricated, checker injection) on both configs; with a stub model that obeys the invoice all 28 outcomes match **[M]**. This checks the checker, not the model; `corpus fixtures/cases.json near-ai` runs the real model (spends credits) and has not been run **[N]**. Freeze a corpus of attacks, harmless invoices, fabricated reports and duplicates, including a report that tells the judge to approve it. Publish expected/observed outcomes, false payouts, missed violations, runtime and cost. The same deterministic checker handles human and AI submissions. Reduced triage effort stays **[A]** until measured against a human baseline.
7. ⬜ **README for the machine:** "do X → see Y" for every case; pinned dependencies and fixtures; links to receipts, ciphertext, the verifier measurement and the evidence table; why NEAR (funded settlement + attestation-bound execution) with integration links; the track hints named explicitly (agent security, function call keys, TEE attestation; private AI, TEE).

### P2: what separates 1st from 2nd

1. ⬜ **One external agent team runs the flow (high priority, optional).** A NEAR agent/tool maintainer supplies its config and policy, funds a test bounty and decrypts the result. Record onboarding friction, an agreed next test and willingness to pay. Start outreach early; submission does not depend on a response.
2. ⬜ **Two programs on the same service:** a second agent config with a different spending rule through the same encrypted submission and payout flow.
3. ⬜ **Function-call key** (track hint): the target agent's wallet holds a NEAR function-call key + policy, and the violation is checked against it.
4. ⬜ **Historical Intents exploit, before and after the patch.** Pin the historical code and state, reproduce the violation, reject the patched case. nearcore inside the TEE is untested **[N]**. This is neither a new vulnerability nor an Intents partnership.
5. ⬜ **Operating model:** measured verification cost and latency, capped run time and submission rate, and who pays for rejected reports. "Junk gets no bounty" does not mean junk is free to process.

### P3: if time is left

NEP-141 stablecoin rewards, gas sponsorship, onboarding templates for protocols, a second attested verifier implementation. Cross-chain funding and a hunter marketplace wait for a customer need.

### Submission

Checklist in [JUDGING.md](../JUDGING.md#submission-checklist-every-project-m). Project specifics: `tracks: ["security", "privacy"]`; the X post carries a demo video (our target is 2 minutes or less; the rules also accept screenshots).

## Risks

| Risk | Mitigation |
|---|---|
| TEE execution or attestation verification fails **[N]** | First gate: run the smallest target end to end and verify both keys and the code; cut P2/P3 before weakening this claim |
| Model behavior changes between runs **[N]** | Pin model/config ids, keep the signed trace and ledger evidence, publish repeated-run outcomes; never promise deterministic inference |
| Attacks reach the checker or signing keys **[N]** | Checker outside the target's control, isolated tools and secrets, restricted egress and run time; no LLM ever authorizes payment |
| Duplicates drain the pool, or spam makes verification unaffordable **[N]** | One rewarded violation per funded program; define claim ordering, pending-claim limits and execution budgets first |
| Seen as generic escrow, a jailbreak game or an AI auditor | Lead with the executed violation, private execution and the committed reward; show a second owner on the same service |
| A TEE verdict sold as a mathematical proof | State hardware trust, admin/upgrade authority and the exact invariant tested |

Not chosen: a general AI auditor, public jailbreak entertainment, or a mainnet-fork platform as the P1 deliverable.

## Engineering notes

### Build

```sh
cd contract && cargo build --target wasm32-unknown-unknown --release
```

`contract/.cargo/config.toml` adds `-C target-cpu=mvp --cfg near`; without `--cfg near`, every panic traps as `unreachable`.

### Known gaps (reviewed 2026-10-31)

- The escrow reserves the full reward, but the fixed `Retryable` withdrawal rule is only in the current source and WASM; the old testnet deployment remains vulnerable **[M]**.
- The funded contract and OutLayer project owner still have upgrade access keys on testnet, so the new immutable funding gate rejects the current deployment **[M]**.
- The WASI runner verifies Intel quote signatures (PCK chain to the pinned root, QE report, attestation key) and NVIDIA NRAS JWTs before inference; checked natively on a live `Qwen/Qwen3.8-27B` report, tampered quote, expired chain, foreign nonce and forged GPU token rejected **[M]**. Not inside OutLayer yet **[N]**. Intel TCB/QE identity collateral, PCK CRL and the NVIDIA JWKS x5c chain are not checked.
- New OutLayer bounties include `modelPolicyHash` in their rules hash, and the WASI runner checks the secret's policy against it before inference **[M]**.
- Live Sealed Bounty OutLayer execution, browser wallet signing, the mainnet OutLayer payment-key balance, and a two-minute end-to-end demo remain unverified **[N]**. The current testnet project's WASM URL returned HTTP 502 **[M]**; its version needs a reachable HTTPS host before execution.
- The separate policy-wallet contract has native unit tests and a release WASM build, but no live testnet deployment **[M]**.
