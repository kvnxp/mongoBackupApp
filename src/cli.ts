import * as fs from 'fs';
import * as path from 'path';
import { getMongoClient } from './mongoConnection';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';
import { ARCHIVE_RE, CompressionKind, openArchive } from './archive';
import { findConnectionByName, getBackupRoot, readDbConnections } from './config';
import { runBackupJob, runRestoreJob, JobEvents, JobSummary, Task } from './jobs';
import { formatDuration, formatNumber } from './utils';

export type CliArgs = {
    action: 'backup' | 'restore' | 'help' | null;
    connection: string | null;
    database: string | null;
    backupName: string | null;
    compress: CompressionKind | null;
    debug: boolean;
};

export function parseCliArgs(args: string[]): CliArgs {
    const result: CliArgs = { action: null, connection: null, database: null, backupName: null, compress: null, debug: false };

    for (let i = 0; i < args.length; i++) {
        // Value of the current flag; another flag (e.g. "-b -zip") is not taken as a value
        const value = (): string | null => {
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith('-')) {
                i++;
                return next;
            }
            return null;
        };
        switch (args[i]) {
            case '-h':
            case '--help':
                result.action = 'help';
                break;
            case '-c':
                result.connection = value();
                break;
            case '-d':
                result.database = value();
                break;
            case '-b':
                result.action = 'backup';
                result.backupName = value();
                break;
            case '-r':
                result.action = 'restore';
                result.backupName = value();
                break;
            case '-zip':
                result.compress = 'zip';
                break;
            case '-tar':
                result.compress = 'tar';
                break;
            case '-D':
                result.debug = true;
                break;
        }
    }

    return result;
}

export function showCliHelp(): void {
    console.log(`
MongoBackupCli - MongoDB Backup & Restore Tool

Usage:
  mongobackupcli [options]

Options:
  -c <connection>   Connection name from MBConfig.json (optional if MONGOURI is set)
  -d <database>     Database name to backup/restore (optional if DBNAME is set)
  -b <name>         Backup mode with given project name
  -r <name>         Restore mode (detects .zip or .tar automatically)
  -zip              Compress backup as .zip
  -tar              Package backup as .tar (uncompressed)
  -D                Debug mode (prints resolved directories)
  -h                Show this help message

Examples:
  mongobackupcli -c personal -d mydb -b backup-lunes -zip
  mongobackupcli -c personal -d mydb -b backup-lunes -tar
  mongobackupcli -c personal -d mydb -r backup-lunes.zip
  mongobackupcli -b backup-lunes -zip                    Uses MONGOURI and DBNAME from .env
  mongobackupcli                                         Interactive TUI

Notes:
  - Connections are stored in ~/.mongobackupcli/MBConfig.json
  - Backup root: BACKUPDIR, else <config.workingDir>/backup, else ./backup
  - Restore auto-detects .zip or .tar from the filename
  - Restore replaces the target collections with the backup contents
  - Running without flags in a terminal opens the interactive TUI
`);
}

export function printUsage(): void {
    console.log('Usage:');
    console.log('  mongobackupcli -c <connection> -d <database> -b <name>   Backup');
    console.log('  mongobackupcli -c <connection> -d <database> -r <name>   Restore');
    console.log('  mongobackupcli -h                                        Show help');
    console.log('  mongobackupcli                                           Interactive TUI');
}

/** Resolves the Mongo URI and database from flags / .env. Throws with a user-facing message. */
function resolveTarget(args: CliArgs): { mongoUri: string; dbName: string } {
    let mongoUri: string | null;
    if (args.connection) {
        const conn = findConnectionByName(args.connection);
        if (!conn) {
            const names = readDbConnections().map(c => `  - ${c.name}`);
            throw new Error(`Connection '${args.connection}' not found in MBConfig.json` + (names.length ? `\nAvailable connections:\n${names.join('\n')}` : ''));
        }
        mongoUri = conn.url;
    } else {
        mongoUri = process.env.MONGOURI || null;
        if (!mongoUri) throw new Error('No connection specified. Use -c <connection> or set MONGOURI in .env');
    }
    const dbName = args.database || process.env.DBNAME || null;
    if (!dbName) throw new Error('No database specified. Use -d <database> or set DBNAME in .env');
    return { mongoUri, dbName };
}

