import { getMongoClient } from './mongoConnection';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { BSON, Db } from 'mongodb';
const { EJSON } = BSON;
import { errorMessage, promptSelection } from './selection';

export const SYSTEM_DATABASES = ['admin', 'local', 'config'];

export class MongoBackup {
    // Serialize MongoDB types to canonical Extended JSON (keeps Int32/Double/Long/Binary/etc.)
    static serializeMongoTypes(obj: any): any {
        return EJSON.serialize(obj, { relaxed: false });
    }

    /** Lists real collections (no views, no system collections). */
    static async listCollectionNames(db: Db): Promise<string[]> {
        const cols = await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
        return cols.map(c => c.name).filter(name => !name.startsWith('system.')).sort();
    }

    /**
     * Streams one collection to `<dir>/<collection>.json` as a JSON array.
     * Writes to a temporary file first so an interrupted backup never leaves a truncated .json.
     * Returns the number of documents written.
     */
    static async backupCollection(db: Db, collectionName: string, dir: string): Promise<number> {
        const filePath = path.join(dir, `${collectionName}.json`);
        const tmpPath = `${filePath}.tmp`;
        const fd = fs.openSync(tmpPath, 'w');
        let count = 0;
        try {
            fs.writeSync(fd, '[');
            // promoteValues: false keeps Int32/Double/Long wrappers so their type survives the round trip
            const cursor = db.collection(collectionName).find({}, { promoteValues: false, promoteLongs: false });
            for await (const doc of cursor) {
                fs.writeSync(fd, (count === 0 ? '\n' : ',\n') + EJSON.stringify(doc, undefined, 2, { relaxed: false }));
                count++;
            }
            fs.writeSync(fd, count === 0 ? ']\n' : '\n]\n');
            fs.closeSync(fd);
        } catch (error) {
            fs.closeSync(fd);
            fs.rmSync(tmpPath, { force: true });
            throw error;
        }
        fs.renameSync(tmpPath, filePath);
        return count;
    }

    static async backupMongoInteractive(projectName: string, mongoUrl: string, rl: readline.Interface, debugMode: boolean = false, backupRoot: string) {
        const backupDir = path.join(backupRoot, projectName);
        if (debugMode) {
            console.log("\n📋 DEBUG MODE - Backup Directories:");
            console.log(`Project name: ${projectName}`);
            console.log(`Backup root: ${backupRoot}`);
            console.log(`Backup path: ${backupDir}\n`);
        }

        console.log("Connecting to MongoDB...");
        const client = await getMongoClient(mongoUrl).connect();
        try {
            await client.db().admin().ping();
            console.log('Connection successful.\n');

            // List all databases
            const dbList = await client.db().admin().listDatabases();
            const databases = dbList.databases
                .map((db: any) => db.name)
                .filter((name: string) => !SYSTEM_DATABASES.includes(name));

            if (databases.length === 0) {
                console.log('No databases available in this connection.');
                return;
            }

            console.log('Available databases:');
            const dbSelection = await promptSelection(rl, "Select database(s) (number, name, comma separated, or 'all'): ", databases);

            fs.mkdirSync(backupDir, { recursive: true });
            console.log(`\nStarting backup process for project: ${projectName}\n`);

            for (const dbName of dbSelection.selected) {
                const db = client.db(dbName);
                const colList = await MongoBackup.listCollectionNames(db);

                if (colList.length === 0) {
                    console.log(`No collections found in database '${dbName}'.`);
                    continue;
                }

                let collectionsToBackup: string[];
                // Si se seleccionó 'all' en bases de datos, hacer backup de todas las colecciones automáticamente
                if (dbSelection.all) {
                    collectionsToBackup = colList;
                    console.log(`Backing up all collections from database '${dbName}'...`);
                } else {
                    // Si se seleccionaron bases de datos específicas, preguntar qué colecciones
                    console.log(`\nCollections in database '${dbName}':`);
                    collectionsToBackup = (await promptSelection(rl, "Enter collection(s) to backup (number, name, comma separated, or 'all'): ", colList)).selected;
                }

                const dbBackupDir = path.join(backupDir, dbName);
                fs.mkdirSync(dbBackupDir, { recursive: true });

                console.log(`Backing up database: ${dbName}`);
                for (const collectionName of collectionsToBackup) {
                    console.log(`  Backing up collection: ${collectionName}`);
                    try {
                        const count = await MongoBackup.backupCollection(db, collectionName, dbBackupDir);
                        console.log(`    ✓ Backed up ${count} documents to ${path.join(dbBackupDir, `${collectionName}.json`)}`);
                    } catch (error) {
                        console.error(`    ✗ Error backing up collection ${collectionName}: ${errorMessage(error)}`);
                    }
                }
            }

            console.log("\nBackup process completed!");
        } finally {
            await client.close();
        }
    }
}
