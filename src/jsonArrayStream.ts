import * as fs from 'fs';

/**
 * Streams the elements of a top-level JSON array of objects, one at a time,
 * without loading the whole file in memory.
 *
 * Accepts any valid JSON layout (pretty printed, compact, one element per line),
 * so it reads both current and older backup files.
 * Each yielded value is the result of JSON.parse on one element.
 */
export async function* readJsonArray(
    filePath: string,
    options: { highWaterMark?: number; onBytes?: (bytesRead: number) => void } = {},
): AsyncGenerator<any> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: options.highWaterMark ?? 1 << 20 });

    let started = false;   // '[' seen
    let ended = false;     // closing ']' seen
    let depth = 0;         // nesting depth inside the current element (0 = between elements)
    let inString = false;
    let escaped = false;
    let parts: string[] = [];   // pieces of the current element across chunks
    let index = 0;              // number of elements yielded

    const fail = (msg: string): never => {
        stream.destroy();
        throw new Error(`${filePath}: ${msg}`);
    };

    for await (const chunk of stream as AsyncIterable<string>) {
        let elementStart = depth > 0 ? 0 : -1;
        const completed: string[] = [];

        for (let i = 0; i < chunk.length; i++) {
            const c = chunk[i];

            if (depth > 0) {
                if (inString) {
                    if (escaped) escaped = false;
                    else if (c === '\\') escaped = true;
                    else if (c === '"') inString = false;
                } else if (c === '"') {
                    inString = true;
                } else if (c === '{' || c === '[') {
                    depth++;
                } else if (c === '}' || c === ']') {
                    depth--;
                    if (depth === 0) {
                        parts.push(chunk.slice(elementStart, i + 1));
                        completed.push(parts.join(''));
                        parts = [];
                        elementStart = -1;
                    }
                }
                continue;
            }

            // Between elements
            if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '﻿') continue;
            if (ended) fail('unexpected content after the closing "]"');
            if (!started) {
                if (c !== '[') fail('does not contain an array of documents');
                started = true;
            } else if (c === ']') {
                ended = true;
            } else if (c === ',') {
                continue;
            } else if (c === '{') {
                depth = 1;
                elementStart = i;
            } else {
                fail(`element ${index + completed.length} is not a document`);
            }
        }

        if (depth > 0 && elementStart >= 0) {
            parts.push(chunk.slice(elementStart));
        }
        options.onBytes?.(stream.bytesRead);

        for (const text of completed) {
            let value: any;
            try {
                value = JSON.parse(text);
            } catch (error) {
                fail(`invalid JSON in element ${index}: ${(error as Error).message}`);
            }
            index++;
            yield value;
        }
    }

    if (!started) throw new Error(`${filePath}: does not contain an array of documents`);
    if (!ended) throw new Error(`${filePath}: unexpected end of file (array not closed)`);
}
