import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from beya import AsyncBeyaClient, BeyaClient


class RecordingClient(BeyaClient):
    def __init__(self):
        super().__init__(base_url="http://beya.test")
        self.calls = []

    def _request(self, method, path, payload=None, timeout=None):
        self.calls.append((method, path, payload))
        if path == "/api/tasks" and method == "POST":
            return {
                "task_id": "task-1",
                "workflow_id": "task-1",
                "session_id": "session-1",
                "status": "QUEUED",
            }
        if path == "/api/tasks/task-1" and method == "GET":
            return {
                "task_id": "task-1",
                "workflow_id": "task-1",
                "session_id": "session-1",
                "query": "hello",
                "status": "COMPLETED",
                "result": "done",
            }
        if path.startswith("/api/tasks/task-1/events"):
            return {"events": []}
        if path == "/v1/chat/completions":
            return {
                "id": "chatcmpl-1",
                "object": "chat.completion",
                "created": 0,
                "model": "beya",
                "choices": [],
            }
        return {"ok": True, "path": path}

    def _stream_sse(self, path, payload=None, timeout=None):
        self.calls.append(("STREAM", path, payload))
        yield {
            "type": "LLM_PARTIAL",
            "task_id": "task-1",
            "workflow_id": "task-1",
            "session_id": "session-1",
            "message": "hello",
            "timestamp": "now",
            "seq": 1,
            "stream_id": "1",
        }


class ProductClientTest(unittest.TestCase):
    def test_product_resources_use_canonical_api_paths(self):
        client = RecordingClient()

        handle = client.chat.run("hello")
        self.assertEqual(handle.result, "done")
        client.tasks.events("task-1", types=["LLM_PARTIAL"])
        client.sessions.list()
        client.sessions.history("session-1")
        client.providers.catalog()
        client.providers.activate("openai")
        client.models.current()
        client.tools.execute("Read", {"file_path": "package.json"})
        client.skills.use("code-review", "review this")
        client.plugins.enable("plugin-a", scope="project")
        client.plugins.reload(session_id="session-1")
        client.mcp.list()
        client.workspace.list("session-1")
        client.workspace.write("session-1", "notes.txt", "hello")
        client.memory.files("project")
        client.agents.list()
        client.teams.list()
        client.schedules.list()
        client.diagnostics.export()
        client.settings.permission_mode()
        client.local.browse(path="F:/Documents/beya", search="README")
        client.openai.create_chat_completion([{"role": "user", "content": "hi"}], "beya")

        paths = [path for _method, path, _payload in client.calls]
        self.assertTrue(paths)
        legacy_marker = "/api/" + "v1"
        self.assertFalse(any(legacy_marker in path for path in paths))
        self.assertIn("/api/tasks", paths)
        self.assertIn("/api/providers/catalog", paths)
        self.assertIn("/api/plugins/enable", paths)
        self.assertIn("/api/scheduled-tasks", paths)
        self.assertIn("/v1/chat/completions", paths)

    def test_stream_parser_returns_events(self):
        client = RecordingClient()
        events = list(client.tasks.stream("task-1"))
        self.assertEqual(events[0].type, "LLM_PARTIAL")
        self.assertEqual(client.calls[0][1], "/api/stream/sse?task_id=task-1")

    def test_async_client_exposes_product_resources(self):
        async def run():
            client = AsyncBeyaClient(base_url="http://beya.test")
            self.assertTrue(hasattr(client, "tasks"))
            self.assertTrue(hasattr(client, "workspace"))
            await client.close()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
