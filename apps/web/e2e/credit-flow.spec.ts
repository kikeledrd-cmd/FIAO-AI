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

test("fiado sale charges credit and the customer list shows the balance", async ({ page }) => {
  await login(page);

  // Home -> Vender
  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Pan Sobao/ }).first()).toBeVisible();

  // Vender 1 Pan Sobao (RD$25) a fiado a Doña María (seed: límite RD$1,000, saldo RD$800).
  await page.getByRole("button", { name: /Pan Sobao/ }).first().click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fiado" }).click();
  await dialog.getByRole("combobox", { name: "Cliente a fiado" }).selectOption("40000000-0000-4000-8000-100000000001");
  await dialog.getByRole("button", { name: /Confirmar venta|Guardar offline/ }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();

  // El recibo muestra Fiado.
  await expect(page.getByText("Fiado")).toBeVisible();
  await page.getByRole("button", { name: "Nueva venta" }).click();

  // Clientes: Doña María ahora debe RD$825 (800 + 25).
  await page.goto("/customers");
  await expect(page.getByText("Doña María Peña")).toBeVisible();
  await expect(page.getByText("RD$825.00")).toBeVisible();
  await expect(page.getByText("RD$1,000.00")).toBeVisible(); // límite
});

test("abono reduces the balance and syncs", async ({ page }) => {
  await login(page);

  // Crear saldo de Don Rafael: vender 1 arroz a fiado (RD$275).
  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  const sellDialog = page.getByRole("dialog");
  await sellDialog.getByRole("button", { name: "Fiado" }).click();
  await sellDialog.getByRole("combobox", { name: "Cliente a fiado" }).selectOption("40000000-0000-4000-8000-100000000002");
  await sellDialog.getByRole("button", { name: /Confirmar venta|Guardar offline/ }).click();
  await expect(page.getByText("Venta registrada")).toBeVisible();

  await page.goto("/customers");
  const rafael = page.locator("li", { hasText: "Don Rafael Marte" });
  await expect(rafael.getByText("RD$275.00")).toBeVisible();

  // Abonar RD$200 -> queda RD$75.
  await rafael.getByRole("button", { name: "Abonar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Monto del abono (RD$)").fill("200");
  await dialog.getByRole("button", { name: /Registrar abono|Guardar offline/ }).click();

  await expect(rafael.getByText("RD$75.00")).toBeVisible({ timeout: 10_000 });
});

test("new customer is created and syncs exactly once", async ({ page }) => {
  await login(page);
  await page.goto("/customers");

  await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill("Cliente E2E");
  await dialog.getByLabel("Teléfono (opcional)").fill("+18095550998");
  await dialog.getByRole("button", { name: "Guardar cliente" }).click();

  await expect(page.getByText("Cliente E2E")).toBeVisible();
  // El upsert se sincroniza: el header vuelve a "Sincronizado".
  await expect(page.locator("header").getByText(/Sincronizado|0 pendientes/)).toBeVisible({ timeout: 10_000 });
});
