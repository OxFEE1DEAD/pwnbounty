import { setupWalletSelector, type WalletSelector, type BrowserWallet } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { actionCreators } from '@near-js/transactions';
import type { SealedReport } from './crypto.js';

export class HunterWallet {
  private selector:Promise<WalletSelector>;
  private callback=new URL(window.location.pathname,window.location.origin).toString();
  constructor(private network:'mainnet'|'testnet',private contract:string,private allowMainnetWrites:boolean) {
    this.selector=setupWalletSelector({network:{networkId:network,nodeUrl:`https://rpc.${network}.fastnear.com`,helperUrl:`https://helper.${network}.near.org`,explorerUrl:network==='mainnet'?'https://nearblocks.io':'https://testnet.nearblocks.io',indexerUrl:network==='mainnet'?'https://api.fastnear.com/v0':'https://test.api.fastnear.com/v0'},modules:[setupMyNearWallet({walletUrl:network==='mainnet'?'https://app.mynearwallet.com':'https://testnet.mynearwallet.com'})],debug:false});
  }
  async account():Promise<string|undefined> {
    const selector=await this.selector;
    if(!selector.isSignedIn())return undefined;
    return (await (await selector.wallet('my-near-wallet')).getAccounts())[0]?.accountId;
  }
  async connect():Promise<string|undefined> {
    if(this.network==='mainnet'&&!this.allowMainnetWrites)throw new Error('Mainnet signing отключён настройками worker');
    const wallet=await (await this.selector).wallet<BrowserWallet>('my-near-wallet');
    await wallet.signIn({contractId:this.contract,methodNames:['commit'],successUrl:this.callback,failureUrl:this.callback});
    return this.account();
  }
  async commit(report:SealedReport,deposit:string):Promise<void> {
    if(this.network==='mainnet'&&!this.allowMainnetWrites)throw new Error('Mainnet signing отключён настройками worker');
    if(report.network!==this.network||report.contract!==this.contract)throw new Error('Заявка относится к другой сети или контракту');
    const actor=await this.account();
    if(!actor||actor!==report.hunter)throw new Error('Подключите кошелёк аккаунта охотника этой заявки');
    if(!/^[1-9][0-9]{0,38}$/.test(deposit)||BigInt(deposit)>(1n<<128n)-1n)throw new Error('Неверный storage deposit');
    const wallet=await (await this.selector).wallet<BrowserWallet>('my-near-wallet');
    await wallet.signAndSendTransaction({signerId:actor,receiverId:this.contract,callbackUrl:this.callback,actions:[actionCreators.functionCall('commit',{bounty:report.bounty,submission:report.submission,report_hash:report.report_hash},100_000_000_000_000n,BigInt(deposit))]});
  }
}
