"use client";

import { useEffect, useState } from "react";

const EXAMPLES = [
  "魔教余孽潜入正派扫地，悟出绝学后揭穿正邪之分不过是掩盖血案的谎言。",
  "明朝末年的小镖师，护送一封改变国运的密信",
  "被困在无限循环的一天里的高中生，必须找到打破循环的方法",
  "太空殖民船上唯一醒来的乘客，发现其他人都消失了",
];

interface Props {
  onStart: (idea: string) => void;
  loading: boolean;
  error: string | null;
  /** 构建进度百分比（loading 时有效） */
  progress: number;
  /** 当前阶段文案 */
  stage: string;
}

/**
 * 让进度在真实节点之间缓慢爬升。
 *
 * 出图阶段是一次约 45 秒的等待，期间没有任何可上报的中间事件，
 * 进度条若静止不动会被误认为卡死。这里在真实进度之上叠加缓慢爬升，
 * 并在接近下一节点前收敛，既避免假死观感也不会超过真实进度太多。
 */
function useCreepingProgress(target: number): number {
  /** 自上一个真实节点以来累计爬升的量 */
  const [creep, setCreep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // 最多爬 18%，留出真实事件的落点
      setCreep((c) => Math.min(c + 1, 18));
    }, 1400);

    // target 变化时清零，让新的真实进度直接接管
    return () => {
      clearInterval(timer);
      setCreep(0);
    };
  }, [target]);

  return Math.min(target + creep, target >= 100 ? 100 : 99);
}

/**
 * 构建世界的进度视图。开局刻意等到图文全部就绪才进入游戏，
 * 所以这段等待较长（约一分钟），必须给出真实进度而非无限转圈。
 */
function BuildingProgress({ progress, stage }: { progress: number; stage: string }) {
  const display = useCreepingProgress(progress);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-zinc-100">正在构建世界</h2>
        <p className="mt-3 text-zinc-400">{stage}</p>
      </div>

      <div className="w-full">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-zinc-500">进度</span>
          <span className="text-2xl font-semibold tabular-nums text-amber-300">{display}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-500"
            style={{ width: `${display}%` }}
          />
        </div>
      </div>

      <p className="text-center text-sm leading-relaxed text-zinc-600">
        首次构建需要生成世界设定、开场剧情与场景插图，
        <br />
        完成后进入游戏即可图文秒开。
      </p>
    </div>
  );
}

/** 首页：输入一句话创意，生成故事 */
export function IdeaForm({ onStart, loading, error, progress, stage }: Props) {
  const [idea, setIdea] = useState("");
  const canSubmit = idea.trim().length >= 2 && !loading;

  // 构建中占满视图，避免玩家在等待期反复点击
  if (loading) return <BuildingProgress progress={progress} stage={stage} />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-amber-200 via-orange-300 to-rose-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          千面故事
        </h1>
        <p className="mt-4 text-lg text-zinc-400">
          一句话，AI 为你生成一个可玩的互动故事。每个选择都会改变结局。
        </p>
      </div>

      <form
        className="flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onStart(idea.trim());
        }}
      >
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="描述你想玩的故事，比如：魔教余孽潜入正派扫地，悟出绝学后揭穿正邪之分不过是掩盖血案的谎言。"
          maxLength={300}
          rows={3}
          disabled={loading}
          className="w-full resize-none rounded-2xl border border-zinc-700 bg-zinc-900/80 px-5 py-4 text-lg text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{idea.length}/300</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-amber-400 px-8 py-3 font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "正在构建世界…" : "开始冒险"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-rose-300">
          {error}
        </p>
      )}

      <div className="w-full">
        <p className="mb-3 text-sm text-zinc-500">试试这些：</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={loading}
              onClick={() => setIdea(ex)}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-amber-400/60 hover:text-amber-200 disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
