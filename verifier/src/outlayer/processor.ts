import { verify, type KeyObject } from 'node:crypto';
import { digest, verdictMessage } from '../../../protocol/index.ts';
import type { Disclosure, ProgramSource, SealedReport, Settler } from '../interfaces.ts';
import type { PreparedJob } from '../job-store.ts';
import { NonRetryablePrepareError, type JobProcessor } from '../jobs.ts';
import { object, verdict as parseVerdict } from '../near/validation.ts';
import { OutLayerClient } from './client.ts';
import { ed25519Key } from '../crypto.ts';
import { Verifier } from '../verifier.ts';

export class OutLayerProcessor implements JobProcessor {
  readonly nonRepeatablePrepare = true;
  private readonly signingKey: KeyObject;
  constructor(
    private client: OutLayerClient,
    private programs: ProgramSource,
    private disclosure: Disclosure,
    private settler: Settler,
    publicKey: Uint8Array,
  ) {
    this.signingKey = ed25519Key(publicKey);
  }
  async prepare(
    report: SealedReport,
    checkpoint?: { callId?: string; accepted(callId: string): Promise<void> },
  ): Promise<PreparedJob> {
    const program = await this.programs.load(report);
    const execution = await this.client.executeSealed(report, program.config, checkpoint);
    try {
      let decoded: unknown = execution.output;
      if (typeof decoded === 'string') {
        try {
          decoded = JSON.parse(decoded);
        } catch {
          throw new Error('Invalid OutLayer runner JSON output');
        }
      }
      const result = object(decoded, 'OutLayer runner output');
      const verdict = parseVerdict(result.verdict);
      for (const field of [
        'network',
        'contract',
        'bounty',
        'hunter',
        'submission',
        'report_hash',
      ] as const) {
        if (verdict[field] !== report[field])
          throw new Error('OutLayer verdict submission mismatch');
      }
      if (
        verdict.rules_hash !== program.rules_hash ||
        BigInt(verdict.expires) > BigInt(program.verdictExpires)
      )
        throw new Error('OutLayer verdict program mismatch');
      const signature = decode(result.signature, 64, 64);
      if (!verify(null, verdictMessage(verdict), this.signingKey, signature))
        throw new Error('Invalid OutLayer verdict signature');
      const ciphertext = decode(result.disclosure_ciphertext, 93, 1_048_576);
      if (digest(ciphertext) !== verdict.disclosure_hash)
        throw new Error('OutLayer disclosure hash mismatch');
      const location = await this.disclosure.publish(ciphertext);
      return { verdict, signature, location };
    } catch (error) {
      throw new NonRetryablePrepareError(
        error instanceof Error ? error.message : 'OutLayer output processing failed',
      );
    }
  }
  deliver(prepared: PreparedJob): Promise<{ transaction: string }> {
    return Verifier.deliver(this.settler, prepared);
  }
}

function decode(value: unknown, min: number, max: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4)
    throw new Error('Invalid OutLayer base64 output');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value)
    throw new Error('Invalid OutLayer base64 output');
  return bytes;
}
