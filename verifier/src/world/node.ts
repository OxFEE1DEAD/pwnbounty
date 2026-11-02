import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Node {
  rpcUrl: string;
  root: { accountId: string; secretKey: string };
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });
}

function exec(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    spawn(bin, args, { stdio: 'ignore' })
      .on('error', reject)
      .on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`sandbox init ${code}`)))),
  );
}

export async function startNode(bin: string, epochLength: number): Promise<Node> {
  const home = await mkdtemp(join(tmpdir(), 'sealed-world-'));
  let validator: { account_id: string; secret_key: string };
  let ports: number[];
  try {
    await exec(bin, ['--home', home, 'init']);
    const genesisPath = join(home, 'genesis.json');
    const genesis = JSON.parse(await readFile(genesisPath, 'utf8'));
    await writeFile(genesisPath, JSON.stringify({ ...genesis, epoch_length: epochLength }));
    validator = JSON.parse(await readFile(join(home, 'validator_key.json'), 'utf8'));
    ports = [await freePort(), await freePort()];
  } catch (e) {
    await rm(home, { recursive: true, force: true });
    throw e;
  }
  const [rpc, net] = ports;
  const child = spawn(
    bin,
    ['--home', home, 'run', '--rpc-addr', `127.0.0.1:${rpc}`, '--network-addr', `127.0.0.1:${net}`],
    { stdio: 'ignore' },
  );
  const rpcUrl = `http://127.0.0.1:${rpc}`;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  };
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) break;
    const ready = await fetch(`${rpcUrl}/status`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready)
      return {
        rpcUrl,
        root: { accountId: validator.account_id, secretKey: validator.secret_key },
        stop,
      };
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error('Sandbox did not start');
}
