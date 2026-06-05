import asyncio
from http.cookiejar import CookieJar
import json
import time
from typing import Any, Dict, Iterable, Iterator, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from . import errors
from ._websocket import WebSocketClient, WebSocketProtocolError
from .models import ChatResult, RunEvent


JsonObject = Dict[str, Any]


class BeyaClient:
    """Product client for the Beya Server API.

    The SDK exposes Beya product resources. It is not a route table dump, but
    every resource method is backed by canonical /api/* Beya Server endpoints.
    """

    def __init__(
        self,
        base_url="http://127.0.0.1:3456",
        api_key=None,
        bearer_token=None,
        default_timeout=120.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.bearer_token = bearer_token
        self.default_timeout = default_timeout
        self.cookie_jar = CookieJar()
        self._opener = build_opener(HTTPCookieProcessor(self.cookie_jar))

        self.tasks = TasksResource(self)
        self.chat = ChatResource(self)
        self.sessions = SessionsResource(self)
        self.models = ModelsResource(self)
        self.providers = ProvidersResource(self)
        self.tools = ToolsResource(self)
        self.skills = SkillsResource(self)
        self.plugins = PluginsResource(self)
        self.mcp = McpResource(self)
        self.workspace = WorkspaceResource(self)
        self.memory = MemoryResource(self)
        self.agents = AgentsResource(self)
        self.teams = TeamsResource(self)
        self.schedules = SchedulesResource(self)
        self.diagnostics = DiagnosticsResource(self)
        self.settings = SettingsResource(self)
        self.local = LocalResource(self)

    # Public escape hatch. Mainline usage should prefer product resources.
    def request(self, method, path, payload=None, timeout=None, params=None):
        if params:
            path = _append_query(path, params)
        return self._request(method, path, payload, timeout=timeout)

    def list_tasks(self, **kwargs):
        return self.tasks.list(**kwargs)

    def list_sessions(self, **kwargs):
        return self.sessions.list(**kwargs)

    def get_session(self, session_id, timeout=None):
        return self.sessions.get(session_id, timeout=timeout)

    def get_session_history(self, session_id, timeout=None):
        return self.sessions.history(session_id, timeout=timeout)

    def update_session_title(self, session_id, title, timeout=None):
        return self.sessions.update_title(session_id, title, timeout=timeout)

    def delete_session(self, session_id, timeout=None):
        return self.sessions.delete(session_id, timeout=timeout)

    def list_tools(self, **kwargs):
        return self.tools.list(**kwargs)

    def get_tool(self, name, timeout=None):
        return self.tools.get(name, timeout=timeout)

    def execute_tool(self, name, arguments=None, session_id=None, timeout=None):
        return self.tools.execute(name, arguments=arguments, session_id=session_id, timeout=timeout)

    def list_skills(self, **kwargs):
        return self.skills.list(**kwargs)

    def get_skill(self, name, source=None, timeout=None):
        return self.skills.get(name, source=source, timeout=timeout)

    def list_plugins(self, **kwargs):
        return self.plugins.list(**kwargs)

    def get_plugin(self, plugin_id, **kwargs):
        return self.plugins.get(plugin_id, **kwargs)

    def enable_plugin(self, plugin_id, **kwargs):
        return self.plugins.enable(plugin_id, **kwargs)

    def disable_plugin(self, plugin_id, **kwargs):
        return self.plugins.disable(plugin_id, **kwargs)

    def update_plugin(self, plugin_id, **kwargs):
        return self.plugins.update(plugin_id, **kwargs)

    def uninstall_plugin(self, plugin_id, **kwargs):
        return self.plugins.uninstall(plugin_id, **kwargs)

    def reload_plugins(self, **kwargs):
        return self.plugins.reload(**kwargs)

    def list_providers(self, timeout=None):
        return self.providers.list(timeout=timeout)

    def provider_catalog(self, timeout=None):
        return self.providers.catalog(timeout=timeout)

    def create_provider(self, payload, timeout=None):
        return self.providers.create(payload, timeout=timeout)

    def upsert_provider(self, payload, timeout=None):
        return self.providers.upsert(payload, timeout=timeout)

    def activate_provider(self, provider_id, timeout=None):
        return self.providers.activate(provider_id, timeout=timeout)

    def test_provider(self, provider_id, overrides=None, timeout=None):
        return self.providers.test(provider_id, overrides=overrides, timeout=timeout)

    def list_models(self, timeout=None):
        return self.models.list(timeout=timeout)

    def get_current_model(self, timeout=None):
        return self.models.current(timeout=timeout)

    def set_current_model(self, model_id, timeout=None):
        return self.models.set_current(model_id, timeout=timeout)

    def health(self, timeout=None):
        return self._request("GET", "/api/health", timeout=timeout)

    def readiness(self, timeout=None):
        return self._request("GET", "/api/readiness", timeout=timeout)

    def export_diagnostics(self, timeout=None):
        return self.diagnostics.export(timeout=timeout)

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.bearer_token:
            headers["Authorization"] = "Bearer %s" % self.bearer_token
        elif self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    def _request(self, method, path, payload=None, timeout=None):
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        req = Request(
            "%s%s" % (self.base_url, path),
            data=data,
            method=method,
            headers=self._headers(),
        )
        try:
            with self._opener.open(req, timeout=timeout or self.default_timeout) as response:
                raw = response.read()
                if not raw:
                    return None
                content_type = response.headers.get("content-type", "")
                if "application/json" not in content_type:
                    return raw.decode("utf-8")
                return json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except Exception:
                payload = raw
            raise errors.error_from_response(exc.code, payload)
        except URLError as exc:
            raise errors.BeyaServerUnavailableError(str(exc.reason), code="BEYA_SERVER_UNAVAILABLE")

    def _open_session_websocket(self, session_id, timeout=None):
        headers = {}
        if self.bearer_token:
            headers["Authorization"] = "Bearer %s" % self.bearer_token
        elif self.api_key:
            headers["X-API-Key"] = self.api_key
        try:
            return WebSocketClient(
                self._session_websocket_url(session_id),
                headers=headers,
                timeout=timeout or self.default_timeout,
            )
        except WebSocketProtocolError as exc:
            raise errors.BeyaServerUnavailableError(str(exc), code="WEBSOCKET_UNAVAILABLE")

    def _session_websocket_url(self, session_id):
        parsed = urlsplit(self.base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        base_path = parsed.path.rstrip("/")
        path = "%s/api/sessions/%s/ws" % (base_path, _path(session_id))
        query = parsed.query
        token = self.bearer_token or self.api_key
        if token:
            extra = urlencode({"token": token})
            query = "%s&%s" % (query, extra) if query else extra
        return urlunsplit((scheme, parsed.netloc, path, query, ""))


class TasksResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/tasks", timeout=timeout)

    def lists(self, timeout=None):
        return self._client._request("GET", "/api/tasks/lists", timeout=timeout)

    def get_list(self, task_list_id, timeout=None):
        return self._client._request("GET", "/api/tasks/lists/%s" % _path(task_list_id), timeout=timeout)

    def get(self, task_list_id, task_id, timeout=None):
        return self._client._request(
            "GET",
            "/api/tasks/lists/%s/%s" % (_path(task_list_id), _path(task_id)),
            timeout=timeout,
        )

    def reset_list(self, task_list_id, timeout=None):
        return self._client._request(
            "POST",
            "/api/tasks/lists/%s/reset" % _path(task_list_id),
            {},
            timeout=timeout,
        )


class ChatResource:
    def __init__(self, client):
        self._client = client

    def run(self, input, **kwargs):
        events = list(self.stream(input, **kwargs))
        session_id = str(kwargs.get("session_id") or "")
        result = ""
        usage = None
        error = None
        for event in events:
            if event.session_id:
                session_id = event.session_id
            if event.type == "WORKFLOW_COMPLETED":
                result = event.result or event.message
            if event.type == "WORKFLOW_FAILED":
                error = event.error or event.message
            if event.payload and "usage" in event.payload:
                usage = event.payload.get("usage")
        return ChatResult(session_id=session_id, result=result, events=events, usage=usage, error=error)

    def stream(
        self,
        input,
        session_id=None,
        work_dir=None,
        permission_mode=None,
        model=None,
        model_override=None,
        provider_id=None,
        provider_override=None,
        effort=None,
        effort_level=None,
        attachments=None,
        timeout=None,
        **_ignored,
    ):
        session_id = session_id or self._create_session(
            work_dir=work_dir,
            permission_mode=permission_mode,
            timeout=timeout,
        )
        seq = 0
        accumulated = []
        try:
            with self._client._open_session_websocket(session_id, timeout=timeout) as ws:
                if permission_mode:
                    ws.send_json({"type": "set_permission_mode", "mode": permission_mode})
                selected_model = model_override or model
                if selected_model:
                    ws.send_json(_drop_none({
                        "type": "set_runtime_config",
                        "providerId": provider_override if provider_override is not None else provider_id,
                        "modelId": selected_model,
                        "effortLevel": effort_level or effort,
                    }))
                ws.send_json(_drop_none({
                    "type": "user_message",
                    "content": input,
                    "attachments": attachments,
                }))
                while True:
                    raw = ws.recv_json()
                    if raw is None:
                        break
                    seq += 1
                    event = _chat_frame_to_event(raw, session_id, seq, accumulated)
                    if event is None:
                        continue
                    yield event
                    if event.type in ("WORKFLOW_COMPLETED", "WORKFLOW_FAILED"):
                        break
        except WebSocketProtocolError as exc:
            raise errors.BeyaServerUnavailableError(str(exc), code="WEBSOCKET_UNAVAILABLE")

    def _create_session(self, work_dir=None, permission_mode=None, timeout=None):
        data = self._client.sessions.create(
            work_dir=work_dir,
            permission_mode=permission_mode,
            timeout=timeout,
        )
        session_id = (
            data.get("session_id")
            or data.get("sessionId")
            or data.get("id")
            if isinstance(data, dict)
            else None
        )
        if not session_id:
            raise errors.BeyaError("Beya Server did not return a session id", code="SESSION_CREATE_FAILED")
        return str(session_id)


class SessionsResource:
    def __init__(self, client):
        self._client = client

    def list(self, limit=50, offset=0, timeout=None):
        return self._client._request(
            "GET",
            "/api/sessions?limit=%s&offset=%s" % (limit, offset),
            timeout=timeout,
        )

    def get(self, session_id, timeout=None):
        return self._client._request("GET", "/api/sessions/%s" % _path(session_id), timeout=timeout)

    def history(self, session_id, timeout=None):
        return self._client._request("GET", "/api/sessions/%s/history" % _path(session_id), timeout=timeout)

    def events(self, session_id, last_event_id=None, types=None, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/sessions/%s/events" % _path(session_id), _event_params(last_event_id, types)),
            timeout=timeout,
        )

    def create(self, work_dir=None, repository=None, permission_mode=None, timeout=None):
        return self._client._request(
            "POST",
            "/api/sessions",
            _drop_none({"workDir": work_dir, "repository": repository, "permissionMode": permission_mode}),
            timeout=timeout,
        )

    def resume(self, session_id, timeout=None):
        return self.get(session_id, timeout=timeout)

    def update_title(self, session_id, title, timeout=None):
        return self._client._request("PATCH", "/api/sessions/%s" % _path(session_id), {"title": title}, timeout=timeout)

    def delete(self, session_id, timeout=None):
        return self._client._request("DELETE", "/api/sessions/%s" % _path(session_id), timeout=timeout)


class ModelsResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/models", timeout=timeout)

    def current(self, timeout=None):
        return self._client._request("GET", "/api/models/current", timeout=timeout)

    def set_current(self, model_id, timeout=None):
        return self._client._request("PUT", "/api/models/current", {"modelId": model_id}, timeout=timeout)

    def effort(self, timeout=None):
        return self._client._request("GET", "/api/effort", timeout=timeout)

    def set_effort(self, level, timeout=None):
        return self._client._request("PUT", "/api/effort", {"level": level}, timeout=timeout)


class ProvidersResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/providers", timeout=timeout)

    def catalog(self, timeout=None):
        return self._client._request("GET", "/api/providers/catalog", timeout=timeout)

    def auth_status(self, timeout=None):
        return self._client._request("GET", "/api/providers/auth-status", timeout=timeout)

    def settings(self, timeout=None):
        return self._client._request("GET", "/api/providers/settings", timeout=timeout)

    def update_settings(self, settings, timeout=None):
        return self._client._request("PUT", "/api/providers/settings", settings, timeout=timeout)

    def create(self, payload, timeout=None):
        return self._client._request("POST", "/api/providers", payload, timeout=timeout)

    def upsert(self, payload, timeout=None):
        provider_id = str(payload.get("providerId") or payload.get("id") or "").strip() if isinstance(payload, dict) else ""
        if not provider_id:
            raise ValueError("providerId is required")
        existing = self.list(timeout=timeout)
        rows = existing.get("providers") if isinstance(existing, dict) else existing
        ids = {
            str(item.get("providerId") or item.get("id") or "")
            for item in (rows if isinstance(rows, list) else [])
            if isinstance(item, dict)
        }
        if provider_id in ids:
            return self.update(provider_id, payload, timeout=timeout)
        return self.create(payload, timeout=timeout)

    def update(self, provider_id, payload, timeout=None):
        return self._client._request("PATCH", "/api/providers/%s" % _path(provider_id), payload, timeout=timeout)

    def delete(self, provider_id, timeout=None):
        return self._client._request("DELETE", "/api/providers/%s" % _path(provider_id), timeout=timeout)

    def activate(self, provider_id, timeout=None):
        return self._client._request("POST", "/api/providers/%s/activate" % _path(provider_id), {}, timeout=timeout)

    def test(self, provider_id, overrides=None, timeout=None):
        return self._client._request("POST", "/api/providers/%s/test" % _path(provider_id), overrides or {}, timeout=timeout)

    def test_config(self, payload, timeout=None):
        return self._client._request("POST", "/api/providers/test", payload, timeout=timeout)


class ToolsResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/tools", timeout=timeout)

    def get(self, name, timeout=None):
        return self._client._request("GET", "/api/tools/%s" % _path(name), timeout=timeout)

    def execute(self, name, arguments=None, session_id=None, permission_mode=None, timeout=None):
        return self._client._request(
            "POST",
            "/api/tools/%s/execute" % _path(name),
            _drop_none({
                "input": arguments or {},
                "arguments": arguments or {},
                "session_id": session_id,
                "permission_mode": permission_mode,
            }),
            timeout=timeout,
        )


class SkillsResource:
    def __init__(self, client):
        self._client = client

    def list(self, cwd=None, timeout=None):
        return self._client._request("GET", _append_query("/api/skills", _drop_none({"cwd": cwd})), timeout=timeout)

    def get(self, name, source=None, cwd=None, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/skills/%s" % _path(name), _drop_none({"source": source, "cwd": cwd})),
            timeout=timeout,
        )

    def use(self, name, query, **kwargs):
        skills = list(kwargs.pop("skills", []) or [])
        skills.insert(0, name)
        return self._client.chat.run(query, skills=skills, **kwargs)


class PluginsResource:
    def __init__(self, client):
        self._client = client

    def list(self, cwd=None, timeout=None):
        return self._client._request("GET", _append_query("/api/plugins", _drop_none({"cwd": cwd})), timeout=timeout)

    def get(self, plugin_id, cwd=None, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/plugins/%s" % _path(plugin_id), _drop_none({"cwd": cwd})),
            timeout=timeout,
        )

    def install(self, plugin, scope=None, cwd=None, timeout=None):
        if hasattr(plugin, "to_server_inline_ref"):
            payload = plugin.to_server_inline_ref()
            payload["id"] = getattr(plugin, "name", None)
            return self._client._request("POST", "/api/plugins", _drop_none(payload), timeout=timeout)
        if isinstance(plugin, dict):
            return self._client._request("POST", "/api/plugins", plugin, timeout=timeout)
        if isinstance(plugin, str) and ("/" in plugin or "\\" in plugin or plugin.startswith(".")):
            return self._client._request("POST", "/api/plugins", {"path": plugin}, timeout=timeout)
        return self.enable(plugin, scope=scope, cwd=cwd, timeout=timeout)

    def install_or_update(self, plugin, scope=None, cwd=None, timeout=None):
        return self.install(plugin, scope=scope, cwd=cwd, timeout=timeout)

    def enable(self, plugin_id, scope=None, cwd=None, timeout=None):
        return self._plugin_action("enable", plugin_id, scope=scope, cwd=cwd, timeout=timeout)

    def disable(self, plugin_id, scope=None, cwd=None, timeout=None):
        return self._plugin_action("disable", plugin_id, scope=scope, cwd=cwd, timeout=timeout)

    def update(self, plugin_id, scope=None, cwd=None, timeout=None):
        return self._plugin_action("update", plugin_id, scope=scope, cwd=cwd, timeout=timeout)

    def uninstall(self, plugin_id, scope=None, keep_data=None, timeout=None):
        return self._plugin_action("uninstall", plugin_id, scope=scope, keepData=keep_data, timeout=timeout)

    def reload(self, cwd=None, session_id=None, timeout=None):
        return self._client._request(
            "POST",
            _append_query("/api/plugins/reload", _drop_none({"cwd": cwd, "sessionId": session_id})),
            {},
            timeout=timeout,
        )

    def _plugin_action(self, action, plugin_id, timeout=None, **payload):
        body = _drop_none({"id": plugin_id})
        body.update(_drop_none(payload))
        return self._client._request("POST", "/api/plugins/%s" % action, body, timeout=timeout)


class McpResource:
    def __init__(self, client):
        self._client = client

    def list(self, cwd=None, timeout=None):
        return self._client._request("GET", _append_query("/api/mcp", _drop_none({"cwd": cwd})), timeout=timeout)

    def status(self, name, cwd=None, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/mcp/%s/status" % _path(name), _drop_none({"cwd": cwd})),
            timeout=timeout,
        )

    def create(self, name, payload, cwd=None, timeout=None):
        body = dict(payload)
        body["name"] = name
        if cwd:
            body["cwd"] = cwd
        return self._client._request("POST", "/api/mcp", body, timeout=timeout)

    def update(self, name, payload, cwd=None, previous_cwd=None, timeout=None):
        body = dict(payload)
        if cwd:
            body["cwd"] = cwd
        if previous_cwd:
            body["previousCwd"] = previous_cwd
        return self._client._request("PUT", "/api/mcp/%s" % _path(name), body, timeout=timeout)

    def remove(self, name, scope, cwd=None, timeout=None):
        return self._client._request(
            "DELETE",
            _append_query("/api/mcp/%s" % _path(name), _drop_none({"scope": scope, "cwd": cwd})),
            timeout=timeout,
        )

    def toggle(self, name, cwd=None, session_id=None, timeout=None):
        return self._client._request(
            "POST",
            "/api/mcp/%s/toggle" % _path(name),
            _drop_none({"cwd": cwd, "sessionId": session_id}),
            timeout=timeout,
        )

    def reconnect(self, name, cwd=None, timeout=None):
        return self._client._request("POST", "/api/mcp/%s/reconnect" % _path(name), _drop_none({"cwd": cwd}), timeout=timeout)


class WorkspaceResource:
    def __init__(self, client):
        self._client = client

    def status(self, session_id, timeout=None):
        return self._client._request("GET", "/api/sessions/%s/workspace/status" % _path(session_id), timeout=timeout)

    def list(self, session_id, path="", timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/sessions/%s/workspace/tree" % _path(session_id), _drop_none({"path": path})),
            timeout=timeout,
        )

    def read(self, session_id, path, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/sessions/%s/workspace/file" % _path(session_id), {"path": path}),
            timeout=timeout,
        )

    def diff(self, session_id, path, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/sessions/%s/workspace/diff" % _path(session_id), {"path": path}),
            timeout=timeout,
        )

    def write(self, session_id, path, content, timeout=None):
        return self._client.tools.execute(
            "Write",
            arguments={"file_path": path, "content": content},
            session_id=session_id,
            timeout=timeout,
        )

    def search(self, root_path, query, include_files=True, max_results=50, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/filesystem/browse", {
                "path": root_path,
                "search": query,
                "includeFiles": _bool_query(include_files),
                "maxResults": max_results,
            }),
            timeout=timeout,
        )


