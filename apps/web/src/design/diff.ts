// Line diff by longest common subsequence. Used by the sign-off "AI proposed vs doctor final" view (FR-F7-01).
export type DiffRow =
  | { kind: 'same'; before: string; after: string }
  | { kind: 'removed'; before: string }
  | { kind: 'added'; after: string };

export function diffLines(before: readonly string[], after: readonly string[]): DiffRow[] {
  const n = before.length;
  const m = after.length;
  // lcs[i][j] = length of the LCS of before[i..] and after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[];
      row[j] =
        before[i] === after[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'same', before: before[i] as string, after: after[j] as string });
      i += 1;
      j += 1;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      rows.push({ kind: 'removed', before: before[i] as string });
      i += 1;
    } else {
      rows.push({ kind: 'added', after: after[j] as string });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ kind: 'removed', before: before[i] as string });
    i += 1;
  }
  while (j < m) {
    rows.push({ kind: 'added', after: after[j] as string });
    j += 1;
  }
  return rows;
}
