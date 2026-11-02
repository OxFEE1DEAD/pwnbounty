import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { digest } from '../../protocol/index.ts';
import type { Disclosure } from './interfaces.ts';
export class FileDisclosure implements Disclosure {
  private directory: string;
  constructor(directory: string) { this.directory=resolve(directory); }
  async publish(ciphertext: Uint8Array): Promise<string> {
    const hash=digest(ciphertext), path=join(this.directory,hash+'.bin');
    await mkdir(this.directory,{recursive:true,mode:0o700});
    try { await writeFile(path,ciphertext,{flag:'wx',mode:0o600}); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
    if(digest(await readFile(path))!==hash) throw new Error('Disclosure integrity failure');
    return path;
  }
  async read(hash: string): Promise<Buffer> {
    if(!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid disclosure hash');
    const ciphertext=await readFile(join(this.directory,hash+'.bin'));
    if(digest(ciphertext)!==hash) throw new Error('Disclosure integrity failure');
    return ciphertext;
  }
}