class MemoryResource:
    def __init__(self, client):
        self._client = client

    def files(self, project_id, timeout=None):
        return self._client._request("GET", _append_query("/api/memory/files", {"projectId": project_id}), timeout=timeout)

    def get(self, project_id, path, timeout=None):
        return self._client._request("GET", _append_query("/api/memory/file", {"projectId": project_id, "path": path}), timeout=timeout)

    def update(self, project_id, path, content, timeout=None):
        return self._client._request("PUT", "/api/memory/file", {"projectId": project_id, "path": path, "content": content}, timeout=timeout)


class AgentsResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/agents", timeout=timeout)

    def get(self, agent_id, timeout=None):
        return self._client._request("GET", "/api/agents/%s" % _path(agent_id), timeout=timeout)

    def execute(self, agent_id, input=None, session_id=None, timeout=None):
        return self._client._request("POST", "/api/agents/%s" % _path(agent_id), _drop_none({"input": input or {}, "session_id": session_id}), timeout=timeout)


class TeamsResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/teams", timeout=timeout)

    def get(self, team_id, timeout=None):
        return self._client._request("GET", "/api/teams/%s" % _path(team_id), timeout=timeout)

    def request(self, method, path="", payload=None, timeout=None):
        suffix = "/%s" % path.strip("/") if path else ""
        return self._client._request(method, "/api/teams%s" % suffix, payload, timeout=timeout)


