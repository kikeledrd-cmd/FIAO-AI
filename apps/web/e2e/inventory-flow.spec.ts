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

test("owner adjusts stock from the inventory screen", async ({ page }) => {
  await login(page);

  // Home -> Inventario
  await page.getByRole("link", { name: /Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByText("Arroz La Garza 5lb").first()).toBeVisible();

  // Ajustar: +5 (el seed deja 40).
  await page.getByText("Arroz La Garza 5lb").first().locator("xpath=ancestor::li").getByRole("button", { name: "Ajustar" }).click();
  const dialog = page.getByRole("dialog", { name: "Ajustar stock" });
  await dialog.getByLabel("Cantidad (usa − para restar, ej. −2)").fill("5");
  await dialog.getByLabel("Motivo").fill("Compra al proveedor E2E");
  await dialog.getByRole("button", { name: "Guardar ajuste" }).click();

  // El stock local sube a 45 tras el sync.
  await expect(page.getByText(/45 und/).first()).toBeVisible({ timeout: 10_000 });
});

test("owner reverses a cash sale and the stock is restored", async ({ page }) => {
  await login(page);

  // Vender 1 arroz (N -> N-1).
  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();
  const stockBefore = await stockOf(page, "Arroz La Garza 5lb");
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();

  // Anular la venta (OWNER: no pide PIN).
  await page.getByRole("button", { name: "Anular venta" }).click();
  const dialog = page.getByRole("dialog", { name: "Anular venta" });
  await dialog.getByLabel("Motivo de la anulación").fill("Devolución E2E");
  await dialog.getByRole("button", { name: "Confirmar anulación" }).click();

  // Vuelve al POS; el stock local se restaura (N-1 -> N).
  await expect(page.getByPlaceholder("Buscar producto…")).toBeVisible();
  await expect
    .poll(async () => stockOf(page, "Arroz La Garza 5lb"), { timeout: 10_000 })
    .toBe(stockBefore);
});

test("cashier cannot reverse without owner PIN", async ({ page }) => {  // Login como cajero.
  const cashierPhone = process.env.FIAO_SEED_CASHIER_PHONE ?? "+18095550999";
  const cashierPin = process.env.FIAO_SEED_CASHIER_PIN ?? "5678";
  await page.goto("/login");
  await page.getByLabel("Teléfono").fill(cashierPhone);
  await page.getByLabel("PIN").fill(cashierPin);
  await page.getByRole("button", { name: /Entrar a FIAO/ }).click();
  await expect(page.locator("header").getByRole("img", { name: "FIAO" })).toBeVisible();

  // El cajero no ve la card de inventario... la ve pero sin permiso la API lo
  // rechaza. Para el E2E: el botón Anular pide PIN del dueño; sin conexión
  // se bloquea. Verificamos que el PIN incorrecto muestra error.
  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta" }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();

  await page.getByRole("button", { name: "Anular venta" }).click();
  const dialog = page.getByRole("dialog", { name: "Anular venta" });
  await dialog.getByLabel("Motivo de la anulación").fill("Intento sin permiso");
  await dialog.getByLabel("PIN del dueño").fill("0000");
  await dialog.getByRole("button", { name: "Confirmar anulación" }).click();

  // PIN inválido -> error visible y la venta sigue en el recibo.
  await expect(dialog.getByRole("alert")).toContainText(/PIN incorrecto|No se pudo anular/, { timeout: 10_000 });
});

async function stockOf(page: Page, productName: string): Promise<number> {
  const text = await page.getByRole("button", { name: new RegExp(productName) }).first().innerText();
  const match = text.match(/(\d+(?:\.\d+)?)\s*und/);
  if (!match) throw new Error(`No se pudo leer el stock de ${productName}: "${text}"`);
  return Number(match[1]);
}
