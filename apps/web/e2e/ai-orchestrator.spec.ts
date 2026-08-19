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

async function ask(page: Page, text: string) {
  await page.goto("/ai");
  await page.getByPlaceholder("Escribe o dicta tu pregunta…").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test("consulta de solo lectura responde con datos confirmados", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);
  await ask(page, "¿cuánto vendí hoy?");
  await expect(page.locator(".ai-assistant").last()).toContainText("Ventas de hoy", { timeout: 10_000 });
});

test("registra un abono desde el chat con confirmación humana", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);
  await ask(page, "abona 100 pesos a maría");
  await expect(page.locator(".ai-assistant").last()).toContainText("Abonar", { timeout: 10_000 });
  await page.locator(".ai-assistant").last().getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator(".ai-assistant").last()).toContainText("Acción confirmada y ejecutada", { timeout: 10_000 });
});

test("el cajero no ve datos protegidos de caja", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);
  await ask(page, "¿cuánto hay en caja?");
  const answer = page.locator(".ai-assistant").last();
  await expect(answer).toBeVisible({ timeout: 10_000 });
  const text = await answer.innerText();
  expect(text).not.toContain("diferencia");
  expect(text).not.toContain("contado");
  expect(text).not.toContain("margen");
});
