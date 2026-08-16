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
  // Carga de documento completa para que el SW cachee el shell (navigate).
  await page.reload();
  await expect(page.locator("header").getByRole("img", { name: "FIAO" })).toBeVisible();
}

test("app shell works offline and sync recovers", async ({ page, context }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);

  const header = page.locator("header");

  // App shell shows the active branch and a ready sync state.
  await expect(header.getByRole("button", { name: /Los Mina/ })).toBeVisible();
  await expect(header.getByText(/Sincronizado/)).toBeVisible();

  // The branch switcher lists the other branch.
  await header.getByRole("button", { name: /Los Mina/ }).click();
  await expect(header.getByText("Invivienda")).toBeVisible();
  await header.getByRole("button", { name: /Los Mina/ }).click();

  // Go offline: shell, branch name and connection status must still render.
  await context.setOffline(true);
  // En un dispositivo real la radio cortada hace navigator.onLine=false; con la
  // emulación de Playwright el documento servido por el SW nace "online", así
  // que reflejamos el estado de red real del dispositivo como lo haría el OS.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(header.getByText("Sin conexión")).toBeVisible();
  // Recarga offline: el shell (logo, sucursal, sync status) se sirve del SW.
  await page.reload();
  await expect(header.getByRole("img", { name: "FIAO" })).toBeVisible();
  await expect(header.getByRole("button", { name: /Los Mina/ })).toBeVisible();
  await expect(header.getByText(/Sincronizado/)).toBeVisible();

  // Back online: connection status recovers and manual sync is available.
  await context.setOffline(false);
  await expect(header.getByText("En línea")).toBeVisible();
  await header.getByRole("button", { name: /Sync/ }).click();
  await expect(header.getByText(/Sincronizado/)).toBeVisible({ timeout: 10_000 });
});

test("cashier only sees the assigned branch", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);

  const header = page.locator("header");
  await expect(header.getByRole("button", { name: /Los Mina/ })).toBeVisible();
  await expect(header.getByText("Invivienda")).not.toBeVisible();
});
