"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, StorySetup, TurnMeta } from "./schema";
import { requestSetup, requestTurn, requestIllustration } from "./client";

const STORAGE_KEY = "ai-story-save-v1";

/** 叙事流式输出达到此字数即提前发起画图，让插画生成与剩余叙事并行 */
const ILLUSTRATION_TRIGGER_CHARS = 80;

type Phase = "idle" | "creating" | "playing" | "streaming" | "ended";

interface GameUI {
  phase: Phase;
  state: GameState | null;
  /** 当前正在流式输出的叙事文本 */
  streamingText: string;
  /** 当前可选行动 */
  choices: string[];
  /** 最近一回合的属性变化，用于 UI 高亮闪烁 */
  lastStatChanges: Record<string, number>;
  endingType: TurnMeta["endingType"];
  error: string | null;
  /** 插画正在生成中的回合索引，-1 表示开场插画，null 表示无进行中的插画 */
  illustratingIndex: number | null;
}

const INITIAL_UI: GameUI = {
  phase: "idle",
  state: null,
  streamingText: "",
  choices: [],
  lastStatChanges: {},
  endingType: undefined,
  error: null,
  illustratingIndex: null,
};

function loadSave(): GameUI | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GameUI) : null;
  } catch {
    return null;
  }
}

/**
 * 游戏状态机 hook。服务端无状态，所有进度在此维护并持久化到 localStorage，
 * 刷新页面可恢复。流式中途刷新则回滚到上一回合结束时的存档。
 */
export function useGame() {
  const [ui, setUi] = useState<GameUI>(INITIAL_UI);
  const abortRef = useRef<AbortController | null>(null);

  // 首次挂载读取存档；放在 effect 里避免 SSR/CSR 不一致
  useEffect(() => {
    const saved = loadSave();
    if (saved && saved.state) setUi({ ...saved, error: null });
  }, []);

  // 仅在稳定阶段落盘，流式中间态不存
  useEffect(() => {
    if (ui.phase === "playing" || ui.phase === "ended") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ui));
    }
  }, [ui]);

  const startGame = useCallback(async (idea: string) => {
    setUi({ ...INITIAL_UI, phase: "creating" });
    try {
      const setup: StorySetup = await requestSetup(idea);
      const state: GameState = {
        setup,
        stats: { ...setup.stats },
        items: [],
        history: [],
        turnCount: 0,
        openingImageUrl: null,
      };
      // 先让剧情可玩，插画随后异步补上
      setUi({ ...INITIAL_UI, phase: "playing", state, choices: setup.choices, illustratingIndex: -1 });

      const imageUrl = await requestIllustration(setup.genre, setup.opening);
      setUi((u) => {
        if (!u.state) return u;
        return { ...u, state: { ...u.state, openingImageUrl: imageUrl }, illustratingIndex: null };
      });
    } catch (e) {
      setUi({ ...INITIAL_UI, error: e instanceof Error ? e.message : "创建失败" });
    }
  }, []);

  const act = useCallback(
    async (action: string) => {
      if (!ui.state || ui.phase !== "playing") return;
      const prevState = ui.state;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setUi((u) => ({ ...u, phase: "streaming", streamingText: "", choices: [], lastStatChanges: {}, error: null }));

      let narrative = "";
      // 由 onMeta 回写，供插画请求定位要填充的回合
      let turnIndex = -1;
      // 插画请求提前发起后在此挂起，最后再 await，让画图与叙事输出重叠
      let illustrationPromise: Promise<string | null> | null = null;

      try {
        await requestTurn(
          prevState,
          action,
          {
            onText: (delta) => {
              narrative += delta;
              setUi((u) => ({ ...u, streamingText: narrative }));

              // 攒够开头就发起画图，不等叙事写完（插画约 20-30s，与后续输出并行可省一半等待）
              if (!illustrationPromise && narrative.length >= ILLUSTRATION_TRIGGER_CHARS) {
                illustrationPromise = requestIllustration(prevState.setup.genre, narrative, controller.signal);
              }
            },
            onMeta: (meta) => {
              const nextStats = applyStatChanges(prevState.stats, meta.statChanges);
              const nextState: GameState = {
                ...prevState,
                stats: nextStats,
                items: [...prevState.items, ...meta.newItems.filter((i) => !prevState.items.includes(i))],
                history: [...prevState.history, { action, narrative, imageUrl: null }],
                turnCount: prevState.turnCount + 1,
              };
              // 任意属性归零视为坏结局，与 prompt 中的规则保持一致
              const anyZero = Object.values(nextStats).some((v) => v <= 0);
              const ended = meta.isEnding || anyZero;
              turnIndex = nextState.history.length - 1;
              setUi({
                phase: ended ? "ended" : "playing",
                state: nextState,
                streamingText: "",
                choices: ended ? [] : meta.choices,
                lastStatChanges: meta.statChanges,
                endingType: ended ? (meta.endingType ?? (anyZero ? "bad" : "neutral")) : undefined,
                error: null,
                illustratingIndex: turnIndex,
              });
            },
          },
          controller.signal,
        );

        // 叙事很短没触发提前发起时，在此补发
        if (turnIndex >= 0 && !illustrationPromise && narrative) {
          illustrationPromise = requestIllustration(prevState.setup.genre, narrative, controller.signal);
        }

        // 等待插画落地。失败返回 null，页面降级为纯文字
        if (turnIndex >= 0 && illustrationPromise) {
          const imageUrl = await illustrationPromise;
          setUi((u) => {
            if (!u.state) return u;
            const history = u.state.history.map((h, i) => (i === turnIndex ? { ...h, imageUrl } : h));
            return { ...u, state: { ...u.state, history }, illustratingIndex: null };
          });
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        // 失败回滚到行动前，玩家可重试
        setUi((u) => ({
          ...u,
          phase: "playing",
          streamingText: "",
          choices: getChoicesBefore(prevState, u),
          error: e instanceof Error ? e.message : "生成失败",
          illustratingIndex: null,
        }));
      }
    },
    [ui.state, ui.phase],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    localStorage.removeItem(STORAGE_KEY);
    setUi(INITIAL_UI);
  }, []);

  return { ...ui, startGame, act, reset };
}

function applyStatChanges(stats: Record<string, number>, changes: Record<string, number>): Record<string, number> {
  const next = { ...stats };
  for (const [k, delta] of Object.entries(changes)) {
    if (k in next) next[k] = Math.max(0, Math.min(100, next[k] + delta));
  }
  return next;
}

/** 失败回滚时恢复上一次的选项：首回合用开局选项，否则用存档里的 */
function getChoicesBefore(prev: GameState, ui: GameUI): string[] {
  if (prev.turnCount === 0) return prev.setup.choices;
  const saved = loadSave();
  return saved?.choices?.length ? saved.choices : ui.choices;
}
