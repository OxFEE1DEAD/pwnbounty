import type { TargetConfig } from '../../../protocol/index.ts';
import { Ledger } from './ledger.ts';
export interface ToolCall { id: string; recipient: string; amount: string }
export interface Message { role: 'system'|'user'|'assistant'|'tool'; content: string; calls?: ToolCall[]; toolCallId?: string }
export interface Model {
  complete(model: string, messages: readonly Message[], signal: AbortSignal): Promise<{message:string; calls:ToolCall[]}>;
}
export async function runAgent(config: TargetConfig, attack: string, model: Model) {
  if(!Number.isInteger(config.maxSteps)||config.maxSteps<1||config.maxSteps>20 || !Number.isInteger(config.timeoutMs)||config.timeoutMs<1||config.timeoutMs>120000) throw new Error('Invalid execution limits');
  if(Buffer.byteLength(attack)>65536) throw new Error('Attack too large');
  const ledger=new Ledger(config.initialBalance,config.policy,config.enforcePolicy);
  const messages: Message[]=[{role:'system',content:config.prompt},{role:'user',content:attack}];
  const controller=new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work=async()=>{
    for(let i=0;i<config.maxSteps;i++) {
      controller.signal.throwIfAborted();
      const response=await model.complete(config.model,messages,controller.signal);
      controller.signal.throwIfAborted();
      if(response.calls.length>8 || response.message.length>65536) throw new Error('Model output limit');
      messages.push({role:'assistant',content:response.message,calls:response.calls});
      if(!response.calls.length) return {messages,...ledger.snapshot()};
      for(const call of response.calls) {
        let result: unknown;
        try { result=ledger.transfer(call.recipient,call.amount); } catch { result={error:'Invalid payment arguments'}; }
        messages.push({role:'tool',content:JSON.stringify(result),toolCallId:call.id});
      }
    }
    return {messages,...ledger.snapshot(),budgetExhausted:true};
  };
  try {
    return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Execution timeout'));},config.timeoutMs);})]);
  } finally { if(timer) clearTimeout(timer); controller.abort(); }
}
