from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class EventType(str, Enum):
    TASK_STARTED = "TASK_STARTED"
    WORKFLOW_COMPLETED = "WORKFLOW_COMPLETED"
    WORKFLOW_FAILED = "WORKFLOW_FAILED"
    WORKFLOW_CANCELLED = "WORKFLOW_CANCELLED"
    AGENT_THINKING = "AGENT_THINKING"
    LLM_PARTIAL = "LLM_PARTIAL"
    TOOL_INVOKED = "TOOL_INVOKED"
    TOOL_OBSERVATION = "TOOL_OBSERVATION"
    APPROVAL_REQUESTED = "APPROVAL_REQUESTED"
    STREAM_END = "done"


class TaskStatusEnum(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass
class Event:
    type: str
    task_id: str
    workflow_id: str
    session_id: str
    message: str
    timestamp: str
    seq: int = 0
    stream_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    result: Optional[str] = None
    error: Optional[str] = None

    @property
    def id(self):
        return self.stream_id or str(self.seq)


@dataclass
class TaskHandle:
    task_id: str
    workflow_id: str
    session_id: Optional[str] = None
    status: str = TaskStatusEnum.QUEUED.value
    _client: Any = field(default=None, repr=False)

    def _set_client(self, client):
        self._client = client
        return self

    def wait(self, timeout=None):
        if self._client is None:
            raise RuntimeError("TaskHandle is not associated with a client")
        return self._client.wait(self.task_id, timeout=timeout)

    def stream(self, types=None):
        if self._client is None:
            raise RuntimeError("TaskHandle is not associated with a client")
        return self._client.stream(self.task_id, types=types)

    def cancel(self, reason=None):
        if self._client is None:
            raise RuntimeError("TaskHandle is not associated with a client")
        return self._client.cancel(self.task_id, reason=reason)


@dataclass
class TaskStatus:
    task_id: str
    workflow_id: str
    query: str
    status: str
    session_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[str] = None
    error_message: Optional[str] = None
    model_used: Optional[str] = None
    provider: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class OpenAIChatMessage:
    role: str
    content: Any
    name: Optional[str] = None


@dataclass
class OpenAIChatCompletion:
    id: str
    object: str
    created: int
    model: str
    choices: List[Dict[str, Any]]
    usage: Optional[Dict[str, Any]] = None
    beya_task_id: Optional[str] = None
    beya_session_id: Optional[str] = None


@dataclass
class OpenAIChatCompletionChunk:
    id: str
    object: str
    created: int
    model: str
    choices: List[Dict[str, Any]]
    beya_events: List[Dict[str, Any]] = field(default_factory=list)


RunEvent = Event


@dataclass
class WorkspaceFile:
    path: str
    name: Optional[str] = None
    is_directory: bool = False
    size: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class DiagnosticEvent:
    type: str
    summary: str
    severity: str = "info"
    timestamp: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


@dataclass
class Schedule:
    id: str
    name: str
    enabled: bool = True
    cron: Optional[str] = None
    query: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ReviewState:
    status: str
    task_id: Optional[str] = None
    current_plan: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ApprovalRequest:
    approval_id: str
    task_id: str
    message: str
    payload: Optional[Dict[str, Any]] = None


Session = Dict[str, Any]
SessionSummary = Dict[str, Any]
ToolDetail = Dict[str, Any]
SkillDetail = Dict[str, Any]
PluginDetail = Dict[str, Any]
ProviderInfo = Dict[str, Any]
ModelInfo = Dict[str, Any]
McpServerInfo = Dict[str, Any]
AgentInfo = Dict[str, Any]
TeamInfo = Dict[str, Any]
