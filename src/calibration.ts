import type { Subtitle } from './types';

/** 锚点输入：一条当前字幕 + 用户填写的与视频对齐的目标开始时间（原始字符串） */
export interface AnchorInput {
  id: string;
  targetText: string;
}

export interface ResolvedAnchor {
  sub: Subtitle;
  /** 解析后的目标开始时间（毫秒） */
  targetStart: number;
  /** 该锚点需要施加的偏移（毫秒，目标 − 原始开始时间） */
  offset: number;
}

export interface CalibrationPlan {
  first: ResolvedAnchor;
  second: ResolvedAnchor;
  /** 实际会改变时间的字幕条数 */
  affected: number;
  /** 全部字幕中最大绝对偏移（毫秒） */
  maxAbsOffset: number;
}

export interface CalibrationResult {
  valid: boolean;
  reason: string;
  plan: CalibrationPlan | null;
}

/**
 * 解析目标开始时间。支持 SRT 时间戳（`HH:MM:SS,mmm` / `HH:MM:SS.mmm`，
 * 时/分可省略），也支持纯数字秒（`12.5` = 12 秒 500 毫秒）。
 * 无法解析、空白或为负时返回 null。
 */
export function parseTargetStart(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const sec = Number(t);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.round(sec * 1000);
  }
  const m = t.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  const min = Number(mm);
  const sec = Number(ss);
  if (min > 59 || sec > 59) return null;
  return (
    Number(h ?? 0) * 3600000 +
    min * 60000 +
    sec * 1000 +
    Number((ms ?? '').padEnd(3, '0'))
  );
}

/** 毫秒偏移格式化为带符号的可读文本，如 +1.250s / −300ms */
export function formatOffset(ms: number): string {
  const sign = ms > 0 ? '+' : '−';
  const abs = Math.abs(ms);
  const body = abs % 1000 === 0 ? `${abs / 1000}s` : abs >= 1000 ? `${(abs / 1000).toFixed(3)}s` : `${abs}ms`;
  return `${sign}${body}`;
}

/**
 * 计算某条字幕在给定两个锚点下应施加的偏移（毫秒）：
 * 第一锚点之前统一使用首个偏移；两锚点之间按原始开始时间线性插值；
 * 第二锚点之后统一使用末个偏移。锚点自身恰好落在各自的目标时间。
 */
export function offsetAt(startMs: number, first: ResolvedAnchor, second: ResolvedAnchor): number {
  if (startMs <= first.sub.start) return first.offset;
  if (startMs >= second.sub.start) return second.offset;
  const ratio =
    (startMs - first.sub.start) / (second.sub.start - first.sub.start);
  return Math.round(first.offset + (second.offset - first.offset) * ratio);
}

/**
 * 校验双锚点输入并生成校准计划。锚点须按当前开始时间严格先后排列，
 * 目标时间也须严格递增。
 */
export function buildCalibrationPlan(
  subs: Subtitle[],
  a: AnchorInput,
  b: AnchorInput
): CalibrationResult {
  if (subs.length < 2) return { valid: false, reason: '至少需要 2 条字幕才能设置两个锚点', plan: null };
  if (!a.id || !b.id) return { valid: false, reason: '请分别选择第一、第二锚点字幕', plan: null };
  if (a.id === b.id) return { valid: false, reason: '两个锚点不能选择同一条字幕', plan: null };

  const subA = subs.find((s) => s.id === a.id);
  const subB = subs.find((s) => s.id === b.id);
  if (!subA || !subB) return { valid: false, reason: '锚点字幕不存在，请重新选择', plan: null };

  const targetA = parseTargetStart(a.targetText);
  const targetB = parseTargetStart(b.targetText);
  if (targetA === null || targetB === null) {
    return { valid: false, reason: '请为两个锚点填写有效的目标开始时间（HH:MM:SS,mmm 或秒数）', plan: null };
  }

  // 锚点须按当前时间先后排列
  const [firstSub, secondSub] =
    subA.start <= subB.start ? [subA, subB] : [subB, subA];
  const [firstTarget, secondTarget] =
    subA.start <= subB.start ? [targetA, targetB] : [targetB, targetA];
  if (firstSub.start === secondSub.start) {
    return { valid: false, reason: '两条锚点字幕的当前开始时间相同，无法按先后排列', plan: null };
  }
  if (firstTarget >= secondTarget) {
    return { valid: false, reason: '第二锚点的目标时间必须晚于第一锚点（严格递增）', plan: null };
  }

  const first: ResolvedAnchor = {
    sub: firstSub,
    targetStart: firstTarget,
    offset: firstTarget - firstSub.start,
  };
  const second: ResolvedAnchor = {
    sub: secondSub,
    targetStart: secondTarget,
    offset: secondTarget - secondSub.start,
  };

  let affected = 0;
  let maxAbsOffset = 0;
  for (const s of subs) {
    const off = offsetAt(s.start, first, second);
    if (Math.abs(off) > 0.5) affected++;
    if (Math.abs(off) > maxAbsOffset) maxAbsOffset = Math.abs(off);
  }

  return { valid: true, reason: '', plan: { first, second, affected, maxAbsOffset } };
}

/**
 * 应用双锚点漂移校准：按各字幕的原始开始时间计算偏移并整体平移，
 * 时长保持不变；开始时间不允许小于 0（与拖动编辑一致）。
 * 返回新数组（不修改入参）。
 */
export function applyCalibration(subs: Subtitle[], plan: CalibrationPlan): Subtitle[] {
  return subs.map((s) => {
    const off = offsetAt(s.start, plan.first, plan.second);
    if (off === 0) return s;
    const start = Math.max(0, s.start + off);
    return { ...s, start, end: start + (s.end - s.start) };
  });
}
