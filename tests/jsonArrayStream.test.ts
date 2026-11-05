import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonArray } from '../src/jsonArrayStream';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-json-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let fileCounter = 0;
function writeFile(content: string): string {
    const file = path.join(dir, `f${fileCounter++}.json`);
    fs.writeFileSync(file, content);
    return file;
}

async function readAll(file: string, highWaterMark?: number): Promise<any[]> {
    const out: any[] = [];
    for await (const doc of readJsonArray(file, { highWaterMark })) out.push(doc);
    return out;
}

const tricky = [
    { _id: 1, s: 'brackets ] } [ { and commas , inside' },
    { _id: 2, s: 'escaped \\" quote and backslash \\\\', nested: { a: [1, { b: '}' }] } },
    { _id: 3, s: 'unicode ñ á 漢字 😀', empty: {}, emptyArr: [] },
    { _id: 4, s: '"', t: '\\' },
];

describe('readJsonArray', () => {
    test('reads pretty printed arrays (old backup format)', async () => {
        expect(await readAll(writeFile(JSON.stringify(tricky, null, 2)))).toEqual(tricky);
    });

    test('reads compact arrays', async () => {
        expect(await readAll(writeFile(JSON.stringify(tricky)))).toEqual(tricky);
    });

    test('reads the current backup layout (one element per block)', async () => {
        const content = '[\n' + tricky.map(d => JSON.stringify(d, null, 2)).join(',\n') + '\n]\n';
        expect(await readAll(writeFile(content))).toEqual(tricky);
    });

    test('handles elements split across tiny chunks, including multibyte characters', async () => {
        const file = writeFile(JSON.stringify(tricky, null, 2));
        for (const hwm of [1, 2, 3, 7, 16]) {
            expect(await readAll(file, hwm)).toEqual(tricky);
        }
    });

    test('accepts a UTF-8 BOM and surrounding whitespace', async () => {
        expect(await readAll(writeFile('﻿  \n[ {"a":1} ]  \n'))).toEqual([{ a: 1 }]);
    });

    test('yields nothing for an empty array', async () => {
        expect(await readAll(writeFile('[]'))).toEqual([]);
        expect(await readAll(writeFile('[\n]\n'))).toEqual([]);
    });

    test('streams large files element by element', async () => {
        const docs = Array.from({ length: 5000 }, (_, i) => ({ i, pad: 'x'.repeat(50) }));
        const file = writeFile(JSON.stringify(docs));
        let count = 0;
        for await (const doc of readJsonArray(file, { highWaterMark: 4096 })) {
            expect(doc.i).toBe(count++);
        }
        expect(count).toBe(5000);
    });

    test('rejects a file that is not an array', async () => {
        await expect(readAll(writeFile('{"a":1}'))).rejects.toThrow('does not contain an array of documents');
        await expect(readAll(writeFile(''))).rejects.toThrow('does not contain an array of documents');
    });

    test('rejects elements that are not documents', async () => {
        await expect(readAll(writeFile('[{"a":1}, 2]'))).rejects.toThrow('element 1 is not a document');
        await expect(readAll(writeFile('["x"]'))).rejects.toThrow('element 0 is not a document');
    });

    test('rejects a truncated file', async () => {
        await expect(readAll(writeFile('[{"a":1},{"b":'))).rejects.toThrow('unexpected end of file');
        await expect(readAll(writeFile('[{"a":1}'))).rejects.toThrow('unexpected end of file');
    });

    test('rejects content after the closing bracket', async () => {
        await expect(readAll(writeFile('[{"a":1}] {"b":2}'))).rejects.toThrow('unexpected content after');
    });

    test('rejects an invalid element', async () => {
        await expect(readAll(writeFile('[{"a":1,}]'))).rejects.toThrow('invalid JSON in element 0');
    });
});
