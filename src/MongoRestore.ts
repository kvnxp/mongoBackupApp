
import { getMongoClient } from './mongoConnection';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { BSON, Db, Document, IndexDescription } from 'mongodb';
const { EJSON } = BSON;
import { errorMessage, parseSelection, promptSelection, question } from './selection';

const INSERT_BATCH_SIZE = 1000;

export class MongoRestore {
    // Deserialize Extended JSON to MongoDB types.
    // Also reads backups made by older versions ($oid, $date ISO string, $numberDecimal, $numberLong, $timestamp).
    static deserializeMongoTypes(obj: any): any {
        return EJSON.deserialize(obj, { relaxed: false });
    }

    /** Lists `<collection>.json` files in a backup folder and returns collection names. */
    static listBackupCollections(dir: string): string[] {
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => path.basename(f, '.json'))
            .sort();
    }

    /**
     * Replaces `collectionName` with the documents in `filePath`.
     * Documents go into a temporary collection first (with the target's indexes);
     * the target is only replaced, via rename, once every insert succeeded.
     * Returns the number of restored documents, or null when the file is empty (target untouched).
     */
    static async restoreCollection(db: Db, collectionName: string, filePath: string): Promise<number | null> {
        const documents = MongoRestore.deserializeMongoTypes(JSON.parse(fs.readFileSync(filePath, 'utf8')));
        if (!Array.isArray(documents)) {
            throw new Error(`File ${filePath} does not contain an array of documents.`);
        }
        if (documents.length === 0) return null;

        const tmp = db.collection(`${collectionName}.__restore_tmp_${Date.now()}`);
        try {
            const exists = (await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray()).length > 0;
            if (exists) {
                const indexes = (await db.collection(collectionName).listIndexes().toArray())
                    .filter(idx => idx.name !== '_id_')
                    .map(({ v, ns, ...spec }) => spec as IndexDescription);
                if (indexes.length > 0) await tmp.createIndexes(indexes);
            }
            for (let i = 0; i < documents.length; i += INSERT_BATCH_SIZE) {
                await tmp.insertMany(documents.slice(i, i + INSERT_BATCH_SIZE) as Document[]);
            }
            await tmp.rename(collectionName, { dropTarget: true });
        } catch (error) {
            await tmp.drop().catch(() => {});
            throw error;
        }
        return documents.length;
    }

    static async restoreMongoInteractive(rl: readline.Interface, mongoUrl: string, debugMode: boolean = false, backupRoot: string) {
        if (debugMode) {
            console.log("\n📋 DEBUG MODE - Restore Directories:");
            console.log(`Backup root: ${backupRoot}\n`);
        }

        if (!fs.existsSync(backupRoot)) {
            console.log('No backup folder found.');
            return;
        }
        const projects = fs.readdirSync(backupRoot).filter(f => fs.statSync(path.join(backupRoot, f)).isDirectory()).sort();
        if (projects.length === 0) {
            console.log('No backup projects found.');
            return;
        }
        console.log('Available backup projects:');
        projects.forEach((proj, idx) => console.log(`${idx + 1}. ${proj}`));
        let projectName = '';
        while (!projectName) {
            const result = parseSelection(await question(rl, 'Enter project name to restore (number or name): '), projects);
            if (result && !result.all && result.selected.length === 1) {
                projectName = result.selected[0];
            } else {
                console.log('Invalid project. Please try again.');
            }
        }

        const restoreDir = path.join(backupRoot, projectName);
        const dbFolders = fs.readdirSync(restoreDir).filter(f => fs.statSync(path.join(restoreDir, f)).isDirectory()).sort();
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
        const dbSelection = await promptSelection(rl, "Select database(s) (number, name, comma separated, or 'all'): ", dbFolders);

        // Restore logic
        console.log('Connecting to MongoDB for restore...');
        const client = await getMongoClient(mongoUrl).connect();
        try {
            await client.db().admin().ping();
            console.log('Connection successful.\n');

            let restored = false;
            for (const dbToRestore of dbSelection.selected) {
                const dbBackupDir = path.join(restoreDir, dbToRestore);
                const collectionList = MongoRestore.listBackupCollections(dbBackupDir);

                if (collectionList.length === 0) {
                    console.log(`No collections found in database '${dbToRestore}'.`);
                    continue;
                }

                let collectionsToRestore: string[];
                // Si se seleccionó 'all' en bases de datos, restaurar todas las colecciones automáticamente
                if (dbSelection.all) {
                    collectionsToRestore = collectionList;
                    console.log(`Restoring all collections from database '${dbToRestore}'...`);
                } else {
                    // Si se seleccionaron bases de datos específicas, preguntar qué colecciones
                    console.log(`\nCollections in database '${dbToRestore}':`);
                    collectionsToRestore = (await promptSelection(rl, "Enter collection(s) to restore (number, name, comma separated, or 'all'): ", collectionList)).selected;
                }

                console.log(`Restore path: ${dbBackupDir}\n`);
                const db = client.db(dbToRestore);
                for (const collectionName of collectionsToRestore) {
                    try {
                        const count = await MongoRestore.restoreCollection(db, collectionName, path.join(dbBackupDir, `${collectionName}.json`));
                        if (count === null) {
                            console.log(`- ${collectionName}: empty backup, skipped`);
                        } else {
                            console.log(`✓ Restored ${count} documents to ${collectionName}`);
                            restored = true;
                        }
                    } catch (error) {
                        console.error(`✗ Error restoring ${collectionName}: ${errorMessage(error)}`);
                    }
                }
            }

            if (!restored) {
                console.log('No collections found to restore.');
            }
        } finally {
            await client.close();
            console.log('MongoDB connection closed.');
        }
    }
}
