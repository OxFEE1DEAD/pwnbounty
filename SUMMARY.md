# Sealed Bounty: summary

Before an AI agent gets real money, its owner funds a bounty and pays hunters to break the agent's spending policy.
The hunter submits an encrypted attack. An attested runner replays it and checks for an actual forbidden transfer, and the NEAR contract pays the reward automatically.
Only the agent team can decrypt the reproduction. A persuasive report with no executable violation earns nothing.
Judging rules: [JUDGING.md](../JUDGING.md). Plan: [GOAL.md](GOAL.md).

Legend: **[M]** measured, **[A]** assumed, **[N]** not checked.

## Problem

| Pain | Evidence |
|---|---|
| Agents with money get drained through prompt injection | Grok/Bankr lost ~$150–204K, 05.2026 **[secondary]** |
| Bug bounties drown in AI-generated junk reports | curl closed its program (01.2026); Bugcrowd saw 4× submissions in 3 weeks **[secondary]** |
| Payouts are manual and depend on the sponsor's goodwill | Intents paid a $300K bounty by hand, 10.2026 **[secondary]** |
| Agent honeypot games exist, but they are one-off shows, not a service | Freysa, JailbreakMe **[secondary]** |

**Sealed Bounty:** a reusable, owner-configured private test with a committed reward. The violation is executed and observed, never judged from prose.

## How it works

1. The agent team calls `create` with the scope, `rules_hash` (pinned model, prompt, tools, spending policy) and `team_key`, then funds the reward.
2. The hunter commits `report_hash` on-chain, then sends the attack encrypted to the runner's key.
3. The attested runner decrypts it, runs the agent from fresh state in an isolated ledger, and checks whether a transfer outside the allowed recipients happened.
4. The runner signs a `Verdict`; `settle` checks the signature and pays the hunter. The reproduction is re-encrypted to `team_key`.

| Module | Language | Role |
|---|---|---|
| `contract/` | Rust, near-sdk 5 | Bounties, pools, commitments, verdict check (ed25519), payout, withdraw |
| `verifier/` | TypeScript, Node built-ins only | Runner: open the report, judge, seal to the team, sign the verdict, settle |

Trust model: the verdict is trusted because of the TEE attestation of the runner and the code it runs.
Which TEE (OutLayer or NEAR AI Cloud, which signs responses with a TDX+GPU-attested key **[secondary]**) is not chosen yet **[N]**.

## Tracks and odds (assuming the full plan is done)

| Track | Target | 1st place | Top 3 |
|---|---|---|---|
| AI Security & Defense (`security`) | 1st | ~30% | ~55% |
| Privacy & Private AI (`privacy`) | top 3 | ~10% | ~25% |
| Grand prize | stretch | ~7% | — |

All numbers are estimates, not measurements.

## Criteria check

| Criterion | How Sealed Bounty covers it | Proof for judges |
|---|---|---|
| Technical implementation | Encrypted submission → attested runner → signed verdict → contract payout | Verified attestation, payout tx, balances |
| Design | One page: funded policy → encrypted attack → violation → reward → team opens the report | 2-minute video |
| Impact | Agents get attacked before they hold real money, not after | Evidence corpus: attacks, harmless inputs, junk reports, duplicates |
| Originality | Executed violation + private disclosure + a reward the sponsor cannot withdraw | A second agent config on the same service |
| Sustainability | Fee per funded program; the team pays for verification runs | One external agent team funds a test bounty |
| Track hints: agent security / function call keys / TEE attestation | Spending-policy agent; its wallet holds a function-call key; attestation verified for the runner | One live run each |
| Theme "AI and money" | AI hunters get paid, AI junk earns zero | Corpus table: false payouts = 0 |

| Judge | What they see |
|---|---|
| Illia | "Security Armageddon" answered: AI defense with a payout, usable by any agent team |
| Haseeb | Blockchain is needed: committed funds pay even when the sponsor dislikes the result |
| Avichal | Security tooling with a real money flow: agent team → bounty → hunter |
| Mert, Eddy | A private exploit becomes verifiable evidence without publishing the attack |
| Kain | A concrete spending policy and a real testnet payout |
| AI judges | One command per case, fixed fixtures, receipts, and simulation clearly separated from live transfers |

## Status

| Part | State |
|---|---|
| `contract/` | `create`, `fund`, `commit`, `settle` (ed25519 verdict signature), `withdraw`, `set_verifier`, views. Rewards in NEAR **[M]**. Not deployed |
| `verifier/` | Interfaces, `seal` (X25519 + AES-GCM), `LocalEnclave` with an empty quote **[M]**. No `Judge`, no TEE, no attestation check |
| Target agent | Not started |

Known contract gaps: [GOAL.md → Engineering notes](GOAL.md#engineering-notes).
