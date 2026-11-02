import { createContext, useContext, useEffect, useState } from 'react';
import type { Context } from './crypto.js';
import type { HunterWallet } from './wallet.js';
import type { Bounty, Chain, Network } from './chain.js';

export interface Meta {
  network:Network;contract:string;signing_public_key:string;trust_mode:string;
  confidential_inference_verified:boolean;claim_storage_deposit:string;
  min_prepare_window_blocks:string;allow_mainnet_writes:boolean;public_ingress?:boolean;
}
export interface TargetConfig {
  model:string;prompt:string;policy:{allowedRecipients:string[];maxTransfer:string};
  initialBalance:string;enforcePolicy:boolean;maxSteps:number;timeoutMs:number;
}
export interface Program {id:string;bounty:Bounty;config:TargetConfig;finalized_height?:string}
export interface TeamDraft {hash:string;context:string}
export interface Note {text:string;error:boolean}
export interface Env {
  meta:Meta;chain:Chain;wallet:HunterWallet;worker:Worker;account?:string;
  connect():Promise<void>;notify(text:string,error?:boolean):void;
  team:TeamDraft;setTeam(draft:TeamDraft):void;
}

export class HttpError extends Error {
  constructor(message:string,readonly status:number) {super(message);}
}

const labels:Record<number,string> = {
  400: 'Bad request or the commitment is not finalized yet',
  401: 'Invalid access token',
  404: 'Record not found',
  409: 'This program uses a different verifier',
  503: 'The worker cannot read the data right now',
};
const requestOptions = () => ({
  cache: 'no-store' as const, redirect: 'error' as const, signal: AbortSignal.timeout(30000),
});

export class Worker {
  constructor(private meta:Meta,private token:()=>string,private unauthorized:()=>void) {}

  async fetch(path:string,auth:boolean,init:RequestInit = {}):Promise<Response> {
    const headers = new Headers(init.headers);
    const token = this.token();
    if (auth && !token && this.meta.public_ingress === false) {
      throw new Error('Enter the operator token');
    }
    if (auth && token) headers.set('authorization', 'Bearer ' + token);
    const response = await fetch(path, {...init, headers, ...requestOptions()});
    if (response.status === 401) this.unauthorized();
    if (!response.ok) {
      const label = labels[response.status] ?? `Worker returned HTTP ${response.status}`;
      throw new HttpError(label, response.status);
    }
    return response;
  }

  async get<T>(path:string,auth = false):Promise<T> {
    return (await this.fetch(path, auth)).json() as Promise<T>;
  }

  async post<T>(path:string,body:unknown):Promise<T> {
    const headers = {'content-type': 'application/json'};
    const init = {method: 'POST', headers, body: JSON.stringify(body)};
    return (await this.fetch(path, true, init)).json() as Promise<T>;
  }
}

export async function loadMeta():Promise<Meta> {
  const response = await fetch('/v1/meta', requestOptions());
  if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}`);
  const meta = await response.json() as Meta;
  if (!['testnet', 'mainnet'].includes(meta.network)) throw new Error('Invalid worker network');
  if (!/^[1-9][0-9]*$/.test(meta.min_prepare_window_blocks)) {
    throw new Error('The worker did not report its verification time limit');
  }
  return meta;
}

const accountPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function context(value:unknown):Context {
  if (!value || typeof value !== 'object') throw new Error('Invalid context');
  const c = value as Record<string,unknown>;
  for (const field of ['network', 'contract', 'bounty', 'hunter', 'submission']) {
    if (typeof c[field] !== 'string') throw new Error('Invalid context field ' + field);
  }
  const {network, contract, bounty, hunter, submission} = c as unknown as Context;
  if (!['testnet', 'mainnet'].includes(network) || !/^(0|[1-9][0-9]{0,19})$/.test(bounty)
    || BigInt(bounty) > (1n << 64n) - 1n || !/^[a-f0-9]{64}$/.test(submission)) {
    throw new Error('Invalid network/bounty/submission');
  }
  for (const account of [contract, hunter]) {
    if (!accountPattern.test(account) || account.length < 2 || account.length > 64) {
      throw new Error('Invalid context account');
    }
  }
  return {network, contract, bounty, hunter, submission};
}

export const errorText = (error:unknown) =>
  error instanceof Error ? error.message : 'Action failed';
export const delay = (ms:number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

export const EnvContext = createContext<Env | null>(null);

export function useEnv():Env {
  const env = useContext(EnvContext);
  if (!env) throw new Error('Wait for the worker to load');
  return env;
}

interface Async<T> {value?:T;error?:string;loading:boolean;reload():void}

export function useAsync<T>(load:()=>Promise<T>,deps:unknown[]):Async<T> {
  const [state, setState] = useState<Omit<Async<T>,'reload'>>({loading: true});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(previous => ({value: previous.value, loading: true}));
    load().then(
      value => live && setState({value, loading: false}),
      error => live && setState({error: errorText(error), loading: false}),
    );
    return () => {live = false;};
  }, [...deps, tick]);
  return {...state, reload: () => setTick(n => n + 1)};
}
