/** 最长公共子序列的行 diff（与 src/stage/story-history.ts 的 lineDiff 同一算法；过程条里的 edit 回显用） */
export interface DiffLine { op: " " | "-" | "+"; text: string }

export function lineDiff(a: string, b: string): DiffLine[] {
	const A = a ? a.split("\n") : [];
	const B = b ? b.split("\n") : [];
	const n = A.length, m = B.length;
	const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
	const out: DiffLine[] = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) { out.push({ op: " ", text: A[i]! }); i++; j++; }
		else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ op: "-", text: A[i++]! });
		else out.push({ op: "+", text: B[j++]! });
	}
	while (i < n) out.push({ op: "-", text: A[i++]! });
	while (j < m) out.push({ op: "+", text: B[j++]! });
	return out;
}
