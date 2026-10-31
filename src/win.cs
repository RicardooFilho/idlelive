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

  static HashSet<uint> ChromePids() {
    var pids = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("chrome")) pids.Add((uint)p.Id);
    return pids;
  }

  public static List<long> ChromeWindows() {
    var chromePids = ChromePids();
    var list = new List<long>();
    EnumWindows((h, l) => {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (IsWindowVisible(h) && chromePids.Contains(pid)) list.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // Fecha a janela só se ela ainda existir e ainda for do Chrome.
  public static void CloseChromeWindow(long handle) {
    var h = new IntPtr(handle);
    if (!IsWindow(h)) return;
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    if (ChromePids().Contains(pid)) PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
  }
}
