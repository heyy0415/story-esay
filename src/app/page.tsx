"use client";

import { useCallback, useState } from "react";
import { useGame } from "@/lib/story/useGame";
import { IdeaForm } from "@/components/IdeaForm";
import { StatusPanel } from "@/components/StatusPanel";
import { StoryPanel } from "@/components/StoryPanel";
import { ConfigButton } from "@/components/ConfigButton";
import { ConfigDialog } from "@/components/ConfigDialog";

export default function Home() {
  const game = useGame();
  /** 用户主动点击打开；与游戏抛出的 needConfig 取并集决定是否展示 */
  const [manualOpen, setManualOpen] = useState(false);

  // 派生而非用 effect 同步：游戏因缺配置中断时自动展示表单
  const configOpen = manualOpen || game.needConfig;

  const closeConfig = useCallback(() => {
    setManualOpen(false);
    game.clearNeedConfig();
  }, [game]);

  const overlay = (
    <>
      <ConfigButton onClick={() => setManualOpen(true)} />
      <ConfigDialog open={configOpen} onClose={closeConfig} reason={game.configError} />
    </>
  );

  // 提前返回而非三元，让 TypeScript 能收窄掉 state 为 null 及 idle/creating 两个 phase
  if (!game.state || game.phase === "idle" || game.phase === "creating") {
    return (
      <>
        {overlay}
        <main className="flex min-h-screen items-center">
          <IdeaForm
            onStart={game.startGame}
            loading={game.phase === "creating"}
            error={game.error}
            progress={game.setupProgress}
            stage={game.setupStage}
          />
        </main>
      </>
    );
  }

  return (
    <>
      {overlay}
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8 lg:h-screen lg:flex-row">
        <StatusPanel state={game.state} lastStatChanges={game.lastStatChanges} onReset={game.reset} />
        <StoryPanel
          state={game.state}
          streamingText={game.streamingText}
          choices={game.choices}
          phase={game.phase}
          endingType={game.endingType}
          error={game.error}
          illustratingIndex={game.illustratingIndex}
          awaitingChars={game.awaitingChars}
          onAct={game.act}
          onReset={game.reset}
        />
      </main>
    </>
  );
}
