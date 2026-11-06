/**
 * Integration tests against a real MongoDB.
 * Uses MONGO_TEST_URI (default mongodb://localhost:27017) and a throwaway database
 * named mbtest_<random>, dropped at the end. Skipped when the server is not reachable.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Db, Double, Int32, Long, MongoClient } from 'mongodb';
import { MongoBackup } from '../src/MongoBackup';
import { MongoRestore } from '../src/MongoRestore';
import { runBackupJob, runCopyJob, runRestoreJob } from '../src/jobs';
import { existingOnTarget } from '../src/tui/screens/CopyScreens';
import { isSameServer } from '../src/MongoCopy';

const uri = process.env.MONGO_TEST_URI || 'mongodb://localhost:27017';

async function connectOrNull(): Promise<MongoClient | null> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
    try {
        await client.connect();
        await client.db().admin().ping();
        return client;
    } catch {
        await client.close().catch(() => {});
        return null;
    }
}

const client = await connectOrNull();
if (!client) console.warn(`[mongo.integration] MongoDB not reachable at ${uri}: tests skipped`);

describe.skipIf(!client)('backup/restore against MongoDB', () => {
    let db: Db;
    let dir: string;

    beforeAll(() => {
        db = client!.db(`mbtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-it-'));
    });

    afterAll(async () => {
        await db.dropDatabase();
        await client!.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    async function collectionNames(): Promise<string[]> {
        return (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort();
    }

    test('round trip keeps documents, types and existing indexes', async () => {
        const docs = Array.from({ length: 2500 }, (_, k) => ({
            _id: k, i: new Int32(k), d: new Double(k), l: Long.fromNumber(k),
        }));
        await db.collection('items').insertMany(docs);
        await db.collection('items').createIndex({ i: 1 }, { unique: true, name: 'i_unique' });

        expect(await MongoBackup.backupCollection(db, 'items', dir)).toBe(2500);
        expect(fs.existsSync(path.join(dir, 'items.json.tmp'))).toBe(false);

        await db.collection('items').deleteMany({ _id: { $gte: 10 } });
        expect(await MongoRestore.restoreCollection(db, 'items', path.join(dir, 'items.json'))).toBe(2500);

        expect(await db.collection('items').countDocuments()).toBe(2500);
        const doc = await db.collection('items').findOne({ _id: 1234 }, { promoteValues: false });
        expect(doc!.i).toBeInstanceOf(Int32);
        expect(doc!.d).toBeInstanceOf(Double);
        expect(doc!.l).toBeInstanceOf(Long);
        const indexNames = (await db.collection('items').indexes()).map(x => x.name);
        expect(indexNames).toContain('i_unique');
        expect(await collectionNames()).toEqual(['items']);
    });

    test('restores into a collection that does not exist', async () => {
        const file = path.join(dir, 'fresh.json');
        fs.writeFileSync(file, '[{"_id":1,"n":{"$numberInt":"1"}},{"_id":2}]');
        expect(await MongoRestore.restoreCollection(db, 'fresh', file)).toBe(2);
        expect(await db.collection('fresh').countDocuments()).toBe(2);
    });

    test('a failed insert leaves the target intact and removes the temp collection', async () => {
        await db.collection('keep').insertMany([{ _id: 'a' }, { _id: 'b' }]);
        const file = path.join(dir, 'keep.json');
        // duplicate _id in a later batch
        const docs = Array.from({ length: 1500 }, (_, k) => ({ _id: k }));
        docs.push({ _id: 1400 });
        fs.writeFileSync(file, JSON.stringify(docs));

        await expect(MongoRestore.restoreCollection(db, 'keep', file)).rejects.toThrow();
        expect(await db.collection('keep').find().toArray()).toEqual([{ _id: 'a' }, { _id: 'b' }]);
        expect((await collectionNames()).filter(n => n.startsWith('keep.__restore_tmp'))).toEqual([]);
    });

    test('a corrupt file leaves the target intact', async () => {
        await db.collection('corrupt').insertOne({ _id: 'orig' });
        const file = path.join(dir, 'corrupt.json');
        fs.writeFileSync(file, JSON.stringify(Array.from({ length: 1200 }, (_, k) => ({ _id: k }))).slice(0, -20));

        await expect(MongoRestore.restoreCollection(db, 'corrupt', file)).rejects.toThrow('unexpected end of file');
        expect(await db.collection('corrupt').find().toArray()).toEqual([{ _id: 'orig' }]);
        expect((await collectionNames()).filter(n => n.includes('__restore_tmp'))).toEqual([]);
    });

    test('an empty backup does not touch the target', async () => {
        await db.collection('emptyb').insertOne({ _id: 'orig' });
        const file = path.join(dir, 'emptyb.json');
        fs.writeFileSync(file, '[]\n');

        expect(await MongoRestore.restoreCollection(db, 'emptyb', file)).toBeNull();
        expect(await db.collection('emptyb').countDocuments()).toBe(1);
        expect((await collectionNames()).filter(n => n.includes('__restore_tmp'))).toEqual([]);
    });

    test('backup of an empty collection writes a valid empty array', async () => {
        await db.createCollection('nothing');
        expect(await MongoBackup.backupCollection(db, 'nothing', dir)).toBe(0);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'nothing.json'), 'utf8'))).toEqual([]);
    });

    test('listCollectionNames skips views', async () => {
        await db.createCollection('aview', { viewOn: 'items', pipeline: [] });
        const names = await MongoBackup.listCollectionNames(db);
        expect(names).not.toContain('aview');
        expect(names.some(n => n.startsWith('system.'))).toBe(false);
        expect(names).toContain('items');
    });
    test('runBackupJob writes every task and compresses the project', async () => {
        await db.collection('jobA').insertMany(Array.from({ length: 300 }, (_, k) => ({ k })));
        await db.collection('jobB').insertOne({ k: 1 });
        const root = path.join(dir, 'jobroot');
        const progress: number[] = [];
        const summary = await runBackupJob({
            client: client!, backupRoot: root, project: 'p1', compress: 'zip',
            tasks: [{ db: db.databaseName, collection: 'jobA', total: 300 }, { db: db.databaseName, collection: 'jobB', total: 1 }],
            events: { onTaskProgress: (_i, done) => progress.push(done) },
        });
        expect(summary.results).toEqual([{ status: 'done', docs: 300 }, { status: 'done', docs: 1 }]);
        expect(summary.docs).toBe(301);
        expect(summary.output).toBe(path.join(root, 'p1.zip'));
        expect(fs.existsSync(path.join(root, 'p1.zip'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'p1'))).toBe(false);
        expect(progress).toContain(200);
        expect(progress.at(-1)).toBe(1);
    });

    test('runRestoreJob cancelled mid-collection leaves the target intact and skips the rest', async () => {
        const projectDir = path.join(dir, 'cancelproj');
        const dbDir = path.join(projectDir, db.databaseName);
        fs.mkdirSync(dbDir, { recursive: true });
        fs.writeFileSync(path.join(dbDir, 'bigc.json'), JSON.stringify(Array.from({ length: 5000 }, (_, k) => ({ _id: k }))));
        fs.writeFileSync(path.join(dbDir, 'later.json'), '[{"_id":1}]');
        await db.collection('bigc').insertOne({ _id: 'orig' });

        const controller = new AbortController();
        const summary = await runRestoreJob({
            client: client!, projectDir, signal: controller.signal,
            tasks: [{ db: db.databaseName, collection: 'bigc', total: 1 }, { db: db.databaseName, collection: 'later', total: 1 }],
            events: { onTaskProgress: () => controller.abort() },
        });
        expect(summary.cancelled).toBe(true);
        expect(summary.results).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
        expect(await db.collection('bigc').find().toArray()).toEqual([{ _id: 'orig' }]);
        expect(await collectionNames()).not.toContain('later');
        expect((await collectionNames()).filter(n => n.includes('__restore_tmp'))).toEqual([]);
    });

    test('runRestoreJob reports per-collection errors and keeps going', async () => {
        const projectDir = path.join(dir, 'errproj');
        const dbDir = path.join(projectDir, db.databaseName);
        fs.mkdirSync(dbDir, { recursive: true });
        fs.writeFileSync(path.join(dbDir, 'bad.json'), '[{"_id":1},');
        fs.writeFileSync(path.join(dbDir, 'good.json'), '[{"_id":1},{"_id":2}]');
        const summary = await runRestoreJob({
            client: client!, projectDir,
            tasks: [{ db: db.databaseName, collection: 'bad', total: 1 }, { db: db.databaseName, collection: 'good', total: 1 }],
        });
        expect(summary.results[0].status).toBe('error');
        expect(summary.results[1]).toEqual({ status: 'done', docs: 2 });
        expect(summary.cancelled).toBe(false);
    });
    describe('copy to another server', () => {
        let target: MongoClient;
        let targetDbName: string;
        beforeAll(async () => {
            // A second client stands in for the other server; a different database name keeps source and target apart
            target = await new MongoClient(uri).connect();
            targetDbName = `${db.databaseName}_target`;
        });
        afterAll(async () => {
            await target.db(targetDbName).dropDatabase();
            await target.close();
        });

        test('copies documents with their types, the source indexes and collection options', async () => {
            await db.createCollection('cp_src', { validator: { n: { $type: 'int' } } });
            await db.collection('cp_src').insertMany(Array.from({ length: 2500 }, (_, k) => ({ _id: k, n: new Int32(k), d: new Double(k), l: Long.fromNumber(k) })));
            await db.collection('cp_src').createIndex({ n: -1 }, { name: 'n_desc' });

            const progress: number[] = [];
            const summary = await runCopyJob({
                source: client!, target, targetDbName: () => targetDbName,
                tasks: [{ db: db.databaseName, collection: 'cp_src', total: 2500 }],
                events: { onTaskProgress: (_i, done) => progress.push(done) },
            });
            expect(summary.results).toEqual([{ status: 'done', docs: 2500 }]);
            expect(progress).toEqual([1000, 2000, 2500]);

            const tdb = target.db(targetDbName);
            expect(await tdb.collection('cp_src').countDocuments()).toBe(2500);
            const doc = await tdb.collection('cp_src').findOne({ _id: 7 }, { promoteValues: false });
            expect(doc!.n).toBeInstanceOf(Int32);
            expect(doc!.d).toBeInstanceOf(Double);
            expect(doc!.l).toBeInstanceOf(Long);
            expect((await tdb.collection('cp_src').indexes()).map(i => i.name)).toContain('n_desc');
            const [info] = await tdb.listCollections({ name: 'cp_src' }).toArray();
            expect((info as any).options.validator).toEqual({ n: { $type: 'int' } });
            expect((await tdb.listCollections().toArray()).filter(c => c.name.includes('__restore_tmp'))).toEqual([]);
        });

        test('isSameServer detects two clients on the same server', async () => {
            expect(await isSameServer(client!, target)).toBe(true);
        });

        test('replaces an existing collection on the target', async () => {
            await db.collection('cp_rep').insertMany([{ _id: 1, v: 'new' }, { _id: 2, v: 'new' }]);
            await target.db(targetDbName).collection('cp_rep').insertMany([{ _id: 1, v: 'old' }, { _id: 99, v: 'old' }]);

            const existing = await existingOnTarget(target.db(targetDbName).client, [{ db: targetDbName, collection: 'cp_rep', total: 0 }, { db: targetDbName, collection: 'nope', total: 0 }]);
            expect([...existing]).toEqual([`${targetDbName}.cp_rep`]);

            await runCopyJob({ source: client!, target, targetDbName: () => targetDbName, tasks: [{ db: db.databaseName, collection: 'cp_rep', total: 2 }] });
            expect(await target.db(targetDbName).collection('cp_rep').find().sort({ _id: 1 }).toArray()).toEqual([{ _id: 1, v: 'new' }, { _id: 2, v: 'new' }]);
        });

        test('an empty source collection is skipped and does not touch the target', async () => {
            await db.createCollection('cp_empty');
            await target.db(targetDbName).collection('cp_empty').insertOne({ _id: 'keep' });
            const summary = await runCopyJob({ source: client!, target, targetDbName: () => targetDbName, tasks: [{ db: db.databaseName, collection: 'cp_empty', total: 0 }] });
            expect(summary.results).toEqual([{ status: 'skipped', reason: 'empty collection' }]);
            expect(await target.db(targetDbName).collection('cp_empty').countDocuments()).toBe(1);
        });

        test('cancelling mid-copy leaves the target intact', async () => {
            await db.collection('cp_big').insertMany(Array.from({ length: 5000 }, (_, k) => ({ _id: k })));
            await target.db(targetDbName).collection('cp_big').insertOne({ _id: 'orig' });
            const controller = new AbortController();
            const summary = await runCopyJob({
                source: client!, target, targetDbName: () => targetDbName, signal: controller.signal,
                tasks: [{ db: db.databaseName, collection: 'cp_big', total: 5000 }],
                events: { onTaskProgress: () => controller.abort() },
            });
            expect(summary.cancelled).toBe(true);
            expect(await target.db(targetDbName).collection('cp_big').find().toArray()).toEqual([{ _id: 'orig' }]);
            expect((await target.db(targetDbName).listCollections().toArray()).filter(c => c.name.includes('__restore_tmp'))).toEqual([]);
        });
    });
});
