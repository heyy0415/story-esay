"use client";

import { useGame } from "@/lib/story/useGame";
import { IdeaForm } from "@/components/IdeaForm";
import { StatusPanel } from "@/components/StatusPanel";
import { StoryPanel } from "@/components/StoryPanel";

export default function Home() {
  const game = useGame();

  if (!game.state || game.phase === "idle" || game.phase === "creating") {
    return (
      <main className="flex min-h-screen items-center">
        <IdeaForm onStart={game.startGame} loading={game.phase === "creating"} error={game.error} />
      </main>
    );
  }

  return (
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
        onAct={game.act}
        onReset={game.reset}
      />
    </main>
  );
}
