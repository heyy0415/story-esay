"use client";

import type { GameState } from "@/lib/story/schema";
import { MAX_TURNS } from "@/lib/story/prompts";

interface Props {
  state: GameState;
  lastStatChanges: Record<string, number>;
  onReset: () => void;
}

/** 左侧栏：角色信息、属性条、物品栏与进度 */
export function StatusPanel({ state, lastStatChanges, onReset }: Props) {
  const { setup, stats, items, turnCount } = state;

  return (
    <aside className="flex w-full flex-col gap-6 lg:w-72 lg:shrink-0">
      <div>
        <p className="text-xs uppercase tracking-widest text-amber-400/80">{setup.genre}</p>
        <h2 className="mt-1 text-2xl font-bold text-zinc-100">{setup.title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{setup.worldIntro}</p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="font-semibold text-zinc-100">{setup.protagonist.name}</p>
        <p className="mt-1 text-sm text-zinc-400">{setup.protagonist.description}</p>
      </div>

      <div className="flex flex-col gap-3">
        {Object.entries(stats).map(([name, value]) => {
          const delta = lastStatChanges[name];
          return (
            <div key={name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-300">{name}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {delta !== undefined && delta !== 0 && (
                    <span className={`animate-pulse text-xs font-semibold ${delta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  )}
                  <span className="text-zinc-100">{value}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${statColor(value)}`}
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">物品与线索</p>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-600">暂无</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {items.map((item) => (
              <li key={item} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-300">
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-zinc-800 pt-4 text-sm text-zinc-500">
        <span>
          第 {turnCount} / {MAX_TURNS} 回合
        </span>
        <button type="button" onClick={onReset} className="text-zinc-500 underline-offset-4 hover:text-rose-400 hover:underline">
          重新开始
        </button>
      </div>
    </aside>
  );
}

/** 属性值越低颜色越危险，给玩家直观的风险提示 */
function statColor(value: number): string {
  if (value <= 20) return "bg-rose-500";
  if (value <= 50) return "bg-amber-400";
  return "bg-emerald-400";
}
