type DbConnection = {
    name: string;
    url: string;
};

import * as readline from 'readline';
import { MenuManager } from './MenuManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MongoClient } from 'mongodb';
import { getMongoClient } from './mongoConnection';
import * as dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dbDirPath = path.join(os.homedir(), '.mongobackupcli');
const dbFilePath = path.join(dbDirPath, 'MBConfig.json');
const debugMode = process.argv.includes('-D');

function getWorkingDirectory(): string {
    try {
        const raw = fs.readFileSync(dbFilePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.config && data.config.workingDir && data.config.workingDir.trim()) {
            return data.config.workingDir;
        }
    } catch {}
    return process.cwd();
}

async function readDbConnections(): Promise<DbConnection[]> {
    if (!fs.existsSync(dbDirPath)) {
        fs.mkdirSync(dbDirPath, { recursive: true });
    }
    if (!fs.existsSync(dbFilePath)) return [];
    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    if (!raw.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.dbList && Array.isArray(parsed.dbList)) {
            return parsed.dbList;
        } else {
            return [];
        }
    } catch {
        return [];
    }
}

function saveDbConnections(conns: DbConnection[]): void {
    let data: any = {};
    if (fs.existsSync(dbFilePath)) {
        try {
            const raw = fs.readFileSync(dbFilePath, 'utf-8');
            data = JSON.parse(raw);
        } catch {}
    }
    data.dbList = conns;
    if (!data.config) data.config = { workingDir: "" };
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2));
}

async function testMongoConnection(url: string): Promise<boolean> {
    try {
        const client = new MongoClient(url);
        await client.connect();
        await client.close();
        return true;
    } catch {
        return false;
    }
}

async function promptNewConnection(): Promise<DbConnection | null> {
    return new Promise((resolve) => {
        rl.question('Enter connection name: ', (name) => {
            rl.question('Enter MongoDB connection URL: ', async (url) => {
                process.stdout.write('Testing connection... ');
                const ok = await testMongoConnection(url);
                if (ok) {
                    console.log('Success!');
                    rl.question('Save this connection? (1: Save, 2: Cancel): ', (ans) => {
                        if (ans.trim() === '1') {
                            resolve({ name, url });
                        } else {
                            resolve(null);
                        }
                    });
                } else {
                    console.log('Failed to connect. Try again.');
                    resolve(null);
                }
            });
        });
    });
}

async function selectDbConnection(conns: DbConnection[]): Promise<DbConnection | null> {
    return new Promise((resolve) => {
        console.log('Select a database connection:');
        conns.forEach((c: DbConnection, i: number) => {
            console.log(`${i + 1}. ${c.name} `);
        });
        rl.question('Enter number: ', (ans) => {
            const idx = parseInt(ans.trim(), 10) - 1;
            if (idx >= 0 && idx < conns.length) {
                resolve(conns[idx]);
            } else {
                console.log('Invalid selection.');
                resolve(null);
            }
        });
    });
}

async function listDatabases(url: string): Promise<string[]> {
    try {
        const client = await getMongoClient(url).connect();
        const adminDb = client.db().admin();
        const dbList = await adminDb.listDatabases();
        await client.close();
        return dbList.databases
            .map((db: any) => db.name)
            .filter((name: string) => name !== 'admin' && name !== 'local' && name !== 'config');
    } catch (error) {
        console.error('Error listing databases:', error);
        return [];
    }
}

async function selectDatabase(databases: string[]): Promise<string | null> {
    return new Promise((resolve) => {
        console.log('Available databases:');
        databases.forEach((db, i) => {
            console.log(`${i + 1}. ${db}`);
        });
        rl.question('Select a database (number): ', (ans) => {
            const idx = parseInt(ans.trim(), 10) - 1;
            if (idx >= 0 && idx < databases.length) {
                resolve(databases[idx]);
            } else {
                console.log('Invalid selection.');
                resolve(null);
            }
        });
    });
}

function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim().toLowerCase()));
    });
}

function getCliArgs(): { flag: string | null; name: string | null } {
    const args = process.argv.slice(2);
    if (args.length >= 2) {
        return { flag: args[0], name: args[1] };
    }
    return { flag: null, name: null };
}

