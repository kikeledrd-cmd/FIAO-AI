# FIAO — Modo degradado de WhatsApp (runbook)

Escenario: Meta deja de entregar webhooks (caída de WhatsApp Business API,
bloqueo temporal o cambios de firma) y los pedidos por WhatsApp no entran.

## Detección

- No llegan `POST /api/whatsapp/webhook` con pedidos estructurados.
- En la pantalla `/pedidos` no aparecen pedidos con origen WhatsApp.
- Métrica del piloto `whatsappOrdersCount` se estanca (ver `GET /api/analytics/summary`).

## Respuesta

1. Confirmar el webhook en el panel de Meta: verificar endpoint, token
   `FIAO_WHATSAPP_VERIFY_TOKEN` y secret `FIAO_WHATSAPP_APP_SECRET`.
2. Verificar la firma: `X-Hub-Signature-256` se valida con HMAC-SHA256
   (`apps/web/lib/whatsapp/verify.ts`). Si Meta rota el secret, actualizar la
   variable de entorno y reiniciar.
3. **Degradación manual**: el dueño/cajero crea el pedido desde la UI
   (`/pedidos` → "Nuevo pedido") transcribiendo el mensaje del cliente. El flujo
   de estados/reserva/entrega es idéntico al automático.
4. Mantener una "bandeja de excepciones" revisada: los pedidos ambiguos o con
   stock insuficiente quedan en `NEW` con `exceptionReason` para intervención
   humana (nunca se auto-resuelven en silencio).

## Notas

- El webhook resuelve el actor OWNER con catálogo activo (en dev conviven el
  owner del seed y el del testkit); en producción hay un solo owner por tenant.
- El webhook está exento de la protección CSRF del middleware porque se valida
  por firma HMAC (más fuerte que SameSite).
