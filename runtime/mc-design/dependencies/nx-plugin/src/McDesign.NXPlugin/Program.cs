using System;
using NXOpen;

namespace NXServer
{
    public class Program
    {
        public static Session theSession;
        public static Program theProgram;
        public static bool isDisposeCalled;

        private static ToolManager _toolManager;
        private static HttpServer _httpServer;
        private static RuntimeMonitor _runtimeMonitor;

        public Program()
        {
            InitializeLoggingSafe("Program.ctor");
            Logger.LogInfo("NXServer constructor started.");

            SafeStep("Initialize NX Session", InitializeNXSession);
            SafeStep("Initialize components", InitializeComponents);
            SafeStep("Start local HTTP service", StartServer);
            SafeStep("Check user-side Python client", CheckRuntime);

            Logger.LogInfo("NXServer constructor finished. LogFile=" + Logger.CurrentLogFile);
        }

        private static void InitializeLoggingSafe(string source)
        {
            try
            {
                AppPaths.EnsureInitialized();
                Logger.Initialize(AppPaths.LogDir);
                Logger.LogInfo(source + ": logging initialized. RootDir=" + AppPaths.RootDir + ", LogDir=" + AppPaths.LogDir);
            }
            catch (Exception ex)
            {
                Logger.EnsureInitialized();
                Logger.LogCritical(source + ": failed to initialize logging path; using fallback logger.", ex);
            }
        }

        private static void SafeStep(string stepName, Action action)
        {
            try
            {
                Logger.LogInfo(stepName + ": start.");
                action();
                Logger.LogInfo(stepName + ": done.");
            }
            catch (Exception ex)
            {
                Logger.LogCritical(stepName + ": failed but was caught; NXServer will continue startup.", ex);
            }
        }

        private void InitializeNXSession()
        {
            try
            {
                theSession = Session.GetSession();
                Logger.LogInfo("NX Session acquired.");
            }
            catch (Exception ex)
            {
                Logger.LogCritical("Failed to acquire NX Session.", ex);
                theSession = null;
            }
            isDisposeCalled = false;
        }

        private void InitializeComponents()
        {
            try
            {
                Dispatcher.Initialize();
                Logger.LogInfo("Dispatcher initialized.");
            }
            catch (Exception ex)
            {
                Logger.LogCritical("Dispatcher initialization failed; direct tool execution will be used if needed.", ex);
            }

            _toolManager = new ToolManager();
            try
            {
                _toolManager.Initialize();
            }
            catch (Exception ex)
            {
                Logger.LogCritical("ToolManager initialization failed; local HTTP service may expose no tools.", ex);
            }

            try
            {
                string endpoint = BuildHttpEndpoint();
                _httpServer = new HttpServer(endpoint, SettingConfig.Base_Path, _toolManager);
                Logger.LogInfo("HTTP service object created: " + endpoint + ", Base_Path=" + SettingConfig.Base_Path);
            }
            catch (Exception ex)
            {
                Logger.LogCritical("HTTP service object creation failed.", ex);
                _httpServer = null;
            }

            _runtimeMonitor = new RuntimeMonitor();
        }

        private string BuildHttpEndpoint()
        {
            return "127.0.0.1:" + SettingConfig.Port;
        }

        private void StartServer()
        {
            if (_httpServer == null)
            {
                Logger.LogWarning("HTTP service object is null; skipping HTTP service startup.");
                return;
            }

            try
            {
                _httpServer.Start();
            }
            catch (Exception ex)
            {
                Logger.LogCritical("HTTP service startup failed; NXServer will keep running for logs and runtime launch.", ex);
            }
        }

        private void CheckRuntime()
        {
            if (_runtimeMonitor == null)
            {
                Logger.LogWarning("User-side Python client monitor is null; skipping runtime status check.");
                return;
            }
            _runtimeMonitor.Probe();
        }

        public static int Startup()
        {
            int retValue = 0;
            InitializeLoggingSafe("NXServer.Startup");
            Logger.LogInfo("NXServer.Startup entered.");

            try
            {
                theProgram = new Program();
                Logger.LogInfo("NXServer.Startup finished.");
            }
            catch (Exception ex)
            {
                Logger.LogCritical("NXServer.Startup caught an unexpected exception before it reached NX.", ex);
            }

            return retValue;
        }

        public void Dispose()
        {
            Logger.EnsureInitialized();
            if (isDisposeCalled) return;

            TryDisposeStep("Stop local HTTP service", () => _httpServer?.Stop());
            TryDisposeStep("Release user-side Python client monitor", () => _runtimeMonitor?.Dispose());
            TryDisposeStep("Cleanup ToolManager", () => _toolManager?.Cleanup());
            TryDisposeStep("Release NX seat", () => theSession?.LicenseManager.ReleaseAll(null));

            isDisposeCalled = true;
            Logger.LogInfo("NXServer resources cleaned up.");
        }

        private static void TryDisposeStep(string stepName, Action action)
        {
            try
            {
                action();
                Logger.LogInfo(stepName + ": done.");
            }
            catch (Exception ex)
            {
                Logger.LogError(stepName + ": failed.", ex);
            }
        }

        public static int GetUnloadOption(string arg)
        {
            return Convert.ToInt32(Session.LibraryUnloadOption.AtTermination);
        }
    }
}
