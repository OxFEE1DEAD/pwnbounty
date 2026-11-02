import {
  canonical,
  commitment,
  digest,
  rulesHash,
  type Context,
  type Verdict,
} from '../../protocol/index.ts';
import { seal } from './crypto.ts';
import { checkViolation } from './checker.ts';
import { runAgent, type Model } from './target/agent.ts';
import { runProgram } from './world/run.ts';
import { programHash, type ProgramSpec } from '../../protocol/program.ts';
import type {
  WorldFactory,
  TargetConfig,
  Enclave,
  ProgramSource,
  TrustPolicy,
  Disclosure,
  Settler,
  SealedReport,
} from './interfaces.ts';
import type { PreparedJob } from './job-store.ts';
export class Verifier {
  constructor(
    private enclave: Enclave,
    private programs: ProgramSource,
    private trust: TrustPolicy,
    private model: Model,
    private disclosure: Disclosure,
    private settler: Settler,
    private worlds?: WorldFactory,
  ) {}
  async prepare(report: SealedReport): Promise<PreparedJob> {
    const program = await this.programs.load(report);
    const context: Context = {
      network: report.network,
      contract: report.contract,
      bounty: report.bounty,
      hunter: report.hunter,
      submission: report.submission,
    };
    if (
      program.context.network !== report.network ||
      program.context.contract !== report.contract ||
      program.context.bounty !== report.bounty
    )
      throw new Error('Program context mismatch');
    const hash = program.kind === 'agent' ? rulesHash(program.config) : programHash(program.spec);
    if (hash !== program.rules_hash) throw new Error('Configuration mismatch');
    await this.trust.verify(await this.enclave.attestation(), program);
    const decoded: unknown = JSON.parse(
      Buffer.from(await this.enclave.open(report.ciphertext, canonical(context))).toString('utf8'),
    );
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !('nonce' in decoded) ||
      !('attack' in decoded) ||
      typeof decoded.nonce !== 'string' ||
      typeof decoded.attack !== 'string'
    )
      throw new Error('Invalid submission');
    if (commitment(context, decoded.nonce, decoded.attack) !== report.report_hash)
      throw new Error('Commitment mismatch');
    const { valid, trace } =
      program.kind === 'agent'
        ? await this.agent(program.config, decoded.attack)
        : await this.world(program.spec, decoded.attack);
    const ciphertext = seal(
      Buffer.from(canonical({ context, attack: decoded.attack, trace })),
      program.teamKey,
      canonical(context),
    );
    const disclosure_hash = digest(ciphertext);
    const location = await this.disclosure.publish(ciphertext);
    const verdict: Verdict = {
      ...context,
      version: '1',
      rules_hash: program.rules_hash,
      report_hash: report.report_hash,
      valid,
      disclosure_hash,
      expires: program.verdictExpires,
    };
    const signature = await this.enclave.sign(verdict);
    return { verdict, signature, location };
  }
  private async agent(config: TargetConfig, attack: string) {
    const trace = await runAgent(config, attack, this.model);
    return { valid: checkViolation(trace.operations, config.policy), trace };
  }
  private async world(spec: ProgramSpec, attack: string) {
    if (!this.worlds) throw new Error('Contract programs need NEAR_SANDBOX_BIN');
    const { judgement, evidence } = await runProgram(this.worlds, spec, attack);
    if (judgement.outcome === 'infra_error' || judgement.outcome === 'inconclusive')
      throw new Error('Replay ' + judgement.outcome);
    return {
      valid: judgement.outcome === 'violation',
      trace: { judgement, receipts: evidence?.receipts, status: evidence?.status },
    };
  }
  deliver(prepared: PreparedJob): Promise<{ transaction: string }> {
    return Verifier.deliver(this.settler, prepared);
  }
  static async deliver(settler: Settler, prepared: PreparedJob): Promise<{ transaction: string }> {
    return { transaction: await settler.settle(prepared.verdict, prepared.signature) };
  }
}
export { LocalEnclave } from './enclave/local.ts';