class SchedulesResource:
    def __init__(self, client):
        self._client = client

    def list(self, timeout=None):
        return self._client._request("GET", "/api/scheduled-tasks", timeout=timeout)

    def create(self, payload, timeout=None):
        return self._client._request("POST", "/api/scheduled-tasks", payload, timeout=timeout)

    def get(self, schedule_id, timeout=None):
        return self._client._request("GET", "/api/scheduled-tasks/%s" % _path(schedule_id), timeout=timeout)

    def update(self, schedule_id, payload, timeout=None):
        return self._client._request("PUT", "/api/scheduled-tasks/%s" % _path(schedule_id), payload, timeout=timeout)

    def delete(self, schedule_id, timeout=None):
        return self._client._request("DELETE", "/api/scheduled-tasks/%s" % _path(schedule_id), timeout=timeout)

    def run(self, schedule_id, timeout=None):
        return self._client._request("POST", "/api/scheduled-tasks/%s/run" % _path(schedule_id), {}, timeout=timeout)

    def runs(self, schedule_id=None, limit=50, timeout=None):
        if schedule_id:
            return self._client._request("GET", "/api/scheduled-tasks/%s/runs" % _path(schedule_id), timeout=timeout)
        return self._client._request("GET", "/api/scheduled-tasks/runs?limit=%s" % limit, timeout=timeout)


