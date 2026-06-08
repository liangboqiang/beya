// ToolManager.cs
using System;
using System.Reflection;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NXSDK;

namespace NXServer
{
    public class ToolManager
    {
        // 轻量元信息（避免依赖 ToolAttribute 的类型身份）
        private sealed class ToolMeta
        {
            public string Name;
            public string Description;
            public string Category;
        }

        // 工具名大小写不敏感
        private readonly Dictionary<string, (MethodInfo Method, ToolMeta Meta)> _toolMethods =
            new Dictionary<string, (MethodInfo, ToolMeta)>(StringComparer.OrdinalIgnoreCase);

        private readonly List<Assembly> _toolAssemblies = new List<Assembly>();
        private readonly string _toolsDirectory;

        public ToolManager()
        {
            _toolsDirectory = AppPaths.ToolsDir;
            Logger.LogInfo($"ToolManager 工具目录: {_toolsDirectory}");
        }

        public void Initialize()
        {
            LoadToolsAssemblies();
            ScanToolMethods();
            Logger.LogInfo($"工具管理器初始化完成，已注册 {_toolMethods.Count} 个工具方法");
        }

        /// <summary>
        /// 从 tools 目录加载可能包含工具的程序集
        /// 关键：跳过 NXSDK/Newtonsoft 等基础库，避免重复加载导致 Attribute 类型身份不一致
        /// </summary>
        private void LoadToolsAssemblies()
        {
            _toolAssemblies.Clear();

            if (!Directory.Exists(_toolsDirectory))
            {
                Logger.LogWarning($"工具目录不存在: {_toolsDirectory}");
                return;
            }

            var dlls = Directory.GetFiles(_toolsDirectory, "*.dll", SearchOption.TopDirectoryOnly);

            foreach (var dll in dlls)
            {
                var fileName = Path.GetFileName(dll);

                // 必须跳过这些基础库/系统库（否则极易出现 LoadFrom 重复加载）
                if (fileName.Equals("NXSDK.dll", StringComparison.OrdinalIgnoreCase) ||
                    fileName.Equals("Newtonsoft.Json.dll", StringComparison.OrdinalIgnoreCase) ||
                    fileName.StartsWith("System.", StringComparison.OrdinalIgnoreCase) ||
                    fileName.StartsWith("Microsoft.", StringComparison.OrdinalIgnoreCase) ||
                    fileName.StartsWith("NXOpen", StringComparison.OrdinalIgnoreCase))
                {
                    Logger.LogInfo($"ToolManager.LoadToolsAssemblies: 跳过基础程序集: {fileName}");
                    continue;
                }

                try
                {
                    var asm = Assembly.LoadFrom(dll);
                    _toolAssemblies.Add(asm);
                    Logger.LogInfo($"ToolManager.LoadToolsAssemblies: 已加载工具程序集: {fileName}");
                }
                catch (Exception ex)
                {
                    Logger.LogWarning($"ToolManager.LoadToolsAssemblies: 加载工具程序集失败: {fileName} - {ex.Message}");
                }
            }

            if (_toolAssemblies.Count == 0)
            {
                Logger.LogWarning($"ToolManager.LoadToolsAssemblies: tools 目录下未加载到任何工具程序集: {_toolsDirectory}");
            }
        }

