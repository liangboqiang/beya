using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace NXServer
{
    public static class Logger
    {
        private static string LogFile;
        private static readonly object LockObject = new object();

        /// <summary>
        /// 初始化日志。即使传入路径不可写，也会自动落到 LocalAppData/Temp，避免“启动失败但无日志”。
        /// </summary>
        public static void Initialize(string logDir)
        {
            lock (LockObject)
            {
                LogFile = ResolveLogFile(logDir);
                WriteLogUnsafe("信息", "Logger.Initialize: 日志初始化完成，LogFile=" + LogFile, null);
            }
        }

        public static void EnsureInitialized()
        {
            if (!string.IsNullOrWhiteSpace(LogFile)) return;

            lock (LockObject)
            {
                if (!string.IsNullOrWhiteSpace(LogFile)) return;
                LogFile = ResolveLogFile(null);
                WriteLogUnsafe("信息", "Logger.EnsureInitialized: 日志兜底初始化完成，LogFile=" + LogFile, null);
            }
        }

        public static string CurrentLogFile
        {
            get
            {
                EnsureInitialized();
                return LogFile;
            }
        }

        public static void LogInfo(string message, [System.Runtime.CompilerServices.CallerMemberName] string method = "")
            => WriteLog("信息", GetMessageWithContext(method, message));

        public static void LogWarning(string message, [System.Runtime.CompilerServices.CallerMemberName] string method = "")
            => WriteLog("警告", GetMessageWithContext(method, message));

        public static void LogError(string message, Exception ex = null, [System.Runtime.CompilerServices.CallerMemberName] string method = "")
        {
            string errorDetails = BuildExceptionMessage(message, ex);
            WriteLog("错误", GetMessageWithContext(method, errorDetails));
        }

        public static void LogCritical(string message, Exception ex = null, [System.Runtime.CompilerServices.CallerMemberName] string method = "")
        {
            string errorDetails = BuildExceptionMessage(message, ex);
            WriteLog("严重错误", GetMessageWithContext(method, $"[{Environment.UserName}@{Environment.MachineName}] {errorDetails}"));
        }

        public static void LogAction(string actionType, string detail, [System.Runtime.CompilerServices.CallerMemberName] string method = "")
            => WriteLog("动作", GetMessageWithContext(method, actionType + ": " + detail));

        private static string BuildExceptionMessage(string message, Exception ex)
        {
            if (ex == null) return message ?? string.Empty;
            return (message ?? string.Empty) + Environment.NewLine + ex;
        }

        private static string GetMessageWithContext(string method, string message = "")
        {
            try
            {
                var stackTrace = new StackTrace();
                var frames = stackTrace.GetFrames();
                var callerFrame = frames?.FirstOrDefault(f =>
                    f.GetMethod().DeclaringType != null &&
                    !f.GetMethod().DeclaringType.Name.Contains("Logger"));

                if (callerFrame == null)
                    return message ?? "UnknownCaller";

                var callerType = callerFrame.GetMethod().DeclaringType;
                var className = callerType?.Name ?? "UnknownClass";
                var fullContext = className + "." + method;

                return !string.IsNullOrEmpty(message)
                    ? fullContext + ": " + message
                    : fullContext;
            }
            catch
            {
                return message ?? string.Empty;
            }
        }

        private static void WriteLog(string level, string message)
        {
            EnsureInitialized();

            lock (LockObject)
            {
                WriteLogUnsafe(level, message, null);
            }
        }

        private static void WriteLogUnsafe(string level, string message, Exception writeException)
        {
            string log = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {level} | {message}";
            if (writeException != null)
                log += Environment.NewLine + "[日志写入异常] " + writeException;

            try
            {
                var logDir = Path.GetDirectoryName(LogFile);
                if (!string.IsNullOrWhiteSpace(logDir)) Directory.CreateDirectory(logDir);
                File.AppendAllText(LogFile, log + Environment.NewLine, Encoding.UTF8);
                return;
            }
            catch (Exception ex)
            {
                // 主日志失败时，立即切到可写兜底位置，绝不继续抛出。
                TryFallbackWrite(log, ex);
            }
        }

        private static void TryFallbackWrite(string log, Exception firstException)
        {
            string[] fallbackFiles = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mc-design-nx", "log", "log.txt"),
                Path.Combine(Path.GetTempPath(), "mc-design-nx", "log", "log.txt")
            };

            foreach (var file in fallbackFiles)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    File.AppendAllText(file,
                        log + Environment.NewLine + "[主日志写入失败] " + firstException.Message + Environment.NewLine,
                        Encoding.UTF8);
                    LogFile = file;
                    return;
                }
                catch
                {
                    // 继续尝试下一个路径
                }
            }

            try
            {
                Console.WriteLine("[日志写入失败] " + DateTime.Now.ToString("HH:mm:ss") + " | " + firstException.Message);
            }
            catch
            {
                // 不能让日志系统影响 NX 运行
            }
        }

        private static string ResolveLogFile(string logDir)
        {
            string[] candidates = new[]
            {
                string.IsNullOrWhiteSpace(logDir) ? null : Path.Combine(logDir, "log.txt"),
                SafeGetAppPathsLogFile(),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mc-design-nx", "log", "log.txt"),
                Path.Combine(Path.GetTempPath(), "mc-design-nx", "log", "log.txt")
            };

            foreach (var file in candidates)
            {
                if (string.IsNullOrWhiteSpace(file)) continue;
                try
                {
                    var dir = Path.GetDirectoryName(file);
                    if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                    File.AppendAllText(file, string.Empty, Encoding.UTF8);
                    return file;
                }
                catch
                {
                    // 尝试下一个路径
                }
            }

            return Path.Combine(Path.GetTempPath(), "mc-design-nx-log.txt");
        }

        private static string SafeGetAppPathsLogFile()
        {
            try { return AppPaths.LogFile; }
            catch { return null; }
        }
    }
}
