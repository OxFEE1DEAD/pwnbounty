import { NearConnector, type NearWalletBase } from '@hot-labs/near-connect';
import type { SealedReport } from './crypto.js';
import type { CreateProgram, Wallet } from './ports.js';

const GAS = '100000000000000';
const CLAIM_GAS = '300000000000000';
const WALLETS_OUTSIDE_CSP = [
  'ledger',
  'near-mobile',
  'trezu-wallet',
  'hana-wallet',
  'ethereum-wallets',
  'near-cli',
];

export class HunterWallet implements Wallet {
  private connector: NearConnector;
  constructor(
    private network: 'mainnet' | 'testnet',
    private contract: string,
    private allowMainnetWrites: boolean,
  ) {
    this.connector = new NearConnector({
      network,
      cspNonce: 'nearconnect',
      providers: { [network]: [`https://rpc.${network}.fastnear.com`] },
      excludedWallets: WALLETS_OUTSIDE_CSP,
      autoConnect: false,
    });
  }
  async account(): Promise<string | undefined> {
    return (await this.signer())?.account;
  }
  async connect(): Promise<string | undefined> {
    this.assertWritable();
    await this.connector.connect();
    return this.account();
  }
  async disconnect(): Promise<void> {
    const signer = await this.signer();
    if (signer) await this.connector.disconnect(signer.wallet);
  }
  async submit(report: SealedReport, deposit: string, fee: string): Promise<string | undefined> {
    const signer = await this.hunter(report);
    const outcomes = await signer.wallet.signAndSendTransactions({
      signerId: signer.account,
      transactions: [
        { receiverId: this.contract, actions: [this.commitAction(report, deposit)] },
        { receiverId: this.contract, actions: [this.claimAction(report, fee)] },
      ],
    });
    if (failed(outcomes[0])) throw new Error('The transaction failed on NEAR');
    return claimed(outcomes[1]);
  }
  async claim(report: SealedReport, fee: string): Promise<string | undefined> {
    const signer = await this.hunter(report);
    const outcome = await signer.wallet.signAndSendTransaction({
      signerId: signer.account,
      receiverId: this.contract,
      actions: [this.claimAction(report, fee)],
    });
    return claimed(outcome);
  }
  private async hunter(report: SealedReport) {
    this.assertWritable();
    if (report.network !== this.network || report.contract !== this.contract)
      throw new Error('The submission belongs to another network or contract');
    const signer = await this.signer();
    if (!signer || signer.account !== report.hunter)
      throw new Error("Connect the wallet of this submission's hunter account");
    return signer;
  }
  private commitAction(report: SealedReport, deposit: string) {
    const args = {
      bounty: report.bounty,
      submission: report.submission,
      report_hash: report.report_hash,
    };
    return functionCall('commit', args, GAS, yocto(deposit));
  }
  private claimAction(report: SealedReport, fee: string) {
    const args = {
      bounty: report.bounty,
      submission: report.submission,
      ciphertext: report.ciphertext,
    };
    return functionCall('claim', args, CLAIM_GAS, yocto(fee));
  }
  async retryPayment(bounty: string, hunter: string): Promise<void> {
    this.assertProgram(bounty);
    const signer = await this.signer();
    if (!signer || signer.account !== hunter)
      throw new Error("Only the winner's wallet can retry the transfer");
    await this.call(signer, 'retry_payment', { bounty }, '0');
  }
  async withdraw(bounty: string): Promise<void> {
    this.assertProgram(bounty);
    const signer = await this.signer();
    if (!signer) throw new Error("Connect the program owner's wallet");
    await this.call(signer, 'withdraw', { bounty }, '0');
  }
  async create(program: CreateProgram, deposit: string): Promise<string | undefined> {
    this.assertWritable();
    const signer = await this.signer();
    if (!signer) throw new Error("Connect the program owner's wallet");
    const outcome = await signer.wallet.signAndSendTransaction({
      signerId: signer.account,
      receiverId: this.contract,
      actions: [functionCall('create', program, GAS, yocto(deposit))],
    });
    if (failed(outcome)) throw new Error('The transaction failed on NEAR');
    return events(outcome).find((event) => event.event === 'created')?.data?.[0]?.bounty;
  }
  private assertProgram(bounty: string): void {
    this.assertWritable();
    if (!/^(0|[1-9][0-9]{0,19})$/.test(bounty) || BigInt(bounty) > (1n << 64n) - 1n)
      throw new Error('Invalid program number');
  }
  private assertWritable(): void {
    if (this.network === 'mainnet' && !this.allowMainnetWrites)
      throw new Error('Mainnet signing is disabled by the worker settings');
  }
  private async signer(): Promise<{ wallet: NearWalletBase; account: string } | undefined> {
    const connected = await this.connector.getConnectedWallet().catch(() => undefined);
    const account = connected?.accounts[0]?.accountId;
    return connected && account ? { wallet: connected.wallet, account } : undefined;
  }
  private async call(
    signer: { wallet: NearWalletBase; account: string },
    methodName: string,
    args: object,
    deposit: string,
  ): Promise<void> {
    const outcome = await signer.wallet.signAndSendTransaction({
      signerId: signer.account,
      receiverId: this.contract,
      actions: [functionCall(methodName, args, GAS, deposit)],
    });
    if (failed(outcome)) throw new Error('The transaction failed on NEAR');
  }
}

function functionCall(methodName: string, args: object, gas: string, deposit: string) {
  return { type: 'FunctionCall' as const, params: { methodName, args, gas, deposit } };
}

function yocto(value: string): string {
  if (!/^[1-9][0-9]{0,38}$/.test(value) || BigInt(value) > (1n << 128n) - 1n)
    throw new Error('Invalid deposit');
  return value;
}

type Outcome = { status?: unknown; receipts_outcome?: unknown; transaction?: { hash?: string } };

function failed(outcome: Outcome | undefined): boolean {
  return (
    typeof outcome?.status === 'object' && outcome.status !== null && 'Failure' in outcome.status
  );
}

function events(outcome: Outcome | undefined): { event?: string; data?: { bounty?: string }[] }[] {
  const receipts = (outcome?.receipts_outcome ?? []) as { outcome: { logs: string[] } }[];
  return receipts
    .flatMap((receipt) => receipt.outcome.logs)
    .filter((log) => log.startsWith('EVENT_JSON:'))
    .map((log) => JSON.parse(log.slice(11)));
}

function claimed(outcome: Outcome | undefined): string | undefined {
  if (failed(outcome)) throw new Error('The transaction failed on NEAR');
  if (events(outcome).some((event) => event.event === 'claim_failed'))
    throw new Error('The TEE check returned no verdict. The claim is still open: run it again.');
  return outcome?.transaction?.hash;
}
