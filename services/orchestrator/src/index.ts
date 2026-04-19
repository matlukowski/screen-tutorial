import { utcNowIso, type AssistantQueryInput, type AssistantQueryOutput, type SessionDetail, type SessionSummary } from "@local-ai/shared";
import { LocalAgentClient } from "./agent";
import { HistoryStore } from "./db";

export class LocalAssistantOrchestrator {
  private readonly agent: LocalAgentClient;
  private readonly store: HistoryStore;

  constructor(dbPath: string) {
    this.agent = new LocalAgentClient();
    this.store = new HistoryStore(dbPath);
  }

  ask(input: AssistantQueryInput): AssistantQueryOutput {
    const createdAt = utcNowIso();
    const sessionId = this.store.ensureSession(input.sessionId, input.windowTitle, createdAt);
    const answer = this.agent.generate(input);

    this.store.saveInteraction({
      sessionId,
      screenshotPath: input.screenshotPath,
      question: input.question,
      answer,
      windowTitle: input.windowTitle,
      createdAt,
    });

    return {
      sessionId,
      answer,
      createdAt,
    };
  }

  listSessions(appTitle?: string): SessionSummary[] {
    return this.store.listSessions(appTitle);
  }

  getSession(sessionId: string): SessionDetail | null {
    return this.store.getSessionDetail(sessionId);
  }
}
