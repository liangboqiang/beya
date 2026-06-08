using System;
using System.Collections.Generic;
using System.IO;

namespace NXServer
{
    public static class SettingConfig
    {
        public static int Port { get; private set; } = 8088;
        public static string Base_Path { get; private set; } = "/api";
        public static int Runtime_Port { get; private set; } = 8765;

        public static string ConfigFile
        {
            get { return AppPaths.ClientConfigFile; }
        }

        static SettingConfig()
        {
            Load();
        }

        private static void Load()
        {
            try
            {
                var configFile = ConfigFile;
                Logger.LogInfo("Loading mc-design-client.config: " + configFile);

                if (!File.Exists(configFile))
                {
                    Logger.LogWarning("mc-design-client.config not found; using local defaults: " + configFile);
                    return;
                }

                var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var section = "";
                foreach (var raw in File.ReadAllLines(configFile))
                {
                    var line = raw.Trim();
                    if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                    if (line.StartsWith("[") && line.EndsWith("]"))
                    {
                        section = line.Substring(1, line.Length - 2).Trim();
                        continue;
                    }

                    var idx = line.IndexOf('=');
                    if (idx <= 0) continue;

                    var key = line.Substring(0, idx).Trim();
                    var value = Unquote(line.Substring(idx + 1).Trim());
                    dict[key] = value;
                    if (!string.IsNullOrWhiteSpace(section))
                        dict[section + "." + key] = value;
                }

                int port;
                if (dict.TryGetValue("nx_plugin.port", out var portStr) && int.TryParse(portStr, out port))
                    Port = port;

                int runtimePort;
                if (dict.TryGetValue("runtime.port", out var runtimePortStr) && int.TryParse(runtimePortStr, out runtimePort))
                    Runtime_Port = runtimePort;

                Logger.LogInfo("mc-design-client.config loaded: Port=" + Port + ", Base_Path=" + Base_Path + ", Runtime_Port=" + Runtime_Port);
            }
            catch (Exception ex)
            {
                Logger.LogCritical("Failed to load mc-design-client.config; keeping local defaults.", ex);
            }
        }

        private static string Unquote(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return value;
            var trimmed = value.Trim();
            if (trimmed.Length >= 2)
            {
                var first = trimmed[0];
                var last = trimmed[trimmed.Length - 1];
                if ((first == '"' && last == '"') || (first == '\'' && last == '\''))
                    return trimmed.Substring(1, trimmed.Length - 2);
            }
            return trimmed;
        }
    }
}
