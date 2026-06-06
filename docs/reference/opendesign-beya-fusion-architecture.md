# Open Design + Beya Fusion Architecture

## Summary

Fuse the Open Design agent-platform project with this Beya product by making Beya the single real runtime kernel and Open Design the platform workbench for authoring, inspecting, publishing, and debugging that kernel.

This must not become two products glued by iframes. The fused product should have one runtime, one provider system, one skill/plugin/resource store, one release pipeline, and one desktop shell.

## Product Goal

The fused platform should let a user design and operate real Beya artifacts:

- Publishable artifacts include desktop, CLI, SDK, sidecar, and local server.
- The product remains runnable through the existing local server and desktop app.
- Open Design surfaces can author Skills, plugins, resources, workflows, runtime profiles, and release metadata.
- Debugging uses real sessions, tool calls, traces, patches, diagnostics, and provider results.
- Model/provider configuration is the current Beya provider system, not a parallel model registry.
- UI merges the Open Design workbench visual quality with Beya's complete functional surface.

## Source Of Truth

### Runtime

Beya server is the runtime source of truth.

Current Beya sources:

- `src/server/*`
- `src/tools/*`
- `src/services/runtimePluginTools.ts`
- `src/server/services/sessionRuntimeSurface.ts`
- `src/server/api/providers.ts`
- `src/server/api/models.ts`
- `src/server/api/skills.ts`
- `src/server/api/plugins.ts`
- `src/server/api/tools.ts`
- `packages/sdk-python/*`
- `bin/beya`

Open Design's `backend/server.mjs` and `runtime-data/*` should be treated as seed fixtures and protocol examples, not a second production backend.

### UI

The desktop React app should be the production shell.

Open Design's static pages should be mined for:

- design tokens
- layout density
- navigation shape
- workbench cards
- runtime/agent/skill/plugin/model page IA
- visual treatment for debugging and authoring surfaces

They should not remain as a separate static app after migration.

### Provider

The provider source of truth is Beya's provider runtime:

- saved providers
- provider catalog
- active provider/model
- auth status
- provider test
- official OpenAI OAuth path
- managed provider settings

Open Design `runtime-data/models.json` becomes a display/seed layer that maps to `/api/models`, `/api/providers`, and `/api/providers/catalog`.

### Skill / Plugin / Resource

Real authoring targets are Beya's existing on-disk and plugin-managed surfaces:

- user/project Skills
- installed plugins
- runtime plugin tools
- MCP/plugin resources
- project resources and attachments where already supported

Open Design objects should compile into these surfaces or into patch drafts that modify these surfaces.

## Target Architecture

```text
desktop React shell
  ├─ Chat / sessions / workspace / settings
  ├─ Platform Studio
  │   ├─ Agents
  │   ├─ Runtime Profiles
  │   ├─ Skills
  │   ├─ Plugins
  │   ├─ Resources
  │   ├─ Models / Providers
  │   ├─ Debug Traces
  │   └─ Publishing
  └─ Shared design system

src/server
  ├─ existing Beya APIs
  ├─ Open Design compatibility APIs
  │   ├─ runtime-prototypes
  │   ├─ runtime-profiles
  │   ├─ runtime-contracts
  │   ├─ capability-registry
  │   ├─ context-compose
  │   ├─ platform-projects
  │   └─ publishing
  └─ runtime kernel
      ├─ sessions/conversations
      ├─ tools
      ├─ skills/plugins
      ├─ providers/models
      ├─ filesystem/worktree/diff
      └─ diagnostics

packages/sdk-python
  └─ same server contract exposed to external automation

bin/beya / release scripts
  └─ build and ship desktop + CLI + SDK + server bundle
```

## Compatibility API Layer

Add an explicit Open Design adapter API under the current server, not a second server.

Suggested routes:

```text
GET  /api/platform/runtime-prototypes
GET  /api/platform/runtime-prototypes/:id
GET  /api/platform/agents/:agentId/runtime-profile
PATCH /api/platform/agents/:agentId/runtime-profile
POST /api/platform/agents/:agentId/runtime-profile/compile
GET  /api/platform/agents/:agentId/runtime-contract
GET  /api/platform/agents/:agentId/capability-registry
POST /api/platform/agents/:agentId/context/compose
GET  /api/platform/debug/sessions/:sessionId/trace
POST /api/platform/publishing/build
```

