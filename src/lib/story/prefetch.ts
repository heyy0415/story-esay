import type { GameState, TurnMeta } from "./schema";
import { requestTurn, requestIllustration } from "./client";
import { warmImage } from "./image-warm";

/**
 * 预取模式。额度紧张时改为 "first"（只预取首个选项）或 "off"（关闭）即可一键降级，
 * 因为预取与实时生成共用 generateBranch，关闭后自动回退到实时路径。
 */
export const PREFETCH_MODE: "all" | "first" | "off" = "all";

/** 单分支的生命周期状态 */
export type BranchStatus = "pending" | "ready" | "failed" | "aborted";

/** 一个预取分支的完整产物 */
export interface BranchResult {
  action: string;
  narrative: string;
  meta: TurnMeta;
  /** 插图地址；null 表示生成失败或仍在途（看 imagePending） */
  imageUrl: string | null;
  /** 叙事已就绪但插图还在生成中。此时分支仍可被消费 */
  imagePending: boolean;
  /**
   * 注册插图到达时的回调。插图可能在分支被提交为当前回合之后才到达，
   * 届时才知道该写入 history 的哪个位置，所以回调需要在提交时才绑定。
   * 若插图已到达则立即同步触发。
   */
  onImageReady: (cb: (imageUrl: string | null) => void) => void;
}

/** 缓存条目：一个分支从发起到就绪/失败的全过程 */
export interface BranchEntry {
  key: string;
  action: string;
  status: BranchStatus;
  /** 前置状态的回合数，用于校验分支是否仍然有效 */
  baseTurnCount: number;
  /** 已累积叙事字数，供 UI 进度反馈（不渲染正文，只报进度） */
  charCount: number;
  result: BranchResult | null;
  error: string | null;
  /** 在途 promise，供"点击了 pending 分支"时复用而不重发请求 */
  promise: Promise<BranchResult> | null;
  controller: AbortController;
}

/** 一轮预取：以某个前置状态为根，挂着它所有选项的分支 */
export interface BranchTree {
  rootTurnCount: number;
  branches: Map<string, BranchEntry>;
}

/** 暴露给 UI 的最小派生信息，按行动文本索引 */
export type PrefetchSummary = Record<string, { status: BranchStatus; charCount: number }>;

/**
 * 分支 key。必须带 baseTurnCount 前缀：不同回合可能出现文本完全相同的选项
 * （turn 路由的 FALLBACK_META 就是一组固定选项），只用文本会把旧回合的分支
 * 错当成当前回合的，导致剧情接不上且不报错。
 */
export function branchKey(baseTurnCount: number, action: string): string {
  return `${baseTurnCount}:${action.trim()}`;
}

interface GenerateHooks {
  /** 叙事增量。预取时用于累加字数，实时时用于打字机渲染 */
  onProgress?: (narrative: string) => void;
  /** 叙事与 meta 就绪的瞬间——即"分支 ready"的时刻 */
  onNarrativeDone?: (narrative: string, meta: TurnMeta) => void;
  /** 插图晚到时触发 */
  onImage?: (imageUrl: string | null) => void;
}

/**
 * 生成一个回合分支（叙事 + 元数据 + 插图）。纯逻辑，不触碰 React 状态。
 *
 * 预取与实时生成共用此函数，唯一区别是 onProgress 的实现，
 * 避免两套易发散的生成逻辑。
 *
 * 插图不阻塞 resolve：叙事就绪即返回（imagePending 为 true），
 * 插图通过 onImage 异步补达。否则预取分支要等约 45 秒才可用，预取就失去意义。
 *
 * @throws 服务端未返回元数据、请求失败或被取消时抛出
 */
