---
name: clawd-media-track
description: "Resource tracking and acquisition workflow for media resources. MUST use when the user asks to get, add, track, monitor, search, acquire, transfer, or initialize movies, TV shows, anime, Pansou resources, or 115 cloud storage items with the clawd-media-track system. For every clawd-media-track task: first read mandatory references in order, identify task type (Type 1/2/3), output step-labeled checkpoints, wait for explicit user confirmation before any side-effecting action, and verify side effects after execution."
---

# clawd-media-track Skill

> ⚠️ **DEPRECATED / 已废弃（2026-10 起归档）**
>
> 这是 **Python 版**技能：让外部 agent 直接 `import scripts/pan115_client.py`、手填 CID、自己调 `flatten_directory()`。
> 它已被 **TS V2 sandbox 引擎**取代：同样的证据规则、Type 1/2/3 语义、去重与字幕纪律，全部翻译进
> [`packages/workflow/src/acquisition-v2/skill.ts`](../../../packages/workflow/src/acquisition-v2/skill.ts)，
> 由 `packages/workflow/src/acquisition-v2/sandbox.ts` 以工具句柄强制执行（agent 拿不到 raw URL / cid / 凭证）。
>
> **不要照本文件行事**：文中的 `./.venv/bin/python`、`requirements.txt`、`SAFETY_VIOLATION` 路径都不再受任何测试或 CI 覆盖。
> 现在对外的 agent 操作面只有 [`skills/mediary-scout/SKILL.md`](../../../skills/mediary-scout/SKILL.md)（本地 HTTP API）。
> 保留原因与逐条对照见 [docs/legacy/README.md](../README.md)。

## FIRST ACTIONS (MANDATORY)

Before any clawd-media-track reasoning or tool use:

1. Read `references/00-bootstrap-init.md`
2. Check whether bootstrap is complete
3. If bootstrap is incomplete, stay in init mode and do not enter Type 1 / 2 / 3 yet
4. If bootstrap is complete, read `references/01-environment-contract.md`
5. Read `references/02-global-constraints.md`
6. Read `references/03-methods-reference.md`
7. Determine whether the task is **Type 1**, **Type 2**, or **Type 3**
8. Read the matching type checklist
9. Output the current checkpoint as `[Type X - Step N]`
10. **STOP and wait for user confirmation before any side-effecting action**

**DO NOT:**
- skip mandatory references
- guess the task type
- claim "no resource" before query completion/retry
- execute transfer/create/delete/mark actions without explicit user confirmation
- skip post-action verification

## Critical Safety Notes

This system can make destructive or rate-limit-sensitive 115 calls if used carelessly.

Read the references in order and follow the checklist for the current task type.
Do not improvise around them.

In particular:

- Directory targets come from environment-backed CID configuration, not guesswork.
- `flatten_directory()` is only valid on final landing directories:
  - movie leaf directories directly under `MOVIES_CID`
  - season leaf directories ending with `Season <number>`
- Root/media/category directories are protected and must never be used as flatten targets.
- `list_files()` is shallow by default. Recursive scans on protected directories are blocked for safety.
- If a method raises `SAFETY_VIOLATION`, stop and report the exact target/path instead of retrying with guesses.
- Code-level guardrails are a backstop, not a substitute for reading the checklist and choosing the correct target.

This skill is split for progressive loading.

Read only what is needed, but never skip required safety/rules for the current task type.

## Mandatory Reading Order

For any clawd-media-track task, read in this order:

1. `references/00-bootstrap-init.md` (init gate for bootstrap Step 1 and Step 2)
2. `references/01-environment-contract.md` (required config contract after bootstrap)
3. `references/02-global-constraints.md` (hard safety rules + execution protocol)
4. `references/03-methods-reference.md` (allowed module methods only)

Then route by task type:

- **Type 1** (one-time acquisition: movies / completed series): read `references/05-type1-checklist.md`
- **Type 2** (tracking initialization: ongoing/incomplete): read `references/06-type2-checklist.md`
- **Type 3** (scheduled monitoring / cron): read `references/07-type3-checklist.md`

Read additional references when needed:

- Error handling, retries, dedup, season split strategy: `references/04-error-and-dedup-rules.md`
- Directory structure and common mistakes: `references/08-directory-and-mistakes.md`

## Non-Negotiable Rules (Always Enforced)

- **MUST** follow: Evidence → Derived Facts → Decision before every critical action
- **MUST** process protected collections with `.each()`; **DO NOT** slice/sample/top-N them
- **MUST NOT** use glue scripts, regex helpers, or ad-hoc string parsing to make decision logic
- **MUST** execute Type 3 Step 3b (missing-vs-existing coverage branch) without skipping
- **MUST** bind transfer URLs once and execute via bound variable(s); **DO NOT** re-extract between decision and transfer
- **MUST** verify side effects (transfer/delete/mark/create) with re-read checks
- **MUST** treat any skipped rule as task failure and report honestly

If any hard rule is violated, stop and report failure instead of improvising.

## Execution Context

- Project directory: skill repo root
- Python runtime: `./.venv/bin/python`
- Auth/config: constructors read environment-backed config; do not hardcode cookies, tokens, base URLs, or CIDs in the skill

## File Map

- `references/00-bootstrap-init.md`
- `references/01-environment-contract.md`
- `references/02-global-constraints.md`
- `references/03-methods-reference.md`
- `references/04-error-and-dedup-rules.md`
- `references/05-type1-checklist.md`
- `references/06-type2-checklist.md`
- `references/07-type3-checklist.md`
- `references/08-directory-and-mistakes.md`

## Migration Note

This refactor keeps original procedural content but routes detailed material into references for reliability and context efficiency.
