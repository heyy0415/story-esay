"use client";

import { useSyncExternalStore } from "react";
import { loadConfig, maskKey, subscribeConfig } from "@/lib/config/storage";

interface Props {
  onClick: () => void;
}

/** SSR 时无 localStorage，统一返回未配置以保证首屏一致 */
const serverSnapshot = () => null;

/**
 * 右上角固定的模型配置入口，同时提示当前是否已配置。
 *
 * 用 useSyncExternalStore 订阅配置变化：localStorage 是外部数据源，
 * 这样既能正确处理 SSR 水合，也无需父组件用 effect 手动同步状态。
 */
export function ConfigButton({ onClick }: Props) {
  const masked = useSyncExternalStore(subscribeConfig, getMaskedSnapshot, serverSnapshot);
  const configured = !!masked;

  return (
    <button
      type="button"
      onClick={onClick}
      title={configured ? `已配置：${masked}` : "尚未配置模型"}
      className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm text-zinc-300 backdrop-blur transition hover:border-amber-400/60 hover:text-amber-200"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${configured ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
      <span className="hidden sm:inline">{configured ? masked : "模型配置"}</span>
      <span className="sm:hidden">配置</span>
    </button>
  );
}

/** 缓存快照，useSyncExternalStore 要求同一状态下返回相同引用 */
let cachedKey: string | null = null;
let cachedMask: string | null = null;

function getMaskedSnapshot(): string | null {
  const cfg = loadConfig();
  const key = cfg?.apiKey ?? null;
  if (key !== cachedKey) {
    cachedKey = key;
    cachedMask = key ? maskKey(key) : null;
  }
  return cachedMask;
}
