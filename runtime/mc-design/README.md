# MC Design Local Runtime Assets

This directory contains the local, project-owned assets for the mc-design
component-design agent. The goal is to keep the local chain independent of
cloud AI services, Kubernetes, and external business systems while still using
real local NX when it is available.

## Layout

- `knowledge/`: structured local knowledge base used directly by Beya server
  tools.
- `dependencies/resources/`: packaged mc-design runtime metadata and NX tool
  manifest.
- `dependencies/nx-plugin/`: NX11 plugin payload copied from the prior
  mc-design client install. It is a project-local dependency payload, not a
  generated build output.
- `dependencies/source-documents/`: original local plan and parameterization
  standard documents used to build the structured knowledge files.
- `dependencies/skills/`, `dependencies/tools/`, `dependencies/agents/`: prior
  mc-design agent-loop instructions kept as reference assets.
- `dependencies/templates/`: local NX template files used by the offline
  template library.

## NX Plugin Preparation

The NX plugin payload is stored in this project, but Siemens NX still needs its
`UGII/menus/custom_dirs.dat` file to reference the project-local
`dependencies/nx-plugin` directory before the plugin HTTP API can start.

Use the `mc_design_prepare_nx_plugin` tool to check or register that path. It
only writes `custom_dirs.dat` when called with `register: true` and
`confirmed: true`, and it creates a `.beya-mc-design.*.bak` backup before
replacing the managed mc-design block.

## Source Index

The initial assets were distilled or copied from:

- `E:\A0_Projects\A1_Dynamics_Design_LM\mc-design`
- `F:\Desktop\压缩包归档`
- `F:\Desktop\连杆2+图纸`

Do not point runtime tools back to those source paths. Tools should read this
directory first so the local chain is reproducible from this project checkout.
