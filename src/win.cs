// Funções do Windows usadas pelos scripts open-window.ps1 e close-windows.ps1.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  // Navegadores que o painel pode abrir (nomes dos processos).
  static readonly string[] Browsers = { "chrome", "brave", "msedge" };

  static HashSet<uint> Pids(params string[] names) {
    var pids = new HashSet<uint>();
    foreach (var name in names)
      foreach (var p in Process.GetProcessesByName(name)) pids.Add((uint)p.Id);
    return pids;
  }

  // Janelas visíveis do processo indicado (ex.: "chrome", "msedge").
  public static List<long> BrowserWindows(string processName) {
    var pids = Pids(processName);
    var list = new List<long>();
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (IsWindowVisible(h) && pids.Contains(pid)) list.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // Fecha a janela só se ela ainda existir e ainda for de um dos navegadores.
  public static void CloseBrowserWindow(long handle) {
    var h = new IntPtr(handle);
    if (!IsWindow(h)) return;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (Pids(Browsers).Contains(pid)) PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
  }
}
