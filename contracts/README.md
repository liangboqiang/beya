# Beya Contract System

`contracts/` is the single protocol and architecture contract source. It stores
YAML contracts plus JSON meta-schemas; production routing, generated clients,
event names, module registries, and executor bindings must be derived from this
directory.

## Directory Layout

```text
contracts/
  gateway/v1/rpc.yaml
  session/v1/live.yaml
  runtime/v1/bridge.yaml
  resources/v1/resources.yaml
  events/v1/session-events.yaml
  modules/*/v1/module.yaml
  capabilities/v1/registry.yaml
  executors/v1/runtime.yaml
  meta/
    protocol.schema.json
    module.schema.json
    capability.schema.json
    executor.schema.json
```

## Rules

- Public transport contracts live under `gateway/`, `session/`, `runtime/`,
  `resources/`, and `events/`.
- Module ownership lives under `modules/*/v1/module.yaml`.
- Tool, skill, plugin, agent, and workflow capability declarations live under
  `capabilities/`.
- Agent/workflow/capability dispatch bindings live under `executors/`.
- Resource methods must declare owner module, request/response schema, handler
  binding, client exposure, and auth policy.
- New resource, event, runtime, or session messages must be added here before
  production code uses their names.

Run:

```bash
bun run contracts:lint
bun run contracts:generate
bun run contracts:check
```

Generated outputs are written to:

- `src/generated/contracts/*`
- `src/generated/modules/*`
- `src/generated/executors/*`
- `desktop/src/generated/resources/*`
- `packages/sdk-python/src/beya/generated/*`
