using System;
using System.IO;
using System.Reflection;

namespace NXServer
{
    /// <summary>
    /// NX 插件运行时路径解析。
    ///
    /// 不再依赖 AppDomain.CurrentDomain.BaseDirectory.Replace("startup", ...)，
    /// 因为 NX 环境下 BaseDirectory 可能指向 NX 安装目录、工作目录或其他宿主路径。
    /// 所有路径优先基于 NXServer.dll 实际所在目录推导，并提供可写兜底路径。
    /// </summary>
    public static class AppPaths
    {
        private static readonly object LockObject = new object();
        private static string _startupDir;
        private static string _rootDir;
        private static string _logDir;
        private static string _configureDir;
        private static string _toolsDir;
        private static string _clientDir;

        public static string StartupDir
        {
            get { EnsureInitialized(); return _startupDir; }
        }

        public static string RootDir
        {
            get { EnsureInitialized(); return _rootDir; }
        }

        public static string LogDir
        {
            get { EnsureInitialized(); return _logDir; }
        }

        public static string ConfigureDir
        {
            get { EnsureInitialized(); return _configureDir; }
        }

        public static string ToolsDir
        {
            get { EnsureInitialized(); return _toolsDir; }
        }

        public static string ClientDir
        {
            get { EnsureInitialized(); return _clientDir; }
        }

        public static string ClientConfigFile
        {
            get { return Path.Combine(ConfigureDir, "mc-design-client.config"); }
        }

        public static string LogFile
        {
            get { return Path.Combine(LogDir, "log.txt"); }
        }

        public static void EnsureInitialized()
        {
            if (!string.IsNullOrWhiteSpace(_rootDir)) return;

            lock (LockObject)
            {
                if (!string.IsNullOrWhiteSpace(_rootDir)) return;

                _startupDir = ResolveStartupDir();
                _rootDir = ResolveRootDir(_startupDir);
                _configureDir = Path.Combine(_rootDir, "configure");
                _toolsDir = Path.Combine(_rootDir, "tools");
                _clientDir = Path.Combine(_rootDir, "client");
                _logDir = ResolveWritableLogDir(_rootDir);
            }
        }

        private static string ResolveStartupDir()
        {
            try
            {
                var location = Assembly.GetExecutingAssembly().Location;
                if (!string.IsNullOrWhiteSpace(location))
                {
                    var dir = Path.GetDirectoryName(location);
                    if (!string.IsNullOrWhiteSpace(dir)) return dir;
                }
            }
            catch
            {
                // 继续使用兜底路径
            }

            try
            {
                var baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!string.IsNullOrWhiteSpace(baseDir)) return baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            catch
            {
                // 继续使用兜底路径
            }

            return Environment.CurrentDirectory;
        }

        private static string ResolveRootDir(string startupDir)
        {
            try
            {
                var dir = new DirectoryInfo(startupDir);
                if (string.Equals(dir.Name, "startup", StringComparison.OrdinalIgnoreCase) && dir.Parent != null)
                    return dir.Parent.FullName;

                // 如果 DLL 没在 startup 目录，也尽量向上找包含 configure/tools/log 的插件根目录。
                var current = dir;
                for (int i = 0; i < 4 && current != null; i++)
                {
                    var configure = Path.Combine(current.FullName, "configure");
                    var startup = Path.Combine(current.FullName, "startup");
                    if (Directory.Exists(configure) || Directory.Exists(startup))
                        return current.FullName;
                    current = current.Parent;
                }
            }
            catch
            {
                // 继续使用兜底路径
            }

            return startupDir;
        }

        private static string ResolveWritableLogDir(string rootDir)
        {
            string[] candidates = new[]
            {
                Path.Combine(rootDir ?? string.Empty, "log"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mc-design-nx", "log"),
                Path.Combine(Path.GetTempPath(), "mc-design-nx", "log")
            };

            foreach (var candidate in candidates)
            {
                if (TryEnsureDirectory(candidate)) return candidate;
            }

            return Path.GetTempPath();
        }

        public static bool TryEnsureDirectory(string dir)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(dir)) return false;
                Directory.CreateDirectory(dir);
                return Directory.Exists(dir);
            }
            catch
            {
                return false;
            }
        }
    }
}
