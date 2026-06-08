using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using NXSDK;

namespace NXServer
{
    public class HttpServer
    {
        private TcpListener _listener;
        private CancellationTokenSource _cts;
        private readonly int _port;
        private readonly string _apiPrefix;
        private readonly ToolManager _toolManager;

        public HttpServer(string endpoint, string apiPrefix, ToolManager toolManager)
        {
            _port = ParsePort(endpoint);
            _apiPrefix = NormalizeApiPrefix(apiPrefix);
            _toolManager = toolManager;
        }

        public void Start()
        {
            _cts = new CancellationTokenSource();
            _listener = new TcpListener(IPAddress.Loopback, _port);
            _listener.Start();
            Logger.LogInfo("Loopback NX tool server started on 127.0.0.1:" + _port);
            Task.Run(() => HandleRequests(_cts.Token));
        }

        public void Stop()
        {
            try { _cts?.Cancel(); } catch { }
            try { _listener?.Stop(); } catch { }
            Logger.LogInfo("Loopback NX tool server stopped.");
        }

        private async Task HandleRequests(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    var client = await _listener.AcceptTcpClientAsync();
                    var ignored = Task.Run(() => ProcessClient(client));
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (SocketException)
                {
                    if (token.IsCancellationRequested) break;
                }
                catch (Exception ex)
                {
                    Logger.LogError("Loopback request accept failed.", ex);
                }
            }
        }

        private async Task ProcessClient(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 120000;
                    client.SendTimeout = 120000;
                    using (var stream = client.GetStream())
                    {
                        var request = await ReadHttpRequest(stream);
                        var routed = await RouteRequest(request.Path, request.Method, request.Body);
                        await WriteResponse(stream, routed.Item1, routed.Item2);
                    }
                }
                catch (Exception ex)
                {
                    Logger.LogError("Loopback request processing failed.", ex);
                    try
                    {
                        using (var stream = client.GetStream())
                        {
                            await WriteResponse(stream, 500, NXResult.Fail(ex.Message));
                        }
                    }
                    catch { }
                }
            }
        }

        private async Task<HttpRequest> ReadHttpRequest(NetworkStream stream)
        {
            var buffer = new byte[8192];
            var data = new MemoryStream();
            int headerEnd = -1;

            while (headerEnd < 0)
            {
                var read = await stream.ReadAsync(buffer, 0, buffer.Length);
                if (read <= 0) break;
                data.Write(buffer, 0, read);
                var bytes = data.ToArray();
                headerEnd = FindHeaderEnd(bytes);
                if (data.Length > 1024 * 1024) throw new InvalidOperationException("HTTP request headers are too large.");
            }

            var all = data.ToArray();
            if (headerEnd < 0) throw new InvalidOperationException("Invalid HTTP request.");

            var headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
            var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) throw new InvalidOperationException("Invalid HTTP request line.");

            var parts = lines[0].Split(' ');
            if (parts.Length < 2) throw new InvalidOperationException("Invalid HTTP request line.");

            int contentLength = 0;
            for (int i = 1; i < lines.Length; i++)
            {
                var idx = lines[i].IndexOf(':');
                if (idx <= 0) continue;
                var key = lines[i].Substring(0, idx).Trim();
                var value = lines[i].Substring(idx + 1).Trim();
                if (string.Equals(key, "Content-Length", StringComparison.OrdinalIgnoreCase))
                    int.TryParse(value, out contentLength);
            }

            var bodyOffset = headerEnd + 4;
            var bodyBytes = new MemoryStream();
            if (all.Length > bodyOffset)
                bodyBytes.Write(all, bodyOffset, all.Length - bodyOffset);

            while (bodyBytes.Length < contentLength)
            {
                var remaining = contentLength - (int)bodyBytes.Length;
                var read = await stream.ReadAsync(buffer, 0, Math.Min(buffer.Length, remaining));
                if (read <= 0) break;
                bodyBytes.Write(buffer, 0, read);
            }

            var uriPath = parts[1].Split('?')[0].Trim('/');
            return new HttpRequest
            {
                Method = parts[0].ToUpperInvariant(),
                Path = StripPrefix(uriPath, _apiPrefix),
                Body = Encoding.UTF8.GetString(bodyBytes.ToArray())
            };
        }

        private Task<Tuple<int, object>> RouteRequest(string path, string method, string requestBody)
        {
            if (path == "health" && method == "GET")
                return Task.FromResult(Tuple.Create(200, (object)NXResult.Success("heartbeat")));

            if (path == "tools" && method == "GET")
            {
                var tools = _toolManager.GetToolList();
                return Task.FromResult(Tuple.Create(200, (object)NXResult.Success(new { tools }, "ok")));
            }

            if (path.StartsWith("tools/", StringComparison.OrdinalIgnoreCase) && method == "POST")
            {
                var toolName = path.Substring("tools/".Length);
                var result = _toolManager.ExecuteTool(toolName, requestBody);
                return Task.FromResult(Tuple.Create(200, result));
            }

            return Task.FromResult(Tuple.Create(404, (object)NXResult.Fail("not found")));
        }

        private async Task WriteResponse(NetworkStream stream, int statusCode, object data)
        {
            var json = JsonConvert.SerializeObject(data);
            var body = Encoding.UTF8.GetBytes(json);
            var reason = statusCode == 200 ? "OK" : statusCode == 404 ? "Not Found" : "Internal Server Error";
            var header =
                "HTTP/1.1 " + statusCode + " " + reason + "\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Connection: close\r\n" +
                "\r\n";
            var headerBytes = Encoding.ASCII.GetBytes(header);
            await stream.WriteAsync(headerBytes, 0, headerBytes.Length);
            await stream.WriteAsync(body, 0, body.Length);
        }

        private static int FindHeaderEnd(byte[] bytes)
        {
            for (int i = 0; i <= bytes.Length - 4; i++)
            {
                if (bytes[i] == 13 && bytes[i + 1] == 10 && bytes[i + 2] == 13 && bytes[i + 3] == 10)
                    return i;
            }
            return -1;
        }

        private static int ParsePort(string endpoint)
        {
            if (string.IsNullOrWhiteSpace(endpoint)) return SettingConfig.Port;
            var idx = endpoint.LastIndexOf(':');
            if (idx >= 0 && int.TryParse(endpoint.Substring(idx + 1).Trim('/'), out var port))
                return port;
            return SettingConfig.Port;
        }

        private static string NormalizeApiPrefix(string apiPrefix)
        {
            if (string.IsNullOrWhiteSpace(apiPrefix)) return "";
            return apiPrefix.Trim().Trim('/');
        }

        private static string StripPrefix(string path, string apiPrefix)
        {
            if (string.IsNullOrWhiteSpace(path)) return "";
            if (string.IsNullOrWhiteSpace(apiPrefix)) return path.Trim('/');

            var p = path.Trim('/');
            if (p.StartsWith(apiPrefix + "/", StringComparison.OrdinalIgnoreCase))
                return p.Substring(apiPrefix.Length + 1);
            if (string.Equals(p, apiPrefix, StringComparison.OrdinalIgnoreCase))
                return "";
            return p;
        }

        private sealed class HttpRequest
        {
            public string Method;
            public string Path;
            public string Body;
        }
    }
}
