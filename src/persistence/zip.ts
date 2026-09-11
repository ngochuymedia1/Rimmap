export type ZipEntryInput = { name: string; data: Uint8Array | ArrayBuffer | Blob | string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) { view.setUint16(offset, value & 0xffff, true); }
function write32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

function concat(parts: Uint8Array[]): Uint8Array {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
}

async function toBytes(value: ZipEntryInput['data']): Promise<Uint8Array> {
    if (typeof value === 'string') return encoder.encode(value);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(await value.arrayBuffer());
}

function dosTimestamp(date = new Date()): { time: number; date: number } {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
        time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
        date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
}

/**
 * Creates a standards-compliant ZIP using method 0 (stored/no recompression).
 * Media formats are already compressed, so avoiding DEFLATE keeps saves fast and
 * still eliminates Base64's ~33% expansion and JSON parsing overhead.
 */
export async function createZip(entries: ZipEntryInput[]): Promise<Uint8Array> {
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let localOffset = 0;
    const stamp = dosTimestamp();

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name.replace(/^\/+/, ''));
        const data = await toBytes(entry.data);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        write32(lv, 0, 0x04034b50);
        write16(lv, 4, 20);
        write16(lv, 6, 0x0800); // UTF-8 names
        write16(lv, 8, 0); // stored
        write16(lv, 10, stamp.time);
        write16(lv, 12, stamp.date);
        write32(lv, 14, crc);
        write32(lv, 18, data.length);
        write32(lv, 22, data.length);
        write16(lv, 26, nameBytes.length);
        write16(lv, 28, 0);
        local.set(nameBytes, 30);
        localParts.push(local, data);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        write32(cv, 0, 0x02014b50);
        write16(cv, 4, 20);
        write16(cv, 6, 20);
        write16(cv, 8, 0x0800);
        write16(cv, 10, 0);
        write16(cv, 12, stamp.time);
        write16(cv, 14, stamp.date);
        write32(cv, 16, crc);
        write32(cv, 20, data.length);
        write32(cv, 24, data.length);
        write16(cv, 28, nameBytes.length);
        write16(cv, 30, 0);
        write16(cv, 32, 0);
        write16(cv, 34, 0);
        write16(cv, 36, 0);
        write32(cv, 38, 0);
        write32(cv, 42, localOffset);
        central.set(nameBytes, 46);
        centralParts.push(central);
        localOffset += local.length + data.length;
    }

    const centralOffset = localOffset;
    const central = concat(centralParts);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    write32(ev, 0, 0x06054b50);
    write16(ev, 4, 0);
    write16(ev, 6, 0);
    write16(ev, 8, entries.length);
    write16(ev, 10, entries.length);
    write32(ev, 12, central.length);
    write32(ev, 16, centralOffset);
    write16(ev, 20, 0);
    return concat([...localParts, central, end]);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const Decompression = (globalThis as any).DecompressionStream;
    if (!Decompression) throw new Error('This browser cannot open DEFLATE-compressed ZIP entries.');
    const stream = new Blob([data]).stream().pipeThrough(new Decompression('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(input: Blob | ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
    const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(await input.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22) throw new Error('Invalid ZIP: file is too small.');

    let eocd = -1;
    const min = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= min; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP: end-of-central-directory record not found.');

    const count = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    let cursor = centralOffset;
    const out = new Map<string, Uint8Array>();

    for (let index = 0; index < count; index++) {
        if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
        const method = view.getUint16(cursor + 10, true);
        const expectedCrc = view.getUint32(cursor + 16, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        cursor += 46 + nameLength + extraLength + commentLength;

        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Invalid ZIP local header for ${name}.`);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
        let data: Uint8Array;
        if (method === 0) data = compressed.slice();
        else if (method === 8) data = await inflateRaw(compressed);
        else throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
        if (data.length !== uncompressedSize) throw new Error(`ZIP size check failed for ${name}.`);
        if (crc32(data) !== expectedCrc) throw new Error(`ZIP CRC check failed for ${name}.`);
        out.set(name, data);
    }
    return out;
}

export function looksLikeZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}