class DiagnosticsResource:
    def __init__(self, client):
        self._client = client

    def status(self, timeout=None):
        return self._client._request("GET", "/api/diagnostics/status", timeout=timeout)

    def events(self, timeout=None):
        return self._client._request("GET", "/api/diagnostics/events", timeout=timeout)

    def export(self, timeout=None):
        return self._client._request("POST", "/api/diagnostics/export", {}, timeout=timeout)


class SettingsResource:
    def __init__(self, client):
        self._client = client

    def user(self, timeout=None):
        return self._client._request("GET", "/api/settings/user", timeout=timeout)

    def update_user(self, payload, timeout=None):
        return self._client._request("PUT", "/api/settings/user", payload, timeout=timeout)

    def permission_mode(self, timeout=None):
        return self._client._request("GET", "/api/permissions/mode", timeout=timeout)

    def set_permission_mode(self, mode, timeout=None):
        return self._client._request("PUT", "/api/permissions/mode", {"mode": mode}, timeout=timeout)


class LocalResource:
    def __init__(self, client):
        self._client = client

    def browse(self, path=None, search=None, include_files=False, max_results=200, timeout=None):
        return self._client._request(
            "GET",
            _append_query("/api/filesystem/browse", _drop_none({
                "path": path,
                "search": search,
                "includeFiles": _bool_query(include_files) if include_files is not None else None,
                "maxResults": max_results,
            })),
            timeout=timeout,
        )

    def open_file(self, target_id, path, timeout=None):
        return self._client._request("POST", "/api/open-targets/open", {"targetId": target_id, "path": path}, timeout=timeout)

    def open_targets(self, timeout=None):
        return self._client._request("GET", "/api/open-targets", timeout=timeout)

    def run_command(self, command, session_id=None, timeout=None):
        return self._client.tools.execute("Bash", arguments={"command": command}, session_id=session_id, timeout=timeout)

    def computer_use_status(self, timeout=None):
        return self._client._request("GET", "/api/computer-use/status", timeout=timeout)

    def setup_computer_use(self, timeout=None):
        return self._client._request("POST", "/api/computer-use/setup", {}, timeout=timeout or 300)


