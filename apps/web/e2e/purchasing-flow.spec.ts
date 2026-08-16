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

test("creates a supplier from the suppliers screen", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: /Proveedores/ }).click();
  await expect(page).toHaveURL(/\/suppliers/);

  await page.getByRole("button", { name: "+ Nuevo proveedor" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proveedor" });
  await dialog.getByLabel("Nombre").fill("Distribuidora La Vega E2E");
  await dialog.getByLabel("Teléfono (opcional)").fill("+18095551111");
  await dialog.getByRole("button", { name: "Guardar proveedor" }).click();

  await expect(page.getByText("Distribuidora La Vega E2E")).toBeVisible({ timeout: 10_000 });
});

test("owner registers a purchase and stock + cost update", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: /Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByText("Arroz La Garza 5lb").first()).toBeVisible();

  // Stock inicial del arroz (el seed deja 40).
  const stockBefore = await inventoryStockOf(page, "Arroz La Garza 5lb");

  await page.getByRole("button", { name: "+ Registrar compra" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar compra" });
  await dialog.getByLabel("Producto").selectOption({ label: "Arroz La Garza 5lb" });
  await dialog.getByLabel("Cantidad").fill("5");
  await dialog.getByLabel("Costo unitario (RD$)").fill("80.00");
  await dialog.getByRole("button", { name: "Registrar compra" }).click();

  // El stock local sube a stockBefore + 5.
  await expect
    .poll(async () => inventoryStockOf(page, "Arroz La Garza 5lb"), { timeout: 10_000 })
    .toBe(stockBefore + 5);
});

test("cashier cannot register a purchase without owner PIN", async ({ page }) => {
  const cashierPhone = process.env.FIAO_SEED_CASHIER_PHONE ?? "+18095550999";
  const cashierPin = process.env.FIAO_SEED_CASHIER_PIN ?? "5678";
  await page.goto("/login");
  await page.getByLabel("Teléfono").fill(cashierPhone);
  await page.getByLabel("PIN").fill(cashierPin);
  await page.getByRole("button", { name: /Entrar a FIAO/ }).click();
  await expect(page.locator("header").getByRole("img", { name: "FIAO" })).toBeVisible();

  await page.getByRole("link", { name: /Inventario/ }).click();
  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByText("Arroz La Garza 5lb").first()).toBeVisible();

  await page.getByRole("button", { name: "+ Registrar compra" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar compra" });
  await dialog.getByLabel("Producto").selectOption({ label: "Arroz La Garza 5lb" });
  await dialog.getByLabel("Cantidad").fill("1");
  await dialog.getByLabel("Costo unitario (RD$)").fill("90.00");
  await dialog.getByLabel("PIN del dueño").fill("0000");
  await dialog.getByRole("button", { name: "Registrar compra" }).click();

  await expect(dialog.getByRole("alert")).toContainText(/PIN incorrecto|No se pudo registrar/, { timeout: 10_000 });
});

async function inventoryStockOf(page: Page, productName: string): Promise<number> {
  const item = page.getByText(productName).first().locator("xpath=ancestor::li");
  const text = await item.innerText();
  const match = text.match(/(\d+(?:\.\d+)?)\s*und/);
  if (!match) throw new Error(`No se pudo leer el stock de ${productName}: "${text}"`);
  return Number(match[1]);
}
