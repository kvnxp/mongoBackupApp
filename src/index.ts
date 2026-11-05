type DbConnection = {
    name: string;
    url: string;
};

import * as readline from 'readline';
import { MenuManager } from './MenuManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getMongoClient } from './mongoConnection';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';
import { errorMessage, question } from './selection';
import * as dotenv from 'dotenv';
import { ZipArchive } from 'archiver';
import * as tar from 'tar';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dbDirPath = path.join(os.homedir(), '.mongobackupcli');
const dbFilePath = path.join(dbDirPath, 'MBConfig.json');
const debugMode = process.argv.includes('-D');

function readConfigFile(): any {
    try {
        const raw = fs.readFileSync(dbFilePath, 'utf-8');
        return raw.trim() ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function getWorkingDirectory(): string {
    const workingDir = readConfigFile()?.config?.workingDir;
    return typeof workingDir === 'string' && workingDir.trim() ? workingDir : process.cwd();
}

/**
 * Backup root shared by CLI and interactive modes:
 * BACKUPDIR env var > <config.workingDir>/backup > <cwd>/backup
 */
function getBackupRoot(): string {
    if (process.env.BACKUPDIR && process.env.BACKUPDIR.trim()) {
        return path.resolve(process.env.BACKUPDIR);
    }
    return path.join(getWorkingDirectory(), 'backup');
}

function readDbConnections(): DbConnection[] {
    const parsed = readConfigFile();
    return Array.isArray(parsed?.dbList) ? parsed.dbList : [];
}

function saveDbConnections(conns: DbConnection[]): void {
    fs.mkdirSync(dbDirPath, { recursive: true, mode: 0o700 });
    const data = readConfigFile();
    data.dbList = conns;
    if (!data.config) data.config = { workingDir: "" };
    // The file stores connection URLs with credentials: keep it readable by the owner only
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.chmodSync(dbFilePath, 0o600);
}

async function testMongoConnection(url: string): Promise<boolean> {
    const client = getMongoClient(url);
    try {
        await client.connect();
        await client.db().admin().ping();
        return true;
    } catch {
        return false;
    } finally {
        await client.close().catch(() => {});
    }
}

async function promptNewConnection(): Promise<DbConnection | null> {
    const name = (await question(rl, 'Enter connection name: ')).trim();
    const url = (await question(rl, 'Enter MongoDB connection URL: ')).trim();
    if (!name || !url) {
        console.log('Name and URL are required.');
        return null;
    }
    process.stdout.write('Testing connection... ');
    if (!(await testMongoConnection(url))) {
        console.log('Failed to connect. Try again.');
        return null;
    }
    console.log('Success!');
    const ans = await question(rl, 'Save this connection? (1: Save, 2: Cancel): ');
    return ans.trim() === '1' ? { name, url } : null;
}

async function selectDbConnection(conns: DbConnection[]): Promise<DbConnection | null> {
    if (conns.length === 0) {
        console.log('No connections configured.');
        return null;
    }
    console.log('Select a database connection:');
    conns.forEach((c, i) => console.log(`${i + 1}. ${c.name}`));
    const idx = parseInt((await question(rl, 'Enter number: ')).trim(), 10) - 1;
    if (idx >= 0 && idx < conns.length) {
        return conns[idx];
    }
    console.log('Invalid selection.');
    return null;
}

async function ask(prompt: string): Promise<string> {
    return (await question(rl, prompt)).trim().toLowerCase();
}

function parseCliArgs(): { action: 'backup' | 'restore' | 'help' | null; connection: string | null; database: string | null; backupName: string | null; compress: 'zip' | 'tar' | null } {
    const args = process.argv.slice(2);
    let action: 'backup' | 'restore' | 'help' | null = null;
    let connection: string | null = null;
    let database: string | null = null;
    let backupName: string | null = null;
    let compress: 'zip' | 'tar' | null = null;

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
                action = 'help';
                break;
            case '-c':
                connection = value();
                break;
            case '-d':
                database = value();
                break;
            case '-b':
                action = 'backup';
                backupName = value();
                break;
            case '-r':
                action = 'restore';
                backupName = value();
                break;
            case '-zip':
                compress = 'zip';
                break;
            case '-tar':
                compress = 'tar';
                break;
        }
    }

    return { action, connection, database, backupName, compress };
}

