import { canonical } from './crypto.js';

export interface SettlementVerdict {
  version:string;network:string;contract:string;bounty:string;hunter:string;submission:string;
  rules_hash:string;report_hash:string;valid:boolean;disclosure_hash:string;expires:string;
}
export interface ChainCommitment {report_hash:string;settled:boolean;verdict:SettlementVerdict|null}
export interface RewardState {state:string;winner:string|null}
export type SettlementState = 'unconfirmed'|'no-reward'|'pending'|'retryable'|'paid';

export function settlementState(verdict:SettlementVerdict,claim:ChainCommitment|null,bounty:RewardState):SettlementState {
  if(!claim?.settled)return 'unconfirmed';
  if(claim.report_hash!==verdict.report_hash||!claim.verdict||canonical(claim.verdict)!==canonical(verdict))throw new Error('Worker verdict does not match the finalized commitment');
  if(!verdict.valid)return 'no-reward';
  if(bounty.winner!==verdict.hunter)throw new Error('NEAR reward recipient differs from the verdict');
  if(bounty.state==='Paid')return 'paid';
  if(bounty.state==='Retryable')return 'retryable';
  if(bounty.state==='Pending')return 'pending';
  throw new Error('Unexpected NEAR reward state: '+bounty.state);
}
