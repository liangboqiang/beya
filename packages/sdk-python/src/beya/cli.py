import argparse
import json
import sys

from .client import BeyaClient


def main(argv=None):
    parser = argparse.ArgumentParser(prog="beya")
    parser.add_argument("--base-url", default="http://127.0.0.1:3456")
    parser.add_argument("--api-key")
    parser.add_argument("--bearer-token")
    sub = parser.add_subparsers(dest="command", required=True)

    chat = sub.add_parser("chat", help="Run a Beya chat turn")
    chat.add_argument("message")
    chat.add_argument("--session-id")
    chat.add_argument("--work-dir")
    chat.add_argument("--provider")
    chat.add_argument("--model")
    chat.add_argument("--permission-mode")
    chat.add_argument("--stream", action="store_true")

    sub.add_parser("tasks-list")
    sub.add_parser("task-lists")
    task_list = sub.add_parser("task-list")
    task_list.add_argument("id")
    task_reset = sub.add_parser("task-reset")
    task_reset.add_argument("id")

    sub.add_parser("sessions-list")
    session_get = sub.add_parser("session-get")
    session_get.add_argument("session_id")
    session_history = sub.add_parser("session-history")
    session_history.add_argument("session_id")
    session_title = sub.add_parser("session-title")
    session_title.add_argument("session_id")
    session_title.add_argument("title")

    sub.add_parser("tools-list")
    tool_get = sub.add_parser("tool-get")
    tool_get.add_argument("name")
    tool_exec = sub.add_parser("tool-exec")
    tool_exec.add_argument("name")
    tool_exec.add_argument("--arguments", default="{}")
    tool_exec.add_argument("--session-id")

    sub.add_parser("skills-list")
    skill_get = sub.add_parser("skill-get")
    skill_get.add_argument("name")
    skill_get.add_argument("--source")
    skill_use = sub.add_parser("skill-use")
    skill_use.add_argument("name")
    skill_use.add_argument("query")

    sub.add_parser("plugins-list")
    plugin_get = sub.add_parser("plugin-get")
    plugin_get.add_argument("id")
    for command in ("plugin-enable", "plugin-disable", "plugin-update", "plugin-uninstall"):
        plugin = sub.add_parser(command)
        plugin.add_argument("id")
        plugin.add_argument("--scope")
        if command == "plugin-uninstall":
            plugin.add_argument("--keep-data", action="store_true")
    sub.add_parser("plugins-reload")

    sub.add_parser("providers-list")
    sub.add_parser("providers-catalog")
    provider_activate = sub.add_parser("provider-activate")
    provider_activate.add_argument("id")
    provider_test = sub.add_parser("provider-test")
    provider_test.add_argument("id")

    sub.add_parser("models-list")
    sub.add_parser("model-current")
    model_set = sub.add_parser("model-set")
    model_set.add_argument("model_id")

    sub.add_parser("mcp-list")
    sub.add_parser("schedules-list")
    sub.add_parser("teams-list")
    sub.add_parser("agents-list")
    sub.add_parser("diagnostics-export")

    workspace_list = sub.add_parser("workspace-list")
    workspace_list.add_argument("session_id")
    workspace_list.add_argument("--path", default="")
    workspace_read = sub.add_parser("workspace-read")
    workspace_read.add_argument("session_id")
    workspace_read.add_argument("path")
    workspace_write = sub.add_parser("workspace-write")
    workspace_write.add_argument("session_id")
    workspace_write.add_argument("path")
    workspace_write.add_argument("content")

    local_browse = sub.add_parser("local-browse")
    local_browse.add_argument("--path")
    local_browse.add_argument("--search")
    local_browse.add_argument("--include-files", action="store_true")
    sub.add_parser("local-open-targets")

    args = parser.parse_args(argv)
    client = BeyaClient(
        base_url=args.base_url,
        api_key=args.api_key,
        bearer_token=args.bearer_token,
    )

    if args.command == "chat":
        kwargs = {
            "session_id": args.session_id,
            "work_dir": args.work_dir,
            "provider_override": args.provider,
            "model_override": args.model,
            "permission_mode": args.permission_mode,
        }
        if args.stream:
            for event in client.chat.stream(args.message, **kwargs):
                print(json.dumps(_json(event), ensure_ascii=False))
            return 0
        return _print(client.chat.run(args.message, **kwargs))
    if args.command == "tasks-list":
        return _print(client.tasks.list())
    if args.command == "task-lists":
        return _print(client.tasks.lists())
    if args.command == "task-list":
        return _print(client.tasks.get_list(args.id))
    if args.command == "task-reset":
        return _print(client.tasks.reset_list(args.id))
    if args.command == "sessions-list":
        return _print(client.sessions.list())
    if args.command == "session-get":
        return _print(client.sessions.get(args.session_id))
    if args.command == "session-history":
        return _print(client.sessions.history(args.session_id))
    if args.command == "session-title":
        return _print(client.sessions.update_title(args.session_id, args.title))
    if args.command == "tools-list":
        return _print(client.tools.list())
    if args.command == "tool-get":
        return _print(client.tools.get(args.name))
    if args.command == "tool-exec":
        return _print(client.tools.execute(args.name, arguments=json.loads(args.arguments), session_id=args.session_id))
    if args.command == "skills-list":
        return _print(client.skills.list())
    if args.command == "skill-get":
        return _print(client.skills.get(args.name, source=args.source))
    if args.command == "skill-use":
        return _print(client.skills.use(args.name, args.query))
    if args.command == "plugins-list":
        return _print(client.plugins.list())
    if args.command == "plugin-get":
        return _print(client.plugins.get(args.id))
    if args.command == "plugin-enable":
        return _print(client.plugins.enable(args.id, scope=args.scope))
    if args.command == "plugin-disable":
        return _print(client.plugins.disable(args.id, scope=args.scope))
    if args.command == "plugin-update":
        return _print(client.plugins.update(args.id, scope=args.scope))
    if args.command == "plugin-uninstall":
        return _print(client.plugins.uninstall(args.id, scope=args.scope, keep_data=args.keep_data))
    if args.command == "plugins-reload":
        return _print(client.plugins.reload())
    if args.command == "providers-list":
        return _print(client.providers.list())
    if args.command == "providers-catalog":
        return _print(client.providers.catalog())
    if args.command == "provider-activate":
        return _print(client.providers.activate(args.id))
    if args.command == "provider-test":
        return _print(client.providers.test(args.id))
    if args.command == "models-list":
        return _print(client.models.list())
    if args.command == "model-current":
        return _print(client.models.current())
    if args.command == "model-set":
        return _print(client.models.set_current(args.model_id))
    if args.command == "mcp-list":
        return _print(client.mcp.list())
    if args.command == "schedules-list":
        return _print(client.schedules.list())
    if args.command == "teams-list":
        return _print(client.teams.list())
    if args.command == "agents-list":
        return _print(client.agents.list())
    if args.command == "diagnostics-export":
        return _print(client.diagnostics.export())
    if args.command == "workspace-list":
        return _print(client.workspace.list(args.session_id, path=args.path))
    if args.command == "workspace-read":
        return _print(client.workspace.read(args.session_id, args.path))
    if args.command == "workspace-write":
        return _print(client.workspace.write(args.session_id, args.path, args.content))
    if args.command == "local-browse":
        return _print(client.local.browse(path=args.path, search=args.search, include_files=args.include_files))
    if args.command == "local-open-targets":
        return _print(client.local.open_targets())
    return 2


def _json(value):
    if hasattr(value, "__dict__"):
        return {
            key: _json(entry)
            for key, entry in value.__dict__.items()
            if not key.startswith("_")
        }
    if isinstance(value, list):
        return [_json(entry) for entry in value]
    if isinstance(value, dict):
        return {key: _json(entry) for key, entry in value.items()}
    return value


def _print(value):
    print(json.dumps(_json(value), ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
