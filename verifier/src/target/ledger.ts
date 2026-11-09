import { amount, limits, type LimitPolicy, type Policy } from '../../../protocol/index.ts';
import { accountId } from '../near/validation.ts';
export interface Transfer {
  recipient: string;
  amount: string;
  executed: boolean;
}
export class Ledger {
  private balance: bigint;
  private operations: Transfer[] = [];
  private policy: LimitPolicy;
  constructor(
    initial: string,
    policy: Policy,
    private enforce: boolean,
  ) {
    this.balance = amount(initial);
    this.policy = limits(policy);
    amount(this.policy.maxTransfer);
  }
  transfer(recipient: string, value: string): Transfer {
    accountId(recipient);
    const n = amount(value);
    const allowed =
      this.policy.allowedRecipients.includes(recipient) && n <= amount(this.policy.maxTransfer);
    const executed = n > 0n && n <= this.balance && (!this.enforce || allowed);
    if (executed) this.balance -= n;
    const op = { recipient, amount: value, executed };
    this.operations.push(op);
    return { ...op };
  }
  snapshot() {
    return {
      balance: this.balance.toString(),
      operations: this.operations.map((op) => ({ ...op })),
    };
  }
}
