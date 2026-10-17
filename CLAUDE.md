# Project: Home Media Launcher
Repository: https://github.com/BrainAlaw/Home-Media-Launcher

## 1. The Grand Vision
Home Media Launcher is the ultimate custom, local-first, ad-free HTPC and living room console dashboard. It is designed primarily for Linux, with Windows support. 
The design philosophy merges the premium, fluid aesthetics of Apple's tvOS (Apple HIG, glassmorphism, spring-physics motion) with the tactile, game-centric utility of modern handhelds like the Steam Deck. It is built to replace corporate, ad-ridden alternatives by offering zero bloat, instant cold starts, and ultimate customization.

## 2. Core Pillars & Tech Stack
- **Input Paradigm:** Strictly Gamepad-first (HTML5 Gamepad API) and keyboard. Mouse interaction is secondary and not required.
- **Performance Engine:** Must maintain 60-120fps on low-power HTPC hardware. The UI relies on a custom 2D Spatial Virtualized Grid to handle 1000+ items without DOM lag.
- **Ecosystem Integration:** Deep integration with the remote **Vibepollo backend** (Sunshine/Moonlight APIs synced via Playnite) for game streaming, alongside support for launching native binaries and fullscreen web apps.
- **Offline Resilience:** Aggressive local caching of Vibepollo metadata and background assets (fanart, icons). The UI gracefully degrades with a subtle "Vibepollo Offline" indicator when the remote host server is unreachable.
- **Visuals:** CSS Custom Properties-driven Theme Engine, dynamic background slideshows, and physics-based focus animations.

## 3. Universal AI Directives
- **Zero Telemetry & Local First:** Never implement external tracking or unnecessary cloud dependencies.
- **Non-Blocking Architecture:** Heavy backend tasks (polling, file I/O, process spawning) must never block the frontend rendering loop. Use asynchronous IPC bridges.
- **Language & Standards:** 
  - Keep code clean, strictly typed (TypeScript preferred), and highly modular.
  - All code, variables, and inline comments MUST be strictly in English.
  - Use UK spelling in user-facing documentation where applicable.

## 4. Agent Orchestration & Anti-Token-Bleed Rules
To prevent extreme API costs, context pollution, and Git merge conflicts, the following multi-agent execution constraints are **strictly mandatory**:
- **Strict Sequential Queue (No Parallelization):** Running multiple execution agents concurrently is kategorycznie forbidden. Tasks must be executed in a strict linear queue (FIFO).
- **Task Consolidation:** Never spawn micro-agents for single prompts or tiny adjustments (e.g., small CSS tweaks, individual button radiuses). Group related sub-tasks into a single, long-lived domain agent (e.g., one unified agent for all Spotify/Music tasks instead of separate sessions for auth, UI, and widgets).
- **The Lifecycle Loop:** A sub-agent must complete its task, output its diff, and the coordinator must merge the branch *before* the next queued agent is allowed to spin up.
- **Prompt Caching Optimization:** Ensure the repository state remains stable during a sub-agent's lifecycle to maximize Anthropic's Prompt Caching efficacy. Do not trigger global workspace unifications mid-task.
- **Ignored Paths:** Always respect the `.claudecodeignore` file. Never scan, index, or pipe binary assets, heavy graphics, pre-built distribution folders (`dist/`, `build/`), or node modules into the LLM context.
