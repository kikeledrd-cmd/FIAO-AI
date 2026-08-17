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

/** Abre caja con float para el dueño (el anticipo de apartado exige sesión abierta). */
async function openCash(page: Page, float: string) {
  await page.goto("/cash");
  await expect(page).toHaveURL(/\/cash/);

  const empty = page.getByText("No hay sesión de caja para esta sucursal.");
  await expect(empty.or(page.getByText("Abierta").or(page.getByText("Cerrada")))).toBeVisible({
    timeout: 10_000
  });

  if (await page.getByRole("button", { name: "Cerrar caja" }).isVisible().catch(() => false)) {
    const text = await page.locator(".cash-summary").innerText();
    const match = text.match(/Efectivo esperado\s+RD\$([\d,.]+)/);
    const expected = (match ? (match[1] ?? "0.00") : "0.00").replace(/,/g, "");
    await page.getByRole("button", { name: "Cerrar caja" }).click();
    const closeDialog = page.getByRole("dialog", { name: "Cerrar caja" });
    await closeDialog.getByLabel("Efectivo contado (RD$)").fill(expected);
    await closeDialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Cerrada")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Abrir nueva caja" }).click();
  } else {
    await page
      .getByRole("button", { name: "Abrir caja" })
      .or(page.getByRole("button", { name: "Abrir nueva caja" }))
      .click();
  }

  const dialog = page.getByRole("dialog", { name: "Abrir caja" });
  await dialog.getByLabel("Float inicial (RD$)").fill(float);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Abierta")).toBeVisible({ timeout: 10_000 });
}

/** Crea un apartado simple (Pan Sobao ×qty con anticipo) para Doña María. */
async function createApartado(page: Page, qty: string, deposit: string) {
  await page.goto("/apartados");
  await page.getByRole("button", { name: "+ Nuevo apartado" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo apartado" });
  await dialog.getByRole("combobox", { name: "Cliente" }).selectOption({ label: "Doña María Peña" });
  for (let i = 0; i < Number(qty); i += 1) {
    await dialog.locator(".pos-grid .pos-product", { hasText: "Pan Sobao" }).first().click();
  }
  await dialog.getByLabel("Anticipo (RD$)").fill(deposit);
  await dialog.getByRole("button", { name: /Guardar apartado|Guardar offline/ }).click();
}

test("apartado se crea con anticipo y se completa cobrando el resto", async ({ page }) => {
  await login(page);
  await openCash(page, "2000.00");

  await createApartado(page, "2", "25.00");

  // El apartado aparece activo con anticipo RD$25 y resta RD$25.
  await expect(page.getByText("Activo").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Anticipo RD\$25\.00/)).toBeVisible();

  // Completar cobrando el resto en efectivo.
  await page.getByRole("button", { name: "Completar" }).first().click();
  const completeDialog = page.getByRole("dialog", { name: "Completar apartado" });
  await expect(completeDialog.getByText(/Resta por cobrar:.*RD\$25\.00/)).toBeVisible();
  await completeDialog.getByRole("button", { name: /Completar apartado|Guardar offline/ }).click();

  // Pasa al historial como Completado.
  await expect(page.getByText("Completado").first()).toBeVisible({ timeout: 10_000 });
});

test("apartado se cancela y libera la reserva", async ({ page }) => {
  await login(page);
  await openCash(page, "2000.00");

  await createApartado(page, "1", "10.00");
  await expect(page.getByText("Activo").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Cancelar" }).first().click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancelar apartado" });
  await cancelDialog.getByLabel("Motivo").fill("Cliente canceló");
  await cancelDialog.getByRole("button", { name: "Confirmar cancelación" }).click();

  await expect(page.getByText("Cancelado").first()).toBeVisible({ timeout: 10_000 });
});

test("promo del 10% sobre Habichuelas se aplica en el POS", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Habichuelas Rojas 1lb/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /Habichuelas Rojas 1lb/ }).first().click();

  // RD$95.00 − 10% = RD$85.50.
  await expect(page.getByText("Descuento aplicado").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("RD$85.50").first()).toBeVisible();

  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();
  await expect(page.getByText(/RD\$85\.50/).first()).toBeVisible();
});

test("venta a fiado genera puntos de lealtad", async ({ page }) => {
  await login(page);

  // Cliente nuevo con nombre único y límite holgado para no chocar con datos residuales.
  const clienteNombre = `Cliente Lealtad ${Date.now()}`;
  await page.goto("/customers");
  await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
  const createDialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  await createDialog.getByLabel("Nombre").fill(clienteNombre);
  await createDialog.getByLabel("Límite de crédito (RD$)").fill("2000");
  await createDialog.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText(clienteNombre)).toBeVisible();

  // Vender 1 Arroz (RD$275) a fiado al cliente nuevo.
  await page.goto("/sell");
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fiado" }).click();
  const fiadoSelect = dialog.getByRole("combobox", { name: "Cliente a fiado" });
  const optionValue = await dialog.locator("option", { hasText: clienteNombre }).getAttribute("value");
  await fiadoSelect.selectOption(optionValue!);
  await dialog.getByRole("button", { name: /Confirmar venta|Guardar offline/ }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();

  // RD$275 → 275 puntos (1 punto por RD$1 con la tasa demo de 100).
  await page.goto("/loyalty");
  const loyaltySelect = page.getByRole("combobox", { name: "Ver puntos de un cliente" });
  const loyaltyOption = await page.locator("option", { hasText: clienteNombre }).getAttribute("value");
  await loyaltySelect.selectOption(loyaltyOption!);
  await expect(page.getByText(/275 puntos/)).toBeVisible({ timeout: 10_000 });
});
