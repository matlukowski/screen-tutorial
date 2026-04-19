import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("assistantAPI", {
  ask: (input: any) => ipcRenderer.invoke("assistant:ask", input),
  listHistory: (appTitle?: string) => ipcRenderer.invoke("history:list", appTitle),
  getSession: (sessionId: string) => ipcRenderer.invoke("history:get", sessionId),
  transcribeAudio: (bytes: number[]) => ipcRenderer.invoke("stt:transcribe", bytes),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  togglePinWindow: () => ipcRenderer.invoke("window:toggle-pin"),
  toggleWindowMode: () => ipcRenderer.invoke("window:toggle-mode"),
  onOverlayContext: (cb: (payload: any) => void) => ipcRenderer.on("overlay:context", (_e, payload) => cb(payload)),
  onWindowMode: (cb: (payload: any) => void) => ipcRenderer.on("overlay:window-mode", (_e, payload) => cb(payload)),
});
