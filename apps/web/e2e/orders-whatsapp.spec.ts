import { expect, test, type Page } from "@playwright/test";

const SEED_OWNER_PHONE = process.env.FIAO_SEED_OWNER_PHONE ?? "+18095550123";
const SEED_OWNER_PIN = process.env.FIAO_SEED_OWNER_PIN ?? "1234";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Teléfono").fill(SEED_OWNER_PHONE);
  await page.getByLabel("PIN").fill(SEED_OWNER_PIN);
  await page.getByRole("button", { name: /Entrar a FIAO/ }).click();
  await expect(page.locator("header").getByRole("img", { name: "FIAO" })).toBeVisible();
}

/** POST al webhook de WhatsApp (body de Meta con un mensaje de texto). */
async function postWhatsApp(page: Page, body: string) {
  const response = await page.request.post("/api/whatsapp/webhook", {
    headers: { "content-type": "application/json" },
    data: body
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { ok: boolean; result: { status: string; orderId: string | null } };
}

function metaTextPayload(text: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from: "18095550123", type: "text", text: { body: text } }]
            }
          }
        ]
      }
    ]
  });
}

test("el webhook de WhatsApp produce una orden que se auto-acepta y reserva", async ({ page }) => {
  const result = await postWhatsApp(page, metaTextPayload("2 arroz la garza"));
  expect(result.result.status).toBe("AUTO_ACCEPTED");
  expect(result.result.orderId).not.toBeNull();
});

test("un mensaje con ítems ambiguos entra a la bandeja de excepciones", async ({ page }) => {
  const result = await postWhatsApp(page, metaTextPayload("2 arroz y una coca"));
  expect(result.result.status).toBe("EXCEPTION");
  expect(result.result.orderId).not.toBeNull();
});

/** Crea un pedido manual con un nombre de entrega único y lo devuelve. */
async function createManualOrder(page: Page): Promise<{ item: ReturnType<Page["locator"]>; deliveryName: string }> {
  await page.goto("/pedidos");
  const deliveryName = `Pedido ${Date.now()}`;
  await page.getByRole("button", { name: "+ Nuevo pedido" }).click();
  const createDialog = page.getByRole("dialog", { name: "Nuevo pedido" });
  await createDialog.locator(".pos-grid .pos-product", { hasText: "Arroz La Garza 5lb" }).first().click();
  await createDialog.getByLabel("Entrega (nombre o referencia)").fill(deliveryName);
  await createDialog.getByRole("button", { name: /Crear pedido|Guardar offline/ }).click();

  const item = page.locator("li.customers-item", { hasText: deliveryName });
  await expect(item).toBeVisible({ timeout: 10_000 });
  return { item, deliveryName };
}

test("flujo manual completo: crear, aceptar, listo, en camino y entregar", async ({ page }) => {
  await login(page);
  const { item } = await createManualOrder(page);

  // Aceptar → Preparando.
  await item.getByRole("button", { name: "Aceptar" }).click();
  await expect(item.getByText("Preparando")).toBeVisible({ timeout: 10_000 });

  // Listo → Ready.
  await item.getByRole("button", { name: "Listo" }).click();
  await expect(item.getByText("Listo")).toBeVisible({ timeout: 10_000 });

  // En camino → ON_THE_WAY.
  await item.getByRole("button", { name: "En camino" }).click();
  await expect(item.getByText("En camino")).toBeVisible({ timeout: 10_000 });

  // Entregar en efectivo → Delivered (finaliza la venta exactamente una vez).
  await item.getByRole("button", { name: "Entregar" }).click();
  const deliverDialog = page.getByRole("dialog", { name: "Entregar pedido" });
  await expect(deliverDialog.getByText(/Total a cobrar:.*RD\$275\.00/)).toBeVisible();
  await deliverDialog.getByRole("button", { name: /Confirmar entrega|Guardar offline/ }).click();
  await expect(item.getByText("Entregado")).toBeVisible({ timeout: 10_000 });

  // Ya no se puede entregar de nuevo (idempotente por operación).
  await expect(item.getByRole("button", { name: "Entregar" })).toHaveCount(0);
});

test("cancelar un pedido aceptado libera la reserva", async ({ page }) => {
  await login(page);
  const { item } = await createManualOrder(page);

  await item.getByRole("button", { name: "Aceptar" }).click();
  await expect(item.getByText("Preparando")).toBeVisible({ timeout: 10_000 });

  await item.getByRole("button", { name: "Cancelar" }).click();
  await expect(item.getByText("Cancelado")).toBeVisible({ timeout: 10_000 });
});
