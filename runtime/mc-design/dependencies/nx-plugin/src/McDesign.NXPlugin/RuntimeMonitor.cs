using System;
using System.Net;

namespace NXServer
{
    public class RuntimeMonitor : IDisposable
    {
        public void Probe()
        {
            if (IsClientApiRunning())
            {
                Logger.LogInfo("User-side Python client is reachable on loopback. NX plugin will expose tools only.");
                return;
            }

            Logger.LogWarning(
                "User-side Python client is not running. Start it manually with start-client.bat before using the agent."
            );
        }

        public bool IsClientApiRunning()
        {
            try
            {
                var url = "http://127.0.0.1:" + SettingConfig.Runtime_Port + "/health";
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 1000;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        public void Dispose()
        {
            // The Python client is user-owned. NX must never stop or kill it.
        }
    }
}