        private void ScanToolMethods()
        {
            _toolMethods.Clear();

            int registered = 0;

            foreach (var asm in _toolAssemblies)
            {
                try
                {
                    foreach (var type in asm.GetTypes())
                    {
                        // ===== 关键修复点 =====
                        // 你原来用了 type.IsAbstract 直接过滤，会把 static class（abstract+sealed）全部过滤掉
                        // static class 也是合法工具容器，必须允许扫描
                        bool isPublic = type.IsPublic || type.IsNestedPublic;
                        if (!isPublic || type.IsInterface) continue;

                        bool isStaticClass = type.IsAbstract && type.IsSealed; // C# static class 的典型特征
                        if (type.IsAbstract && !isStaticClass) continue;       // 仅跳过“非 static 的 abstract class”
                        // =====================

                        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static))
                        {
                            // 不用 GetCustomAttribute<ToolAttribute>()，避免 NXSDK 重复加载导致类型不一致
                            var meta = TryGetToolMeta(method);
                            if (meta == null) continue;

                            // 注册名：优先 ToolAttribute.Name，否则 Type.Method
                            var registeredName = !string.IsNullOrWhiteSpace(meta.Name)
                                ? meta.Name.Trim()
                                : $"{type.Name}.{method.Name}";

                            RegisterTool(registeredName, method, meta, ref registered);

                            // 额外注册短名别名：A.B -> B，方便直接用 UpdateExpression 调用
                            var lastDot = registeredName.LastIndexOf('.');
                            if (lastDot >= 0 && lastDot < registeredName.Length - 1)
                            {
                                var shortName = registeredName.Substring(lastDot + 1);
                                if (!string.Equals(shortName, registeredName, StringComparison.OrdinalIgnoreCase))
                                {
                                    RegisterTool(shortName, method, meta, ref registered, isAlias: true);
                                }
                            }
                        }
                    }
                }
                catch (ReflectionTypeLoadException rtle)
                {
                    var msgs = string.Join(" | ", rtle.LoaderExceptions?.Select(e => e.Message) ?? Enumerable.Empty<string>());
                    Logger.LogWarning($"ToolManager.ScanToolMethods: 扫描程序集类型失败(部分类型无法加载): {asm.FullName} - {msgs}");
                }
                catch (Exception ex)
                {
                    Logger.LogWarning($"ToolManager.ScanToolMethods: 扫描工具方法失败: {asm.FullName} - {ex.Message}");
                }
            }

