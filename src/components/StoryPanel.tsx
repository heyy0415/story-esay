"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState, TurnMeta } from "@/lib/story/schema";
import { Illustration } from "./Illustration";

interface Props {
  state: GameState;
  streamingText: string;
  choices: string[];
  phase: "playing" | "streaming" | "ended";
  endingType: TurnMeta["endingType"];
  error: string | null;
  /** 正在生成插画的回合索引，-1 为开场 */
  illustratingIndex: number | null;
  onAct: (action: string) => void;
  onReset: () => void;
}

const ENDING_LABEL: Record<NonNullable<TurnMeta["endingType"]>, { text: string; cls: string }> = {
  good: { text: "圆满结局", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-950/40" },
  bad: { text: "悲剧结局", cls: "text-rose-300 border-rose-500/40 bg-rose-950/40" },
  neutral: { text: "故事落幕", cls: "text-amber-200 border-amber-500/40 bg-amber-950/40" },
};

/** 主区域：叙事流、选项与自由输入 */
export function StoryPanel({ state, streamingText, choices, phase, endingType, error, illustratingIndex, onAct, onReset }: Props) {
  const [custom, setCustom] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新内容出现时自动滚到底部，流式期间跟随打字机
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.history.length, streamingText, choices.length]);

  const busy = phase === "streaming";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-8 overflow-y-auto pr-2">
        <div className="space-y-4">
          <Illustration imageUrl={state.openingImageUrl} loading={illustratingIndex === -1} />
          <Narrative text={state.setup.opening} />
        </div>

        {state.history.map((h, i) => (
          <div key={i} className="space-y-4">
            <ActionBubble text={h.action} />
            <Illustration imageUrl={h.imageUrl} loading={illustratingIndex === i} />
            <Narrative text={h.narrative} />
          </div>
        ))}

        {busy && (
          <div className="space-y-4">
            <Narrative text={streamingText} cursor />
          </div>
        )}

        {phase === "ended" && endingType && (
          <div className={`rounded-2xl border px-6 py-5 text-center ${ENDING_LABEL[endingType].cls}`}>
            <p className="text-xl font-bold">{ENDING_LABEL[endingType].text}</p>
            <p className="mt-1 text-sm opacity-80">你在第 {state.turnCount} 回合迎来了这个结局</p>
            <button
              type="button"
              onClick={onReset}
              className="mt-4 rounded-full bg-zinc-100 px-6 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
            >
              开启新的故事
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {phase !== "ended" && (
        <div className="mt-6 border-t border-zinc-800 pt-5">
          {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                disabled={busy}
                onClick={() => onAct(c)}
                className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-left text-zinc-200 transition hover:border-amber-400/70 hover:bg-zinc-800 disabled:opacity-40"
              >
                {c}
              </button>
            ))}
          </div>

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = custom.trim();
              if (v && !busy) {
                onAct(v);
                setCustom("");
              }
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              disabled={busy}
              maxLength={200}
              placeholder={busy ? "剧情推进中…" : "或者，输入你自己的行动…"}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={busy || !custom.trim()}
              className="rounded-xl bg-amber-400 px-5 font-semibold text-zinc-950 hover:bg-amber-300 disabled:opacity-40"
            >
              行动
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function Narrative({ text, cursor }: { text: string; cursor?: boolean }) {
  return (
    <p className="whitespace-pre-wrap text-[17px] leading-8 text-zinc-200">
      {text}
      {cursor && <span className="ml-0.5 inline-block h-5 w-2 animate-pulse bg-amber-400 align-middle" />}
    </p>
  );
}

function ActionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <span className="rounded-2xl rounded-tr-sm bg-amber-400/15 px-4 py-2 text-amber-200">→ {text}</span>
    </div>
  );
}
