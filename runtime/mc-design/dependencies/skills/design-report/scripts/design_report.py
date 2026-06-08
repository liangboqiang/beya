from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import struct
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET


NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "xml": "http://www.w3.org/XML/1998/namespace",
}
for prefix, uri in NS.items():
    if prefix not in {"ct", "rel", "xml"}:
        ET.register_namespace(prefix, uri)


SLOT_PATTERN = re.compile(r"\[\[type:.*?\]\]", flags=re.S)
SLOT_FIELD_NAMES = ("type", "name", "section", "prompt", "schema", "format")
DEFAULT_TEMPLATE_NAME = "conrod_design_report_template.docx"
DEFAULT_REPORT_DIR = Path("design_reports")
DEFAULT_INPUT_DIR = DEFAULT_REPORT_DIR / "input"
DEFAULT_IMAGES_DIR = DEFAULT_REPORT_DIR / "images"
DEFAULT_OUTPUT_DIR = DEFAULT_REPORT_DIR / "output"
DEFAULT_SLOT_SNAPSHOT_NAME = "conrod_design_report_slots.json"
DEFAULT_PAYLOAD_NAME = "report_payload.json"
DEFAULT_OUTPUT_NAME = "design_report.docx"
PAYLOAD_SCHEMA_FILE = "report_payload.schema.json"
TEMPLATE_SLOT_SCHEMA_FILE = "template_slot_schema.json"
EMU_PER_MM = 36000


@dataclass(frozen=True)
class Slot:
    token: str
    type: str
    name: str
    section: str = ""
    prompt: str = ""
    schema: Any = None
    format: Optional[Dict[str, Any]] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "name": self.name,
            "section": self.section,
            "prompt": self.prompt,
            "schema": self.schema,
            "format": self.format or {},
            "token": self.token,
        }


def qn(prefix: str, name: str) -> str:
    return "{" + NS[prefix] + "}" + name


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def bundled_template() -> Path:
    explicit = os.environ.get("MC_DESIGN_REPORT_TEMPLATE")
    if explicit:
        return Path(explicit).resolve()
    name = os.environ.get("MC_DESIGN_REPORT_TEMPLATE_NAME") or DEFAULT_TEMPLATE_NAME
    return skill_root() / "templates" / safe_segment(name)


def resource_path(name: str) -> Path:
    return skill_root() / "resources" / name


def workspace_root(value: Optional[str]) -> Path:
    return Path(value or ".").resolve()


def safe_segment(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.\-\u4e00-\u9fff]+", "_", str(value or "default")).strip("._")
    return cleaned or "default"


def conversation_paths(workspace: Path, conversation_id: str) -> Dict[str, Path]:
    cid = safe_segment(conversation_id)
    input_dir = workspace / DEFAULT_INPUT_DIR / cid
    image_dir = workspace / DEFAULT_IMAGES_DIR / cid
    output_dir = workspace / DEFAULT_OUTPUT_DIR / cid
    return {
        "input_dir": input_dir,
        "image_dir": image_dir,
        "output_dir": output_dir,
        "slot_snapshot": input_dir / DEFAULT_SLOT_SNAPSHOT_NAME,
        "payload_skeleton": input_dir / DEFAULT_PAYLOAD_NAME,
        "default_output": output_dir / DEFAULT_OUTPUT_NAME,
    }


def parse_slot(token: str) -> Slot:
    inner = token[2:-2].strip()
    fields: Dict[str, str] = {}
    for key in SLOT_FIELD_NAMES:
        match = re.search(
            r"(?:^|,)\s*" + re.escape(key) + r"\s*:(.*?)(?=,\s*(?:type|name|section|prompt|schema|format)\s*:|$)",
            inner,
            flags=re.S,
        )
        if match:
            fields[key] = match.group(1).strip()

    section = fields.get("section", "")
    if "prompt:" in section and "prompt" not in fields:
        before, after = section.split("prompt:", 1)
        fields["section"] = before.strip().rstrip(",")
        fields["prompt"] = after.strip()
    prompt = fields.get("prompt", "")
    if "schema:" in prompt and "schema" not in fields:
        before, after = prompt.split("schema:", 1)
        fields["prompt"] = before.strip().rstrip(",")
        fields["schema"] = after.strip()

    schema_value = parse_jsonish(fields.get("schema"))
    format_value = parse_jsonish(fields.get("format"))
    return Slot(
        token=token,
        type=fields.get("type", "").strip().lower() or "text",
        name=fields.get("name", "").strip(),
        section=fields.get("section", "").strip(),
        prompt=fields.get("prompt", "").strip(),
        schema=schema_value,
        format=format_value if isinstance(format_value, dict) else {},
    )