function getEnvBackupDir(): string {
    return process.env.BACKUPDIR || path.join(process.cwd(), 'backup');
}

function getEnvMongoUri(): string | null {
    return process.env.MONGOURI || null;
}

function getEnvDbName(): string | null {
    return process.env.DBNAME || null;
}

async function handleCliBackup(name: string): Promise<void> {
    const mongoUri = getEnvMongoUri();
    if (!mongoUri) {
        console.error('Error: MONGOURI not set in .env');
        process.exit(1);
    }

    const backupDir = getEnvBackupDir();
    const backupPath = path.join(backupDir, name);

    if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
    }

    console.log(`Connecting to MongoDB...`);
    const client = await getMongoClient(mongoUri).connect();
    await client.db().admin().ping();
    console.log('Connection successful.\n');

    const adminDb = client.db().admin();
    const dbList = await adminDb.listDatabases();
    const databases = dbList.databases
        .map((db: any) => db.name)
        .filter((n: string) => n !== 'admin' && n !== 'local' && n !== 'config');

    if (databases.length === 0) {
        console.log('No databases available.');
        await client.close();
        return;
    }

    console.log(`Backing up ${databases.length} database(s) to ${backupPath}\n`);

    for (const dbName of databases) {
        const dbBackupDir = path.join(backupPath, dbName);
        if (!fs.existsSync(dbBackupDir)) {
            fs.mkdirSync(dbBackupDir, { recursive: true });
        }

        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        const colNames = collections.map((c: any) => c.name);

        if (colNames.length === 0) {
            console.log(`  ${dbName}: no collections, skipping`);
            continue;
        }

        console.log(`  ${dbName}: backing up ${colNames.length} collection(s)`);
        for (const colName of colNames) {
            try {
                const docs = await db.collection(colName).find({}).toArray();
                const filePath = path.join(dbBackupDir, `${colName}.json`);
                fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
                console.log(`    ${colName}: ${docs.length} documents`);
            } catch (error) {
                console.error(`    ${colName}: error -`, error);
            }
        }
    }

    await client.close();
    console.log('\nBackup completed.');
}

async function handleCliRestore(name: string): Promise<void> {
    const mongoUri = getEnvMongoUri();
    if (!mongoUri) {
        console.error('Error: MONGOURI not set in .env');
        process.exit(1);
    }

    const backupDir = getEnvBackupDir();
    const restorePath = path.join(backupDir, name);

    if (!fs.existsSync(restorePath)) {
        console.error(`Error: Backup '${name}' not found in ${backupDir}`);
        process.exit(1);
    }

    const dbFolders = fs.readdirSync(restorePath).filter(f =>
        fs.statSync(path.join(restorePath, f)).isDirectory()
    );

    if (dbFolders.length === 0) {
        console.log('No databases found in this backup.');
        return;
    }

    console.log(`Connecting to MongoDB for restore...`);
    const client = await getMongoClient(mongoUri).connect();
    await client.db().admin().ping();
    console.log('Connection successful.\n');

    console.log(`Restoring from ${restorePath}\n`);

    for (const dbName of dbFolders) {
        const dbBackupDir = path.join(restorePath, dbName);
        const collectionFiles = fs.readdirSync(dbBackupDir).filter(f => f.endsWith('.json'));

        if (collectionFiles.length === 0) {
            console.log(`  ${dbName}: no collections, skipping`);
            continue;
        }

        console.log(`  ${dbName}: restoring ${collectionFiles.length} collection(s)`);
        for (const file of collectionFiles) {
            const colName = file.replace('.json', '');
            try {
                const data = fs.readFileSync(path.join(dbBackupDir, file), 'utf8');
                const documents = JSON.parse(data);
                if (!Array.isArray(documents) || documents.length === 0) {
                    console.log(`    ${colName}: empty, skipping`);
                    continue;
                }
                const db = client.db(dbName);
                const collection = db.collection(colName);
                await collection.deleteMany({});
                await collection.insertMany(documents);
                console.log(`    ${colName}: ${documents.length} documents`);
            } catch (error) {
                console.error(`    ${colName}: error -`, error);
            }
        }
    }

    await client.close();
    console.log('\nRestore completed.');
}

