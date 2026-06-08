using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AIWebForm
{
    public partial class MainForm : Form
    {
        private const string DefaultAgentUrl = "https://aidev.linkskycloud.com/product/llm/chat/d5li75of07rl4h8q4fc0";

        private WebView2 webView;
        private MenuStrip menuStrip;

        public MainForm()
        {
            Size = new System.Drawing.Size(600, 900);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new System.Drawing.Size(500, 800);
            WindowState = FormWindowState.Normal;
            Text = "\u96f6\u90e8\u4ef6\u8bbe\u8ba1AI \u52a9\u624b";

            menuStrip = new MenuStrip();
            menuStrip.Dock = DockStyle.Top;

            var topmostMenuItem = new ToolStripMenuItem("\u7f6e\u9876");
            topmostMenuItem.Click += TopmostMenuItem_Click;
            topmostMenuItem.Alignment = ToolStripItemAlignment.Right;
            menuStrip.Items.Add(topmostMenuItem);

            var refreshMenuItem = new ToolStripMenuItem("\u5237\u65b0");
            refreshMenuItem.Click += RefreshMenuItem_Click;
            refreshMenuItem.Alignment = ToolStripItemAlignment.Right;
            menuStrip.Items.Add(refreshMenuItem);

            var exitMenuItem = new ToolStripMenuItem("\u9000\u51fa");
            exitMenuItem.Click += ExitMenuItem_Click;
            exitMenuItem.Alignment = ToolStripItemAlignment.Right;
            menuStrip.Items.Add(exitMenuItem);

            MainMenuStrip = menuStrip;
            Controls.Add(menuStrip);

            InitializeWebView();
        }

        private async void InitializeWebView()
        {
            try
            {
                webView = new WebView2();
                webView.Location = new System.Drawing.Point(0, menuStrip.Height + 10);
                webView.Size = new System.Drawing.Size(ClientSize.Width, ClientSize.Height - menuStrip.Height - 10);
                webView.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Bottom | AnchorStyles.Right;
                Controls.Add(webView);

                var cachePath = Path.Combine(GetInstallRoot(), "client", "data", "webview2");
                Directory.CreateDirectory(cachePath);
                var environment = await CoreWebView2Environment.CreateAsync(null, cachePath);

                webView.CoreWebView2InitializationCompleted += (sender, e) =>
                {
                    if (e.IsSuccess)
                    {
                        webView.ZoomFactor = 0.8f;
                    }
                };

                await webView.EnsureCoreWebView2Async(environment);

                webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                webView.CoreWebView2.Settings.IsZoomControlEnabled = true;
                webView.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;

                webView.Source = new Uri(GetAIAgentUrl());

                webView.NavigationCompleted += (sender, e) =>
                {
                    if (webView != null)
                    {
                        webView.ZoomFactor = 0.8f;
                    }
                };

                webView.CoreWebView2.NewWindowRequested += (sender, e) =>
                {
                    e.Handled = true;
                    if (!string.IsNullOrWhiteSpace(e.Uri))
                    {
                        webView.CoreWebView2.Navigate(e.Uri);
                    }
                };
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "\u521d\u59cb\u5316WebView2\u5931\u8d25: " + ex.Message,
                    "\u9519\u8bef",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
        }

        public void NavigateConfiguredUrl()
        {
            if (webView != null && webView.CoreWebView2 != null)
            {
                webView.CoreWebView2.Navigate(GetAIAgentUrl());
            }
        }

        private void TopmostMenuItem_Click(object sender, EventArgs e)
        {
            var menuItem = sender as ToolStripMenuItem;
            if (menuItem == null)
            {
                return;
            }

            TopMost = !TopMost;
            menuItem.Checked = TopMost;
            menuItem.BackColor = TopMost ? System.Drawing.Color.LightGray : System.Drawing.Color.Transparent;
        }

        private void RefreshMenuItem_Click(object sender, EventArgs e)
        {
            NavigateConfiguredUrl();
        }

        private async void ExitMenuItem_Click(object sender, EventArgs e)
        {
            if (webView == null || webView.CoreWebView2 == null)
            {
                return;
            }

            try
            {
                webView.CoreWebView2.CookieManager.DeleteAllCookies();
                await webView.CoreWebView2.Profile.ClearBrowsingDataAsync();
                webView.CoreWebView2.Navigate(GetAIAgentUrl());
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "\u9000\u51fa\u5e76\u6e05\u9664\u7f13\u5b58\u5931\u8d25: " + ex.Message,
                    "\u9519\u8bef",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }

        private static string GetAIAgentUrl()
        {
            try
            {
                var values = ReadPackageConfig(GetPackageConfigPath());
                string value;
                values.TryGetValue("ai_web_form.agent_url", out value);
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value.Trim();
                }
            }
            catch
            {
            }

            return DefaultAgentUrl;
        }

        private static string GetPackageConfigPath()
        {
            return Path.GetFullPath(Path.Combine(GetInstallRoot(), "client", "resources", "mc-design-package.mcdpkg"));
        }

        private static Dictionary<string, string> ReadPackageConfig(string packagePath)
        {
            if (!File.Exists(packagePath))
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            var raw = File.ReadAllText(packagePath, Encoding.UTF8);
            var serializer = new JavaScriptSerializer();
            var outer = serializer.Deserialize<Dictionary<string, object>>(raw);
            if (outer == null || !outer.ContainsKey("format") || Convert.ToString(outer["format"]) != "mc-design-config")
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            var payload = Convert.ToString(outer["payload"]);
            var expected = Convert.ToString(outer["sha256"]);
            var compressed = Xor(Convert.FromBase64String(payload));
            if (!string.Equals(ToHex(Sha256(compressed)), expected, StringComparison.OrdinalIgnoreCase))
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            var json = DecompressUtf8(compressed);
            var body = serializer.Deserialize<Dictionary<string, object>>(json);
            if (body == null || !body.ContainsKey("config_text"))
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            return ReadConfigText(Convert.ToString(body["config_text"]));
        }

        private static Dictionary<string, string> ReadConfigText(string configText)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var section = "";
            foreach (var raw in (configText ?? string.Empty).Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
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
                result[key] = value;
                if (!string.IsNullOrWhiteSpace(section))
                    result[section + "." + key] = value;
            }
            return result;
        }

        private static byte[] Xor(byte[] data)
        {
            var key = Sha256(Encoding.UTF8.GetBytes("mc-design-client-config"));
            var output = new byte[data.Length];
            for (var i = 0; i < data.Length; i++)
            {
                output[i] = (byte)(data[i] ^ key[i % key.Length]);
            }
            return output;
        }

        private static byte[] Sha256(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                return sha.ComputeHash(data);
            }
        }

        private static string ToHex(byte[] data)
        {
            var sb = new StringBuilder(data.Length * 2);
            foreach (var b in data)
            {
                sb.Append(b.ToString("x2"));
            }
            return sb.ToString();
        }

        private static string DecompressUtf8(byte[] compressed)
        {
            using (var input = new MemoryStream(compressed))
            using (var gzip = new GZipStream(input, CompressionMode.Decompress))
            using (var output = new MemoryStream())
            {
                gzip.CopyTo(output);
                return Encoding.UTF8.GetString(output.ToArray());
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

        private static string GetInstallRoot()
        {
            return Path.GetFullPath(Path.Combine(GetAssemblyDirectory(), "..", ".."));
        }

        private static string GetAssemblyDirectory()
        {
            var assemblyPath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            return Path.GetDirectoryName(assemblyPath) ?? AppDomain.CurrentDomain.BaseDirectory;
        }
    }
}
