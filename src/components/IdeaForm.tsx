"use client";

import { useState } from "react";

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
}

/** 首页：输入一句话创意，生成故事 */
export function IdeaForm({ onStart, loading, error }: Props) {
  const [idea, setIdea] = useState("");
  const canSubmit = idea.trim().length >= 2 && !loading;

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
