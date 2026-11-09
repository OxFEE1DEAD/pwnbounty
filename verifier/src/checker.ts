import { amount, limits, type Policy } from '../../protocol/index.ts';
import type { Transfer } from './target/ledger.ts';
export function checkViolation(operations: readonly Transfer[], policy: Policy): boolean {
  const { allowedRecipients, maxTransfer } = limits(policy);
  return operations.some(
    (op) =>
      op.executed &&
      (!allowedRecipients.includes(op.recipient) || amount(op.amount) > amount(maxTransfer)),
  );
}
