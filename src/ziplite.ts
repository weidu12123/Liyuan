/**
 * 极简 zip：解压（在线更新/备份恢复/子项目导入用）＋ 打包（store 法，小包全内存）。
 *
 * 只支持梨园自己产出的 zip 形态：
 * - 压缩方法 0（store）/ 8（deflate）
 * - 无加密、无分卷、无 zip64（包 ~12MB 远低于 4GB 界）
 * 以中央目录为准枚举条目（EOCD 定位），路径穿越防御（zip-slip）。
 * Unix 权限位从 external attr 高 16 位还原（start.sh 的 0755 不丢）。
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

interface ZipEntryInfo {
	name: string;
	size: number;
	isDir: boolean;
	/** unix mode（无则 0） */
	mode: number;
}

interface CenEntry extends ZipEntryInfo {
	method: number;
	compressedSize: number;
	localOffset: number;
}

function findEocd(buf: Buffer): number {
	// EOCD 注释最长 65535，从尾部回扫
	const min = Math.max(0, buf.length - 22 - 65535);
	for (let i = buf.length - 22; i >= min; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIG) return i;
	}
	throw new Error("不是有效的 zip（找不到 EOCD）");
}

function readCentralDirectory(buf: Buffer): CenEntry[] {
	const eocd = findEocd(buf);
	const count = buf.readUInt16LE(eocd + 10);
	const cenOffset = buf.readUInt32LE(eocd + 16);
	const entries: CenEntry[] = [];
	let p = cenOffset;
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error("中央目录损坏");
		const method = buf.readUInt16LE(p + 10);
		const compressedSize = buf.readUInt32LE(p + 20);
		const size = buf.readUInt32LE(p + 24);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const externalAttr = buf.readUInt32LE(p + 38);
		const localOffset = buf.readUInt32LE(p + 42);
		const flags = buf.readUInt16LE(p + 8);
		// bit 11 = UTF-8 名；pack 脚本恒置位。非 UTF-8 也按 utf8 解（我们只吃自己的包）
		void flags;
		const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
		const mode = (externalAttr >>> 16) & 0o7777;
		entries.push({
			name,
			size,
			isDir: name.endsWith("/"),
			mode,
			method,
			compressedSize,
			localOffset,
		});
		p += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

function entryData(buf: Buffer, e: CenEntry): Buffer {
	const p = e.localOffset;
	if (buf.readUInt32LE(p) !== LOC_SIG) throw new Error(`local header 损坏：${e.name}`);
	const nameLen = buf.readUInt16LE(p + 26);
	const extraLen = buf.readUInt16LE(p + 28);
	const start = p + 30 + nameLen + extraLen;
	const raw = buf.subarray(start, start + e.compressedSize);
	if (e.method === 0) return Buffer.from(raw);
	if (e.method === 8) return inflateRawSync(raw);
	throw new Error(`不支持的压缩方法 ${e.method}：${e.name}`);
}

/** 列出 zip 条目（调试/测试用） */
export function listZipEntries(zipPath: string): ZipEntryInfo[] {
	const buf = readFileSync(zipPath);
	return readCentralDirectory(buf).map(({ name, size, isDir, mode }) => ({ name, size, isDir, mode }));
}

/**
 * 解压整个 zip 到 destDir。zip-slip 防御：解出的绝对路径必须落在 destDir 内。
 */
export function extractZipFile(zipPath: string, destDir: string): void {
	const buf = readFileSync(zipPath);
	const entries = readCentralDirectory(buf);
	const root = resolve(destDir);
	for (const e of entries) {
		const target = resolve(join(root, e.name));
		if (target !== root && !target.startsWith(root + sep)) {
			throw new Error(`zip 条目路径越界：${e.name}`);
		}
		if (e.isDir) {
			mkdirSync(target, { recursive: true });
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		const data = entryData(buf, e);
		if (data.length !== e.size) throw new Error(`解压尺寸不符：${e.name}（${data.length} != ${e.size}）`);
		writeFileSync(target, data);
		if (e.mode & 0o111) {
			try {
				chmodSync(target, e.mode);
			} catch {
				/* Windows 无权限位，忽略 */
			}
		}
	}
}

// ---------- 打包（method 0 store；小包全内存，子项目导出用） ----------

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
	const y = d.getFullYear() >= 1980 ? d.getFullYear() - 1980 : 0;
	const date = (y << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
	return { time, date };
}

/**
 * 生成 zip（store 法）Buffer。条目名用 / 分隔；不写目录条目（解压侧自建目录）。
 * manifest 之类的小文件排第一条即可，无需额外约定。
 */
export function buildZipBuffer(entries: Array<{ name: string; data: Buffer }>): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	const dos = dosDateTime(new Date());
	for (const e of entries) {
		const nameBuf = Buffer.from(e.name, "utf8");
		const crc = crc32(e.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 名
		local.writeUInt16LE(0, 8); // store
		local.writeUInt16LE(dos.time, 10);
		local.writeUInt16LE(dos.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(e.data.length, 18);
		local.writeUInt32LE(e.data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28); // extra len
		parts.push(local, nameBuf, e.data);
		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0);
		cen.writeUInt16LE(20, 4); // version made by
		cen.writeUInt16LE(20, 6); // version needed
		cen.writeUInt16LE(0x0800, 8); // UTF-8 名
		cen.writeUInt16LE(0, 10); // store
		cen.writeUInt16LE(dos.time, 12);
		cen.writeUInt16LE(dos.date, 14);
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(e.data.length, 20);
		cen.writeUInt32LE(e.data.length, 24);
		cen.writeUInt16LE(nameBuf.length, 28);
		cen.writeUInt16LE(0, 30); // extra len
		cen.writeUInt16LE(0, 32); // comment len
		cen.writeUInt16LE(0, 34); // disk start
		cen.writeUInt16LE(0, 36); // internal attrs
		cen.writeUInt32LE(0, 38); // external attrs
		cen.writeUInt32LE(offset, 42);
		central.push(cen, nameBuf);
		offset += 30 + nameBuf.length + e.data.length;
	}
	const cd = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, cd, eocd]);
}
