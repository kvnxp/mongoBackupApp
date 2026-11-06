import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_SELECTION_TIMEOUT_MS, getInteractiveClient } from './mongoConnection';

export type DbConnection = {
    name: string;
    url: string;
};

// Resolved on each call so HOME can be changed (tests, sandboxes).
// Bun caches os.homedir(), so the environment is read first.
export function configDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.mongobackupcli');
}

export function configFile(): string {
    return path.join(configDir(), 'MBConfig.json');
}

export function readConfigFile(): any {
    try {
        const raw = fs.readFileSync(configFile(), 'utf-8');
        return raw.trim() ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function readDbConnections(): DbConnection[] {
    const parsed = readConfigFile();
    return Array.isArray(parsed?.dbList) ? parsed.dbList : [];
}

export function saveDbConnections(conns: DbConnection[]): void {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    const data = readConfigFile();
    data.dbList = conns;
    if (!data.config) data.config = { workingDir: "" };
    // The file stores connection URLs with credentials: keep it readable by the owner only
    fs.writeFileSync(configFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.chmodSync(configFile(), 0o600);
}

export function findConnectionByName(name: string): DbConnection | null {
    return readDbConnections().find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
}

export function getWorkingDirectory(): string {
    const workingDir = readConfigFile()?.config?.workingDir;
    return typeof workingDir === 'string' && workingDir.trim() ? workingDir : process.cwd();
}

/**
 * Backup root shared by CLI and interactive modes:
 * BACKUPDIR env var > <config.workingDir>/backup > <cwd>/backup
 */
export function getBackupRoot(): string {
    if (process.env.BACKUPDIR && process.env.BACKUPDIR.trim()) {
        return path.resolve(process.env.BACKUPDIR);
    }
    return path.join(getWorkingDirectory(), 'backup');
}

/** Connects, pings and closes. Throws with the driver's message on failure. */
export async function checkMongoConnection(url: string, timeoutMs = DEFAULT_SELECTION_TIMEOUT_MS): Promise<void> {
    const client = getInteractiveClient(url, timeoutMs);
    try {
        await client.connect();
        await client.db().admin().ping();
    } finally {
        await client.close().catch(() => {});
    }
}

export async function testMongoConnection(url: string, timeoutMs = DEFAULT_SELECTION_TIMEOUT_MS): Promise<boolean> {
    try {
        await checkMongoConnection(url, timeoutMs);
        return true;
    } catch {
        return false;
    }
}