class AsyncBeyaClient:
    def __init__(self, *args, **kwargs):
        self._client = BeyaClient(*args, **kwargs)
        self.tasks = _AsyncResourceProxy(self._client.tasks)
        self.chat = _AsyncResourceProxy(self._client.chat)
        self.sessions = _AsyncResourceProxy(self._client.sessions)
        self.models = _AsyncResourceProxy(self._client.models)
        self.providers = _AsyncResourceProxy(self._client.providers)
        self.tools = _AsyncResourceProxy(self._client.tools)
        self.skills = _AsyncResourceProxy(self._client.skills)
        self.plugins = _AsyncResourceProxy(self._client.plugins)
        self.mcp = _AsyncResourceProxy(self._client.mcp)
        self.workspace = _AsyncResourceProxy(self._client.workspace)
        self.memory = _AsyncResourceProxy(self._client.memory)
        self.agents = _AsyncResourceProxy(self._client.agents)
        self.teams = _AsyncResourceProxy(self._client.teams)
        self.schedules = _AsyncResourceProxy(self._client.schedules)
        self.diagnostics = _AsyncResourceProxy(self._client.diagnostics)
        self.settings = _AsyncResourceProxy(self._client.settings)
        self.local = _AsyncResourceProxy(self._client.local)

    async def request(self, *args, **kwargs):
        return await _run_blocking(self._client.request, *args, **kwargs)

    async def health(self, *args, **kwargs):
        return await _run_blocking(self._client.health, *args, **kwargs)

    async def close(self):
        return await _run_blocking(self._client.close)

    def __getattr__(self, name):
        attr = getattr(self._client, name)
        if not callable(attr):
            return attr

        async def call(*args, **kwargs):
            return await _run_blocking(attr, *args, **kwargs)

        return call

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()
        return False


