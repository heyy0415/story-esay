"use client";

import { AIConfigSchema, type AIConfig } from "./schema";

const STORAGE_KEY = "ai-story-config-v1";

/** 供用户参考的常见配置预设 */
export const CONFIG_PRESETS = [
  { label: "OpenAI 官方", baseUrl: "", model: "gpt-4o-mini" },
  { label: "DeepSeek 官方", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
] as const;

/**
 * 读取已保存的配置。
 * @returns 无配置或配置已损坏时返回 null
 */
export function loadConfig(): AIConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = AIConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 配置变更订阅者，供 useSyncExternalStore 驱动 UI 更新 */
const listeners = new Set<() => void>();

/** 订阅配置变化。同时监听 storage 事件以感知其他标签页的修改 */
export function subscribeConfig(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * 保存配置
 * @returns 是否保存成功（localStorage 可能因隐私模式或配额不可用）
 */
export function saveConfig(config: AIConfig): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    notify();
    return true;
  } catch {
    return false;
  }
}

export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    notify();
  } catch {
    // 忽略：清理失败不影响使用
  }
}

/** 脱敏显示 key，用于已配置状态的回显 */
export function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}
