
import { getMongoClient } from './mongoConnection';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export class MongoBackup {
    // Serialize MongoDB types to extended JSON
    static serializeMongoTypes(obj: any): any {
        if (obj == null) return obj;
        if (Array.isArray(obj)) return obj.map(MongoBackup.serializeMongoTypes);
        if (typeof obj === 'object') {
            // ObjectId
            if (obj._bsontype === 'ObjectID' || obj._bsontype === 'ObjectId') {
                return { "$oid": obj.toHexString() };
            }
            // Date
            if (obj instanceof Date) {
                return { "$date": obj.toISOString() };
            }
            // Decimal128
            if (obj._bsontype === 'Decimal128') {
                return { "$numberDecimal": obj.toString() };
            }
            // Double
            if (obj._bsontype === 'Double') {
                return { "$numberDouble": obj.value };
            }
            // Int32
            if (obj._bsontype === 'Int32') {
                return { "$numberInt": obj.value };
            }
            // Long
            if (obj._bsontype === 'Long') {
                return { "$numberLong": obj.toString() };
            }
            // Timestamp
            if (obj._bsontype === 'Timestamp') {
                return { "$timestamp": { "t": obj.getHighBits(), "i": obj.getLowBits() } };
            }
            // Recursively serialize all properties
            const result: any = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    result[key] = MongoBackup.serializeMongoTypes(obj[key]);
                }
            }
            return result;
        }
        return obj;
    }

    static async backupMongoInteractive(projectName: string, dbName: string, rl: readline.Interface, mongoUrl: string) {
        console.log("Connecting to MongoDB...");
        const client = await getMongoClient(mongoUrl).connect();
        console.log(`Backing up database: ${dbName}`);

        const db = client.db(dbName);
        const collectionNames = await db.listCollections().toArray();
        const colList = collectionNames.map((col: any) => col.name);

        if (colList.length === 0) {
            console.log(`No collections found in database '${dbName}'.`);
            await client.close();
            return;
        }

        console.log(`Collections in database '${dbName}':`);
        colList.forEach((col: string, idx: number) => {
            console.log(`${idx + 1}. ${col}`);
        });

        let collectionsToBackup: string[] = [];
        while (collectionsToBackup.length === 0) {
            await new Promise<void>((resolve) => {
                rl.question("Enter collection name(s) to backup (number, name, comma separated, or 'all'): ", (colInput) => {
                    const input = colInput.trim();
                    if (input.toLowerCase() === 'all') {
                        collectionsToBackup = colList;
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
                            collectionsToBackup = Array.from(new Set(selected));
                        } else {
                            console.log("Invalid collection selection. Please try again.");
                        }
                    }
                    resolve();
                });
            });
        }

        // Create backup directory structure and backup collections
        const backupDir = path.join(process.cwd(), 'backup', projectName);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const dbBackupDir = path.join(backupDir, dbName);
        if (!fs.existsSync(dbBackupDir)) {
            fs.mkdirSync(dbBackupDir, { recursive: true });
        }

        console.log(`Starting backup process for project: ${projectName}, database: ${dbName}`);

        for (const collectionName of collectionsToBackup) {
            console.log(`  Backing up collection: ${collectionName}`);
            try {
                const collection = db.collection(collectionName);
                const documents = await collection.find({}).toArray();
                // Serialize MongoDB types for backup
                const serializedDocs = MongoBackup.serializeMongoTypes(documents);
                const backupFilePath = path.join(dbBackupDir, `${collectionName}.json`);
                fs.writeFileSync(backupFilePath, JSON.stringify(serializedDocs, null, 2));
                console.log(`    ✓ Backed up ${documents.length} documents to ${backupFilePath}`);
            } catch (error) {
                console.error(`    ✗ Error backing up collection ${collectionName}:`, error);
            }
        }

        console.log("\nBackup process completed!");
        await client.close();
    }
}