def parse_jsonish(value: Optional[str]) -> Any:
    if not value:
        return None
    text = str(value).strip()
    for old, new in {
        "“": '"',
        "”": '"',
        "„": '"',
        "＂": '"',
        "‘": "'",
        "’": "'",
        "\u00a0": " ",
    }.items():
        text = text.replace(old, new)
    try:
        return json.loads(text)
    except Exception:
        return text


def document_xml_parts(names: List[str]) -> List[str]:
    out = ["word/document.xml"] if "word/document.xml" in names else []
    out.extend(sorted(name for name in names if re.fullmatch(r"word/(header|footer)\d+\.xml", name)))
    return out


def paragraph_text(paragraph: ET.Element) -> str:
    return "".join(node.text or "" for node in paragraph.iter(qn("w", "t")))


def extract_slots(template_path: Path) -> List[Slot]:
    slots: List[Slot] = []
    seen_tokens = set()
    with zipfile.ZipFile(template_path, "r") as archive:
        for part_name in document_xml_parts(archive.namelist()):
            root = ET.fromstring(archive.read(part_name))
            for paragraph in root.iter(qn("w", "p")):
                for token in SLOT_PATTERN.findall(paragraph_text(paragraph)):
                    if token in seen_tokens:
                        continue
                    seen_tokens.add(token)
                    slots.append(parse_slot(token))
    return slots


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_template(template: Optional[Path] = None) -> Dict[str, Any]:
    source = (template or bundled_template()).resolve()
    if not source.is_file():
        raise FileNotFoundError("Bundled report template is missing: %s" % source)
    slots = extract_slots(source)
    return {
        "ok": True,
        "template_path": str(source),
        "template_sha256": file_sha256(source),
        "slot_count": len(slots),
        "text_slot_count": sum(1 for slot in slots if slot.type == "text"),
        "image_slot_count": sum(1 for slot in slots if slot.type == "image"),
        "payload_schema_path": str(resource_path(PAYLOAD_SCHEMA_FILE)),
        "template_slot_schema_path": str(resource_path(TEMPLATE_SLOT_SCHEMA_FILE)),
        "slots": [slot.as_dict() for slot in slots],
    }


