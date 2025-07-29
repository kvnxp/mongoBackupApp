
import { mongoClient } from './mongoConnection';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export class MongoBackup {
    static async backupMongoInteractive(projectName: string, rl: readline.Interface) {
        console.log("Connecting to MongoDB...");
        const client = await mongoClient.connect();
        console.log("Reading databases...");
        var getdb = await client.db().admin().listDatabases();

        const databaseList: any = [];
        getdb.databases.forEach((db) => {
            if (db.name === 'admin' || db.name === 'local' || db.name === 'config') {
                return;
            }
            databaseList.push(db.name);
        });

        if (databaseList.length === 0) {
            console.log("No databases found to backup.");
            await client.close();
            return;
        }

        console.log("Available databases:");
        databaseList.forEach((db: string, idx: number) => {
            console.log(`${idx + 1}. ${db}`);
        });

        // Loop until valid database selection
        let dbsToBackup: string[] = [];
        while (dbsToBackup.length === 0) {
            await new Promise<void>((resolveDb) => {
                rl.question("Enter database name(s) to backup (number, name, comma separated, or 'all'): ", (dbInput) => {
                    const input = dbInput.trim();
                    if (input.toLowerCase() === 'all') {
                        dbsToBackup = databaseList;
                    } else {
                        let selected: string[] = [];
                        const parts = input.split(',').map(s => s.trim()).filter(Boolean);
                        for (const part of parts) {
                            if (/^\d+$/.test(part)) {
                                const idx = parseInt(part, 10) - 1;
                                if (databaseList[idx]) selected.push(databaseList[idx]);
                            } else if (databaseList.includes(part)) {
                                selected.push(part);
                            }
                        }
                        if (selected.length > 0) {
                            dbsToBackup = Array.from(new Set(selected));
                        } else {
                            console.log("Invalid database selection. Please try again.");
                        }
                    }
                    resolveDb();
                });
            });
        }

        const collections: any = {};
        for (const dbName of dbsToBackup) {
            const db = client.db(dbName);
            const collectionNames = await db.listCollections().toArray();
            collections[dbName] = collectionNames.map((col: any) => col.name);
        }

        let collectionsToBackup: { [db: string]: string[] } = {};

        // If only one db, allow collection selection
        if (dbsToBackup.length === 1) {
            const dbName = dbsToBackup[0];
            const colList = collections[dbName];
            console.log(`Collections in database '${dbName}':`);
            colList.forEach((col: string, idx: number) => {
                console.log(`${idx + 1}. ${col}`);
            });
            // Loop until valid collection selection
            while (!collectionsToBackup[dbName]) {
                await new Promise<void>((resolveCol) => {
                    rl.question("Enter collection name(s) to backup (number, name, comma separated, or 'all'): ", (colInput) => {
                        const input = colInput.trim();
                        if (input.toLowerCase() === 'all') {
                            collectionsToBackup[dbName] = colList;
                        } else {
                            let selected: string[] = [];
                            const parts = input.split(',').map(s => s.trim()).filter(Boolean);
                            for (const part of parts) {
                                if (/^\d+$/.test(part)) {
                                    const idx = parseInt(part, 10) - 1;
                                    if (colList[idx]) selected.push(colList[idx]);
                                } else if (colList.includes(part)) {
                                    selected.push(part);
                                }
                            }
                            if (selected.length > 0) {
                                collectionsToBackup[dbName] = Array.from(new Set(selected));
                            } else {
                                console.log("Invalid collection selection. Please try again.");
                            }
                        }
                        resolveCol();
                    });
                });
            }
        } else {
            // Multiple databases, backup all collections
            dbsToBackup.forEach(dbName => {
                collectionsToBackup[dbName] = collections[dbName];
            });
        }

        // Create backup directory structure and backup collections
        const backupDir = path.join(process.cwd(), 'backup', projectName);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        console.log(`Starting backup process for project: ${projectName}`);

        for (const dbName of Object.keys(collectionsToBackup)) {
            console.log(`\nBacking up database: ${dbName}`);
            const dbBackupDir = path.join(backupDir, dbName);
            if (!fs.existsSync(dbBackupDir)) {
                fs.mkdirSync(dbBackupDir, { recursive: true });
            }
            const db = client.db(dbName);
            for (const collectionName of collectionsToBackup[dbName]) {
                console.log(`  Backing up collection: ${collectionName}`);
                try {
                    const collection = db.collection(collectionName);
                    const documents = await collection.find({}).toArray();
                    const backupFilePath = path.join(dbBackupDir, `${collectionName}.json`);
                    fs.writeFileSync(backupFilePath, JSON.stringify(documents, null, 2));
                    console.log(`    ✓ Backed up ${documents.length} documents to ${backupFilePath}`);
                } catch (error) {
                    console.error(`    ✗ Error backing up collection ${collectionName}:`, error);
                }
            }
        }

        console.log("\nBackup process completed!");
        await client.close();
    }
}