The adapter maps Open Design concepts to current Beya surfaces:

| Open Design Concept | Beya Source |
| --- | --- |
| RuntimePrototype | predefined runtime strategy registry backed by Beya execution modes |
| RuntimeProfile | agent runtime config stored as managed platform config |
| RuntimeContract | compiled schema summary from tools, skills, plugins, provider, permissions |
| RuntimeInputEnvelope | conversation/session request plus cwd, model, tools, skills, workspace |
| PlatformOutputStream | Beya conversation events, tool events, diagnostics, patch/worktree cards |
| Capability Registry | `sessionRuntimeSurface`, `/api/tools`, `/api/skills`, `/api/plugins`, `/api/models` |
| Context Composer | Beya prompt assembly and provider/runtime metadata |
| Problem | diagnostics, tasks, quality reports, future issue/problem store |
| Patch | current diff/worktree/edit surfaces |

## Runtime Prototype Mapping

Initial runtime prototypes should compile to Beya runtime behavior, not independent workflow engines.

```text
beya-autonomous
  -> current agent loop with planning, tool execution, patch/diff, verification, handoff

plan-exec
  -> plan-first execution mode over current session + tools

react-tool-loop
  -> current tool orchestration surface, exposed as a strategy description first

reflect
  -> verification/review pass using existing quality gates, diagnostics, and handoff rules
```

First implementation can return compiled contracts and run through the existing Beya conversation/session APIs. Later phases can add richer per-prototype execution controls.

## Platform Studio UI

Add a Platform Studio area inside `desktop/`, using Open Design's visual system but Beya's data.

Recommended navigation:

```text
Agents
Runtime
Skills
Plugins
Resources
Models
Debug
Publishing
Governance
```

Do not fork the whole shell. Reuse:

- `AppShell`
- `Sidebar`
- `ContentRouter`
- shared buttons/inputs/modals
- stores and API client conventions
- existing provider/settings/skill/plugin pages where possible

Open Design visual qualities to import:

- denser workbench layout
- stronger page hierarchy
- grouped object cards
- right rail assistant/capability inspector
- runtime cards and trace/event presentation
- softer surface layering from the platform design system

## Authoring Model

Skill/plugin/resource authoring should use a draft-first safety model by default.

Preferred first version:

```text
Platform Studio edit
  -> server validates target and schema
  -> server produces patch draft
  -> user reviews diff
  -> confirmed apply writes real files
  -> reload plugins/skills for active session if requested
```

Direct writes can be allowed later for explicitly trusted local-only project mode.

## Publishing Model

Publishing should call the existing release and delivery surfaces rather than creating a new packager.

First publishing targets:

- desktop web build
- Tauri desktop package when native toolchain exists
- CLI bundle from `bin/beya`
- server bundle
- Python SDK package
- release notes and manifest

Server API should expose a publishing plan first, then build on confirmation.

Suggested first route:

```text
POST /api/platform/publishing/plan
POST /api/platform/publishing/build
```

This should wrap current scripts such as:

- `scripts/delivery/build.ts`
- `scripts/sdk/build.ts`
- `scripts/sdk/pack.ts`
- `scripts/release.ts`
- existing quality gates

## Debugging Model

Debugging should show real runtime facts:

- session timeline
- model/provider selection
- prompt/context summary
- tool calls and results
- permission prompts
- worktree changes
- diagnostics
- failed checks
- patch draft/apply state
- quality gate evidence

Open Design's debug and workflow pages should become views over these facts, not simulated workflows.

## Data Migration

Treat the Open Design project directory as an import source.

Import candidates:

- `DESIGN.md` -> theme/design-system preset
- `runtime-data/runtime-prototypes.json` -> seed runtime prototype registry
- `runtime-data/models.json` -> seed display mapping, then resolve against Beya providers/models
- `runtime-data/skills.json` -> draft Skills
- `runtime-data/plugins.json` -> draft plugins or plugin metadata
- `runtime-data/resources.json` -> platform resource records
- `docs/beya-code/*` -> product docs and runtime architecture references

Do not keep `backend/server.mjs` as production code after migration.

## Rollout Phases

### Phase 0: Architecture Lock

Deliverables:

- this architecture spec
- decision record for storage, authoring authority, and UI migration strategy
- changed-surface impact matrix

Verification:

