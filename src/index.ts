type DbConnection = {
    name: string;
    url: string;
};

import * as readline from 'readline';
import { MenuManager } from './MenuManager';
import * as fs from 'fs';
import * as path from 'path';
import { MongoClient } from 'mongodb';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const dbFilePath = path.join(__dirname, '../db.json');


async function readDbConnections(): Promise<DbConnection[]> {
    if (!fs.existsSync(dbFilePath)) return [];
    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    if (!raw.trim()) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function saveDbConnections(conns: DbConnection[]): void {
    fs.writeFileSync(dbFilePath, JSON.stringify(conns, null, 2));
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

async function startApp() {
    let conns = await readDbConnections();
    let selectedConn = null;
    while (!selectedConn) {
        if (conns.length === 0) {
            console.log('No database connections found. Please create one.');
            const newConn = await promptNewConnection();
            if (newConn) {
                conns.push(newConn);
                saveDbConnections(conns);
                selectedConn = newConn;
            }
        } else {
            selectedConn = await selectDbConnection(conns);
        }
    }
    // You can set process.env.MONGO_URL or pass selectedConn.url to your connection logic here
    const menu = new MenuManager(selectedConn.url, rl);
    menu.mainMenu();
}

startApp();