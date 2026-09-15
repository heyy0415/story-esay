"use client";

import { useEffect, useState } from "react";
import { AIConfigSchema, type AIConfig } from "@/lib/config/schema";
import { CONFIG_PRESETS, clearConfig, loadConfig, saveConfig } from "@/lib/config/storage";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 模型配置表单。配置存于浏览器 localStorage 并随每次请求发往服务端，
 * 服务端不持有任何密钥——公开演示时每位体验者使用自己的额度。
 */
export function ConfigDialog({ open, onClose }: Props) {
  // 关闭时不挂载：重新打开即得到全新实例，表单自然回填最新配置，无需用 effect 重置
  if (!open) return null;
  return <ConfigForm onClose={onClose} />;
}

function ConfigForm({ onClose }: Omit<Props, "open">) {
  // 初始值直接取已存配置，避免用户重复输入
  const [form, setForm] = useState<AIConfig>(() => loadConfig() ?? { apiKey: "", model: "", baseUrl: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof AIConfig, string>>>({});
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const parsed = AIConfigSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof AIConfig, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof AIConfig;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    if (!saveConfig(parsed.data)) {
      setErrors({ apiKey: "无法写入本地存储，请检查浏览器隐私设置" });
      return;
    }
    onClose();
  };

  const reset = () => {
    clearConfig();
    setForm({ apiKey: "", model: "", baseUrl: "" });
    setErrors({});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h2 className="text-xl font-bold text-zinc-100">模型配置</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          本站不提供模型额度，请填写你自己的 API Key。配置仅保存在当前浏览器，
          <span className="text-zinc-300">不会上传或留存于服务器</span>。
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <Field label="API Key" error={errors.apiKey} required>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder="sk-..."
                autoComplete="off"
                className={inputCls(!!errors.apiKey)}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 rounded-xl border border-zinc-700 px-3 text-sm text-zinc-400 hover:text-zinc-200"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </Field>

          <Field label="模型名" error={errors.model} required>
            <input
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="gpt-4o-mini"
              className={inputCls(!!errors.model)}
            />
          </Field>

          <Field label="Base URL" error={errors.baseUrl} hint="留空使用 OpenAI 官方地址；中转网关注意是否需要 /v1 后缀">
            <input
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://api.example.com/v1"
              className={inputCls(!!errors.baseUrl)}
            />
          </Field>

          <div>
            <p className="mb-2 text-xs text-zinc-500">快速填充：</p>
            <div className="flex flex-wrap gap-2">
              {CONFIG_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, model: p.model, baseUrl: p.baseUrl }))}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-400/60 hover:text-amber-200"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button type="button" onClick={reset} className="text-sm text-zinc-500 hover:text-rose-400">
            清除配置
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="rounded-full px-5 py-2 text-sm text-zinc-400 hover:text-zinc-200">
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-full bg-amber-400 px-6 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return `w-full rounded-xl border bg-zinc-950/60 px-4 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
    hasError ? "border-rose-500/70 focus:border-rose-400" : "border-zinc-700 focus:border-amber-400"
  }`;
}

function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-zinc-300">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-rose-400">{error}</span> : hint ? <span className="text-xs text-zinc-600">{hint}</span> : null}
    </label>
  );
}
