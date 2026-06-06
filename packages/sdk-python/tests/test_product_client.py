import asyncio
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tempfile import TemporaryDirectory

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from beya import AsyncBeyaClient, BeyaClient, ConnectorToolExecutor, RemoteToolExecutor, RunEvent, define_plugin, define_skill, define_tool


class FakeWebSocket:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def send_json(self, payload):
        self.sent.append(payload)

    def recv_json(self):
        if not self.frames:
            return None
        return self.frames.pop(0)


class RecordingClient(BeyaClient):
    def __init__(self, frames=None):
        super().__init__(base_url="http://beya.test")
        self.calls = []
        self.fake_ws = FakeWebSocket(frames or [
            {"type": "connected", "sessionId": "session-1"},
            {"type": "content_delta", "text": "hello"},
            {"type": "message_complete", "usage": {"input_tokens": 1, "output_tokens": 1}},
        ])

    def _request(self, method, path, payload=None, timeout=None):
        self.calls.append((method, path, payload))
        if path == "/api/sessions" and method == "POST":
            return {"session_id": "session-1"}
        return {"ok": True, "path": path}

    def _open_session_websocket(self, session_id, timeout=None, purpose=None):
        self.calls.append(("WS", self._session_websocket_url(session_id, purpose=purpose), None))
        return self.fake_ws


