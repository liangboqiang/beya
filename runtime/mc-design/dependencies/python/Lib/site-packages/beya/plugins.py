import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


JsonObject = Dict[str, Any]


@dataclass
class RemoteToolExecutor:
    url: str
    method: str = "POST"
    headers: Dict[str, str] = field(default_factory=dict)
    tool_name: Optional[str] = None
    namespace: Optional[str] = None

    def to_dict(self):
        data = {
            "type": "http",
            "url": self.url,
            "method": self.method,
            "headers": dict(self.headers),
            "toolName": self.tool_name,
            "namespace": self.namespace,
        }
        return _drop_none(data)


@dataclass
class ConnectorToolExecutor:
    url: str
    connector_id: str
    action: Optional[str] = None
    method: str = "POST"
    headers: Dict[str, str] = field(default_factory=dict)
    tool_name: Optional[str] = None
    namespace: Optional[str] = None

    def to_dict(self):
        data = {
            "type": "http",
            "url": self.url,
            "method": self.method,
            "headers": dict(self.headers),
            "toolName": self.action or self.tool_name,
            "namespace": self.namespace or self.connector_id,
        }
        return _drop_none(data)


@dataclass
class SdkToolDefinition:
    name: str
    description: str
    input_schema: JsonObject = field(default_factory=lambda: {"type": "object", "properties": {}})
    executor: Optional[Union[RemoteToolExecutor, ConnectorToolExecutor]] = None
    annotations: JsonObject = field(default_factory=dict)
    search_hint: Optional[str] = None
    always_load: bool = False

    def to_server_tool(self):
        data = {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema,
            "executor": self.executor.to_dict() if self.executor else None,
            "annotations": dict(self.annotations),
            "searchHint": self.search_hint,
            "alwaysLoad": self.always_load,
        }
        return _drop_none(data)


@dataclass
class SdkSkillDefinition:
    name: str
    description: str
    content: str
    when_to_use: Optional[str] = None
    allowed_tools: List[str] = field(default_factory=list)
    argument_hint: Optional[str] = None
    model: Optional[str] = None
    user_invocable: bool = True

    def to_server_skill(self):
        data = {
            "name": self.name,
            "description": self.description,
            "content": self.content,
            "whenToUse": self.when_to_use,
            "allowedTools": list(self.allowed_tools),
            "argumentHint": self.argument_hint,
            "model": self.model,
            "userInvocable": self.user_invocable,
        }
        return _drop_none(data)


@dataclass
class SdkPluginDefinition:
    name: str
    description: str = ""
    tools: List[SdkToolDefinition] = field(default_factory=list)
    skills: List[SdkSkillDefinition] = field(default_factory=list)
    resources: List[str] = field(default_factory=list)
    mcp_servers: JsonObject = field(default_factory=dict)
    metadata: JsonObject = field(default_factory=dict)

    def to_server_inline_ref(self):
        return {
            "type": "inline",
            "definition": {
                "name": self.name,
                "description": self.description,
                "tools": [tool.to_server_tool() for tool in self.tools],
                "skills": [skill.to_server_skill() for skill in self.skills],
                "resources": list(self.resources),
                "mcpServers": dict(self.mcp_servers),
                "metadata": dict(self.metadata),
            },
        }

    def to_manifest(self):
        manifest = {
            "name": self.name,
            "description": self.description,
            "version": str(self.metadata.get("version") or "0.1.0"),
        }
        if self.skills:
            manifest["skills"] = "./skills"
        if self.tools:
            manifest["tools"] = "./tools"
        if self.resources:
            manifest["resources"] = "./resources"
        if self.mcp_servers:
            manifest["mcpServers"] = self.mcp_servers
        return manifest

    def write(self, path):
        root = os.path.abspath(path)
        os.makedirs(root, exist_ok=True)
        manifest_root = os.path.join(root, ".beya-plugin")
        os.makedirs(manifest_root, exist_ok=True)
        with open(os.path.join(manifest_root, "plugin.json"), "w", encoding="utf-8") as fh:
            json.dump(self.to_manifest(), fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        if self.skills:
            skills_root = os.path.join(root, "skills")
            os.makedirs(skills_root, exist_ok=True)
            for skill in self.skills:
                skill_dir = os.path.join(skills_root, _safe_name(skill.name))
                os.makedirs(skill_dir, exist_ok=True)
                with open(os.path.join(skill_dir, "SKILL.md"), "w", encoding="utf-8") as fh:
                    fh.write(skill.content.rstrip() + "\n")
        if self.tools:
            tools_root = os.path.join(root, "tools")
            os.makedirs(tools_root, exist_ok=True)
            for tool in self.tools:
                tool_dir = os.path.join(tools_root, _safe_name(tool.name))
                os.makedirs(tool_dir, exist_ok=True)
                with open(os.path.join(tool_dir, "tool.json"), "w", encoding="utf-8") as fh:
                    json.dump(tool.to_server_tool(), fh, ensure_ascii=False, indent=2)
                    fh.write("\n")
        if self.resources:
            resources_root = os.path.join(root, "resources")
            os.makedirs(resources_root, exist_ok=True)
            for index, resource in enumerate(self.resources):
                with open(os.path.join(resources_root, "resource-%03d.md" % (index + 1)), "w", encoding="utf-8") as fh:
                    fh.write(str(resource).rstrip() + "\n")
        return root


def define_tool(name, description, input_schema=None, executor=None, annotations=None, search_hint=None, always_load=False):
    return SdkToolDefinition(
        name=name,
        description=description,
        input_schema=input_schema or {"type": "object", "properties": {}},
        executor=executor,
        annotations=annotations or {},
        search_hint=search_hint,
        always_load=always_load,
    )


def define_skill(name, description, content, when_to_use=None, allowed_tools=None, argument_hint=None, model=None, user_invocable=True):
    return SdkSkillDefinition(
        name=name,
        description=description,
        content=content,
        when_to_use=when_to_use,
        allowed_tools=list(allowed_tools or []),
        argument_hint=argument_hint,
        model=model,
        user_invocable=user_invocable,
    )


def define_plugin(name, description="", tools=None, skills=None, resources=None, mcp_servers=None, metadata=None):
    return SdkPluginDefinition(
        name=name,
        description=description,
        tools=list(tools or []),
        skills=list(skills or []),
        resources=list(resources or []),
        mcp_servers=dict(mcp_servers or {}),
        metadata=dict(metadata or {}),
    )


def _safe_name(value):
    return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "-" for ch in str(value)).strip("-") or "item"


def _drop_none(data):
    return {key: value for key, value in data.items() if value is not None}
