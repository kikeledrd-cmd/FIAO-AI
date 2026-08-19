import { parseAiIntent, type AiIntent } from "@fiao/domain/ai/ai-intent";

/**
 * Adaptador de modelo (Responses API). En V1 la implementación por defecto es
 * determinística (parser local); el orquestador depende solo de esta interfaz,
 * así que un proveedor LLM real puede sustituirse sin tocar la lógica de negocio.
 */
export interface AiProvider {
  /** Convierte texto libre en un intent estructurado (sin ejecutar nada). */
  parseIntent(text: string): AiIntent;
}

/** Implementación determinística por defecto (sin red, testeable). */
export class DeterministicAiProvider implements AiProvider {
  parseIntent(text: string): AiIntent {
    return parseAiIntent(text);
  }
}

export function defaultAiProvider(): AiProvider {
  return new DeterministicAiProvider();
}
