"use client";

import { useRef, useState } from "react";
import { useAppShell } from "@/components/app-shell";
import type { AiTurn } from "@/lib/ai/orchestrator";

interface ChatMessage {
  role: "user" | "assistant";
  text?: string;
  turn?: AiTurn;
}

interface PendingPin {
  token: string;
  operationId: string;
}

export function AiScreen() {
  const { activeBranchId } = useAppShell();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function pushAssistant(turn: AiTurn) {
    setMessages((current) => [...current, { role: "assistant", turn }]);
  }

  async function send(text: string, overrides: Record<string, unknown> = {}) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchId, text: trimmed, ...overrides })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error al procesar.");
        return;
      }
      pushAssistant(json.turn as AiTurn);
    } catch {
      setError("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(token: string, ownerAuthorizationId?: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchId, token, ownerAuthorizationId: ownerAuthorizationId ?? null })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Error al confirmar.");
        return;
      }
      pushAssistant(json.turn as AiTurn);
    } catch {
      setError("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  async function authorizeAndConfirm() {
    if (!pendingPin || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const authRes = await fetch("/api/owner/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: activeBranchId,
          purpose: "STOCK_ADJUSTMENT",
          targetOperationId: pendingPin.operationId,
          pin
        })
      });
      const authJson = await authRes.json();
      if (!authRes.ok) {
        setError(authJson.error === "INVALID_OWNER_PIN" ? "PIN del dueño incorrecto." : authJson.error ?? "No autorizado.");
        return;
      }
      setPin("");
      setPendingPin(null);
      await confirm(pendingPin.token, authJson.authorizationId);
    } catch {
      setError("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }

  function startVoice() {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("La entrada por voz no está disponible en este navegador.");
      return;
    }
    const Recognition = SpeechRecognition as new () => {
      lang: string;
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
    };
    const recognition = new Recognition();
    recognition.lang = "es-DO";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setInput(transcript);
    };
    recognition.onerror = () => setError("No se pudo escuchar. Intenta de nuevo.");
    recognition.start();
  }

  return (
    <div className="customers-screen">
      <div className="ai-chat" ref={listRef} aria-label="Conversación con FIAO AI">
        {messages.length === 0 ? (
          <p className="pos-empty">
            Pregúntale a tu negocio: “¿cuánto vendí hoy?”, “¿quién me debe?”, “¿qué me falta en inventario?” o “abre la caja con 2000”.
          </p>
        ) : null}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "ai-message ai-user" : "ai-message ai-assistant"}>
            {message.text ? <span>{message.text}</span> : null}
            {message.turn ? <TurnView turn={message.turn} onPick={(text, overrides) => void send(text, overrides)} onConfirm={(token) => void confirm(token)} onPin={(token, operationId) => setPendingPin({ token, operationId })} /> : null}
          </div>
        ))}
      </div>

      {pendingPin ? (
        <div className="ai-pin">
          <input type="password" inputMode="numeric" maxLength={6} placeholder="PIN del dueño" value={pin} onChange={(event) => setPin(event.target.value)} />
          <button type="button" className="pos-pay" onClick={() => void authorizeAndConfirm()} disabled={busy || !pin}>
            Autorizar
          </button>
          <button type="button" className="pos-secondary" onClick={() => setPendingPin(null)} disabled={busy}>
            Cancelar
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="pos-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ai-input">
        <input
          type="text"
          value={input}
          placeholder="Escribe o dicta tu pregunta…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send(input);
          }}
        />
        <button type="button" className="pos-secondary" onClick={startVoice} disabled={busy} aria-label="Dictar">
          🎤
        </button>
        <button type="button" className="pos-pay" onClick={() => void send(input)} disabled={busy || !input.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}

function TurnView(props: {
  turn: AiTurn;
  onPick: (text: string, overrides: Record<string, unknown>) => void;
  onConfirm: (token: string) => void;
  onPin: (token: string, operationId: string) => void;
}) {
  const { turn, onPick, onConfirm, onPin } = props;
  switch (turn.kind) {
    case "query":
      return <span>{turn.text}</span>;
    case "clarification":
      return (
        <span>
          {turn.message}
          {turn.ambiguities.length > 0 ? (
            <ul className="ai-options">
              {turn.ambiguities.map((option) => (
                <li key={option.id}>
                  <button type="button" className="pos-secondary" onClick={() => onPick(option.label, { customerId: option.id })}>
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      );
    case "action_preview":
      return (
        <span>
          <p>{turn.summary}</p>
          {turn.requiresOwnerPin ? (
            <button type="button" className="pos-pay" onClick={() => onPin(turn.token, turn.operationId)}>
              Autorizar con PIN
            </button>
          ) : (
            <button type="button" className="pos-pay" onClick={() => onConfirm(turn.token)}>
              Confirmar
            </button>
          )}
        </span>
      );
    case "action_result":
      return <span>{turn.message}</span>;
    default:
      return null;
  }
}