function consoleEvents(tasks: Task[]): JobEvents {
    return {
        onPhase: phase => {
            if (phase === 'compressing') console.log('\nCompressing...');
        },
        onTaskEnd: (i, result) => {
            const name = tasks[i].collection;
            if (result.status === 'done') console.log(`  ${name}: ${formatNumber(result.docs)} documents`);
            else if (result.status === 'skipped') console.log(`  ${name}: ${result.reason}, skipping`);
            else if (result.status === 'error') console.error(`  ${name}: error - ${result.error}`);
        },
    };
}

function printSummary(kind: string, summary: JobSummary): void {
    const failed = summary.results.filter(r => r.status === 'error').length;
    if (summary.compressError) console.error(`Compression failed: ${summary.compressError}`);
    if (summary.output && kind === 'Backup') console.log(`\nOutput: ${summary.output}`);
    console.log(`\n${kind} completed: ${formatNumber(summary.docs)} documents in ${formatDuration(summary.elapsedMs)}` + (failed ? `, ${failed} collection(s) failed` : '') + '.');
    if (failed || summary.compressError) process.exitCode = 1;
}

async function cliBackup(args: CliArgs, backupName: string): Promise<void> {
    const { mongoUri, dbName } = resolveTarget(args);
    const backupRoot = getBackupRoot();
    if (args.debug) console.log(`📋 DEBUG MODE - Backup root: ${backupRoot}\n`);

    console.log('Connecting to MongoDB...');
    const client = await getMongoClient(mongoUri).connect();
    try {
        await client.db().admin().ping();
        console.log('Connection successful.\n');

        const collections = await MongoBackup.listCollections(client.db(dbName));
        if (collections.length === 0) {
            console.log(`Database '${dbName}' has no collections.`);
            return;
        }
        const tasks: Task[] = collections.map(c => ({ db: dbName, collection: c.name, total: c.count }));
        console.log(`Backing up database '${dbName}' to ${path.join(backupRoot, backupName, dbName)}`);
        console.log(`  ${tasks.length} collection(s) found\n`);

        const summary = await runBackupJob({ client, backupRoot, project: backupName, tasks, compress: args.compress, events: consoleEvents(tasks) });
        printSummary('Backup', summary);
    } finally {
        await client.close();
    }
}

async function cliRestore(args: CliArgs, backupName: string): Promise<void> {
    const { mongoUri, dbName } = resolveTarget(args);
    const backupRoot = getBackupRoot();
    if (args.debug) console.log(`📋 DEBUG MODE - Backup root: ${backupRoot}\n`);

    let projectDir = path.join(backupRoot, backupName);
    let cleanup: (() => void) | null = null;
    try {
        if (ARCHIVE_RE.test(backupName)) {
            const archivePath = path.resolve(backupRoot, backupName);
            if (!fs.existsSync(archivePath)) throw new Error(`Archive '${archivePath}' not found`);
            console.log(`Extracting ${archivePath}...`);
            ({ projectDir, cleanup } = await openArchive(archivePath));
        }

        const restorePath = path.join(projectDir, dbName);
        if (!fs.existsSync(restorePath)) {
            throw new Error(`Backup '${backupName}/${dbName}' not found in ${backupRoot}`);
        }
        const files = MongoRestore.listBackupFiles(restorePath);
        if (files.length === 0) {
            console.log(`No collections found in backup '${backupName}/${dbName}'.`);
            return;
        }

        console.log('Connecting to MongoDB for restore...');
        const client = await getMongoClient(mongoUri).connect();
        try {
            await client.db().admin().ping();
            console.log('Connection successful.\n');
            console.log(`Restoring database '${dbName}' from ${restorePath}`);
            console.log(`  ${files.length} collection(s) found\n`);

            const tasks: Task[] = files.map(f => ({ db: dbName, collection: f.name, total: f.size }));
            const summary = await runRestoreJob({ client, projectDir, tasks, events: consoleEvents(tasks) });
            printSummary('Restore', summary);
        } finally {
            await client.close();
        }
    } finally {
        if (cleanup) {
            cleanup();
            console.log('Cleaned up extracted files.');
        }
    }
}

export async function runCli(args: CliArgs): Promise<void> {
    if (!args.backupName) return;
    if (args.action === 'backup') {
        await cliBackup(args, args.backupName);
    } else if (args.action === 'restore') {
        await cliRestore(args, args.backupName);
    }
}
