"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, StorySetup, TurnMeta } from "./schema";
import { requestSetup, requestIllustration, NeedConfigError } from "./client";
import { warmImage } from "./image-warm";
import { MAX_TURNS } from "./prompts";
import {
  generateBranch,
  startPrefetch,
  takeBranch,
  abortSiblings,
  discardTree,
  summarize,
  type BranchResult,
  type BranchTree,
  type PrefetchSummary,
} from "./prefetch";

const STORAGE_KEY = "ai-story-save-v1";

/** 预取摘要的最小更新间隔。三个分支并发流式每秒产生数十次回调，不节流会打满主线程 */
const SUMMARY_THROTTLE_MS = 300;

/**
 * 开局各阶段的进度权重（累计百分比）。
 * 按实测耗时分配：文字生成约 20s、插图 prompt 约 8s、出图约 45s。
 */
const SETUP_PROGRESS = {
  start: 5,
  storyReady: 30,
  promptReady: 40,
  imageWarmed: 100,
} as const;

/**
 * idle 未开始 / creating 开局生成中 / playing 可交互（预取可能在后台进行）
 * awaiting 已点击但分支尚未就绪 / streaming 实时流式（预取未命中的回退路径）/ ended 结局
 */
type Phase = "idle" | "creating" | "playing" | "awaiting" | "streaming" | "ended";

interface GameUI {
  phase: Phase;
  state: GameState | null;
  /** 实时流式时的叙事增量文本 */
  streamingText: string;
  choices: string[];
  /** 最近一回合的属性变化，用于 UI 高亮 */
  lastStatChanges: Record<string, number>;
  endingType: TurnMeta["endingType"];
  error: string | null;
  /** 插图生成中的回合索引，-1 表示开场，null 表示无进行中的插图 */
  illustratingIndex: number | null;
  /** awaiting 阶段已生成的字数，用于进度反馈 */
  awaitingChars: number;
  /** 预取状态摘要（派生自 treeRef，仅供 UI 参考） */
  prefetch: PrefetchSummary;
  /** 开局进度百分比（creating 阶段有效） */
  setupProgress: number;
  /** 开局当前阶段的文案 */
  setupStage: string;
  /** 因未配置模型而中断，UI 据此弹出配置表单 */
  needConfig: boolean;
  /** 配置相关的具体原因，展示在配置表单中引导用户修正 */
  configError: string | null;
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
  awaitingChars: 0,
  prefetch: {},
  setupProgress: 0,
  setupStage: "",
  needConfig: false,
  configError: null,
};

/** 存档只保留稳定的游戏进度，预取缓存与瞬时 UI 状态不落盘 */
type SavedGame = Pick<GameUI, "phase" | "state" | "choices" | "endingType">;

function loadSave(): SavedGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedGame) : null;
  } catch {
    return null;
  }
}

/**
 * 游戏状态机 hook。服务端无状态，进度在此维护并持久化到 localStorage。
 *
 * 核心机制是预取：玩家阅读当前剧情时，后台并发为每个选项生成下一回合，
 * 点击即时呈现。预取缓存放在 ref 而非 state，一是避免高频流式回调触发
 * 整树 re-render，二是避免被存档 effect 写入 localStorage 撑爆配额。
 */