async function profilesMenu(conns: DbConnection[]): Promise<void> {
    console.log("\n🔗 Profiles Operations:");
    console.log("n. ➕ Add new connection");
    console.log("d. 🗑️ Delete a connection");
    console.log("t. 🧪 Test a connection");
    console.log("b. 🔙 Back to initial menu");
    const choice = await ask("Select an option: ");
    switch (choice) {
        case 'n':
            const newConn = await promptNewConnection();
            if (newConn) {
                conns.push(newConn);
                saveDbConnections(conns);
                conns = await readDbConnections(); // reload
            }
            break;
        case 'd':
            const connToDelete = await selectDbConnection(conns);
            if (connToDelete) {
                const index = conns.indexOf(connToDelete);
                conns.splice(index, 1);
                saveDbConnections(conns);
                conns = await readDbConnections(); // reload
                console.log('Connection deleted.');
            }
            break;
        case 't':
            const connToTest = await selectDbConnection(conns);
            if (connToTest) {
                process.stdout.write('Testing connection... ');
                const ok = await testMongoConnection(connToTest.url);
                console.log(ok ? 'Success!' : 'Failed.');
            }
            break;
        case 'b':
            return;
        default:
            console.log("Invalid option.");
    }
    await profilesMenu(conns); // recursive for submenu
}

async function startApp() {
    const { flag, name } = getCliArgs();

    if (flag === '-b' && name) {
        await handleCliBackup(name);
        rl.close();
        return;
    }

    if (flag === '-r' && name) {
        await handleCliRestore(name);
        rl.close();
        return;
    }

    if (flag && flag !== '-D') {
        console.log(`Usage:`);
        console.log(`  mongobackupcli -b <name>   Backup all databases`);
        console.log(`  mongobackupcli -r <name>   Restore a backup`);
        console.log(`  mongobackupcli              Interactive menu`);
        rl.close();
        return;
    }
    if (debugMode) {
        console.log("\n📋 DEBUG MODE - Working Directories:");
        console.log(`Config directory: ${dbDirPath}`);
        console.log(`Config file: ${dbFilePath}`);
        console.log(`Backup root: ${path.join(process.cwd(), 'backup')}`);
        console.log(`Current working directory: ${process.cwd()}\n`);
    }
    
    let conns = await readDbConnections();
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
            console.log("Or enter the number of the connection to select it directly.");
            const choice = await ask("Select an option or connection number: ");
            if (choice === 'p') {
                await profilesMenu(conns);
                conns = await readDbConnections(); // reload in case changed
            } else if (/^\d+$/.test(choice)) {
                const idx = parseInt(choice, 10) - 1;
                if (idx >= 0 && idx < conns.length) {
                    selectedConn = conns[idx];
                    console.log(`Connecting to ${selectedConn.name}...`);
                    await listDatabases(selectedConn.url); // Test connection
                } else {
                    console.log("Invalid connection number.");
                }
            } else {
                console.log("Invalid option. Please try again.");
            }
        } else {
            // Step 2: Show action menu (Backup/Restore/Back/Exit)
            console.log("\n🔧 MongoBackupApp CLI Menu:");
            console.log(`Conexión: ${selectedConn.name}`);
            console.log("\nb. 💾 Backup MongoDB");
            console.log("r. 🔄 Restore MongoDB");
            console.log("c. 🔙 Back to select connection");
            console.log("x. 🚪 Exit");
            const choice = await ask("Select an option: ");
            
            if (choice === 'b') {
                // Backup flow - no need to select database here
                const workingDir = getWorkingDirectory();
                const menu = new MenuManager(selectedConn.url, '', rl, conns, saveDbConnections, debugMode, workingDir);
                await menu.doBackup();
            } else if (choice === 'r') {
                // Restore flow
                const workingDir = getWorkingDirectory();
                const menu = new MenuManager(selectedConn.url, '', rl, conns, saveDbConnections, debugMode, workingDir);
                await menu.doRestore();
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

startApp();