class _AsyncResourceProxy:
    def __init__(self, resource):
        self._resource = resource

    def __getattr__(self, name):
        attr = getattr(self._resource, name)
        if not callable(attr):
            return attr

        async def call(*args, **kwargs):
            return await _run_blocking(attr, *args, **kwargs)

        return call


async def _run_blocking(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def _path(value):
    return quote(str(value), safe="")


def _drop_none(data):
    return {key: value for key, value in data.items() if value is not None}


def _append_query(path, params):
    cleaned = _drop_none(params or {})
    if not cleaned:
        return path
    return "%s?%s" % (path, urlencode(cleaned))


def _bool_query(value):
    if value is None:
        return None
    return "true" if bool(value) else "false"


def _chat_frame_to_event(raw, session_id, seq, accumulated):
    if not isinstance(raw, dict):
        return None
    typ = str(raw.get("type") or "")
    timestamp = _now_iso()

    if typ in ("connected", "pong", "content_start"):
        return None

    if typ == "content_delta":
        text = str(raw.get("text") or "")
        if text:
            accumulated.append(text)
            return RunEvent(
                type="LLM_PARTIAL",
                session_id=session_id,
                message=text,
                timestamp=timestamp,
                seq=seq,
                raw=raw,
            )
        tool_input = str(raw.get("toolInput") or "")
        if tool_input:
            return RunEvent(
                type="TOOL_INPUT_PARTIAL",
                session_id=session_id,
                message=tool_input,
                timestamp=timestamp,
                seq=seq,
                raw=raw,
            )
        return None

    if typ == "thinking":
        return RunEvent(
            type="AGENT_THINKING",
            session_id=session_id,
            message=str(raw.get("text") or ""),
            timestamp=timestamp,
            seq=seq,
            raw=raw,
        )

    if typ == "tool_use_complete":
        payload = {
            "tool_call_id": raw.get("toolUseId"),
            "name": raw.get("toolName"),
            "input": raw.get("input"),
            "parent_tool_use_id": raw.get("parentToolUseId"),
        }
        return RunEvent(
            type="TOOL_INVOKED",
            session_id=session_id,
            message=str(raw.get("toolName") or ""),
            timestamp=timestamp,
            seq=seq,
            payload=payload,
            raw=raw,
        )

    if typ == "tool_result":
        payload = {
            "tool_call_id": raw.get("toolUseId"),
            "result": raw.get("content"),
            "is_error": raw.get("isError") is True,
            "parent_tool_use_id": raw.get("parentToolUseId"),
        }
        return RunEvent(
            type="TOOL_OBSERVATION",
            session_id=session_id,
            message=str(raw.get("toolUseId") or ""),
            timestamp=timestamp,
            seq=seq,
            payload=payload,
            raw=raw,
        )

    if typ == "permission_request":
        payload = {
            "approval_id": raw.get("requestId"),
            "tool_call_id": raw.get("toolUseId"),
            "name": raw.get("toolName"),
            "input": raw.get("input"),
            "reason": raw.get("description"),
        }
        return RunEvent(
            type="APPROVAL_REQUESTED",
            session_id=session_id,
            message=str(raw.get("description") or raw.get("toolName") or ""),
            timestamp=timestamp,
            seq=seq,
            payload=payload,
            raw=raw,
        )

    if typ == "message_complete":
        result = "".join(accumulated)
        return RunEvent(
            type="WORKFLOW_COMPLETED",
            session_id=session_id,
            message=result,
            result=result,
            timestamp=timestamp,
            seq=seq,
            payload={"usage": raw.get("usage")},
            raw=raw,
        )

    if typ == "error":
        message = str(raw.get("message") or "Beya Server chat failed")
        return RunEvent(
            type="WORKFLOW_FAILED",
            session_id=session_id,
            message=message,
            error=message,
            timestamp=timestamp,
            seq=seq,
            payload={"code": raw.get("code"), "retryable": raw.get("retryable")},
            raw=raw,
        )

    if typ == "status":
        return RunEvent(
            type="STATUS",
            session_id=session_id,
            message=str(raw.get("verb") or raw.get("state") or ""),
            timestamp=timestamp,
            seq=seq,
            payload={key: value for key, value in raw.items() if key != "type"},
            raw=raw,
        )

    return RunEvent(
        type=typ or "SERVER_EVENT",
        session_id=session_id,
        message=str(raw.get("message") or ""),
        timestamp=timestamp,
        seq=seq,
        payload={key: value for key, value in raw.items() if key != "type"},
        raw=raw,
    )


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
