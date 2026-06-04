import asyncio
import json
import time
from typing import Any, Dict, Iterable, Iterator, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from . import errors
from .models import Event, OpenAIChatCompletion, OpenAIChatCompletionChunk, TaskHandle, TaskStatus


JsonObject = Dict[str, Any]


class BeyaClient:
    """Product client for the Beya Gateway API.

    The SDK exposes Beya product resources. It is not a route table dump, but
    every resource method is backed by canonical /api/* Gateway endpoints.
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
        self.openai = OpenAIResource(self)

    # Public escape hatch. Mainline usage should prefer product resources.
    def request(self, method, path, payload=None, timeout=None, params=None):
        if params:
            path = _append_query(path, params)
        return self._request(method, path, payload, timeout=timeout)

    # Backward-compatible convenience methods.
    def submit_task(self, query, **kwargs):
        return self.tasks.submit(query, **kwargs)

    def submit_and_stream(self, query, **kwargs):
        return self.tasks.submit_and_stream(query, **kwargs)

    def get_status(self, task_id, timeout=None):
        return self.tasks.status(task_id, timeout=timeout)

    def list_tasks(self, **kwargs):
        return self.tasks.list(**kwargs)

    def get_task_events(self, task_id, **kwargs):
        return self.tasks.events(task_id, **kwargs)

    def wait(self, task_id, timeout=None):
        return self.tasks.wait(task_id, timeout=timeout)

    def cancel(self, task_id, reason=None, timeout=None):
        return self.tasks.cancel(task_id, reason=reason, timeout=timeout)

    def stream(self, task_id, types=None, last_event_id=None, timeout=None):
        return self.tasks.stream(task_id, types=types, last_event_id=last_event_id, timeout=timeout)

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

    def create_chat_completion(self, messages, model, timeout=None, **kwargs):
        return self.openai.create_chat_completion(messages, model, timeout=timeout, **kwargs)

    def stream_chat_completion(self, messages, model, timeout=None, **kwargs):
        return self.openai.stream_chat_completion(messages, model, timeout=timeout, **kwargs)

    def health(self, timeout=None):
        return self._request("GET", "/health", timeout=timeout)

    def readiness(self, timeout=None):
        return self._request("GET", "/readiness", timeout=timeout)

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
            with urlopen(req, timeout=timeout or self.default_timeout) as response:
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
            raise errors.GatewayUnavailableError(str(exc.reason), code="GATEWAY_UNAVAILABLE")

    def _stream_sse(self, path, payload=None, timeout=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = Request(
            "%s%s" % (self.base_url, path),
            data=data,
            method="POST" if payload is not None else "GET",
            headers=self._headers(),
        )
        try:
            with urlopen(req, timeout=timeout or self.default_timeout) as response:
                buffer = ""
                while True:
                    chunk = response.read(1)
                    if not chunk:
                        break
                    buffer += chunk.decode("utf-8", errors="replace")
                    while "\n\n" in buffer:
                        raw, buffer = buffer.split("\n\n", 1)
                        data_lines = [
                            line[len("data: "):]
                            for line in raw.splitlines()
                            if line.startswith("data: ")
                        ]
                        if not data_lines:
                            continue
                        data = "\n".join(data_lines)
                        if data == "[DONE]":
                            return
                        yield json.loads(data)
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except Exception:
                payload = raw
            raise errors.error_from_response(exc.code, payload)
        except URLError as exc:
            raise errors.GatewayUnavailableError(str(exc.reason), code="GATEWAY_UNAVAILABLE")


class TasksResource:
    def __init__(self, client):
        self._client = client

    def submit(
        self,
        query,
        session_id=None,
        context=None,
        model_tier=None,
        model_override=None,
        provider_override=None,
        mode=None,
        skill=None,
        skills=None,
        plugins=None,
        agent=None,
        instructions=None,
        max_turns=None,
        permission_mode=None,
        metadata=None,
        timeout=None,
    ):
        payload = _drop_none({
            "query": query,
            "session_id": session_id,
            "context": context,
            "model_tier": model_tier,
            "model_override": model_override,
            "provider_override": provider_override,
            "mode": mode,
            "skill": skill,
            "skills": skills,
            "plugins": plugins,
            "agent": agent,
            "instructions": instructions,
            "max_turns": max_turns,
            "permission_mode": permission_mode,
            "metadata": metadata,
        })
        data = self._client._request("POST", "/api/tasks", payload, timeout=timeout)
        return TaskHandle(
            task_id=data["task_id"],
            workflow_id=data.get("workflow_id") or data["task_id"],
            session_id=data.get("session_id"),
            status=data.get("status", "QUEUED"),
        )._set_client(self._client)

    def submit_and_stream(self, query, **kwargs):
        handle = self.submit(query, **kwargs)
        return handle, "/api/stream/sse?task_id=%s" % handle.task_id

    def get(self, task_id, timeout=None):
        return self.status(task_id, timeout=timeout)

    def status(self, task_id, timeout=None):
        data = self._client._request("GET", "/api/tasks/%s" % _path(task_id), timeout=timeout)
        return _parse_task_status(data)

    def list(self, limit=50, offset=0, status=None, session_id=None, timeout=None):
        params = _drop_none({
            "limit": limit,
            "offset": offset,
            "status": status,
            "session_id": session_id,
        })
        return self._client._request("GET", _append_query("/api/tasks", params), timeout=timeout)

    def events(self, task_id, last_event_id=None, types=None, timeout=None):
        params = _event_params(last_event_id=last_event_id, types=types)
        data = self._client._request(
            "GET",
            _append_query("/api/tasks/%s/events" % _path(task_id), params),
            timeout=timeout,
        )
        return [_parse_event(item) for item in data.get("events", [])]

    def timeline(self, task_id, **kwargs):
        return self.events(task_id, **kwargs)

    def wait(self, task_id, timeout=None):
        deadline = time.time() + (timeout if timeout is not None else self._client.default_timeout)
        while time.time() < deadline:
            status = self.status(task_id)
            if status.status in ("COMPLETED", "FAILED", "CANCELLED"):
                return status
            time.sleep(0.25)
        raise errors.BeyaError("Timed out waiting for task %s" % task_id, code="TIMEOUT")

    def cancel(self, task_id, reason=None, timeout=None):
        data = self._client._request(
            "POST",
            "/api/tasks/%s/cancel" % _path(task_id),
            _drop_none({"reason": reason}),
            timeout=timeout,
        )
        return bool(data.get("ok"))

    def stream(self, task_id, types=None, last_event_id=None, timeout=None):
        params = {"task_id": task_id}
        params.update(_event_params(last_event_id=last_event_id, types=types))
        for item in self._client._stream_sse(_append_query("/api/stream/sse", params), timeout=timeout):
            yield _parse_event(item)


class ChatResource:
    def __init__(self, client):
        self._client = client

    def run(self, input, **kwargs):
        handle = self._client.tasks.submit(input, **kwargs)
        return self._client.tasks.wait(handle.task_id, timeout=kwargs.get("timeout"))

    def stream(self, input, **kwargs):
        handle = self._client.tasks.submit(input, **kwargs)
        return self._client.tasks.stream(handle.task_id)


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
        return self._client.tasks.submit(query, skills=skills, **kwargs)


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

    def install(self, plugin_id, scope=None, cwd=None, timeout=None):
        return self.enable(plugin_id, scope=scope, cwd=cwd, timeout=timeout)

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


class OpenAIResource:
    def __init__(self, client):
        self._client = client

    def models(self, timeout=None):
        return self._client._request("GET", "/v1/models", timeout=timeout)

    def create_chat_completion(self, messages, model, timeout=None, **kwargs):
        payload = dict(kwargs)
        payload.update({"messages": [_serialize_message(m) for m in messages], "model": model})
        data = self._client._request("POST", "/v1/chat/completions", payload, timeout=timeout)
        return OpenAIChatCompletion(**data)

    def stream_chat_completion(self, messages, model, timeout=None, **kwargs):
        payload = dict(kwargs)
        payload.update({
            "messages": [_serialize_message(m) for m in messages],
            "model": model,
            "stream": True,
        })
        for item in self._client._stream_sse("/v1/chat/completions", payload=payload, timeout=timeout):
            yield OpenAIChatCompletionChunk(**item)


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
        self.openai = _AsyncResourceProxy(self._client.openai)

    async def request(self, *args, **kwargs):
        return await _run_blocking(self._client.request, *args, **kwargs)

    async def submit_task(self, *args, **kwargs):
        return await _run_blocking(self._client.submit_task, *args, **kwargs)

    async def get_status(self, *args, **kwargs):
        return await _run_blocking(self._client.get_status, *args, **kwargs)

    async def wait(self, *args, **kwargs):
        return await _run_blocking(self._client.wait, *args, **kwargs)

    async def cancel(self, *args, **kwargs):
        return await _run_blocking(self._client.cancel, *args, **kwargs)

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

    async def stream(self, *args, **kwargs):
        events = await _run_blocking(lambda: list(self._client.stream(*args, **kwargs)))
        for event in events:
            yield event

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


def _serialize_message(message):
    if hasattr(message, "__dict__"):
        return _drop_none(message.__dict__)
    return message


def _parse_task_status(data):
    return TaskStatus(
        task_id=data["task_id"],
        workflow_id=data.get("workflow_id") or data["task_id"],
        query=data.get("query", ""),
        status=data.get("status", "QUEUED"),
        session_id=data.get("session_id"),
        created_at=data.get("created_at"),
        updated_at=data.get("updated_at"),
        completed_at=data.get("completed_at"),
        result=data.get("result"),
        error_message=data.get("error_message"),
        model_used=data.get("model_used"),
        provider=data.get("provider"),
        metadata=data.get("metadata"),
    )


def _parse_event(data):
    return Event(
        type=data.get("type", ""),
        task_id=data.get("task_id", ""),
        workflow_id=data.get("workflow_id") or data.get("task_id", ""),
        session_id=data.get("session_id", ""),
        message=data.get("message", ""),
        timestamp=data.get("timestamp", ""),
        seq=int(data.get("seq") or 0),
        stream_id=data.get("stream_id"),
        payload=data.get("payload"),
        result=data.get("result"),
        error=data.get("error"),
    )


def _path(value):
    return quote(str(value), safe="")


def _drop_none(data):
    return {key: value for key, value in data.items() if value is not None}


def _append_query(path, params):
    cleaned = _drop_none(params or {})
    if not cleaned:
        return path
    return "%s?%s" % (path, urlencode(cleaned))


def _event_params(last_event_id=None, types=None):
    params = {}
    if last_event_id:
        params["last_event_id"] = last_event_id
    if types:
        params["types"] = ",".join([str(t.value if hasattr(t, "value") else t) for t in types])
    return params


def _bool_query(value):
    if value is None:
        return None
    return "true" if bool(value) else "false"