class ProductClientTest(unittest.TestCase):
    def test_product_resources_use_canonical_api_paths(self):
        client = RecordingClient()

        result = client.chat.run(
            "hello",
            work_dir="F:/Documents/beya",
            permission_mode="bypassPermissions",
            model_override="doubao-seed-2.0-pro",
            provider_override="custom",
            metadata={"user_id": "u1", "conversation_id": "conv-1"},
        )
        self.assertEqual(result.result, "hello")
        self.assertEqual(client.fake_ws.sent[0], {"type": "set_permission_mode", "mode": "bypassPermissions"})
        self.assertEqual(client.fake_ws.sent[1]["type"], "set_runtime_config")
        self.assertEqual(client.fake_ws.sent[2], {
            "type": "user_message",
            "content": "hello",
            "metadata": {"user_id": "u1", "conversation_id": "conv-1"},
        })
        self.assertIn(("WS", "ws://beya.test/api/sessions/session-1/ws?purpose=sdk_chat", None), client.calls)

        client.tasks.list()
        client.tasks.lists()
        client.tasks.get_list("session-1")
        client.sessions.list()
        client.sessions.history("session-1")
        client.providers.catalog()
        client.providers.activate("openai")
        client.models.current()
        client.tools.list(session_id="session-1", cwd="F:/Documents/beya")
        client.tools.execute("Read", {"file_path": "package.json"})
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

        paths = [path for _method, path, _payload in client.calls]
        self.assertTrue(paths)
        self.assertIn("/api/tasks", paths)
        self.assertIn("/api/tasks/lists", paths)
        self.assertIn("/api/providers/catalog", paths)
        self.assertIn("/api/plugins/enable", paths)
        self.assertIn("/api/scheduled-tasks", paths)
        self.assertIn("/api/health", paths)
        self.assertIn("/api/readiness", paths)
        self.assertTrue(any(path.startswith("/api/tools?") and "session_id=session-1" in path and "cwd=F%3A%2FDocuments%2Fbeya" in path for path in paths))
        self.assertTrue(any(path == "ws://beya.test/api/sessions/session-1/ws?purpose=sdk_chat" for path in paths))
        self.assertFalse(any(path.startswith("/v1/") for path in paths))
        self.assertFalse(any("/api/stream" in path for path in paths))
        self.assertFalse(any("/api/openai" in path for path in paths))
        self.assertFalse(hasattr(client, "submit_task"))
        self.assertFalse(hasattr(client.tasks, "submit"))
        self.assertFalse(hasattr(client.tasks, "stream"))
        self.assertFalse(hasattr(client, "openai"))

    def test_chat_stream_maps_desktop_websocket_frames(self):
        client = RecordingClient(frames=[
            {"type": "connected", "sessionId": "session-1"},
            {"type": "thinking", "text": "思考中"},
            {"type": "content_delta", "toolInput": '{"project": "A"}'},
            {"type": "content_delta", "text": "你好"},
            {"type": "tool_use_complete", "toolName": "query_ipm_list", "toolUseId": "call-1", "input": {"project": "A"}},
            {"type": "tool_result", "toolUseId": "call-1", "content": "ok", "isError": False},
            {"type": "message_complete", "usage": {"input_tokens": 1, "output_tokens": 2}},
        ])

        events = list(client.chat.stream("查一下 IPM", session_id="session-1"))

        self.assertEqual([event.type for event in events], [
            "AGENT_THINKING",
            "TOOL_INPUT_PARTIAL",
            "LLM_PARTIAL",
            "TOOL_INVOKED",
            "TOOL_OBSERVATION",
            "WORKFLOW_COMPLETED",
        ])
        self.assertEqual(events[2].message, "你好")
        self.assertNotIn("\ufffd", events[2].message)
        self.assertEqual(events[3].payload["tool_call_id"], "call-1")
        self.assertEqual(events[-1].result, "你好")

    def test_chat_stream_maps_interactive_desktop_tools_to_structured_events(self):
        client = RecordingClient(frames=[
            {
                "type": "permission_request",
                "requestId": "ask-1",
                "toolName": "AskUserQuestion",
                "toolUseId": "tool-ask-1",
                "description": "Answer questions?",
                "input": {
                    "questions": [
                        {
                            "header": "Task",
                            "question": "请选择要设计的任务？",
                            "options": [
                                {"label": "连杆", "description": "连杆设计"},
                                {"label": "BOM", "description": "BOM 搭建"},
                            ],
                        }
                    ]
                },
            },
            {
                "type": "permission_request",
                "requestId": "plan-1",
                "toolName": "EnterPlanMode",
                "toolUseId": "tool-plan-1",
                "description": "Enter plan mode?",
                "input": {},
            },
        ])

        events = list(client.chat.stream("继续设计", session_id="session-1"))

        self.assertEqual([event.type for event in events], ["QUESTION_REQUESTED", "PLAN_ACTION_REQUESTED"])
        self.assertEqual(events[0].message, "请选择要设计的任务？")
        self.assertEqual(events[0].payload["questions"][0]["header"], "Task")
        self.assertEqual(events[0].payload["tool_call_id"], "tool-ask-1")
        self.assertEqual(events[0].interaction_type, "question")
        self.assertEqual(events[0].request_id, "ask-1")
        self.assertEqual(events[0].tool_call_id, "tool-ask-1")
        self.assertEqual(events[0].tool_name, "AskUserQuestion")
        self.assertEqual(events[0].questions[0]["header"], "Task")
        self.assertEqual(events[1].payload["name"], "EnterPlanMode")
        self.assertEqual(events[1].interaction_type, "plan")
        self.assertEqual(events[1].request_id, "plan-1")

    def test_chat_stream_auto_responds_to_interaction_and_continues(self):
        client = RecordingClient(frames=[
            {
                "type": "permission_request",
                "requestId": "ask-1",
                "toolName": "AskUserQuestion",
                "toolUseId": "tool-ask-1",
                "description": "Choose a path",
                "input": {
                    "questions": [
                        {
                            "header": "Task",
                            "question": "Which task?",
                            "options": [
                                {"label": "Conrod", "description": "Design conrod"},
                            ],
                        }
                    ]
                },
            },
            {"type": "content_delta", "text": "continued"},
            {"type": "message_complete", "usage": {"input_tokens": 1, "output_tokens": 1}},
        ])

        events = list(client.chat.stream(
            "start",
            session_id="session-1",
            on_interaction=lambda event: {"answers": {event.questions[0]["question"]: "Conrod"}},
        ))

        self.assertEqual([event.type for event in events], [
            "QUESTION_REQUESTED",
            "LLM_PARTIAL",
            "WORKFLOW_COMPLETED",
        ])
        self.assertEqual(client.fake_ws.sent[0], {
            "type": "user_message",
            "content": "start",
        })
        self.assertEqual(client.fake_ws.sent[1], {
            "type": "permission_response",
            "requestId": "ask-1",
            "allowed": True,
            "updatedInput": {
                "questions": [
                    {
                        "header": "Task",
                        "question": "Which task?",
                        "options": [
                            {"label": "Conrod", "description": "Design conrod"},
                        ],
                    }
                ],
                "answers": {"Which task?": "Conrod"},
            },
        })

    def test_chat_respond_sends_permission_response_and_streams_result(self):
        client = RecordingClient(frames=[
            {"type": "connected", "sessionId": "session-1"},
            {"type": "content_delta", "text": "done"},
            {"type": "message_complete", "usage": {"input_tokens": 1, "output_tokens": 1}},
        ])

        events = list(client.chat.respond(
            "session-1",
            "ask-1",
            {"answers": {"Which task?": "Conrod"}, "feedback": "selected"},
        ))

        self.assertEqual(client.fake_ws.sent[0], {
            "type": "permission_response",
            "requestId": "ask-1",
            "allowed": True,
            "updatedInput": {"answers": {"Which task?": "Conrod"}},
            "feedback": "selected",
        })
        self.assertEqual([event.type for event in events], ["LLM_PARTIAL", "WORKFLOW_COMPLETED"])
        self.assertEqual(events[-1].result, "done")
        self.assertEqual(
            client.calls[0],
            ("WS", "ws://beya.test/api/sessions/session-1/ws?purpose=interaction_response", None),
        )

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
            name="query_business_records",
            description="Query business records",
            input_schema={"type": "object", "properties": {"projectName": {"type": "string"}}},
            executor=ConnectorToolExecutor(
                url="http://127.0.0.1:8000/api/connectors/execute",
                connector_id="connector.fixture",
                action="query_business_records",
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
        self.assertEqual(executor["toolName"], "query_business_records")
        self.assertEqual(executor["namespace"], "connector.fixture")
        self.assertEqual(executor["url"], "http://127.0.0.1:8000/api/connectors/execute")

    def test_provider_upsert_creates_missing_provider(self):
        client = RecordingClient()

        client.providers.upsert({"providerId": "custom", "apiFormat": "openai_chat"})

        self.assertEqual(client.calls[-2][1], "/api/providers")
        self.assertEqual(client.calls[-1], ("POST", "/api/providers", {"providerId": "custom", "apiFormat": "openai_chat"}))

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

    def test_client_preserves_server_route_cookie_between_api_calls(self):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                cookie = self.headers.get("Cookie") or ""
                seen.append(("GET", self.path, cookie))
                if self.path.startswith("/api/sessions"):
                    raw = json.dumps({"sessions": []}).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Set-Cookie", "AlteonP=pod-a; Path=/")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                if self.path == "/api/models" and "AlteonP=pod-a" in cookie:
                    raw = json.dumps({"models": []}).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
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
            client.sessions.list()
            client.models.list()
            self.assertTrue(any(row[0] == "GET" and "AlteonP=pod-a" in row[2] for row in seen))
        finally:
            server.shutdown()
            server.server_close()

    def test_async_client_exposes_product_resources(self):
        async def run():
            client = AsyncBeyaClient(base_url="http://beya.test")
            self.assertTrue(hasattr(client, "tasks"))
            self.assertTrue(hasattr(client, "workspace"))
            self.assertTrue(RunEvent is not None)
            await client.close()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
