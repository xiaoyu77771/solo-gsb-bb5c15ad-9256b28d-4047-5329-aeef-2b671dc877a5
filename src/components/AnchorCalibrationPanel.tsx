import { useMemo, useState } from 'react';
import type { Subtitle } from '../types';
import { formatTimestamp } from '../srt';
import {
  buildCalibrationPlan,
  formatOffset,
  offsetAt,
  parseTargetStart,
  type AnchorInput,
  type CalibrationPlan,
} from '../calibration';

interface AnchorCalibrationPanelProps {
  subs: Subtitle[];
  selectedId: string | null;
  onJump: (id: string, sec: number) => void;
  /** 应用校准；App 内部会基于最新字幕重算计划，整批进入一次撤销/重做 */
  onApply: (a: AnchorInput, b: AnchorInput) => void;
}

interface AnchorFieldProps {
  label: string;
  badge: string;
  subs: Subtitle[];
  anchorId: string;
  targetText: string;
  otherId: string;
  onSelectId: (id: string) => void;
  onTargetChange: (v: string) => void;
  onUseSelected: () => void;
  canUseSelected: boolean;
  onJump: (id: string, sec: number) => void;
}

function AnchorField({
  label,
  badge,
  subs,
  anchorId,
  targetText,
  otherId,
  onSelectId,
  onTargetChange,
  onUseSelected,
  canUseSelected,
  onJump,
}: AnchorFieldProps) {
  const sub = subs.find((s) => s.id === anchorId);
  const target = targetText.trim() ? parseTargetStart(targetText) : null;
  const offset = sub && target !== null ? target - sub.start : null;

  return (
    <div className="cal-anchor">
      <div className="cal-anchor-head">
        <span className={`cal-anchor-badge ${badge}`}>{label}</span>
        <button
          className="btn btn-sm cal-use-btn"
          disabled={!canUseSelected}
          onClick={onUseSelected}
          title="使用时间轴上当前选中的字幕作为该锚点"
        >
          用选中项
        </button>
      </div>
      <select
        className="cal-select"
        value={anchorId}
        onChange={(e) => onSelectId(e.target.value)}
      >
        <option value="">— 选择锚点字幕 —</option>
        {subs.map((s) => (
          <option
            key={s.id}
            value={s.id}
            disabled={s.id === otherId}
            title={s.text}
          >
            #{s.index} · {formatTimestamp(s.start)} · {s.text.split('\n')[0].slice(0, 24)}
          </option>
        ))}
      </select>
      {sub && (
        <>
          <div className="cal-row">
            <span className="cal-row-label">当前开始</span>
            <span className="cal-row-val">{formatTimestamp(sub.start)}</span>
            <button
              className="cal-jump"
              onClick={() => onJump(sub.id, Math.max(0, sub.start) / 1000)}
              title="在时间轴上定位该锚点"
            >
              🎯 定位
            </button>
          </div>
          <div className="cal-row">
            <span className="cal-row-label">目标开始</span>
            <input
              className="cal-time-input"
              value={targetText}
              placeholder={formatTimestamp(sub.start)}
              onChange={(e) => onTargetChange(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="cal-hint">格式 HH:MM:SS,mmm（如 00:01:23,500）或秒数（如 83.5）</div>
          {target !== null && offset !== null && (
            <div className="cal-row">
              <span className="cal-row-label">锚点偏移</span>
              <span className={`cal-row-val ${offset >= 0 ? 'cal-pos' : 'cal-neg'}`}>
                {formatOffset(offset)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function previewOffsets(subs: Subtitle[], plan: CalibrationPlan): { lead: number; tail: number } {
  const lead = subs.length > 0 ? offsetAt(subs[0].start, plan.first, plan.second) : 0;
  const tail =
    subs.length > 0 ? offsetAt(subs[subs.length - 1].start, plan.first, plan.second) : 0;
  return { lead, tail };
}

export default function AnchorCalibrationPanel({
  subs,
  selectedId,
  onJump,
  onApply,
}: AnchorCalibrationPanelProps) {
  const [id1, setId1] = useState('');
  const [target1, setTarget1] = useState('');
  const [id2, setId2] = useState('');
  const [target2, setTarget2] = useState('');

  // 下拉按当前开始时间排序展示，方便按时间先后挑选锚点
  const orderedSubs = useMemo(() => [...subs].sort((a, b) => a.start - b.start), [subs]);

  // 选择锚点时若目标时间尚未填写，预填该字幕当前开始时间（保持零偏移，便于微调）
  const pickAnchor = (which: 1 | 2, id: string) => {
    if (which === 1) {
      setId1(id);
      if (id && !target1.trim()) {
        const s = subs.find((x) => x.id === id);
        if (s) setTarget1(formatTimestamp(s.start));
      }
    } else {
      setId2(id);
      if (id && !target2.trim()) {
        const s = subs.find((x) => x.id === id);
        if (s) setTarget2(formatTimestamp(s.start));
      }
    }
  };

  const useSelected = (which: 1 | 2) => {
    if (!selectedId) return;
    pickAnchor(which, selectedId);
  };

  const a: AnchorInput = { id: id1, targetText: target1 };
  const b: AnchorInput = { id: id2, targetText: target2 };
  const result = useMemo(
    () => buildCalibrationPlan(subs, a, b),
    [subs, a.id, a.targetText, b.id, b.targetText]
  );

  const plan = result.plan;
  const offsets = plan ? previewOffsets(orderedSubs, plan) : null;

  return (
    <aside className="merge-panel cal-panel">
      <div className="merge-header">
        <span className="merge-title">双锚点漂移校准</span>
      </div>

      <div className="merge-list">
        {subs.length === 0 && <div className="merge-empty">先导入字幕，再设置校准锚点</div>}

        {subs.length > 0 && (
          <>
            <div className="cal-intro dim">
              选择两条按当前时间先后排列的锚点字幕，并分别填写它们与视频对齐的目标开始时间：
              第一锚点之前统一前移/后移首个偏移，两锚点之间按原始开始时间
              <b> 线性插值</b>，第二锚点之后统一使用末个偏移；所有字幕时长保持不变。
            </div>

            <AnchorField
              label="第一锚点"
              badge="b1"
              subs={orderedSubs}
              anchorId={id1}
              targetText={target1}
              otherId={id2}
              onSelectId={(id) => pickAnchor(1, id)}
              onTargetChange={setTarget1}
              onUseSelected={() => useSelected(1)}
              canUseSelected={selectedId !== null && selectedId !== id2}
              onJump={onJump}
            />
            <AnchorField
              label="第二锚点"
              badge="b2"
              subs={orderedSubs}
              anchorId={id2}
              targetText={target2}
              otherId={id1}
              onSelectId={(id) => pickAnchor(2, id)}
              onTargetChange={setTarget2}
              onUseSelected={() => useSelected(2)}
              canUseSelected={selectedId !== null && selectedId !== id1}
              onJump={onJump}
            />

            {!result.valid && (
              <div className="cal-status invalid">⚠️ {result.reason}</div>
            )}

            {plan && offsets && (
              <div className="cal-summary">
                <div className="cal-status ok">✅ 锚点有效，可应用校准</div>
                <div className="cal-sum-row">
                  受影响条数 <b>{plan.affected}</b> 条
                </div>
                <div className="cal-sum-row">
                  最大偏移{' '}
                  <b className={plan.maxAbsOffset > 0 ? 'cal-warn' : ''}>
                    {formatOffset(plan.maxAbsOffset)}
                  </b>
                </div>
                <div className="cal-sum-row">
                  第一锚点之前 <b className={offsets.lead >= 0 ? 'cal-pos' : 'cal-neg'}>
                    {formatOffset(offsets.lead)}
                  </b>
                </div>
                <div className="cal-sum-row">
                  第二锚点之后 <b className={offsets.tail >= 0 ? 'cal-pos' : 'cal-neg'}>
                    {formatOffset(offsets.tail)}
                  </b>
                </div>
                <div className="cal-hint">
                  首偏移 {formatOffset(plan.first.offset)} → 末偏移{' '}
                  {formatOffset(plan.second.offset)}，区间内逐秒线性过渡。
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {subs.length > 0 && (
        <div className="merge-footer">
          <button
            className="btn success"
            disabled={!result.valid || (plan !== null && plan.affected === 0)}
            title={
              result.valid
                ? '整批平移所有字幕时间，时长不变；作为一次撤销/重做操作'
                : result.reason
            }
            onClick={() => onApply(a, b)}
          >
            ✅ 应用校准
            {plan ? `（影响 ${plan.affected} 条，最大 ${formatOffset(plan.maxAbsOffset)}）` : ''}
          </button>
        </div>
      )}
    </aside>
  );
}
