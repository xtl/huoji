using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal sealed class Assistant : ApplicationContext {
    private readonly Control dispatcher = new Control();
    private readonly NotifyIcon tray;
    private readonly Process service;
    private readonly RegisteredWaitHandle reopen;
    private bool ready, stopping;
#if CLOUD
    private const string Site = "http://127.0.0.1:5197/#input/wechat";
    private const string Edition = "云同步";
    private const string EventName = @"Local\HuojiCaptureCloud.Open.v1";
#else
    private const string Site = "http://127.0.0.1:5196/#input/wechat";
    private const string Edition = "本机测试";
    private const string EventName = @"Local\HuojiCaptureTest.Open.v1";
#endif

    private Assistant(EventWaitHandle openRequest, bool verify) {
        var handle = dispatcher.Handle;
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开微信采集", null, (s,e) => Open());
        menu.Items.Add("退出助手", null, (s,e) => Stop());
        tray = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), Text = "货记采集助手 · "+Edition, ContextMenuStrip = menu, Visible = !verify };
        tray.DoubleClick += (s,e) => Open();
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var info = new ProcessStartInfo(Path.Combine(root, "node.exe"), "local.cjs") {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        info.EnvironmentVariables.Remove("NODE_OPTIONS");
        info.EnvironmentVariables.Remove("NODE_PATH");
        service = new Process { StartInfo = info, EnableRaisingEvents = true };
        service.OutputDataReceived += (s,e) => {
            if (e.Data == "HUOJI_READY") dispatcher.BeginInvoke((Action)(() => { ready = true; if (verify) Stop(); else Open(); }));
        };
        service.Exited += (s,e) => dispatcher.BeginInvoke((Action)(() => {
            if (!ready || !stopping) {
                Environment.ExitCode = 1;
                if (!verify) MessageBox.Show("本机服务未能运行。请检查 "+new Uri(Site).Port+" 端口和数据目录。", "货记采集助手");
            }
            ExitThread();
        }));
        service.Start();
        service.BeginOutputReadLine();
        service.BeginErrorReadLine();
        reopen = ThreadPool.RegisterWaitForSingleObject(openRequest, (s,t) => dispatcher.BeginInvoke((Action)Open), null, -1, false);
    }
    private void Open() {
        if (!ready || stopping) return;
        try { Process.Start(new ProcessStartInfo(Site) { UseShellExecute = true }); }
        catch { MessageBox.Show("请在浏览器打开 " + Site, "货记采集助手"); }
    }
    private void Stop() {
        if (stopping) return;
        stopping = true;
        tray.Text = "货记采集助手 · 正在停止";
        service.StandardInput.Close();
    }
    protected override void ExitThreadCore() {
        reopen.Unregister(null); tray.Visible = false; tray.Dispose(); service.Dispose(); dispatcher.Dispose();
        base.ExitThreadCore();
    }
    [STAThread] private static void Main(string[] args) {
        bool verify = args.Length == 1 && args[0] == "--verify";
        bool first;
        using (var openRequest = new EventWaitHandle(false, EventResetMode.AutoReset, EventName, out first)) {
            if (!first) { if (verify) Environment.ExitCode = 2; else openRequest.Set(); return; }
            Application.EnableVisualStyles();
            try { Application.Run(new Assistant(openRequest, verify)); }
            catch { Environment.ExitCode = 1; if (!verify) MessageBox.Show("启动失败，请重新安装货记采集助手。", "货记采集助手"); }
        }
    }
}