- no product code changes required

### Phase 1: Server Compatibility Layer

Deliverables:

- `/api/platform/runtime-prototypes`
- `/api/platform/agents/:agentId/runtime-profile`
- `/api/platform/agents/:agentId/runtime-contract`
- `/api/platform/agents/:agentId/capability-registry`
- focused server tests

Verification:

- `bun run check:server`

### Phase 2: Platform Studio Read-Only UI

Deliverables:

- desktop Platform Studio route
- runtime prototype cards
- capability registry page
- provider/model page backed by current Beya provider APIs
- Open Design visual token integration

Verification:

- `bun run check:desktop`
- browser smoke for Platform Studio

### Phase 3: Draft Authoring

Deliverables:

- Skill authoring -> patch draft
- plugin scaffold authoring -> patch draft
- resource records -> managed project store
- review/apply flow
- reload active runtime after confirmed apply

Verification:

- `bun run check:server`
- `bun run check:desktop`
- `bun run check:persistence-upgrade` if storage shape changes

### Phase 4: Live Runtime Execution

Deliverables:

- runtime input envelope
- context composer backed by Beya prompt assembly
- PlatformOutputStream mapper from existing session/tool events
- debug trace view

Verification:

- mock runtime tests
- `bun run quality:baseline` for agent-loop paths when feasible

### Phase 5: Publishing

Deliverables:

- publish plan UI
- build orchestration API
- desktop/CLI/server/SDK manifest
- artifact evidence panel

Verification:

- delivery build check
- SDK check
- desktop/native gates where environment allows
- release dry run for release candidates

## Decisions Needed

1. Storage authority:
   - A. platform configs live in repo/project files and are versioned
   - B. platform configs live in Beya managed app storage
   - C. hybrid: definitions versioned, secrets/local runtime state managed

   Recommended: C.

2. Authoring authority:
   - A. Platform Studio writes files directly
   - B. Platform Studio creates patch drafts and requires confirmation
   - C. direct writes only in trusted local mode, otherwise draft-first

   Recommended: C, with B as initial implementation.

3. UI migration:
   - A. embed Open Design static app inside desktop
   - B. rewrite Open Design pages as desktop React surfaces using existing APIs
   - C. temporary embed only for visual reference, then replace with native desktop surfaces

   Recommended: C.

4. Runtime contract scope:
   - A. contracts are descriptive first
   - B. contracts actively route execution from day one

   Recommended: A first, then promote selected fields to execution control.

5. Publishing authority:
   - A. platform can run local builds directly
   - B. platform only generates release plans and scripts
   - C. local builds require explicit confirmation and show quality evidence

   Recommended: C.

6. Provider policy:
   - A. Open Design can define separate model registry
   - B. Open Design only reads/writes Beya providers/models

   Recommended: B.

## First Implementation Slice

The first safe implementation slice should be Phase 1, not a UI rewrite.

Concrete files likely touched:

- `src/server/router.ts`
- `src/server/api/platform.ts`
- `src/server/services/platformRuntimeService.ts`
- `src/server/__tests__/platform-runtime.test.ts`
- `desktop/src/api/platform.ts` only if Phase 2 starts

First API behavior:

- return four runtime prototypes
- compile a default `beya-autonomous + reflect` runtime profile
- expose real tool/skill/plugin/model capability registry using existing services
- map Beya provider catalog into Open Design model descriptors

This creates the contract that both desktop UI and future SDK calls can use.

## Risks

- Deep UI merge before API alignment will create two incompatible products.
- Direct Skill/plugin writes without patch review can corrupt user-owned config.
- Treating Open Design `runtime-data` as production storage will fork the source of truth.
- Making RuntimePrototype a workflow engine too early will duplicate the current agent loop.
- Provider divergence will break live model behavior and diagnostics.

## Acceptance Criteria

The fusion is real when:

- Platform Studio shows real Beya agents, providers, skills, plugins, tools, sessions, traces, and worktree state.
- A Skill designed in Platform Studio becomes a real Beya Skill visible to CLI/server/desktop.
- A plugin designed in Platform Studio becomes a real installed/scaffolded plugin.
- Runtime profile compilation uses current Beya capabilities, not mock JSON.
- Publishing produces the same desktop/CLI/server/SDK artifact family as the current project.
- The old Open Design static backend is no longer required for normal operation.
