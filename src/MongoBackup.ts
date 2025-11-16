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

    static async backupMongoInteractive(projectName: string, mongoUrl: string, rl: readline.Interface, debugMode: boolean = false, workingDir: string = process.cwd()) {
        if (debugMode) {
            console.log("\n📋 DEBUG MODE - Backup Directories:");
            console.log(`Project name: ${projectName}`);
            console.log(`Working directory: ${workingDir}`);
            console.log(`Backup root: ${path.join(workingDir, 'backup')}`);
            console.log(`Backup path: ${path.join(workingDir, 'backup', projectName)}\n`);
        }
        
        console.log("Connecting to MongoDB...");
        const client = await getMongoClient(mongoUrl).connect();
        await client.db().admin().ping();
        console.log('Connection successful.\n');
        
        // List all databases
        const adminDb = client.db().admin();
        const dbList = await adminDb.listDatabases();
        const databases = dbList.databases
            .map((db: any) => db.name)
            .filter((name: string) => name !== 'admin' && name !== 'local' && name !== 'config');
        
        if (databases.length === 0) {
            console.log('No databases available in this connection.');
            await client.close();
            return;
        }
        
        console.log('Available databases:');
        databases.forEach((db, idx) => {
            console.log(`${idx + 1}. ${db}`);
        });
        
        let dbsToBackup: string[] = [];
        let backupAllDatabases = false;
        while (dbsToBackup.length === 0) {
            await new Promise<void>((resolveDb) => {
                rl.question("Select database(s) (number, name, comma separated, or 'all'): ", (input) => {
                    const val = input.trim();
                    if (val.toLowerCase() === 'all') {
                        dbsToBackup = databases;
                        backupAllDatabases = true;
                    } else {
                        let selected: string[] = [];
                        const parts = val.split(',').map(s => s.trim()).filter(Boolean);
                        for (const part of parts) {
                            if (/^\d+$/.test(part)) {
                                const idx = parseInt(part, 10) - 1;
                                if (databases[idx]) selected.push(databases[idx]);
                            } else if (databases.includes(part)) {
                                selected.push(part);
                            }
                        }
                        if (selected.length > 0) {
                            dbsToBackup = Array.from(new Set(selected));
                        } else {
                            console.log('Invalid database selection. Please try again.');
                        }
                    }
                    resolveDb();
                });
            });
        }

        const backupDir = path.join(workingDir, 'backup', projectName);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        console.log(`\nStarting backup process for project: ${projectName}\n`);

        for (const dbName of dbsToBackup) {
            const dbBackupDir = path.join(backupDir, dbName);
            if (!fs.existsSync(dbBackupDir)) {
                fs.mkdirSync(dbBackupDir, { recursive: true });
            }

            const db = client.db(dbName);
            const collectionNames = await db.listCollections().toArray();
            const colList = collectionNames.map((col: any) => col.name);

            if (colList.length === 0) {
                console.log(`No collections found in database '${dbName}'.`);
                continue;
            }

            let collectionsToBackup: string[] = [];
            
            // Si se seleccionó 'all' en bases de datos, hacer backup de todas las colecciones automáticamente
            if (backupAllDatabases) {
                collectionsToBackup = colList;
                console.log(`Backing up all collections from database '${dbName}'...`);
            } else {
                // Si se seleccionaron bases de datos específicas, preguntar qué colecciones
                console.log(`\nCollections in database '${dbName}':`);
                colList.forEach((col: string, idx: number) => {
                    console.log(`${idx + 1}. ${col}`);
                });
                
                while (collectionsToBackup.length === 0) {
                    await new Promise<void>((resolve) => {
                        rl.question("Enter collection(s) to backup (number, name, comma separated, or 'all'): ", (colInput) => {
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
            }

            console.log(`Backing up database: ${dbName}`);
            for (const collectionName of collectionsToBackup) {
                try {
                    await client.db().admin().ping();
                } catch (error) {
                    console.error(`Connection lost before backing up ${collectionName}:`, error);
                    continue;
                }
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
        }

        console.log("\nBackup process completed!");
        await client.close();
    }
}