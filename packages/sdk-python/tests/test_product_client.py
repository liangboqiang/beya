import asyncio
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from beya import AsyncBeyaClient, BeyaClient, ConnectorToolExecutor, RemoteToolExecutor, define_plugin, define_skill, define_tool


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
        if path == "/api/openai/chat/completions":
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
        client.tasks.list()
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
        client.health()
        client.readiness()
        client.openai.create_chat_completion([{"role": "user", "content": "hi"}], "beya")

        paths = [path for _method, path, _payload in client.calls]
        self.assertTrue(paths)
        legacy_marker = "/api/" + "v1"
        self.assertFalse(any(legacy_marker in path for path in paths))
        self.assertIn("/api/tasks", paths)
        self.assertTrue(any(path.startswith("/api/tasks?kind=agent") for path in paths))
        self.assertIn("/api/providers/catalog", paths)
        self.assertIn("/api/plugins/enable", paths)
        self.assertIn("/api/scheduled-tasks", paths)
        self.assertIn("/api/health", paths)
        self.assertIn("/api/readiness", paths)
        self.assertIn("/api/openai/chat/completions", paths)
        self.assertFalse(any(path.startswith("/v1/") for path in paths))

    def test_plugin_helpers_generate_installable_plugin_payload(self):
        client = RecordingClient()
        tool = define_tool(
            name="remote_echo",
            description="Remote echo",
            input_schema={"type": "object", "properties": {"message": {"type": "string"}}},
            executor=RemoteToolExecutor(url="http://127.0.0.1:8000/tools"),
            annotations={"readOnlyHint": True},
        )
        skill = define_skill(
            name="echo_skill",
            description="Echo skill",
            content="Use remote_echo.",
            allowed_tools=["remote_echo"],
        )
        plugin = define_plugin(name="demo-plugin", description="Demo", tools=[tool], skills=[skill])

        response = client.plugins.install(plugin)

        self.assertTrue(response["ok"])
        method, path, payload = client.calls[-1]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api/plugins")
        self.assertEqual(payload["id"], "demo-plugin")
        self.assertEqual(payload["type"], "inline")
        self.assertEqual(payload["definition"]["tools"][0]["executor"]["url"], "http://127.0.0.1:8000/tools")
        self.assertEqual(payload["definition"]["skills"][0]["allowedTools"], ["remote_echo"])

    def test_connector_tool_executor_uses_standard_remote_tool_payload(self):
        client = RecordingClient()
        tool = define_tool(
            name="query_ipm_list",
            description="Query IPM tasks",
            input_schema={"type": "object", "properties": {"projectName": {"type": "string"}}},
            executor=ConnectorToolExecutor(
                url="http://127.0.0.1:8000/api/mc-design/connectors/execute",
                connector_id="tool.external",
                action="query_ipm_list",
                headers={"x-api-key": "runtime-key"},
            ),
            annotations={"readOnlyHint": True},
        )
        plugin = define_plugin(name="connector-plugin", tools=[tool])

        client.plugins.install_or_update(plugin)

        method, path, payload = client.calls[-1]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api/plugins")
        executor = payload["definition"]["tools"][0]["executor"]
        self.assertEqual(executor["type"], "http")
        self.assertEqual(executor["toolName"], "query_ipm_list")
        self.assertEqual(executor["namespace"], "tool.external")
        self.assertEqual(executor["url"], "http://127.0.0.1:8000/api/mc-design/connectors/execute")

    def test_provider_upsert_creates_missing_provider(self):
        client = RecordingClient()

        client.providers.upsert({"providerId": "mc-design-llm", "apiFormat": "openai_chat"})

        self.assertEqual(client.calls[-2][1], "/api/providers")
        self.assertEqual(client.calls[-1], ("POST", "/api/providers", {"providerId": "mc-design-llm", "apiFormat": "openai_chat"}))

    def test_plugin_helpers_write_beya_plugin_layout(self):
        plugin = define_plugin(
            name="layout-plugin",
            skills=[define_skill(
                name="layout_skill",
                description="Layout skill",
                content="Use the layout skill.",
            )],
        )
        with TemporaryDirectory() as tmp:
            root = plugin.write(os.path.join(tmp, "layout-plugin"))
            self.assertTrue(os.path.exists(os.path.join(root, ".beya-plugin", "plugin.json")))
            self.assertFalse(os.path.exists(os.path.join(root, "plugin.json")))
            self.assertTrue(os.path.exists(os.path.join(root, "skills", "layout_skill", "SKILL.md")))
            with open(os.path.join(root, ".beya-plugin", "plugin.json"), encoding="utf-8") as fh:
                manifest = json.load(fh)
            self.assertEqual(manifest["skills"], "./skills")

    def test_stream_parser_returns_events(self):
        client = RecordingClient()
        events = list(client.tasks.stream("task-1"))
        self.assertEqual(events[0].type, "LLM_PARTIAL")
        self.assertEqual(client.calls[0][1], "/api/stream/sse?task_id=task-1")

    def test_client_preserves_server_route_cookie_between_task_calls(self):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                if self.path != "/api/tasks":
                    self.send_error(404)
                    return
                seen.append(("POST", self.path, self.headers.get("Cookie") or ""))
                body = {
                    "task_id": "task-1",
                    "workflow_id": "task-1",
                    "session_id": None,
                    "status": "RUNNING",
                }
                raw = json.dumps(body).encode("utf-8")
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", "AlteonP=pod-a; Path=/")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                cookie = self.headers.get("Cookie") or ""
                seen.append(("GET", self.path, cookie))
                if "AlteonP=pod-a" not in cookie:
                    self.send_error(404)
                    return
                if self.path == "/api/tasks/task-1":
                    body = {
                        "task_id": "task-1",
                        "workflow_id": "task-1",
                        "query": "hello",
                        "status": "COMPLETED",
                        "result": "done",
                    }
                    raw = json.dumps(body).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                if self.path == "/api/stream/sse?task_id=task-1":
                    raw = (
                        'data: {"type":"LLM_PARTIAL","task_id":"task-1","message":"hello","timestamp":"now","seq":1}\n\n'
                        "data: [DONE]\n\n"
                    ).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                self.send_error(404)

            def log_message(self, _format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = BeyaClient(base_url="http://127.0.0.1:%s" % server.server_port)
            handle = client.tasks.submit("hello")
            status = client.tasks.status(handle.task_id)
            events = list(client.tasks.stream(handle.task_id))
            self.assertEqual(status.result, "done")
            self.assertEqual(events[0].message, "hello")
            self.assertTrue(any(row[0] == "GET" and "AlteonP=pod-a" in row[2] for row in seen))
        finally:
            server.shutdown()
            server.server_close()

    def test_async_client_exposes_product_resources(self):
        async def run():
            client = AsyncBeyaClient(base_url="http://beya.test")
            self.assertTrue(hasattr(client, "tasks"))
            self.assertTrue(hasattr(client, "workspace"))
            await client.close()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
