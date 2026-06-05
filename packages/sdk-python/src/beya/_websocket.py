import base64
import hashlib
import json
import os
import socket
import ssl
import struct
from urllib.parse import urlsplit


_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocketProtocolError(RuntimeError):
    pass


class WebSocketClient:
    def __init__(self, url, headers=None, timeout=None):
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.sock = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def connect(self):
        parsed = urlsplit(self.url)
        if parsed.scheme not in ("ws", "wss"):
            raise WebSocketProtocolError("Unsupported WebSocket scheme: %s" % parsed.scheme)

        host = parsed.hostname
        if not host:
            raise WebSocketProtocolError("WebSocket URL is missing host")
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query

        raw = socket.create_connection((host, port), timeout=self.timeout)
        if parsed.scheme == "wss":
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        raw.settimeout(self.timeout)
        self.sock = raw

        key = base64.b64encode(os.urandom(16)).decode("ascii")
        host_header = host if parsed.port is None else "%s:%s" % (host, port)
        request_headers = {
            "Host": host_header,
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": key,
            "Sec-WebSocket-Version": "13",
        }
        request_headers.update(self.headers)
        request = "GET %s HTTP/1.1\r\n%s\r\n\r\n" % (
            path,
            "\r\n".join("%s: %s" % (name, value) for name, value in request_headers.items()),
        )
        raw.sendall(request.encode("ascii"))
        response = _read_http_response(raw)
        status_line = response.split("\r\n", 1)[0]
        if " 101 " not in status_line:
            raise WebSocketProtocolError("WebSocket upgrade failed: %s" % status_line)
        accept = _header_value(response, "sec-websocket-accept")
        expected = base64.b64encode(hashlib.sha1((key + _GUID).encode("ascii")).digest()).decode("ascii")
        if accept != expected:
            raise WebSocketProtocolError("WebSocket upgrade returned invalid accept header")

    def send_json(self, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_frame(0x1, data)

    def recv_json(self):
        while True:
            opcode, payload = self._read_frame()
            if opcode == 0x1:
                return json.loads(payload.decode("utf-8"))
            if opcode == 0x8:
                return None
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue

    def close(self):
        if not self.sock:
            return
        try:
            self._send_frame(0x8, b"")
        except Exception:
            pass
        try:
            self.sock.close()
        finally:
            self.sock = None

    def _send_frame(self, opcode, payload):
        if not self.sock:
            raise WebSocketProtocolError("WebSocket is not connected")
        length = len(payload)
        header = bytearray([0x80 | opcode])
        mask_bit = 0x80
        if length < 126:
            header.append(mask_bit | length)
        elif length <= 0xFFFF:
            header.append(mask_bit | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(mask_bit | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def _read_frame(self):
        if not self.sock:
            raise WebSocketProtocolError("WebSocket is not connected")
        first = _read_exact(self.sock, 2)
        b1, b2 = first[0], first[1]
        opcode = b1 & 0x0F
        masked = bool(b2 & 0x80)
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", _read_exact(self.sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", _read_exact(self.sock, 8))[0]
        mask = _read_exact(self.sock, 4) if masked else b""
        payload = _read_exact(self.sock, length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload


def _read_http_response(sock):
    buffer = b""
    while b"\r\n\r\n" not in buffer:
        chunk = sock.recv(4096)
        if not chunk:
            break
        buffer += chunk
        if len(buffer) > 65536:
            raise WebSocketProtocolError("WebSocket HTTP upgrade response is too large")
    return buffer.decode("iso-8859-1")


def _read_exact(sock, size):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise WebSocketProtocolError("WebSocket closed while reading frame")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _header_value(response, name):
    prefix = name.lower() + ":"
    for line in response.split("\r\n")[1:]:
        if line.lower().startswith(prefix):
            return line.split(":", 1)[1].strip()
    return None
