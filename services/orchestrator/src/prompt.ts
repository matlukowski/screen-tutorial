import type { AssistantQueryInput } from "@local-ai/shared";

export function buildSystemPrompt(): string {
  return [
    "Jesteś lokalnym asystentem do nawigacji po interfejsie użytkownika.",
    "Odpowiadaj po polsku.",
    "Odpowiadaj bardzo konkretnie i operacyjnie.",
    "Używaj formy krok po kroku.",
    "Preferuj zwroty: 'po lewej stronie', 'kliknij', 'w panelu'.",
    "Zakładaj, że użytkownik nie zna interfejsu.",
    "Jeśli screenshoty są dołączone, traktuj je jako główne źródło prawdy i odwołuj się do widocznych elementów interfejsu.",
    "Jeśli jest kilka screenshotów, potraktuj je jako krótki ciąg czasowy pomagający złapać kontekst bieżącego ekranu.",
    "Jeśli czegoś nie widać na screenach, powiedz to i zaproponuj najbliższy bezpieczny krok.",
    "Unikaj ogólników i teorii.",
  ].join("\n");
}

export function buildUserPrompt(input: AssistantQueryInput): string {
  const mode = input.captureMode ?? "active-window";
  const screenshotPaths = [...new Set([...(input.screenshotPaths ?? []), input.screenshotPath].filter(Boolean))];

  return [
    `Aktywne okno: ${input.windowTitle}`,
    `Tryb przechwytywania: ${mode}`,
    `Liczba dołączonych screenshotów: ${screenshotPaths.length}`,
    `Najnowszy screenshot (referencyjnie): ${input.screenshotPath}`,
    ...screenshotPaths.map((screenshotPath, index) => `Screenshot ${index + 1}: ${screenshotPath}`),
    "",
    `Pytanie użytkownika: ${input.question}`,
    "",
    "Zwróć odpowiedź w formacie:",
    "Krok 1: ...",
    "Krok 2: ...",
    "Krok 3: ...",
    "Uwaga: ...",
  ].join("\n");
}
