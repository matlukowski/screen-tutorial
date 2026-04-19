export type CaptureMode = "active-window" | "fullscreen" | "region";

export interface AssistantQueryInput {
  question: string;
  screenshotPath: string;
  screenshotPaths?: string[];
  windowTitle: string;
  sessionId?: string;
  captureMode?: CaptureMode;
}

export interface AssistantQueryOutput {
  sessionId: string;
  answer: string;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  appTitle: string;
  createdAt: string;
  lastInteractionAt: string;
}

export interface SessionInteraction {
  id: string;
  sessionId: string;
  screenshotPath: string;
  question: string;
  answer: string;
  windowTitle: string;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionSummary;
  interactions: SessionInteraction[];
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
