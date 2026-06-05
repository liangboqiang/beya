class BeyaError(Exception):
    def __init__(self, message, code=None, status=None, details=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


class AuthenticationError(BeyaError):
    pass


class ValidationError(BeyaError):
    pass


class PermissionDeniedError(BeyaError):
    pass


class RateLimitError(BeyaError):
    pass


class TaskNotFoundError(BeyaError):
    pass


class SessionNotFoundError(BeyaError):
    pass


class ProviderError(BeyaError):
    pass


class BeyaServerUnavailableError(BeyaError):
    pass


class LocalExecutionError(BeyaError):
    pass


class ServerError(BeyaError):
    pass


def error_from_response(status, payload):
    if isinstance(payload, dict):
        message = str(payload.get("message") or payload.get("error") or "HTTP %s" % status)
        code = payload.get("code") or str(status)
    else:
        message = str(payload or "HTTP %s" % status)
        code = str(status)
    kwargs = {"code": code, "status": status, "details": payload}
    lowered = message.lower()
    if status == 401:
        return AuthenticationError(message, **kwargs)
    if status == 403:
        return PermissionDeniedError(message, **kwargs)
    if status == 404 and "session" in lowered:
        return SessionNotFoundError(message, **kwargs)
    if status == 404 and "task" in lowered:
        return TaskNotFoundError(message, **kwargs)
    if status == 400:
        return ValidationError(message, **kwargs)
    if status == 429:
        return RateLimitError(message, **kwargs)
    if "provider" in lowered:
        return ProviderError(message, **kwargs)
    if "local" in lowered or "terminal" in lowered or "computer" in lowered:
        return LocalExecutionError(message, **kwargs)
    if status >= 500:
        return BeyaServerUnavailableError(message, **kwargs)
    return BeyaError(message, **kwargs)
