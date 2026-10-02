# 归档区（legacy）

这里的东西**都已废弃**：不在任何测试、CI、构建路径里，也不会被应用加载。留着只有一个理由——它们记录了**为什么**这样设计，避免后来人重跑一遍已经做完的调研、或者把当年的弯路当成新想法再走一遍。

> 提问「我该照哪个做？」的默认答案：**都不照**。见下面「现在什么是真的」。

## 现在什么是真的

| 你要做的事 | 唯一真相 |
|---|---|
| 让 Claude Code / Codex 等编程 agent 操作一份实例 | [`skills/mediary-scout/SKILL.md`](../../skills/mediary-scout/SKILL.md)（走本地 HTTP Agent API，见 [docs/agent-api.md](../agent-api.md)） |
| 看获取 agent 在 loop 里遵守什么纪律 | [`packages/workflow/src/acquisition-v2/skill.ts`](../../packages/workflow/src/acquisition-v2/skill.ts)（分节、按需 `readSkill` 加载） |
| 看这些纪律怎么被**强制**而不是劝说 | [`packages/workflow/src/acquisition-v2/sandbox.ts`](../../packages/workflow/src/acquisition-v2/sandbox.ts) |
| 看产品/工作流设计取舍 | [docs/workflow-product-architecture.md](../workflow-product-architecture.md)、[docs/architecture.md](../architecture.md) |

## `clawd-media-track-python/` 是什么

2026-06 之前的形态：仓库根一个 `SKILL.md` + `references/00–08`，外部 agent（openclaw / Claude Code）按 checklist 直接 `import scripts/pan115_client.py`（基于 `p115client`）、手填 `MOVIES_CID` / `TV_SHOWS_CID`、自己执行转存与 `flatten_directory()`。

它**没有被 TS 引擎删掉的那部分知识**（搜索配方、去重与季切分策略、错误/风控处理纪律、目录安全红线）已经逐条翻译进 V2 skill；被换掉的是**执行机制**：

| 旧（Python 技能） | 新（TS V2 引擎） |
|---|---|
| agent 直接拿到 share URL、CID、cookie | 句柄化：`{id, title}` + `CandidateRegistry` 旁路，raw URL/cid/凭证不进上下文 |
| 靠 checklist 文字「要求」agent 复验 | `force-reread`：每个写操作后系统重读网盘真实状态再返回 |
| `SAFETY_VIOLATION` → 停下报告 | guard 拒绝变成 `{error}` **证据**回喂模型，loop 不中断 |
| 人工按 Type 1/2/3 逐步确认 | 同一语义变成 `WorkflowKind`（type1_package_init / type2_init / type3_monitor / movie_init / replace_request / staging_recovery），入队由进程内 worker 执行 |
| 只有 115 | 115 / 夸克 / 光鸭 / 123 / 天翼，能力差异走 optional 方法门（如字幕） |
| 步数硬上限 | 重复无进展熔断 + 预算软/硬双阈值 + 收尾 nudge（`agent-loop-guards.ts`） |

`tests/*.py` + `requirements.txt` 随该技能一起归档：它们测的是 `scripts/*_client.py` 这套旧 Python 客户端，`vitest.config.ts` 从来不含它们，CI 也从没有 Python 步骤。想跑就在本目录 `python -m unittest discover -s tests`（需自建 `.venv` 装 `p115client`），但**没有绿灯保证**。

## 想恢复某条老规则？

先确认 V2 skill 里是否已有等价物（多数有，措辞更硬）。确实缺失的，改 `acquisition-v2/skill.ts` 并配一条 sandbox 测试——不要复活 Python 执行面。