function showCliHelp(): void {
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
  mongobackupcli                                         Interactive menu

Notes:
  - Connections are stored in ~/.mongobackupcli/MBConfig.json
  - Backup root: BACKUPDIR, else <config.workingDir>/backup, else ./backup
  - Restore auto-detects .zip or .tar from the filename
  - Restore replaces the target collections with the backup contents
  - Running without flags opens the interactive menu
`);
}

function findConnectionByName(name: string): DbConnection | null {
    return readDbConnections().find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
}

async function compressZip(sourceDir: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = new ZipArchive({ zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, path.basename(sourceDir));
        archive.finalize();
    });
}

async function compressTar(sourceDir: string, outputPath: string): Promise<void> {
    await tar.create(
        { file: outputPath, cwd: path.dirname(sourceDir), gzip: false },
        [path.basename(sourceDir)]
    );
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
    if (archivePath.endsWith('.zip')) {
        const { default: extractZip } = await import('extract-zip');
        await extractZip(archivePath, { dir: destDir });
    } else if (archivePath.endsWith('.tar')) {
        await tar.extract({ file: archivePath, cwd: destDir });
    } else {
        throw new Error('Unsupported archive format. Use .zip or .tar');
    }
}

async function handleCliBackup(mongoUri: string, dbName: string, backupName: string, compress: 'zip' | 'tar' | null): Promise<void> {
    const backupDir = getBackupRoot();
    const backupFolder = path.join(backupDir, backupName);
    const backupPath = path.join(backupFolder, dbName);

    if (debugMode) {
        console.log(`📋 DEBUG MODE - Backup root: ${backupDir}\n`);
    }

    console.log(`Connecting to MongoDB...`);
    const client = await getMongoClient(mongoUri).connect();
    try {
        await client.db().admin().ping();
        console.log('Connection successful.\n');

        const db = client.db(dbName);
        const colNames = await MongoBackup.listCollectionNames(db);

        if (colNames.length === 0) {
            console.log(`Database '${dbName}' has no collections.`);
            return;
        }

        fs.mkdirSync(backupPath, { recursive: true });
        console.log(`Backing up database '${dbName}' to ${backupPath}`);
        console.log(`  ${colNames.length} collection(s) found\n`);

        for (const colName of colNames) {
            try {
                const count = await MongoBackup.backupCollection(db, colName, backupPath);
                console.log(`  ${colName}: ${count} documents`);
            } catch (error) {
                console.error(`  ${colName}: error - ${errorMessage(error)}`);
            }
        }
    } finally {
        await client.close();
    }

    if (compress) {
        const archivePath = path.join(backupDir, `${backupName}.${compress}`);

        console.log(`\nCompressing to ${archivePath}...`);
        if (compress === 'zip') {
            await compressZip(backupFolder, archivePath);
        } else {
            await compressTar(backupFolder, archivePath);
        }

        fs.rmSync(backupFolder, { recursive: true, force: true });
        console.log('Compression completed.');
    }

    console.log('\nBackup completed.');
}

/** Finds `<root>/<projectName>/<dbName>` in an extracted archive, tolerating renamed archives. */
function findExtractedDbPath(extractRoot: string, projectName: string, dbName: string): string {
    const expected = path.join(extractRoot, projectName, dbName);
    if (fs.existsSync(expected)) return expected;
    const dirs = fs.readdirSync(extractRoot).filter(f => fs.statSync(path.join(extractRoot, f)).isDirectory());
    if (dirs.length === 1) return path.join(extractRoot, dirs[0], dbName);
    return expected;
}

async function handleCliRestore(mongoUri: string, dbName: string, backupName: string): Promise<void> {
    const backupDir = getBackupRoot();
    let restorePath = path.join(backupDir, backupName, dbName);
    // Archives are extracted to a private temp dir, never inside the backup root,
    // so cleanup can never delete an existing uncompressed backup
    let tempDir: string | null = null;

    try {
        if (/\.(zip|tar)$/.test(backupName)) {
            const archivePath = path.resolve(backupDir, backupName);
            if (!fs.existsSync(archivePath)) {
                throw new Error(`Archive '${archivePath}' not found`);
            }
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongobackup-'));
            console.log(`Extracting ${archivePath}...`);
            await extractArchive(archivePath, tempDir);
            restorePath = findExtractedDbPath(tempDir, path.basename(backupName).replace(/\.(zip|tar)$/, ''), dbName);
        }

        if (!fs.existsSync(restorePath)) {
            throw new Error(`Backup '${backupName}/${dbName}' not found in ${backupDir}`);
        }

        const collections = MongoRestore.listBackupCollections(restorePath);
        if (collections.length === 0) {
            console.log(`No collections found in backup '${backupName}/${dbName}'.`);
            return;
        }

        console.log(`Connecting to MongoDB for restore...`);
        const client = await getMongoClient(mongoUri).connect();
        try {
            await client.db().admin().ping();
            console.log('Connection successful.\n');

            console.log(`Restoring database '${dbName}' from ${restorePath}`);
            console.log(`  ${collections.length} collection(s) found\n`);

            const db = client.db(dbName);
            for (const colName of collections) {
                try {
                    const count = await MongoRestore.restoreCollection(db, colName, path.join(restorePath, `${colName}.json`));
                    console.log(count === null ? `  ${colName}: empty, skipping` : `  ${colName}: ${count} documents`);
                } catch (error) {
                    console.error(`  ${colName}: error - ${errorMessage(error)}`);
                }
            }
        } finally {
            await client.close();
        }
    } finally {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log('\nCleaned up extracted files.');
        }
    }

    console.log('\nRestore completed.');
}

async function profilesMenu(): Promise<void> {
    while (true) {
        const conns = readDbConnections();
        console.log("\n🔗 Profiles Operations:");
        console.log("n. ➕ Add new connection");
        console.log("d. 🗑️ Delete a connection");
        console.log("t. 🧪 Test a connection");
        console.log("b. 🔙 Back to initial menu");
        const choice = await ask("Select an option: ");
        switch (choice) {
            case 'n': {
                const newConn = await promptNewConnection();
                if (newConn) {
                    saveDbConnections([...conns, newConn]);
                }
                break;
            }
            case 'd': {
                const connToDelete = await selectDbConnection(conns);
                if (connToDelete) {
                    saveDbConnections(conns.filter(c => c !== connToDelete));
                    console.log('Connection deleted.');
                }
                break;
            }
            case 't': {
                const connToTest = await selectDbConnection(conns);
                if (connToTest) {
                    process.stdout.write('Testing connection... ');
                    console.log((await testMongoConnection(connToTest.url)) ? 'Success!' : 'Failed.');
                }
                break;
            }
            case 'b':
                return;
            default:
                console.log("Invalid option.");
        }
    }
}

async function startApp() {
    const { action, connection, database, backupName, compress } = parseCliArgs();

    if (action === 'help') {
        showCliHelp();
        rl.close();
        return;
    }

    // CLI mode: -b/-r <name> with connection from -c or MONGOURI env
    if (action && backupName) {
        let mongoUri: string | null = null;

        if (connection) {
            const conn = findConnectionByName(connection);
            if (!conn) {
                console.error(`Error: Connection '${connection}' not found in MBConfig.json`);
                const conns = readDbConnections();
                if (conns.length > 0) {
                    console.log('Available connections:');
                    conns.forEach(c => console.log(`  - ${c.name}`));
                }
                process.exit(1);
            }
            mongoUri = conn.url;
        } else {
            mongoUri = process.env.MONGOURI || null;
            if (!mongoUri) {
                console.error('Error: No connection specified. Use -c <connection> or set MONGOURI in .env');
                process.exit(1);
            }
        }

        const dbName = database || process.env.DBNAME || null;
        if (!dbName) {
            console.error('Error: No database specified. Use -d <database> or set DBNAME in .env');
            process.exit(1);
        }

        if (action === 'backup') {
            await handleCliBackup(mongoUri, dbName, backupName, compress);
        } else {
            await handleCliRestore(mongoUri, dbName, backupName);
        }
        rl.close();
        return;
    }

    // Incomplete CLI flags — show usage
    if (action || connection || database || backupName) {
        console.log('Usage:');
        console.log('  mongobackupcli -c <connection> -d <database> -b <name>   Backup');
        console.log('  mongobackupcli -c <connection> -d <database> -r <name>   Restore');
        console.log('  mongobackupcli -h                                        Show help');
        console.log('  mongobackupcli                                           Interactive menu');
        rl.close();
        return;
    }
    if (debugMode) {
        console.log("\n📋 DEBUG MODE - Working Directories:");
        console.log(`Config directory: ${dbDirPath}`);
        console.log(`Config file: ${dbFilePath}`);
        console.log(`Backup root: ${getBackupRoot()}`);
        console.log(`Current working directory: ${process.cwd()}\n`);
    }

    let conns = readDbConnections();
    let selectedConn: DbConnection | null = null;

    while (true) {
        if (!selectedConn) {
            // Step 1: Select connection
            console.log("\n🔧 MongoBackupApp Initial Menu:");
            console.log("Available connections:");
            if (conns.length === 0) {
                console.log("No connections configured.");
            } else {
                conns.forEach((c: DbConnection, i: number) => {
                    console.log(`${i + 1}. ${c.name}`);
                });
            }
            console.log("\np. 🔗 Profiles Operations");
            console.log("x. 🚪 Exit");
            console.log("Or enter the number of the connection to select it directly.");
            const choice = await ask("Select an option or connection number: ");
            if (choice === 'p') {
                await profilesMenu();
                conns = readDbConnections(); // reload in case changed
            } else if (choice === 'x') {
                rl.close();
                return;
            } else if (/^\d+$/.test(choice)) {
                const idx = parseInt(choice, 10) - 1;
                if (idx >= 0 && idx < conns.length) {
                    console.log(`Connecting to ${conns[idx].name}...`);
                    if (await testMongoConnection(conns[idx].url)) {
                        selectedConn = conns[idx];
                    } else {
                        console.log('Failed to connect. Check the connection URL or server.');
                    }
                } else {
                    console.log("Invalid connection number.");
                }
            } else {
                console.log("Invalid option. Please try again.");
            }
        } else {
            // Step 2: Show action menu (Backup/Restore/Back/Exit)
            console.log("\n🔧 MongoBackupApp CLI Menu:");
            console.log(`Connection: ${selectedConn.name}`);
            console.log("\nb. 💾 Backup MongoDB");
            console.log("r. 🔄 Restore MongoDB");
            console.log("c. 🔙 Back to select connection");
            console.log("x. 🚪 Exit");
            const choice = await ask("Select an option: ");

            if (choice === 'b' || choice === 'r') {
                const menu = new MenuManager(selectedConn.url, rl, debugMode, getBackupRoot());
                if (choice === 'b') {
                    await menu.doBackup();
                } else {
                    await menu.doRestore();
                }
            } else if (choice === 'c') {
                selectedConn = null;
            } else if (choice === 'x') {
                rl.close();
                return;
            } else {
                console.log("Invalid option. Please try again.");
            }
        }
    }
}

startApp().catch((error) => {
    console.error('Error:', errorMessage(error));
    rl.close();
    process.exit(1);
});
