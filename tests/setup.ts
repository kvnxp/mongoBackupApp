/**
 * Preloaded before every test file (see bunfig.toml).
 * Points HOME and BACKUPDIR to throwaway folders so no test can read or modify
 * the real ~/.mongobackupcli/MBConfig.json or real backups.
 */
import { afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-sandbox-'));
process.env.HOME = path.join(sandbox, 'home');
process.env.USERPROFILE = process.env.HOME;
process.env.BACKUPDIR = path.join(sandbox, 'backup');
fs.mkdirSync(process.env.HOME, { recursive: true });

afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));
