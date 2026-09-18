import type { Subtitle } from './types';

/** 解析 SRT 文本为字幕数组，容忍 CRLF、缺失序号、逗号/句点毫秒分隔符 */
export function parseSrt(content: string): Subtitle[] {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const subs: Subtitle[] = [];
  let uid = 0;

  for (const block of blocks) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;

    const m = lines[timeIdx].match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/
    );
    if (!m) continue;

    subs.push({
      id: `sub-${uid++}`,
      index: subs.length + 1,
      start: parseTimestamp(m[1]),
      end: parseTimestamp(m[2]),
      text: lines.slice(timeIdx + 1).join('\n').trim(),
    });
  }
  return subs;
}

/** "00:01:23,456" -> 毫秒 */
export function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return 0;
  const [, h, mm, ss, ms] = m;
  return (
    Number(h) * 3600000 +
    Number(mm) * 60000 +
    Number(ss) * 1000 +
    Number(ms.padEnd(3, '0'))
  );
}

/** 毫秒 -> "00:01:23,456" */
export function formatTimestamp(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const milli = t % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** 按开始时间排序并重新编号后导出为标准 SRT */
export function serializeSrt(subs: Subtitle[]): string {
  const sorted = [...subs].sort((a, b) => a.start - b.start);
  return (
    sorted
      .map(
        (s, i) =>
          `${i + 1}\n${formatTimestamp(s.start)} --> ${formatTimestamp(s.end)}\n${s.text}`
      )
      .join('\n\n') + '\n'
  );
}
