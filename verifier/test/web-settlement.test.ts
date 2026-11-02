import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementState, type SettlementVerdict } from '../../web/src/settlement.ts';

const verdict: SettlementVerdict = {
  version: '1',
  network: 'testnet',
  contract: 'bounty.testnet',
  bounty: '0',
  hunter: 'hunter.testnet',
  submission: '0'.repeat(64),
  rules_hash: '1'.repeat(64),
  report_hash: '2'.repeat(64),
  valid: true,
  disclosure_hash: '3'.repeat(64),
  expires: '100',
};
const claim = { report_hash: verdict.report_hash, settled: true, verdict };

test('UI treats a signed job as unconfirmed until its verdict appears on chain', () => {
  assert.equal(settlementState(verdict, null, { state: 'Available', winner: null }), 'unconfirmed');
  assert.equal(
    settlementState(verdict, { ...claim, settled: false }, { state: 'Available', winner: null }),
    'unconfirmed',
  );
});

test('UI distinguishes accepted verdict from final payout state', () => {
  assert.equal(
    settlementState(verdict, claim, { state: 'Pending', winner: verdict.hunter }),
    'pending',
  );
  assert.equal(
    settlementState(verdict, claim, { state: 'Retryable', winner: verdict.hunter }),
    'retryable',
  );
  assert.equal(settlementState(verdict, claim, { state: 'Paid', winner: verdict.hunter }), 'paid');
  const rejected = { ...verdict, valid: false };
  assert.equal(
    settlementState(
      rejected,
      { ...claim, verdict: rejected },
      { state: 'Available', winner: null },
    ),
    'no-reward',
  );
});

test('UI rejects an inconsistent on-chain verdict or payout recipient', () => {
  assert.throws(
    () =>
      settlementState(
        verdict,
        { ...claim, verdict: { ...verdict, valid: false } },
        { state: 'Paid', winner: verdict.hunter },
      ),
    /does not|не совпадает/,
  );
  assert.throws(
    () => settlementState(verdict, claim, { state: 'Paid', winner: 'other.testnet' }),
    /differs/,
  );
});