export async function generateBranch(
  baseState: GameState,
  action: string,
  signal: AbortSignal,
  hooks?: GenerateHooks,
): Promise<BranchResult> {
  let narrative = "";
  let meta: TurnMeta | null = null;

  await requestTurn(
    baseState,
    action,
    {
      onText: (delta) => {
        narrative += delta;
        hooks?.onProgress?.(narrative);
      },
      onMeta: (m) => {
        meta = m;
      },
    },
    signal,
  );

  if (!meta) throw new Error("服务端未返回回合元数据");
  hooks?.onNarrativeDone?.(narrative, meta);

  let lateCallback: ((imageUrl: string | null) => void) | null = null;

  const result: BranchResult = {
    action,
    narrative,
    meta,
    imageUrl: null,
    imagePending: true,
    onImageReady: (cb) => {
      // 已到达则立即触发，否则登记等待
      if (!result.imagePending) cb(result.imageUrl);
      else lateCallback = cb;
    },
  };

  // 基于【完整】叙事生成插图，而非流式过程中的前缀——否则插图只反映剧情开头，
  // 关键转折进不了 prompt，造成图文脱节。同时让 deriveSeed 基于完整文本而稳定。
  // 不 await：插图需数十秒，分支的就绪只取决于叙事，否则预取失去意义。
  void requestIllustration(baseState.setup.genre, narrative, signal).then((imageUrl) => {
    result.imageUrl = imageUrl;
    result.imagePending = false;
    lateCallback?.(imageUrl);
    hooks?.onImage?.(imageUrl);
  });

  return result;
}

/**
 * 为 baseState 的所有选项并发启动预取，立即返回（不等待任何请求）。
 * @param onUpdate 分支状态变化时回调，供调用方同步 UI 摘要
 */
export function startPrefetch(
  baseState: GameState,
  choices: string[],
  onUpdate: (tree: BranchTree) => void,
): BranchTree | null {
  if (PREFETCH_MODE === "off" || !choices.length) return null;

  const targets = PREFETCH_MODE === "first" ? choices.slice(0, 1) : choices;
  const tree: BranchTree = { rootTurnCount: baseState.turnCount, branches: new Map() };

  for (const action of targets) {
    const key = branchKey(baseState.turnCount, action);
    const controller = new AbortController();
    const entry: BranchEntry = {
      key,
      action,
      status: "pending",
      baseTurnCount: baseState.turnCount,
      charCount: 0,
      result: null,
      error: null,
      promise: null,
      controller,
    };

    entry.promise = generateBranch(baseState, action, controller.signal, {
      onProgress: (narrative) => {
        entry.charCount = narrative.length;
        onUpdate(tree);
      },
      onImage: (imageUrl) => {
        onUpdate(tree);
        // 玩家阅读期间在后台串行预热分支插图，使真正选中时更可能秒开。
        // 队列已做串行化，此处并发调用不会压垮上游限流。
        if (imageUrl) void warmImage(imageUrl, controller.signal);
      },
    })
      .then((result) => {
        entry.status = "ready";
        entry.result = result;
        onUpdate(tree);
        return result;
      })
      .catch((e: unknown) => {
        entry.status = controller.signal.aborted ? "aborted" : "failed";
        entry.error = e instanceof Error ? e.message : String(e);
        onUpdate(tree);
        throw e;
      });

    // 被丢弃的分支通常无人 await，挂空 catch 消除 unhandled rejection
    void entry.promise.catch(() => {});

    tree.branches.set(key, entry);
  }

  return tree;
}

/** 从树中取出仍然有效的分支；根回合数不匹配（状态已推进）时视为失效 */
export function takeBranch(tree: BranchTree | null, state: GameState, action: string): BranchEntry | undefined {
  if (!tree || tree.rootTurnCount !== state.turnCount) return undefined;
  return tree.branches.get(branchKey(state.turnCount, action));
}

/**
 * 取消除 keepKey 外的所有分支。
 * 每分支独立 controller 正是为了这个操作——共用一个会把刚选中的分支
 * （可能还在等插图）一起取消掉。
 */
export function abortSiblings(tree: BranchTree | null, keepKey?: string): void {
  if (!tree) return;
  for (const [key, entry] of tree.branches) {
    if (key !== keepKey) entry.controller.abort();
  }
}

/** 整树废弃：取消全部并清空，避免悬挂的 promise 继续持有旧状态 */
export function discardTree(tree: BranchTree | null): void {
  abortSiblings(tree);
  tree?.branches.clear();
}

/** 派生 UI 摘要。tree 本体放 ref 不进 state，只把这份极小的摘要交给 UI */
export function summarize(tree: BranchTree | null): PrefetchSummary {
  const summary: PrefetchSummary = {};
  if (!tree) return summary;
  for (const entry of tree.branches.values()) {
    summary[entry.action] = { status: entry.status, charCount: entry.charCount };
  }
  return summary;
}
