# StoryEasy

输入一句话创意，AI 生成一个可玩的文字互动故事：世界设定、角色属性、分支剧情与写实场景插图全部由模型实时生成，每个选择都会改变结局。

## 使用说明

本站不提供模型额度。首次点击「开始冒险」时会引导填写配置，也可随时点右上角按钮修改：

| 字段 | 必填 | 说明 |
|---|---|---|
| API Key | 是 | 任意 OpenAI 兼容服务的 key |
| 模型名 | 是 | 如 `gpt-4o-mini` / `deepseek-chat` |
| Base URL | 否 | 留空走 OpenAI 官方；中转网关注意是否需要 `/v1` 后缀 |

配置保存在浏览器 localStorage，随每次请求发往 Route Handler 代理模型调用。**服务端不持有、不留存任何密钥**，因此部署时无需配置模型相关环境变量，公开演示也不会消耗站点方的额度。

插图走免费的 Pollinations，不需要 key；

1. 输入一句话创意（例："魔教余孽潜入正派扫地，悟出绝学后揭穿正邪之分不过是掩盖血案的谎言"）
2. 等待约 20-40 秒构建世界，期间显示真实进度百分比
3. 进入游戏，图文同时呈现
4. 点击选项推进剧情，最多 15 回合，属性归零或剧情收束时进入结局

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router） |
| 语言 | TypeScript（strict） |
| 样式 | Tailwind CSS v4 |
| 校验 | Zod |
| 模型调用 | OpenAI SDK（兼容任意 OpenAI 协议服务） |
| 文生图 | Pollinations（免费，无需 key） |

依赖仅 5 个运行时包，约 2000 行源码。

## 架构

```
┌─────────────────────── 客户端 ───────────────────────┐
│                                                      │
│  useGame (状态机)                                     │
│    ├── prefetch.ts   分支树：并发预取下一回合全部选项      │
│    ├── image-warm.ts 图片串行队列 + 预热                │
│    └── localStorage  存档 + 模型配置（BYOK）             │
│                            │                         │
└────────────────────────────┼─────────────────────────┘
                             │ GameState + 模型配置随请求回传
┌────────────────────────────┼─────────────────────────┐
│  Route Handlers（全部无状态）                          │
│    /api/story/setup      开局生成（JSON）              │
│    /api/story/turn       回合推进（SSE 流式）           │
│    /api/story/illustrate 插图 prompt → 图片 URL        │
└──────────────────────────────────────────────────────┘
```

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000 ，在右上角填入模型配置即可。

## 目录结构

```
src/
├── app/
│   ├── api/story/
│   │   ├── setup/route.ts       开局生成（非流式，含 schema 校验与重试）
│   │   ├── turn/route.ts        回合推进（SSE，正文+元数据分隔协议）
│   │   └── illustrate/route.ts  插图 prompt → 图片 URL（失败静默降级）
│   └── page.tsx                 首页/游戏页切换
├── components/
│   ├── IdeaForm.tsx             创意输入 + 构建进度
│   ├── ConfigButton.tsx         右上角配置入口（订阅 localStorage）
│   ├── ConfigDialog.tsx         模型配置表单
│   ├── StatusPanel.tsx          属性条 / 物品栏 / 回合进度
│   ├── StoryPanel.tsx           叙事流 + 选项 + 自由输入
│   └── Illustration.tsx         插图（带进度与降级）
└── lib/
    ├── config/                  模型配置 schema 与 localStorage 存取
    ├── ai/provider.ts           模型适配层（按请求配置创建 client）
    ├── story/
    │   ├── schema.ts            Zod schema，所有边界数据的契约
    │   ├── prompts.ts           prompt 构建 + 历史摘要压缩
    │   ├── client.ts            前端请求封装 + SSE 消费
    │   ├── prefetch.ts          分支树：预取、取消、生命周期
    │   ├── image.ts             图片 URL 构建 + 稳定 seed
    │   ├── image-warm.ts        图片串行队列 + 预热 + 重试
    │   └── useGame.ts           状态机 + 存档
    ├── rate-limit.ts            分桶滑动窗口限流
    └── useCreepingProgress.ts   时间驱动进度爬升
```
