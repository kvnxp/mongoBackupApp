
import { getMongoClient } from './mongoConnection';
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
    static async restoreMongoInteractive(rl: readline.Interface, mongoUrl: string, selectedDbName: string, debugMode: boolean = false, workingDir: string = process.cwd()) {
        if (debugMode) {
            console.log("\n📋 DEBUG MODE - Restore Directories:");
            console.log(`Working directory: ${workingDir}`);
            console.log(`Backup root: ${path.join(workingDir, 'backup')}`);
            console.log(`Selected database: ${selectedDbName}\n`);
        }
        
        const backupRoot = path.join(workingDir, 'backup');
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
        
        if (debugMode) {
            console.log(`📋 DEBUG MODE - Selected Project Directories:`);
            console.log(`Project path: ${restoreDir}`);
            console.log(`Available databases: ${dbFolders.join(', ')}\n`);
        }
        
        console.log('Available databases in this backup:');
        dbFolders.forEach((db, idx) => {
            console.log(`${idx + 1}. ${db}`);
        });
        let dbsToRestore: string[] = [];
        let restoreAllDatabases = false;
        while (dbsToRestore.length === 0) {
            await new Promise<void>((resolveDb) => {
                rl.question("Select database(s) (number, name, comma separated, or 'all'): ", (input) => {
                    const val = input.trim();
                    if (val.toLowerCase() === 'all') {
                        dbsToRestore = dbFolders;
                        restoreAllDatabases = true;
                    } else {
                        let selected: string[] = [];
                        const parts = val.split(',').map(s => s.trim()).filter(Boolean);
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
        
        // Restore logic
        console.log('Connecting to MongoDB for restore...');
        const client = await getMongoClient(mongoUrl).connect();
        await client.db().admin().ping();
        console.log('Connection successful.\n');
        
        let restored = false;
        
        for (const dbToRestore of dbsToRestore) {
            const dbBackupDir = path.join(restoreDir, dbToRestore);
            const collectionFiles = fs.readdirSync(dbBackupDir).filter(f => f.endsWith('.json'));
            
            if (collectionFiles.length === 0) {
                console.log(`No collections found in database '${dbToRestore}'.`);
                continue;
            }
            
            const collectionList = collectionFiles.map(f => f.replace('.json', ''));
            let collectionsToRestore: string[] = [];
            
            // Si se seleccionó 'all' en bases de datos, restaurar todas las colecciones automáticamente
            if (restoreAllDatabases) {
                collectionsToRestore = collectionList;
                console.log(`Restoring all collections from database '${dbToRestore}'...`);
            } else {
                // Si se seleccionaron bases de datos específicas, preguntar qué colecciones
                console.log(`\nCollections in database '${dbToRestore}':`);
                collectionList.forEach((col, idx) => {
                    console.log(`${idx + 1}. ${col}`);
                });
                
                while (collectionsToRestore.length === 0) {
                    await new Promise<void>((resolveCol) => {
                        rl.question("Enter collection(s) to restore (number, name, comma separated, or 'all'): ", (colInput) => {
                            const input = colInput.trim();
                            if (input.toLowerCase() === 'all') {
                                collectionsToRestore = collectionList;
                            } else {
                                let selected: string[] = [];
                                const parts = input.split(',').map(s => s.trim()).filter(Boolean);
                                for (const part of parts) {
                                    if (/^\d+$/.test(part)) {
                                        const idx = parseInt(part, 10) - 1;
                                        if (collectionList[idx]) selected.push(collectionList[idx]);
                                    } else if (collectionList.includes(part)) {
                                        selected.push(part);
                                    }
                                }
                                if (selected.length > 0) {
                                    collectionsToRestore = Array.from(new Set(selected));
                                } else {
                                    console.log('Invalid collection selection. Please try again.');
                                }
                            }
                            resolveCol();
                        });
                    });
                }
            }
            
            console.log(`Restore path: ${dbBackupDir}\n`);
            
            for (const collectionName of collectionsToRestore) {
                try {
                    await client.db().admin().ping();
                } catch (error) {
                    console.error(`Connection lost before restoring ${collectionName}:`, error);
                    continue;
                }
                const filePath = path.join(dbBackupDir, `${collectionName}.json`);
                try {
                    const data = fs.readFileSync(filePath, 'utf8');
                    let documents = JSON.parse(data);
                    if (!Array.isArray(documents)) {
                        console.log(`File ${filePath} does not contain an array of documents.`);
                        continue;
                    }
                    // Deserialize MongoDB types
                    documents = MongoRestore.deserializeMongoTypes(documents);
                    const db = client.db(dbToRestore);
                    const collection = db.collection(collectionName);
                    if (documents.length > 0) {
                        await collection.deleteMany({});
                        await collection.insertMany(documents);
                    }
                    console.log(`✓ Restored ${documents.length} documents to ${collectionName}`);
                    restored = true;
                } catch (error) {
                    console.error(`✗ Error restoring ${collectionName}:`, error);
                }
            }
        }
        
        if (!restored) {
            console.log('No collections found to restore.');
        }
        await client.close();
        console.log('MongoDB connection closed.');
    }
}
