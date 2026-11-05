import { describe, expect, test } from 'bun:test';
import { BSON, Binary, BSONRegExp, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from 'mongodb';
import { MongoBackup } from '../src/MongoBackup';
import { MongoRestore } from '../src/MongoRestore';

function roundTrip(doc: any): any {
    // Same path as a real backup/restore: serialize -> JSON text -> parse -> deserialize
    const text = JSON.stringify(MongoBackup.serializeMongoTypes(doc));
    return MongoRestore.deserializeMongoTypes(JSON.parse(text));
}

describe('EJSON round trip', () => {
    const doc = {
        _id: new ObjectId('64b000000000000000000001'),
        int: new Int32(5),
        double: new Double(5.0),
        long: Long.fromString('9007199254740993'),
        decimal: Decimal128.fromString('1.10'),
        ts: new Timestamp({ t: 1700000000, i: 7 }),
        bin: new Binary(Buffer.from('hi')),
        uuid: new UUID('11111111-2222-3333-4444-555555555555'),
        regex: new BSONRegExp('^a', 'i'),
        min: new MinKey(),
        max: new MaxKey(),
        date: new Date('2024-01-01T00:00:00.000Z'),
        str: 'text',
        bool: true,
        nil: null,
        nested: { arr: [new Int32(1), 'x', { deep: new Double(2.5) }] },
    };

    test('preserves every BSON type', () => {
        const out = roundTrip(doc);
        expect(out._id).toBeInstanceOf(ObjectId);
        expect(out._id.toHexString()).toBe('64b000000000000000000001');
        expect(out.int).toBeInstanceOf(Int32);
        expect(out.int.value).toBe(5);
        expect(out.double).toBeInstanceOf(Double);
        expect(out.double.value).toBe(5);
        expect(out.long).toBeInstanceOf(Long);
        expect(out.long.toString()).toBe('9007199254740993');
        expect(out.decimal).toBeInstanceOf(Decimal128);
        expect(out.decimal.toString()).toBe('1.10');
        expect(out.ts).toBeInstanceOf(Timestamp);
        expect([out.ts.t, out.ts.i]).toEqual([1700000000, 7]);
        expect(out.bin).toBeInstanceOf(Binary);
        expect(Buffer.from(out.bin.buffer).toString()).toBe('hi');
        expect(out.uuid.sub_type).toBe(Binary.SUBTYPE_UUID);
        expect(out.uuid.toUUID().toHexString()).toBe('11111111-2222-3333-4444-555555555555');
        expect(out.regex).toBeInstanceOf(BSONRegExp);
        expect([out.regex.pattern, out.regex.options]).toEqual(['^a', 'i']);
        expect(out.min).toBeInstanceOf(MinKey);
        expect(out.max).toBeInstanceOf(MaxKey);
        expect(out.date).toBeInstanceOf(Date);
        expect(out.date.toISOString()).toBe('2024-01-01T00:00:00.000Z');
        expect([out.str, out.bool, out.nil]).toEqual(['text', true, null]);
        expect(out.nested.arr[0]).toBeInstanceOf(Int32);
        expect(out.nested.arr[1]).toBe('x');
        expect(out.nested.arr[2].deep).toBeInstanceOf(Double);
    });

    test('produces BSON identical to the original', () => {
        expect(Buffer.from(BSON.serialize(roundTrip(doc)))).toEqual(Buffer.from(BSON.serialize(doc)));
    });

    test('writes canonical type wrappers', () => {
        const json = MongoBackup.serializeMongoTypes({ i: new Int32(5), d: new Double(5), l: Long.fromNumber(7) });
        expect(json).toEqual({ i: { $numberInt: '5' }, d: { $numberDouble: '5.0' }, l: { $numberLong: '7' } });
    });
});

describe('legacy backup format', () => {
    test('reads files written by the previous serializer', () => {
        const legacy = JSON.parse(`{
            "_id": {"$oid": "64b000000000000000000002"},
            "n": 3,
            "f": 1.5,
            "when": {"$date": "2024-05-01T10:00:00.000Z"},
            "dec": {"$numberDecimal": "2.5"},
            "big": {"$numberLong": "123"},
            "ts": {"$timestamp": {"t": 1700000000, "i": 2}}
        }`);
        const out = MongoRestore.deserializeMongoTypes(legacy);
        expect(out._id).toBeInstanceOf(ObjectId);
        expect(out.n).toBeInstanceOf(Int32);
        expect(out.f).toBeInstanceOf(Double);
        expect(out.when).toBeInstanceOf(Date);
        expect(out.when.toISOString()).toBe('2024-05-01T10:00:00.000Z');
        expect(out.dec).toBeInstanceOf(Decimal128);
        expect(out.big).toBeInstanceOf(Long);
        expect([out.ts.t, out.ts.i]).toEqual([1700000000, 2]);
    });
});
