
import { mongoClient } from './mongoConnection';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export class MongoRestore {
    // Deserialize extended JSON to MongoDB types
    static deserializeMongoTypes(obj: any): any {
        if (obj == null) return obj;
        if (Array.isArray(obj)) return obj.map(MongoRestore.deserializeMongoTypes);
        if (typeof obj === 'object') {
            // ObjectId
            if (obj.$oid) {
                const { ObjectId } = require('mongodb');
                return new ObjectId(obj.$oid);
            }
            // Date
            if (obj.$date) {
                return new Date(obj.$date);
            }
            // Decimal128
            if (obj.$numberDecimal) {
                const { Decimal128 } = require('mongodb');
                return Decimal128.fromString(obj.$numberDecimal);
            }
            // Double
            if (obj.$numberDouble) {
                const { Double } = require('mongodb');
                return new Double(obj.$numberDouble);
            }
            // Int32
            if (obj.$numberInt) {
                const { Int32 } = require('mongodb');
                return new Int32(obj.$numberInt);
            }
            // Long
            if (obj.$numberLong) {
                const { Long } = require('mongodb');
                return Long.fromString(obj.$numberLong);
            }
            // Timestamp
            if (obj.$timestamp) {
                const { Timestamp } = require('mongodb');
                return new Timestamp(obj.$timestamp.t, obj.$timestamp.i);
            }
            // Recursively deserialize all properties
            const result: any = {};
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    result[key] = MongoRestore.deserializeMongoTypes(obj[key]);
                }
            }
            return result;
        }
        return obj;
    }
    static async restoreMongoInteractive(rl: readline.Interface) {
        const backupRoot = path.join(process.cwd(), 'backup');
        if (!fs.existsSync(backupRoot)) {
            console.log('No backup folder found.');
            return;
        }
        const projects = fs.readdirSync(backupRoot).filter(f => fs.statSync(path.join(backupRoot, f)).isDirectory());
        if (projects.length === 0) {
            console.log('No backup projects found.');
            return;
        }
        console.log('Available backup projects:');
        projects.forEach((proj, idx) => {
            console.log(`${idx + 1}. ${proj}`);
        });
        let projectName = '';
        while (!projects.includes(projectName.trim())) {
            await new Promise<void>((resolveProj) => {
                rl.question('Enter project name to restore (number or name): ', (input) => {
                    const val = input.trim();
                    if (/^\d+$/.test(val)) {
                        const idx = parseInt(val, 10) - 1;
                        if (projects[idx]) {
                            projectName = projects[idx];
                        } else {
                            console.log('Invalid project number. Please try again.');
                        }
                    } else if (projects.includes(val)) {
                        projectName = val;
                    } else {
                        console.log('Invalid project name. Please try again.');
                    }
                    resolveProj();
                });
            });
        }
        const restoreDir = path.join(backupRoot, projectName);
        const dbFolders = fs.readdirSync(restoreDir).filter(f => fs.statSync(path.join(restoreDir, f)).isDirectory());
        if (dbFolders.length === 0) {
            console.log('No databases found in this project.');
            return;
        }
        console.log('Available databases:');
        dbFolders.forEach((db, idx) => {
            console.log(`${idx + 1}. ${db}`);
        });
        let dbsToRestore: string[] = [];
        while (dbsToRestore.length === 0) {
            await new Promise<void>((resolveDb) => {
                rl.question("Enter database name(s) to restore (number, name, comma separated, or 'all'): ", (dbInput) => {
                    const input = dbInput.trim();
                    if (input.toLowerCase() === 'all') {
                        dbsToRestore = dbFolders;
                    } else {
                        let selected: string[] = [];
                        const parts = input.split(',').map(s => s.trim()).filter(Boolean);
                        for (const part of parts) {
                            if (/^\d+$/.test(part)) {
                                const idx = parseInt(part, 10) - 1;
                                if (dbFolders[idx]) selected.push(dbFolders[idx]);
                            } else if (dbFolders.includes(part)) {
                                selected.push(part);
                            }
                        }
                        if (selected.length > 0) {
                            dbsToRestore = Array.from(new Set(selected));
                        } else {
                            console.log('Invalid database selection. Please try again.');
                        }
                    }
                    resolveDb();
                });
            });
        }
        let collectionsToRestore: {[db: string]: string[]} = {};
        if (dbsToRestore.length === 1) {
            const dbName = dbsToRestore[0];
            const dbPath = path.join(restoreDir, dbName);
            const colFiles = fs.readdirSync(dbPath).filter(f => f.endsWith('.json'));
            const colList = colFiles.map(f => path.basename(f, '.json'));
            if (colList.length === 0) {
                console.log('No collections found in this database.');
                return;
            }
            console.log(`Collections in database '${dbName}':`);
            colList.forEach((col: string, idx: number) => {
                console.log(`${idx + 1}. ${col}`);
            });
            while (!collectionsToRestore[dbName]) {
                await new Promise<void>((resolveCol) => {
                    rl.question("Enter collection name(s) to restore (number, name, comma separated, or 'all'): ", (colInput) => {
                        const input = colInput.trim();
                        if (input.toLowerCase() === 'all') {
                            collectionsToRestore[dbName] = colList;
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
                                collectionsToRestore[dbName] = Array.from(new Set(selected));
                            } else {
                                console.log('Invalid collection selection. Please try again.');
                            }
                        }
                        resolveCol();
                    });
                });
            }
        } else {
            // Multiple databases, restore all collections
            dbsToRestore.forEach(dbName => {
                const dbPath = path.join(restoreDir, dbName);
                const colFiles = fs.readdirSync(dbPath).filter(f => f.endsWith('.json'));
                collectionsToRestore[dbName] = colFiles.map(f => path.basename(f, '.json'));
            });
        }
        // Restore logic
        console.log('Connecting to MongoDB for restore...');
        const client = await mongoClient.connect();
        let restored = false;
        for (const dbName of Object.keys(collectionsToRestore)) {
            const dbPath = path.join(restoreDir, dbName);
            for (const collectionName of collectionsToRestore[dbName]) {
                const filePath = path.join(dbPath, `${collectionName}.json`);
                try {
                    const data = fs.readFileSync(filePath, 'utf8');
                    let documents = JSON.parse(data);
                    if (!Array.isArray(documents)) {
                        console.log(`File ${filePath} does not contain an array of documents.`);
                        continue;
                    }
                    // Deserialize MongoDB types
                    documents = MongoRestore.deserializeMongoTypes(documents);
                    const db = client.db(dbName);
                    const collection = db.collection(collectionName);
                    if (documents.length > 0) {
                        await collection.deleteMany({});
                        await collection.insertMany(documents);
                    }
                    console.log(`✓ Restored ${documents.length} documents to ${dbName}.${collectionName}`);
                    restored = true;
                } catch (error) {
                    console.error(`✗ Error restoring ${dbName}.${collectionName}:`, error);
    }
        }
        if (!restored) {
            console.log('No collections found to restore.');
        }
        await client.close();
        console.log('MongoDB connection closed.');
    }
    }
}
