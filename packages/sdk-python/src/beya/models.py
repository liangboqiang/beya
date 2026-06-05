from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RunEvent:
    type: str
    session_id: str
    message: str = ""
    timestamp: Optional[str] = None
    seq: int = 0
    payload: Optional[Dict[str, Any]] = None
    result: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None

    @property
    def id(self):
        return str(self.seq)


Event = RunEvent


@dataclass
class ChatResult:
    session_id: str
    result: str = ""
    events: List[RunEvent] = field(default_factory=list)
    usage: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class TaskListItem:
    id: str
    subject: str = ""
    status: str = ""
    task_list_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


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
    message: str
    session_id: Optional[str] = None
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
