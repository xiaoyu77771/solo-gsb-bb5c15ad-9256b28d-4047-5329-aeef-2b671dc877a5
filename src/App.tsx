import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import type { Subtitle } from './types';
import { parseSrt, serializeSrt } from './srt';
import { detectIssues } from './issues';
import { alignSubtitles, applyMerge } from './merge';
import { SAMPLE_SRT } from './sample';
import { useWaveform } from './useWaveform';
import Toolbar from './components/Toolbar';
import VideoPlayer from './components/VideoPlayer';
import Timeline from './components/Timeline';
import IssuesPanel from './components/IssuesPanel';
import RevisionMergePanel from './components/RevisionMergePanel';
import './styles.css';

interface History {
  past: Subtitle[][];
  present: Subtitle[];
  future: Subtitle[][];
}

const EMPTY_HISTORY: History = { past: [], present: [], future: [] };

export default function App() {
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const subs = history.present;

  const [srtName, setSrtName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [currentTime, setCurrentTime] = useState(0); // 秒
  const [videoDuration, setVideoDuration] = useState(0);
  const [chainMode, setChainMode] = useState(true);
  const [follow, setFollow] = useState(true);
  const [pxPerSec, setPxPerSec] = useState(80);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  // 修订稿独立于当前字幕保存：导入不会替换当前时间轴
  const [revision, setRevision] = useState<Subtitle[]>([]);
  const [revisionName, setRevisionName] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const { waveform, loadWaveform, dismissWaveform } = useWaveform();

  const issues = useMemo(() => detectIssues(subs), [subs]);

  // 对齐计算较重（大文件毫秒到秒级），用 deferred 值避免拖动字幕时的高频更新阻塞交互；
  // 应用合并（applyRevision）始终基于 history.present 即时重算，不受延迟影响。
  const deferredSubs = useDeferredValue(subs);
  const deferredRevision = useDeferredValue(revision);
  const mergeResult = useMemo(
    () => (deferredRevision.length > 0 ? alignSubtitles(deferredSubs, deferredRevision) : null),
    [deferredSubs, deferredRevision]
  );

  // ---- 历史操作 ----
  /** 拖动结束：把拖动前快照压入历史（present 已在拖动过程中实时更新） */
  const commitDrag = useCallback((before: Subtitle[]) => {
    setHistory((h) => ({ ...h, past: [...h.past, before], future: [] }));
  }, []);

  const undo = useCallback(() => {
    setHistory((h) =>
      h.past.length === 0
        ? h
        : {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future],
          }
    );
  }, []);

  const redo = useCallback(() => {
    setHistory((h) =>
      h.future.length === 0
        ? h
        : {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
    );
  }, []);

  const liveChange = useCallback((next: Subtitle[]) => {
    setHistory((h) => ({ ...h, present: next }));
  }, []);

  // ---- 文件导入导出 ----
  const loadSrt = useCallback((content: string, name: string) => {
    const parsed = parseSrt(content);
    setHistory({ past: [], present: parsed, future: [] });
    setSrtName(name);
    setSelectedId(null);
    setCurrentTime(0);
    // 新字幕载入后，旧修订稿的匹配已失效，一并清空
    setRevision([]);
    setRevisionName('');
  }, []);

  const importSrt = useCallback(
    async (file: File) => loadSrt(await file.text(), file.name),
    [loadSrt]
  );

  const importRevision = useCallback(
    async (file: File) => {
      const parsed = parseSrt(await file.text());
      setRevision(parsed);
      setRevisionName(file.name);
    },
    []
  );

  const clearRevision = useCallback(() => {
    setRevision([]);
    setRevisionName('');
  }, []);

  // 应用修订稿合并：仅已匹配条目的文本写回当前字幕，id / 序号 / 时间保留，
  // 整批作为一次撤销/重做操作
  const applyRevision = useCallback(() => {
    setHistory((h) => {
      if (revision.length === 0) return h;
      const result = alignSubtitles(h.present, revision);
      if (result.pairs.length === 0) return h;
      return {
        past: [...h.past, h.present],
        present: applyMerge(h.present, revision, result),
        future: [],
      };
    });
  }, [revision]);

  const importVideo = useCallback(
    (file: File) => {
      setVideoUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setVideoName(file.name);
      // 浏览器内解码音轨生成波形；失败仅影响波形轨道，不影响字幕编辑。
      // 旧视频的波形数据随状态替换释放，不会累积在内存中。
      loadWaveform(file);
    },
    [loadWaveform]
  );

  const loadSample = useCallback(() => loadSrt(SAMPLE_SRT, '示例字幕.srt'), [loadSrt]);

  const exportSrt = useCallback(() => {
    const blob = new Blob([serializeSrt(subs)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = srtName ? srtName.replace(/\.srt$/i, '') + '.fixed.srt' : 'fixed.srt';
    a.click();
    URL.revokeObjectURL(url);
  }, [subs, srtName]);

  // ---- 播放与跳转 ----
  const seekTo = useCallback((sec: number) => {
    if (videoRef.current) videoRef.current.currentTime = sec;
    setCurrentTime(sec);
  }, []);

  const jumpTo = useCallback(
    (id: string, sec: number) => {
      setSelectedId(id);
      seekTo(sec);
    },
    [seekTo]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setHistory((h) => ({
      past: [...h.past, h.present],
      present: h.present.filter((s) => s.id !== selectedId),
      future: [],
    }));
    setSelectedId(null);
  }, [selectedId]);

  // ---- 快捷键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedId, deleteSelected]);

  // 时间轴总时长：视频时长、字幕末尾、30 秒下限，再留 10 秒余量
  const timelineDuration =
    Math.max(videoDuration, ...subs.map((s) => s.end / 1000), 30) + 10;

  return (
    <div className="app">
      <Toolbar
        srtName={srtName}
        videoName={videoName}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        chainMode={chainMode}
        follow={follow}
        pxPerSec={pxPerSec}
        hasSubs={subs.length > 0}
        hasSelection={selectedId !== null}
        showMerge={showMerge}
        onImportSrt={importSrt}
        onImportVideo={importVideo}
        onLoadSample={loadSample}
        onExport={exportSrt}
        onUndo={undo}
        onRedo={redo}
        onToggleChain={setChainMode}
        onToggleFollow={setFollow}
        onZoom={setPxPerSec}
        onDeleteSelected={deleteSelected}
        onToggleMerge={() => setShowMerge((v) => !v)}
      />

      <main className="main">
        <section className="top-row">
          <VideoPlayer
            url={videoUrl}
            name={videoName}
            videoRef={videoRef}
            onTimeUpdate={setCurrentTime}
            onDuration={setVideoDuration}
          />
          <IssuesPanel subs={subs} issues={issues} selectedId={selectedId} onJump={jumpTo} />
          {showMerge && (
            <RevisionMergePanel
              subs={subs}
              revision={revision}
              revisionName={revisionName}
              result={mergeResult}
              selectedId={selectedId}
              onImportRevision={importRevision}
              onApply={applyRevision}
              onClear={clearRevision}
              onJump={jumpTo}
            />
          )}
        </section>

        <Timeline
          subs={subs}
          issues={issues}
          duration={timelineDuration}
          pxPerSec={pxPerSec}
          currentTime={currentTime}
          chainMode={chainMode}
          selectedId={selectedId}
          follow={follow}
          waveform={waveform}
          onSelect={setSelectedId}
          onSeek={seekTo}
          onLiveChange={liveChange}
          onDragCommit={commitDrag}
          onDismissWaveform={dismissWaveform}
        />
      </main>
    </div>
  );
}
