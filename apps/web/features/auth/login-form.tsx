"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("Este celular");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, pin, deviceLabel })
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Demasiados intentos. Intenta nuevamente en un momento." : "Teléfono o PIN incorrecto.");
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <label>
        Teléfono
        <input
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
      </label>
      <label>
        PIN
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          minLength={4}
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          required
        />
      </label>
      <label>
        Nombre de este dispositivo
        <input
          name="deviceLabel"
          value={deviceLabel}
          onChange={(event) => setDeviceLabel(event.target.value)}
          maxLength={80}
          required
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? "Entrando…" : "Entrar a FIAO"}
      </button>
    </form>
  );
}