            Logger.LogInfo($"ToolManager.ScanToolMethods: 扫描完成，已注册 {registered} 个工具入口（含别名）");
        }

        private void RegisterTool(string name, MethodInfo method, ToolMeta meta, ref int registered, bool isAlias = false)
        {
            if (_toolMethods.ContainsKey(name))
            {
                Logger.LogWarning($"ToolManager.RegisterTool: 工具名冲突: {name}，跳过重复注册");
                return;
            }

            _toolMethods[name] = (method, meta);
            registered++;

            Logger.LogInfo(isAlias
                ? $"ToolManager.RegisterTool: 注册工具别名: {name}"
                : $"ToolManager.RegisterTool: 注册工具方法: {name}");
        }

        /// <summary>
        /// 通过“属性全名”识别 NXSDK.ToolAttribute，并反射读取 Name/Description/Category
        /// </summary>
        private ToolMeta TryGetToolMeta(MethodInfo method)
        {
            try
            {
                var attrs = method.GetCustomAttributes(inherit: false);
                foreach (var a in attrs)
                {
                    var t = a.GetType();
                    if (!string.Equals(t.FullName, "NXSDK.ToolAttribute", StringComparison.Ordinal))
                        continue;

                    string name = ReadStringProperty(a, "Name");
                    string desc = ReadStringProperty(a, "Description");
                    string cat = ReadStringProperty(a, "Category");

                    return new ToolMeta
                    {
                        Name = name,
                        Description = desc ?? string.Empty,
                        Category = cat
                    };
                }
            }
            catch
            {
                // 忽略异常，视为无工具特性
            }

            return null;
        }

        private static string ReadStringProperty(object obj, string propName)
        {
            var p = obj.GetType().GetProperty(propName, BindingFlags.Public | BindingFlags.Instance);
            if (p == null) return null;
            return p.GetValue(obj, null) as string;
        }

        public object ExecuteTool(string toolName, string requestBody)
        {
            if (!_toolMethods.TryGetValue(toolName ?? "", out var toolInfo))
            {
                return NXResult.Fail($"工具未找到: {toolName}");
            }

            try
            {
                var data = Dispatcher.Invoke(() => ExecuteMethod(toolInfo.Method, requestBody));

                // 如果工具本身就返回 NXSDK.NXResult，则直接透传，避免双层 ok/data/message
                if (data is NXSDK.NXResult r)
                {
                    return r;
                }

                // 否则才包一层统一成功结构
                return NXSDK.NXResult.Success(data, "工具调用成功");

            }
            catch (ArgumentException ex)
            {
                Logger.LogWarning($"ToolManager.ExecuteTool: 参数错误: {toolName} - {ex.Message}");
                return NXResult.Fail(ex.Message);
            }
            catch (TargetInvocationException ex)
            {
                var msg = ex.InnerException?.Message ?? ex.Message;
                Logger.LogError($"ToolManager.ExecuteTool: 执行工具失败: {toolName}", ex);
                return NXResult.Fail(msg);
            }
            catch (Exception ex)
            {
                Logger.LogError($"ToolManager.ExecuteTool: 执行工具失败: {toolName}", ex);
                return NXResult.Fail(ex.Message);
            }
        }

        private object ExecuteMethod(MethodInfo method, string requestBody)
        {
            object instance = null;
            if (!method.IsStatic)
            {
                instance = Activator.CreateInstance(method.DeclaringType);
            }

            var parameters = method.GetParameters();
            object[] args = new object[parameters.Length];

            JObject requestData = null;
            if (!string.IsNullOrWhiteSpace(requestBody))
            {
                requestData = Newtonsoft.Json.JsonConvert.DeserializeObject<JObject>(requestBody);
            }

            for (int i = 0; i < parameters.Length; i++)
            {
                var param = parameters[i];
                var token = GetValueIgnoreCase(requestData, param.Name);

                if (token != null)
                {
                    args[i] = token.ToObject(param.ParameterType);
                }
                else if (param.HasDefaultValue)
                {
                    args[i] = param.DefaultValue;
                }
                else
                {
                    throw new ArgumentException($"缺少必要参数: {param.Name}");
                }
            }

            return method.Invoke(instance, args);
        }

        // 入参字段大小写兼容 + 忽略下划线兜底
        private static JToken GetValueIgnoreCase(JObject obj, string key)
        {
            if (obj == null || string.IsNullOrWhiteSpace(key)) return null;

            if (obj.TryGetValue(key, StringComparison.OrdinalIgnoreCase, out var value))
                return value;

            var normKey = key.Replace("_", "");
            foreach (var prop in obj.Properties())
            {
                var propNorm = prop.Name.Replace("_", "");
                if (string.Equals(propNorm, normKey, StringComparison.OrdinalIgnoreCase))
                    return prop.Value;
            }

            return null;
        }

        public List<object> GetToolList()
        {
            var tools = new List<object>();

            var grouped = _toolMethods.GroupBy(kv => kv.Value.Meta.Category);

            foreach (var group in grouped)
            {
                var categoryTools = new List<object>();

                foreach (var kv in group)
                {
                    var method = kv.Value.Method;
                    var meta = kv.Value.Meta;

                    categoryTools.Add(new
                    {
                        name = kv.Key,
                        description = meta.Description,
                        className = method.DeclaringType?.Name,
                        methodName = method.Name,
                        isStatic = method.IsStatic,
                        parameters = GetMethodParameters(method)
                    });
                }

                tools.Add(new
                {
                    category = group.Key,
                    tools = categoryTools
                });
            }

            return tools;
        }

        private object GetMethodParameters(MethodInfo method)
        {
            var parameters = method.GetParameters();
            var paramList = new List<object>();

            foreach (var param in parameters)
            {
                paramList.Add(new
                {
                    name = param.Name,
                    type = param.ParameterType.Name,
                    isOptional = param.IsOptional,
                    defaultValue = param.HasDefaultValue ? param.DefaultValue?.ToString() : null
                });
            }

            return paramList;
        }

        public void ReloadTools()
        {
            Logger.LogInfo("ToolManager.ReloadTools: 重新加载工具...");
            Initialize();
        }

        public void Cleanup()
        {
            _toolMethods.Clear();
            _toolAssemblies.Clear();
        }
    }
}
