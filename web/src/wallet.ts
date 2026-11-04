import { NearConnector, type NearWalletBase } from '@hot-labs/near-connect';
import type { SealedReport } from './crypto.js';
import type { Wallet } from './ports.js';

const GAS = '100000000000000';
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
  async commit(report: SealedReport, deposit: string): Promise<void> {
    this.assertWritable();
    if (report.network !== this.network || report.contract !== this.contract)
      throw new Error('The submission belongs to another network or contract');
    const signer = await this.signer();
    if (!signer || signer.account !== report.hunter)
      throw new Error("Connect the wallet of this submission's hunter account");
    if (!/^[1-9][0-9]{0,38}$/.test(deposit) || BigInt(deposit) > (1n << 128n) - 1n)
      throw new Error('Invalid storage deposit');
    await this.call(
      signer,
      'commit',
      { bounty: report.bounty, submission: report.submission, report_hash: report.report_hash },
      deposit,
    );
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
      actions: [{ type: 'FunctionCall', params: { methodName, args, gas: GAS, deposit } }],
    });
    if (typeof outcome?.status === 'object' && 'Failure' in outcome.status)
      throw new Error('The transaction failed on NEAR');
  }
}