def prepare_workspace(workspace: Path, conversation_id: str, output_name: str = DEFAULT_OUTPUT_NAME) -> Dict[str, Any]:
    info = inspect_template()
    slots = [parse_slot(str(slot["token"])) for slot in info["slots"]]
    paths = conversation_paths(workspace, conversation_id)
    for key in ("input_dir", "image_dir", "output_dir"):
        paths[key].mkdir(parents=True, exist_ok=True)

    output_path = paths["output_dir"] / safe_segment(output_name)
    if output_path.suffix.lower() != ".docx":
        output_path = output_path.with_suffix(".docx")

    slot_snapshot = {
        "ok": True,
        "template_path": info["template_path"],
        "template_sha256": info["template_sha256"],
        "slot_count": info["slot_count"],
        "slots": info["slots"],
    }
    paths["slot_snapshot"].write_text(json.dumps(slot_snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    skeleton = {
        "output_path": relative_to_workspace(output_path, workspace),
        "slots": {slot.name: skeleton_entry(slot, workspace, conversation_id) for slot in slots},
    }
    paths["payload_skeleton"].write_text(json.dumps(skeleton, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "status": "prepared",
        "template_path": info["template_path"],
        "template_sha256": info["template_sha256"],
        "workspace": str(workspace),
        "conversation_id": safe_segment(conversation_id),
        "input_dir": str(paths["input_dir"]),
        "images_dir": str(paths["image_dir"]),
        "output_dir": str(paths["output_dir"]),
        "payload_skeleton_path": str(paths["payload_skeleton"]),
        "slot_snapshot_path": str(paths["slot_snapshot"]),
        "default_output_path": str(output_path),
        "slot_count": info["slot_count"],
        "text_slot_count": info["text_slot_count"],
        "image_slot_count": info["image_slot_count"],
        "slots": info["slots"],
    }


def ensure_template(workspace: Path, conversation_id: str = "default", output_name: str = DEFAULT_OUTPUT_NAME) -> Dict[str, Any]:
    payload = prepare_workspace(workspace, conversation_id, output_name)
    payload["copied"] = False
    payload["note"] = "Compatibility alias: the report template stays in the design-report skill; workspace stores only snapshots, payloads, images, and outputs."
    return payload


def skeleton_entry(slot: Slot, workspace: Path, conversation_id: str) -> Dict[str, Any]:
    if is_auto_fill_slot(slot):
        return {
            "status": "auto",
            "source": "design_report.py:auto_fill",
            "prompt": slot.prompt,
            "schema": slot.schema,
        }
    if slot.type == "image":
        image_name = safe_segment(slot.name or slot.section or "image") + ".png"
        return {
            "status": "needs_evidence",
            "image_path": str((DEFAULT_IMAGES_DIR / safe_segment(conversation_id) / image_name).as_posix()),
            "source": "nx_create_image",
            "prompt": slot.prompt,
            "format": slot.format or {},
        }
    return {
        "status": "needs_evidence",
        "value": "",
        "source": "",
        "prompt": slot.prompt,
        "schema": slot.schema,
    }


def load_payload(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("report payload must be a JSON object")
    return data


def normalize_slot_values(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    raw_slots = payload.get("slots") or payload.get("slot_values") or {}
    if isinstance(raw_slots, dict):
        for key, value in raw_slots.items():
            out[str(key)] = normalize_slot_entry(value)
    elif isinstance(raw_slots, list):
        for item in raw_slots:
            if not isinstance(item, dict):
                continue
            key = str(item.get("name") or item.get("slot") or item.get("section") or "").strip()
            if key:
                out[key] = normalize_slot_entry(item)
    return out


def normalize_slot_entry(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {"value": value}


def entry_for_slot(slot: Slot, values: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for key in (slot.name, slot.section):
        if key and key in values:
            return values[key]
    return None


def validate_report_payload(workspace: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    template = bundled_template().resolve()
    if not template.is_file():
        raise FileNotFoundError("Bundled report template is missing: %s" % template)
    slots = extract_slots(template)
    values = normalize_slot_values(payload)

    errors: List[Dict[str, Any]] = []
    needs_confirmation: List[Dict[str, Any]] = []
    filled_slots: List[str] = []
    auto_filled_slots: List[str] = []
    confirmed_missing_slots: List[str] = []

    raw_slots = payload.get("slots") if "slots" in payload else payload.get("slot_values")
    if raw_slots is not None and not isinstance(raw_slots, (dict, list)):
        errors.append({"code": "INVALID_SLOTS", "message": "payload slots must be an object or array"})

    known_keys = set()
    for slot in slots:
        if slot.name:
            known_keys.add(slot.name)
        if slot.section:
            known_keys.add(slot.section)
    for key in values:
        if key not in known_keys:
            errors.append({"code": "UNKNOWN_SLOT", "slot": key, "message": "payload contains a slot not present in the DOCX template"})

    output_value = payload.get("output_path")
    if output_value:
        try:
            output_path = resolve_workspace_path(output_value, workspace)
            if output_path.suffix.lower() != ".docx":
                errors.append({"code": "INVALID_OUTPUT_PATH", "path": str(output_value), "message": "output_path must end with .docx"})
        except ValueError as exc:
            errors.append({"code": "OUTPUT_PATH_OUTSIDE_WORKSPACE", "path": str(output_value), "message": str(exc)})

    for slot in slots:
        entry = entry_for_slot(slot, values)
        if is_auto_fill_slot(slot) and (entry is None or str(entry.get("status") or "").lower() == "auto"):
            auto_filled_slots.append(slot.name)
            continue
        if is_confirmed_missing(entry):
            confirmed_missing_slots.append(slot.name)
            continue
        if entry is not None and str(entry.get("status") or "").lower() in {"missing", "pending", "todo", "needs_evidence"}:
            needs_confirmation.append(confirmation_request(slot, "slot is marked missing but has no user confirmation"))
            continue
        if slot.type == "image":
            image_status = validate_image_entry(slot, entry, workspace)
            if image_status["ok"]:
                filled_slots.append(slot.name)
            elif image_status["needs_confirmation"]:
                needs_confirmation.append(confirmation_request(slot, image_status["message"]))
            else:
                errors.append(image_status["error"])
            continue
        if entry_has_text(entry):
            filled_slots.append(slot.name)
        else:
            needs_confirmation.append(confirmation_request(slot, "slot has no tool evidence or user-confirmed value"))

    status = "ok"
    if errors:
        status = "invalid_payload"
    elif needs_confirmation:
        status = "needs_user_confirmation"

    return {
        "ok": status == "ok",
        "status": status,
        "template_path": str(template),
        "template_sha256": file_sha256(template),
        "slot_count": len(slots),
        "filled_slots": sorted(set(filled_slots)),
        "auto_filled_slots": sorted(set(auto_filled_slots)),
        "confirmed_missing_slots": sorted(set(confirmed_missing_slots)),
        "needs_user_confirmation": needs_confirmation,
        "missing_slots": sorted({str(item.get("name") or "") for item in needs_confirmation if item.get("name")}),
        "errors": errors,
    }


def validate_image_entry(slot: Slot, entry: Optional[Dict[str, Any]], workspace: Path) -> Dict[str, Any]:
    if entry is None:
        return {"ok": False, "needs_confirmation": True, "message": "image slot has no image_path"}
    raw = entry.get("image_path") or entry.get("path") or entry.get("file_path") or entry.get("value")
    if raw is None or str(raw).strip() == "":
        return {"ok": False, "needs_confirmation": True, "message": "image slot has an empty image_path"}
    try:
        path = resolve_workspace_path(raw, workspace)
    except ValueError as exc:
        return {
            "ok": False,
            "needs_confirmation": False,
            "error": {"code": "IMAGE_PATH_OUTSIDE_WORKSPACE", "slot": slot.name, "path": str(raw), "message": str(exc)},
        }
    if not path.is_file():
        return {
            "ok": False,
            "needs_confirmation": False,
            "error": {"code": "IMAGE_NOT_FOUND", "slot": slot.name, "path": str(path), "message": "image file does not exist"},
        }
    return {"ok": True, "needs_confirmation": False}


def entry_has_text(entry: Optional[Dict[str, Any]]) -> bool:
    if not entry:
        return False
    for key in ("value", "text", "content"):
        if key in entry and entry[key] is not None and str(entry[key]).strip() != "":
            return True
    return False


def is_confirmed_missing(entry: Optional[Dict[str, Any]]) -> bool:
    if not entry:
        return False
    if str(entry.get("status") or "").lower() != "confirmed_missing":
        return False
    return str(entry.get("confirmation_source") or "").lower() == "user" and str(entry.get("reason") or "").strip() != ""


def confirmed_missing_text(entry: Dict[str, Any]) -> str:
    return "用户确认暂缺：" + str(entry.get("reason") or "").strip()


def is_auto_fill_slot(slot: Slot) -> bool:
    schema = slot.schema if isinstance(slot.schema, dict) else {}
    auto_fill = str(schema.get("auto_fill") or schema.get("autoFill") or "").strip().lower()
    if auto_fill:
        return True
    name = slot.name.strip()
    prompt = slot.prompt.strip()
    if name == "当前日期" or ("当前日期" in prompt and "获取" in prompt):
        return True
    if name == "当前时间" or ("当前时间" in prompt and "获取" in prompt):
        return True
    return False


def auto_fill_value(slot: Slot, now: datetime) -> str:
    schema = slot.schema if isinstance(slot.schema, dict) else {}
    auto_fill = str(schema.get("auto_fill") or schema.get("autoFill") or "").strip().lower()
    if auto_fill in {"date", "current_date"} or slot.name == "当前日期":
        return now.strftime("%Y/%m/%d")
    if auto_fill in {"time", "datetime", "current_time"} or slot.name == "当前时间":
        return now.strftime("%Y/%m/%d %H:%M:%S")
    if "日期" in slot.name:
        return now.strftime("%Y/%m/%d")
    return now.strftime("%Y/%m/%d %H:%M:%S")


def confirmation_request(slot: Slot, reason: str) -> Dict[str, Any]:
    return {
        "name": slot.name,
        "section": slot.section,
        "type": slot.type,
        "prompt": slot.prompt,
        "reason": reason,
        "suggested_tools": suggested_tools(slot),
        "question": "请确认“%s”的填写内容，或明确确认暂缺并说明原因。" % (slot.name or slot.section),
    }


def suggested_tools(slot: Slot) -> List[str]:
    text = " ".join([slot.prompt, slot.section, slot.name]).lower()
    tools: List[str] = []
    known = [
        "teamcenter_get_parts_from_specified_folder",
        "teamcenter_get_process_personnel_information",
        "connect_qpp",
        "query_ipm_list",
        "query_ecr_list",
        "mysql_query",
        "nx_get_work_part_info",
        "nx_get_all_view_names",
        "nx_switch_view",
        "nx_create_image",
    ]
    for name in known:
        if name.lower() in text:
            tools.append(name)
    if "tc" in text or "teamcenter" in text:
        tools.append("tc_call")
    if "qpp" in text or "ipm" in text or "ecr" in text:
        tools.append("query_ipm_list")
    if "nx" in text or slot.type == "image":
        tools.append("tool.nx")
    if "mysql" in text:
        tools.append("mysql_query")
    return sorted(set(tools))


def text_for_slot(slot: Slot, entry: Optional[Dict[str, Any]], now: datetime) -> Tuple[str, str]:
    if is_confirmed_missing(entry):
        return confirmed_missing_text(entry or {}), "confirmed_missing"
    if entry:
        for key in ("value", "text", "content"):
            if key in entry and entry[key] is not None and str(entry[key]).strip() != "":
                return stringify(entry[key]), "filled"
    if is_auto_fill_slot(slot):
        return auto_fill_value(slot, now), "auto"
    return "", "missing"


def image_path_for_slot(slot: Slot, entry: Optional[Dict[str, Any]], workspace: Path) -> Optional[Path]:
    if not entry:
        return None
    raw = entry.get("image_path") or entry.get("path") or entry.get("file_path") or entry.get("value")
    if not raw:
        return None
    return resolve_workspace_path(raw, workspace)


def stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, default=str)


def clear_paragraph(paragraph: ET.Element) -> None:
    paragraph_properties = None
    for child in list(paragraph):
        if child.tag == qn("w", "pPr"):
            paragraph_properties = child
        paragraph.remove(child)
    if paragraph_properties is not None:
        paragraph.append(paragraph_properties)


def add_text_run(paragraph: ET.Element, text: str) -> None:
    if text == "":
        return
    lines = text.split("\n")
    run = ET.SubElement(paragraph, qn("w", "r"))
    for index, line in enumerate(lines):
        if index:
            ET.SubElement(run, qn("w", "br"))
        text_node = ET.SubElement(run, qn("w", "t"))
        if line.startswith(" ") or line.endswith(" "):
            text_node.set(qn("xml", "space"), "preserve")
        text_node.text = line


def add_image_run(paragraph: ET.Element, rel_id: str, image_name: str, width_emu: int, height_emu: int, docpr_id: int) -> None:
    run = ET.SubElement(paragraph, qn("w", "r"))
    drawing = ET.fromstring(
        '''
<w:drawing xmlns:w="{w}" xmlns:wp="{wp}" xmlns:a="{a}" xmlns:pic="{pic}" xmlns:r="{r}">
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="{width_emu}" cy="{height_emu}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="{docpr_id}" name="{image_name}"/>
    <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:nvPicPr>
            <pic:cNvPr id="0" name="{image_name}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="{rel_id}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="{width_emu}" cy="{height_emu}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
'''.format(
            w=NS["w"],
            wp=NS["wp"],
            a=NS["a"],
            pic=NS["pic"],
            r=NS["r"],
            width_emu=width_emu,
            height_emu=height_emu,
            docpr_id=docpr_id,
            image_name=xml_escape(image_name),
            rel_id=rel_id,
        )
    )
    run.append(drawing)


def xml_escape(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def image_dimensions(path: Path) -> Tuple[int, int]:
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            length = struct.unpack(">H", data[index : index + 2])[0]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF} and index + 7 < len(data):
                height, width = struct.unpack(">HH", data[index + 3 : index + 7])
                return width, height
            index += length
    return 1600, 900


def image_extension(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    if ext == "jpeg":
        return "jpg"
    if ext in {"png", "jpg"}:
        return ext
    return "png"


def content_type_for_extension(ext: str) -> str:
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext.lower(), "application/octet-stream")


def rels_path_for_part(part_name: str) -> str:
    part = Path(part_name.replace("\\", "/"))
    return str(part.parent / "_rels" / (part.name + ".rels")).replace("\\", "/")


def load_relationships(files: Dict[str, bytes], rels_path: str) -> ET.Element:
    if rels_path in files:
        return ET.fromstring(files[rels_path])
    return ET.Element(qn("rel", "Relationships"))


def next_relationship_id(rels_root: ET.Element, counter: int) -> str:
    existing = {str(rel.get("Id") or "") for rel in rels_root.findall(qn("rel", "Relationship"))}
    current = max(1, counter)
    while "rIdMcDesign%d" % current in existing:
        current += 1
    return "rIdMcDesign%d" % current


def add_image_relationship(rels_root: ET.Element, rel_id: str, media_name: str) -> None:
    rel = ET.SubElement(rels_root, qn("rel", "Relationship"))
    rel.set("Id", rel_id)
    rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
    rel.set("Target", "media/" + media_name)


def ensure_content_type(files: Dict[str, bytes], ext: str) -> None:
    path = "[Content_Types].xml"
    if path not in files:
        return
    root = ET.fromstring(files[path])
    for node in root.findall(qn("ct", "Default")):
        if str(node.get("Extension") or "").lower() == ext.lower():
            return
    node = ET.SubElement(root, qn("ct", "Default"))
    node.set("Extension", ext)
    node.set("ContentType", content_type_for_extension(ext))
    files[path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)


def replace_paragraph_slots(
    paragraph: ET.Element,
    values: Dict[str, Dict[str, Any]],
    workspace: Path,
    now: datetime,
    stats: Dict[str, Any],
    files: Dict[str, bytes],
    rels_root: ET.Element,
    state: Dict[str, int],
) -> None:
    text = paragraph_text(paragraph)
    matches = list(SLOT_PATTERN.finditer(text))
    if not matches:
        return
    clear_paragraph(paragraph)
    cursor = 0
    for match in matches:
        if match.start() > cursor:
            add_text_run(paragraph, text[cursor : match.start()])
        slot = parse_slot(match.group(0))
        entry = entry_for_slot(slot, values)
        if slot.type == "image":
            if is_confirmed_missing(entry):
                add_text_run(paragraph, confirmed_missing_text(entry or {}))
                stats["confirmed_missing_slots"].append(slot.name)
            else:
                image_path = image_path_for_slot(slot, entry, workspace)
                if image_path is None or not image_path.is_file():
                    raise ValueError("image for slot %s is unavailable after validation" % slot.name)
                width_px, height_px = image_dimensions(image_path)
                width_mm = 120.0
                try:
                    width_mm = float((slot.format or {}).get("width_mm") or width_mm)
                except Exception:
                    width_mm = 120.0
                height_mm = width_mm * (height_px / width_px) if width_px else width_mm * 0.5625
                ext = image_extension(image_path)
                state["image_index"] += 1
                media_name = "mcdesign_report_image_%d.%s" % (state["image_index"], ext)
                files["word/media/" + media_name] = image_path.read_bytes()
                ensure_content_type(files, ext)
                rel_id = next_relationship_id(rels_root, state["image_index"])
                add_image_relationship(rels_root, rel_id, media_name)
                add_image_run(
                    paragraph,
                    rel_id=rel_id,
                    image_name=slot.name or media_name,
                    width_emu=int(width_mm * EMU_PER_MM),
                    height_emu=int(height_mm * EMU_PER_MM),
                    docpr_id=10000 + state["image_index"],
                )
                caption = str((entry or {}).get("caption") or (slot.format or {}).get("caption") or "").strip()
                if caption:
                    add_text_run(paragraph, "\n" + caption)
                stats["filled_slots"].append(slot.name)
        else:
            replacement, status = text_for_slot(slot, entry, now)
            add_text_run(paragraph, replacement)
            stats["auto_filled_slots" if status == "auto" else "confirmed_missing_slots" if status == "confirmed_missing" else "filled_slots"].append(slot.name)
        cursor = match.end()
    if cursor < len(text):
        add_text_run(paragraph, text[cursor:])


def generate_report(workspace: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    validation = validate_report_payload(workspace, payload)
    if not validation["ok"]:
        return validation

    template = bundled_template().resolve()
    output = resolve_workspace_path(payload.get("output_path") or (DEFAULT_OUTPUT_DIR / DEFAULT_OUTPUT_NAME), workspace)
    output.parent.mkdir(parents=True, exist_ok=True)

    values = normalize_slot_values(payload)
    now = datetime.now()
    stats: Dict[str, Any] = {"filled_slots": [], "auto_filled_slots": [], "confirmed_missing_slots": []}
    with zipfile.ZipFile(template, "r") as archive:
        files = {info.filename: archive.read(info.filename) for info in archive.infolist() if not info.is_dir()}

    part_names = document_xml_parts(list(files))
    image_state = {"image_index": 0}
    for part_name in part_names:
        root = ET.fromstring(files[part_name])
        rels_path = rels_path_for_part(part_name)
        rels_root = load_relationships(files, rels_path)
        rel_count_before = len(rels_root.findall(qn("rel", "Relationship")))
        for paragraph in root.iter(qn("w", "p")):
            replace_paragraph_slots(
                paragraph,
                values=values,
                workspace=workspace,
                now=now,
                stats=stats,
                files=files,
                rels_root=rels_root,
                state=image_state,
            )
        files[part_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        if len(rels_root.findall(qn("rel", "Relationship"))) != rel_count_before or rels_path in files:
            files[rels_path] = ET.tostring(rels_root, encoding="utf-8", xml_declaration=True)

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)

    remaining = [slot.as_dict() for slot in extract_slots(output)]
    return {
        "ok": True,
        "status": "generated",
        "template_path": str(template),
        "template_sha256": file_sha256(template),
        "output_path": str(output),
        "slot_count": validation["slot_count"],
        "filled_slots": sorted(set(stats["filled_slots"])),
        "auto_filled_slots": sorted(set(stats["auto_filled_slots"])),
        "confirmed_missing_slots": sorted(set(stats["confirmed_missing_slots"])),
        "missing_slots": [],
        "remaining_raw_slot_count": len(remaining),
        "remaining_raw_slots": remaining,
    }


def resolve_path(value: Any, workspace: Path) -> Path:
    path = Path(str(value))
    if not path.is_absolute():
        path = workspace / path
    return path.resolve()


def resolve_workspace_path(value: Any, workspace: Path) -> Path:
    path = resolve_path(value, workspace)
    root = workspace.resolve()
    if not is_relative_to(path, root):
        raise ValueError("path escapes workspace: %s" % value)
    return path


def relative_to_workspace(path: Path, workspace: Path) -> str:
    try:
        return path.resolve().relative_to(workspace.resolve()).as_posix()
    except Exception:
        return str(path)


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def emit(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare, validate, and generate fixed-slot mc-design DOCX reports.")
    sub = parser.add_subparsers(dest="command", required=True)

    inspect = sub.add_parser("inspect-template", help="Inspect the bundled DOCX template slots.")
    inspect.add_argument("--template", default="", help="Optional DOCX template path for development inspection.")

    prepare = sub.add_parser("prepare", help="Prepare workspace report folders, slot snapshot, and payload skeleton.")
    prepare.add_argument("--workspace", default=".", help="Beya workspace root. Defaults to current directory.")
    prepare.add_argument("--conversation-id", default="default", help="Conversation id used for input, image, and output folders.")
    prepare.add_argument("--output-name", default=DEFAULT_OUTPUT_NAME, help="Default DOCX output file name.")

    ensure = sub.add_parser("ensure-template", help="Compatibility alias for prepare; does not copy the bundled template.")
    ensure.add_argument("--workspace", default=".", help="Beya workspace root. Defaults to current directory.")
    ensure.add_argument("--conversation-id", default="default", help="Conversation id used for input, image, and output folders.")
    ensure.add_argument("--output-name", default=DEFAULT_OUTPUT_NAME, help="Default DOCX output file name.")
    ensure.add_argument("--source-template", default="", help="Deprecated and ignored. The skill template is the only report template.")
    ensure.add_argument("--overwrite", action="store_true", help="Deprecated and ignored. The skill template is not copied.")

    extract = sub.add_parser("extract-slots", help="Compatibility alias for inspecting slots.")
    extract.add_argument("--workspace", default=".", help="Beya workspace root. Defaults to current directory.")
    extract.add_argument("--template", default="", help="Optional DOCX template path. Defaults to the bundled skill template.")
    extract.add_argument("--out", default="", help="Optional JSON output path under workspace.")

    validate = sub.add_parser("validate", help="Validate a report payload against the bundled template slots.")
    validate.add_argument("--workspace", default=".", help="Beya workspace root. Defaults to current directory.")
    validate.add_argument("--input", required=True, help="JSON payload containing slots and optional output_path.")

    generate = sub.add_parser("generate", help="Fill the bundled fixed-slot DOCX template from a validated JSON payload.")
    generate.add_argument("--workspace", default=".", help="Beya workspace root. Defaults to current directory.")
    generate.add_argument("--input", required=True, help="JSON payload containing slots and optional output_path.")

    args = parser.parse_args(argv)
    try:
        if args.command == "inspect-template":
            emit(inspect_template(Path(args.template).resolve() if args.template else None))
            return 0

        workspace = workspace_root(getattr(args, "workspace", "."))
        if args.command == "prepare":
            emit(prepare_workspace(workspace, str(args.conversation_id), str(args.output_name)))
            return 0
        if args.command == "ensure-template":
            emit(ensure_template(workspace, str(args.conversation_id), str(args.output_name)))
            return 0
        if args.command == "extract-slots":
            template = resolve_path(args.template, workspace) if args.template else bundled_template()
            payload = inspect_template(template)
            if args.out:
                out = resolve_workspace_path(args.out, workspace)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                payload["output_path"] = str(out)
            emit(payload)
            return 0
        if args.command == "validate":
            emit(validate_report_payload(workspace, load_payload(resolve_workspace_path(args.input, workspace))))
            return 0
        if args.command == "generate":
            result = generate_report(workspace, load_payload(resolve_workspace_path(args.input, workspace)))
            emit(result)
            return 0 if result.get("ok") else 1
    except Exception as exc:
        emit({"ok": False, "status": "error", "error": type(exc).__name__, "message": str(exc)})
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
