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