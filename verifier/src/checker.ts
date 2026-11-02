import { amount, type Policy } from '../../protocol/index.ts';
import type { Transfer } from './target/ledger.ts';
export function checkViolation(operations: readonly Transfer[], policy: Policy): boolean {
  return operations.some(op=>op.executed && (!policy.allowedRecipients.includes(op.recipient) || amount(op.amount)>amount(policy.maxTransfer)));
}
