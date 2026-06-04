# beya-sdk

Python product client for the Beya Gateway API.

The SDK is a pure client. It connects to a running Beya Gateway and wraps
Gateway capabilities as product resources instead of exposing raw routes as the
main interface.

## Install

```bash
pip install beya-sdk
```

For local development:

```bash
pip install -e packages/sdk-python
```

## Quick Start

```python
from beya import BeyaClient

client = BeyaClient(base_url="http://127.0.0.1:3456")

result = client.chat.run(
    "Review the current workspace and summarize risks",
    skill="code-review",
)

print(result.result)
```

## Streaming

```python
handle = client.tasks.submit("Explain this repository")

for event in client.tasks.stream(handle.task_id):
    print(event.type, event.message)
```

## Product Resources

```python
client.tasks.submit("Run a design check")
client.sessions.history("session-id")
client.providers.catalog()
client.providers.create({...})
client.models.current()
client.tools.execute("Read", {"file_path": "package.json"})
client.skills.use("code-review", "Review my changes")
client.plugins.enable("my-plugin", scope="project")
client.mcp.list()
client.workspace.list("session-id")
client.workspace.read("session-id", "README.md")
client.workspace.write("session-id", "notes.md", "content")
client.memory.files("project-id")
client.schedules.list()
client.diagnostics.export()
client.local.browse(path="F:/Documents/beya", search="README")
client.openai.create_chat_completion(
    [{"role": "user", "content": "hello"}],
    "beya",
)
```

`client.request(method, path, payload=None)` is available as an escape hatch for
new Gateway resources, but customer-facing code should prefer the product
resources above.

## CLI

```bash
beya submit "What changed in this workspace?" --wait
beya stream <task_id>
beya skills-list
beya skill-use code-review "Review this project"
beya plugins-list
beya providers-catalog
beya workspace-read <session_id> README.md
beya local-browse --path F:/Documents/beya --search README --include-files
```

## Notes

- Python 3.8+ is supported.
- The SDK does not start Beya and does not include the Beya runtime.
- Local and workspace operations are real Beya Gateway operations and keep the
  Gateway's permission and audit semantics.