export function useGame() {
  const [ui, setUi] = useState<GameUI>(INITIAL_UI);

  /** 预取树。放 ref：高频更新不应触发渲染，也不应进入存档 */
  const treeRef = useRef<BranchTree | null>(null);
  /** 当前回合（实时/awaiting）的取消器，与各预取分支的取消器分离 */
  const actAbortRef = useRef<AbortController | null>(null);
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 当前正在等待的分支 key，用于把该分支的进度反映到 awaitingChars */
  const awaitingKeyRef = useRef<string | null>(null);

  /** 节流地把预取摘要同步到 UI，并驱动 awaiting 进度 */
  const syncSummary = useCallback((tree: BranchTree) => {
    if (summaryTimerRef.current) return;
    summaryTimerRef.current = setTimeout(() => {
      summaryTimerRef.current = null;
      const prefetch = summarize(tree);
      const awaitingChars = awaitingKeyRef.current
        ? (tree.branches.get(awaitingKeyRef.current)?.charCount ?? 0)
        : undefined;

      setUi((u) => ({ ...u, prefetch, ...(awaitingChars !== undefined ? { awaitingChars } : {}) }));
    }, SUMMARY_THROTTLE_MS);
  }, []);

  /** 为指定状态启动新一轮预取。结局或已达最大回合时不预取，避免必败请求 */
  const schedulePrefetch = useCallback(
    (state: GameState, choices: string[]) => {
      discardTree(treeRef.current);
      treeRef.current = null;

      if (!choices.length || state.turnCount >= MAX_TURNS) return;
      treeRef.current = startPrefetch(state, choices, syncSummary);
      setUi((u) => ({ ...u, prefetch: summarize(treeRef.current) }));
    },
    [syncSummary],
  );

  // 首次挂载读取存档；放在 effect 里避免 SSR/CSR 不一致
  useEffect(() => {
    const saved = loadSave();
    if (saved?.state) {
      setUi({ ...INITIAL_UI, ...saved, error: null });
      // 恢复存档后立刻为已有选项预取，让读档后的第一次点击也是零等待
      if (saved.phase === "playing" && saved.choices?.length) {
        schedulePrefetch(saved.state, saved.choices);
      }
    }
  }, [schedulePrefetch]);

  // 仅在稳定阶段落盘，流式中间态不存
  useEffect(() => {
    if (ui.phase !== "playing" && ui.phase !== "ended") return;
    const save: SavedGame = { phase: ui.phase, state: ui.state, choices: ui.choices, endingType: ui.endingType };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    } catch (e) {
      // 配额超限不应中断游戏，仅失去存档能力
      console.warn("[save] 写入存档失败:", e instanceof Error ? e.message : e);
    }
  }, [ui.phase, ui.state, ui.choices, ui.endingType]);

  // 卸载时取消全部在途请求，避免回调写入已卸载组件
  useEffect(
    () => () => {
      actAbortRef.current?.abort();
      discardTree(treeRef.current);
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    },
    [],
  );

  /**
   * 把一个已完成的分支提交为新的当前回合，并立刻为新选项启动预取。
   * 插图若仍在途，通过 attachLateImage 在到达后按叙事内容匹配回填。
   */
  const commitBranch = useCallback(
    (prevState: GameState, result: BranchResult) => {
      const nextStats = applyStatChanges(prevState.stats, result.meta.statChanges);
      const nextState: GameState = {
        ...prevState,
        stats: nextStats,
        items: [...prevState.items, ...result.meta.newItems.filter((i) => !prevState.items.includes(i))],
        history: [...prevState.history, { action: result.action, narrative: result.narrative, imageUrl: result.imageUrl }],
        turnCount: prevState.turnCount + 1,
      };

      // 任意属性归零视为坏结局，与 prompt 中的规则保持一致
      const anyZero = Object.values(nextStats).some((v) => v <= 0);
      const ended = result.meta.isEnding || anyZero;
      const turnIndex = nextState.history.length - 1;

      setUi((u) => ({
        ...u,
        phase: ended ? "ended" : "playing",
        state: nextState,
        streamingText: "",
        choices: ended ? [] : result.meta.choices,
        lastStatChanges: result.meta.statChanges,
        endingType: ended ? (result.meta.endingType ?? (anyZero ? "bad" : "neutral")) : undefined,
        error: null,
        illustratingIndex: result.imagePending ? turnIndex : null,
        awaitingChars: 0,
      }));

      if (result.imagePending) attachLateImage(result, setUi);
      if (!ended) schedulePrefetch(nextState, result.meta.choices);
    },
    [schedulePrefetch],
  );

  /** 实时流式生成（预取未命中或失败时的回退路径） */
  const runLiveTurn = useCallback(
    async (baseState: GameState, action: string) => {
      const controller = new AbortController();
      actAbortRef.current = controller;

      setUi((u) => ({ ...u, phase: "streaming", streamingText: "", choices: [], lastStatChanges: {}, error: null }));

      try {
        const result = await generateBranch(baseState, action, controller.signal, {
          onProgress: (narrative) => setUi((u) => ({ ...u, streamingText: narrative })),
        });
        commitBranch(baseState, result);
      } catch (e) {
        if (controller.signal.aborted) return;
        // 失败回滚到行动前，玩家可重试
        setUi((u) => ({
          ...u,
          phase: "playing",
          streamingText: "",
          choices: u.choices.length ? u.choices : baseState.setup.choices,
          error: e instanceof NeedConfigError ? null : e instanceof Error ? e.message : "生成失败",
          needConfig: e instanceof NeedConfigError,
          configError: e instanceof NeedConfigError ? e.message : null,
          illustratingIndex: null,
          awaitingChars: 0,
        }));
      }
    },
    [commitBranch],
  );

  /**
   * 开始新故事。开局刻意做成"全部就绪才进入"：先生成世界设定与开场，
   * 再预热开场插图，使玩家进入时图文同时秒开。
   *
   * 分支插图不在此预热——文生图服务有共享上游限流，实测并发 4 路仅 1 路成功，
   * 串行 4 张需约 170 秒，超出可接受的开局等待。分支图改为进入后惰加载。
   */
  const startGame = useCallback(
    async (idea: string) => {
      const controller = new AbortController();
      actAbortRef.current = controller;

      const report = (setupProgress: number, setupStage: string) =>
        setUi((u) => (u.phase === "creating" ? { ...u, setupProgress, setupStage } : u));

      setUi({ ...INITIAL_UI, phase: "creating", setupProgress: SETUP_PROGRESS.start, setupStage: "构思世界设定…" });

      try {
        const setup: StorySetup = await requestSetup(idea);
        if (controller.signal.aborted) return;

        const state: GameState = {
          setup,
          stats: { ...setup.stats },
          items: [],
          history: [],
          turnCount: 0,
          openingImageUrl: null,
        };
        report(SETUP_PROGRESS.storyReady, `《${setup.title}》已就绪，正在绘制开场…`);

        // 立刻启动文字预取，与插图预热并行——文字不受图片限流影响
        schedulePrefetch(state, setup.choices);

        const imageUrl = await requestIllustration(setup.genre, setup.opening, controller.signal);
        if (controller.signal.aborted) return;
        report(SETUP_PROGRESS.promptReady, "画面生成中，这一步最久…");

        // 预热成功后 <img> 即为秒开；失败也照常进入，届时退化为骨架屏
        if (imageUrl) {
          await warmImage(imageUrl, controller.signal, (attempt) => {
            report(SETUP_PROGRESS.promptReady, attempt > 1 ? `画面生成中（重试 ${attempt}/3）…` : "画面生成中，这一步最久…");
          });
        }
        if (controller.signal.aborted) return;

        report(SETUP_PROGRESS.imageWarmed, "准备就绪");
        setUi((u) => ({
          ...u,
          phase: "playing",
          state: { ...state, openingImageUrl: imageUrl },
          choices: setup.choices,
          illustratingIndex: null,
        }));
      } catch (e) {
        if (controller.signal.aborted) return;
        // 未配置模型不是错误，交给 UI 引导用户填写而非显示红色报错
        if (e instanceof NeedConfigError) {
          setUi({ ...INITIAL_UI, needConfig: true, configError: e.message });
          return;
        }
        setUi({ ...INITIAL_UI, error: e instanceof Error ? e.message : "创建失败" });
      }
    },
    [schedulePrefetch],
  );

  const act = useCallback(
    async (action: string) => {
      // awaiting/streaming 期间禁止再次行动，避免并发提交
      if (!ui.state || ui.phase !== "playing") return;
      const baseState = ui.state;

      const entry = takeBranch(treeRef.current, baseState, action);
      // 保留选中分支，取消其余——它们的插图可能还在途，不能一起取消
      abortSiblings(treeRef.current, entry?.key);

      if (entry?.status === "ready" && entry.result) {
        commitBranch(baseState, entry.result);
        return;
      }

      if (entry?.status === "pending" && entry.promise) {
        awaitingKeyRef.current = entry.key;
        setUi((u) => ({ ...u, phase: "awaiting", error: null, awaitingChars: entry.charCount }));
        try {
          // 复用在途请求，不重新发起
          const result = await entry.promise;
          commitBranch(baseState, result);
        } catch {
          if (entry.controller.signal.aborted) return;
          await runLiveTurn(baseState, action);
        } finally {
          awaitingKeyRef.current = null;
        }
        return;
      }

      // failed / aborted / 未命中（自由输入）→ 实时生成
      await runLiveTurn(baseState, action);
    },
    [ui.state, ui.phase, commitBranch, runLiveTurn],
  );

  const reset = useCallback(() => {
    actAbortRef.current?.abort();
    discardTree(treeRef.current);
    treeRef.current = null;
    localStorage.removeItem(STORAGE_KEY);
    setUi(INITIAL_UI);
  }, []);

  const clearNeedConfig = useCallback(() => setUi((u) => ({ ...u, needConfig: false, configError: null })), []);

  return { ...ui, startGame, act, reset, clearNeedConfig };
}

function applyStatChanges(stats: Record<string, number>, changes: Record<string, number>): Record<string, number> {
  const next = { ...stats };
  for (const [k, delta] of Object.entries(changes)) {
    if (k in next) next[k] = Math.max(0, Math.min(100, next[k] + delta));
  }
  return next;
}

/**
 * 插图晚于提交到达时回填到对应回合。
 * 按叙事内容匹配而非下标：玩家可能已重置或开启新故事，下标会失效甚至越界。
 */
function attachLateImage(result: BranchResult, setUi: React.Dispatch<React.SetStateAction<GameUI>>) {
  result.onImageReady((imageUrl) => {
    setUi((u) => {
      if (!u.state) return u;

      const index = u.state.history.findIndex((h) => h.narrative === result.narrative);
      // 找不到说明该回合已不在当前故事中（重置/新开局），仅撤掉骨架
      if (index === -1) return { ...u, illustratingIndex: null };

      const history = u.state.history.map((h, i) => (i === index ? { ...h, imageUrl } : h));
      return { ...u, state: { ...u.state, history }, illustratingIndex: null };
    });
  });
}
