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