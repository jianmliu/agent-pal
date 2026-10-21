# dev-autopilot — gated dev/QA auto-play (NOT the product)

The **legacy AI loop**, extracted from `ai/` so it doesn't entangle with the AI-NPC
product runtime. This is a **dev/QA tool**, not part of the AI-NPC wedge.

- `ai-controller.ts` — a 500ms tick loop that, behind flags, can **auto-play the
  game for you** (`_decide*` / `_buildLLMPrompt` — the LLM drives the *player*) and
  dispatch the legacy `npc-behaviours` registry. Bootstrapped from `js/pal/main.ts`
  **only when** `enablePlayerAI` (`?ai=1` + `config.enableAIControl`) or
  `enableNPCBehaviours` is set — off by default.
- `ai-replay.ts` — records/replays adapter streams + actions for the autopilot.

## Not to be confused with the product NPC runtime

The AI-NPC product lives in `ai/` and is **event-driven, engine-neutral**:
`pal-npc-runtime` (`startPalNpcAgents`) → `pal-agent-adapter` → `@aigg/npc-agent`
(`LlmAgent` → structured `AgentIntent` → `EffectResolver` → memory). It is gated
separately by `?agents=1` (see `bootstrap-pal-agents.ts`).

| | dev-autopilot (here) | AI-NPC product (`ai/`) |
|---|---|---|
| Drives | the **player** (auto-play) | **NPCs** (dialogue + effects) |
| Loop | 500ms tick polling | event-driven (perceptions) |
| Output | game action enum | structured `AgentIntent` |
| Gate | `?ai=1` | `?agents=1` |
| Status | legacy / dev-only | the wedge |
