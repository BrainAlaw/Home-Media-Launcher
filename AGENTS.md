# Multi-Agent Workflow & Division of Labor

Due to context window limitations and architecture complexity, this project utilizes a multi-session AI workflow. Work is strictly partitioned into isolated domains to prevent code overwrite and logic conflicts.

If you are an AI agent reading this, verify your current assigned session/role and DO NOT modify files or dictate architecture outside your specific scope.

## Current Phase: Phase 3 (Sync & Launch Engine)

### Session 1: Backend Architecture (Data & Spawner)
- **Domain:** `/backend`, `/scripts`, Node.js child processes, filesystem interactions.
- **Responsibilities:**
  - Polling the remote Vibepollo server (Sunshine/Moonlight API) and aggressive local disk caching.
  - Offline state handling (`isVibepolloOffline: true`).
  - Process spawning (`child_process`) for native apps, Moonlight streams, and web browser instances.

### Session 2: Frontend UI/UX (Layouts & Motion)
- **Domain:** `/src/components`, CSS modules, layout views, animations.
- **Responsibilities:**
  - Building Apple HIG compliant layouts (e.g., Hero Banner, Menus).
  - Implementing spring-physics motion and glassmorphism styling.
  - Debouncing metadata updates during rapid spatial grid navigation.

### Session 3: Integration & IPC Glue Code
- **Domain:** `/src/hooks`, `preload.ts`, IPC bridges, type contracts, state management.
- **Responsibilities:**
  - Defining strict TypeScript interfaces bridging the backend and frontend.
  - Wiring Gamepad events from the UI to trigger backend IPC execution commands.
  - Managing application-level state (e.g., suspending UI rendering when a game process is actively running).

## Contract Rules
- Frontend components must assume the backend exposes functionality via a secure `window.api` object.
- Backend logic must emit structured events for the frontend to consume.
- Integration code defines the truth between the two.