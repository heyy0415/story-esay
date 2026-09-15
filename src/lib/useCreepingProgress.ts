"use client";

import { useEffect, useState } from "react";

/**
 * 时间驱动的进度爬升。
 *
 * 文生图服务是一次 GET 返回整张图，过程中没有任何进度回传，且耗时的绝大部分
 * 在服务端排队与生成（字节要到最后一两秒才下来）。因此无法给出真实进度。
 *
 * 这里按实测耗时做时间驱动的爬升：不反映真实进度，但准确传达"大约还要多久"，
 * 这是玩家真正关心的信息。爬到封顶后停住并由调用方改文案，不假装马上完成。
 *
 * @param active 是否正在进行中。false 时进度归零
 * @param expectedMs 预期总耗时，据此换算爬升速度
 * @param ceiling 封顶百分比，留给真实完成事件跳到 100
 * @returns [显示百分比, 是否已封顶]
 */
export function useCreepingProgress(active: boolean, expectedMs: number, ceiling = 95): [number, boolean] {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!active) return;

    // 每 500ms 走一步，据预期耗时算步长，使爬到封顶恰好约等于预期耗时
    const TICK_MS = 500;
    const step = (ceiling * TICK_MS) / expectedMs;

    const timer = setInterval(() => {
      setPercent((p) => Math.min(p + step, ceiling));
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      setPercent(0);
    };
  }, [active, expectedMs, ceiling]);

  return [Math.round(percent), percent >= ceiling];
}
