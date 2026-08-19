import { expect, test, type Page } from "@playwright/test";

const SEED_OWNER_PHONE = process.env.FIAO_SEED_OWNER_PHONE ?? "+18095550123";
const SEED_OWNER_PIN = process.env.FIAO_SEED_OWNER_PIN ?? "1234";
const SEED_CASHIER_PHONE = process.env.FIAO_SEED_CASHIER_PHONE ?? "+18095550999";
const SEED_CASHIER_PIN = process.env.FIAO_SEED_CASHIER_PIN ?? "5678";

async function login(page: Page, phone: string, pin: string) {
  await page.goto("/login");
  await page.getByLabel("Teléfono").fill(phone);
  await page.getByLabel("PIN").fill(pin);
  await page.getByRole("button", { name: /Entrar a FIAO/ }).click();
  await expect(page.locator("header").getByRole("img", { name: "FIAO" })).toBeVisible();
}

test("el dueño ve el resumen de reportes", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);
  await page.goto("/reportes");
  await expect(page.getByText("Resumen de hoy")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("tab", { name: "Ganancia" })).toBeVisible();
});

test("el cajero no ve las pestañas protegidas de reportes", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);
  await page.goto("/reportes");
  await expect(page.getByRole("tab", { name: "Ventas" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("tab", { name: "Ganancia" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveCount(0);
});

test("el dueño cambia un ajuste y se guarda", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);
  await page.goto("/configuracion");
  const field = page.getByText("Días de promesa por defecto").locator("..").locator("input");
  await field.fill("12");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Guardado.")).toBeVisible({ timeout: 10_000 });
});

test("el dueño exporta clientes a CSV", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);
  await page.goto("/reportes");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar clientes (CSV)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("customers.csv");
});
