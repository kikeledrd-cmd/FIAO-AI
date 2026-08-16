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

/**
 * Abre una sesión de caja con el float indicado. Espera el estado estable de
 * la pantalla y, si ya hay una sesión abierta (residual de un test
 * anterior), la cierra cuadrando primero: lee el "Efectivo esperado" de la
 * pantalla y lo usa como efectivo contado.
 */
async function openCash(page: Page, float: string) {
  await page.goto("/cash");
  await expect(page).toHaveURL(/\/cash/);

  const empty = page.getByText("No hay sesión de caja para esta sucursal.");
  await expect(empty.or(page.getByText("Abierta").or(page.getByText("Cerrada")))).toBeVisible({
    timeout: 10_000
  });

  if (await page.getByRole("button", { name: "Cerrar caja" }).isVisible().catch(() => false)) {
    const summary = page.locator(".cash-summary");
    const text = await summary.innerText();
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

test("cashier opens a cash session with an initial float", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);

  await openCash(page, "2000.00");

  await expect(page.getByText("RD$2,000.00").first()).toBeVisible();
  await expect(page.getByText("Efectivo esperado")).toBeVisible();
});

test("cashier registers an expense within the limit and it appears in the list", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);

  await openCash(page, "2000.00");

  await page.getByRole("button", { name: "Gasto" }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar gasto" });
  await dialog.getByLabel("Monto (RD$)").fill("500.00");
  await dialog.getByLabel("Descripción (opcional)").fill("Botellón de agua");
  await dialog.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText("Botellón de agua")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("+RD$500.00")).toBeVisible();
});

test("cashier closes the cash session reconciling (difference 0)", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);

  await openCash(page, "2000.00");

  // Gasto de 500 → esperado = 2000 − 500 = 1500.
  await page.getByRole("button", { name: "Gasto" }).click();
  const expenseDialog = page.getByRole("dialog", { name: "Registrar gasto" });
  await expenseDialog.getByLabel("Monto (RD$)").fill("500.00");
  await expenseDialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("RD$1,500.00").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Cerrar caja" }).click();
  const closeDialog = page.getByRole("dialog", { name: "Cerrar caja" });
  await closeDialog.getByLabel("Efectivo contado (RD$)").fill("1500.00");
  await closeDialog.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText("Cerrada")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("RD$0.00").first()).toBeVisible(); // diferencia 0
});

test("cashier cannot close with difference without owner PIN", async ({ page }) => {
  await login(page, SEED_CASHIER_PHONE, SEED_CASHIER_PIN);

  await openCash(page, "2000.00");

  await page.getByRole("button", { name: "Cerrar caja" }).click();
  const closeDialog = page.getByRole("dialog", { name: "Cerrar caja" });
  await closeDialog.getByLabel("Efectivo contado (RD$)").fill("1900.00");

  // Diferencia ≠ 0 → pide PIN del dueño; con PIN incorrecto falla.
  await closeDialog.getByLabel("PIN del dueño").fill("0000");
  await closeDialog.getByRole("button", { name: "Confirmar" }).click();

  await expect(closeDialog.getByRole("alert")).toContainText(/PIN incorrecto|No se pudo completar/, { timeout: 10_000 });
});

test("owner closes with a difference and the audit records it", async ({ page }) => {
  await login(page, SEED_OWNER_PHONE, SEED_OWNER_PIN);

  await openCash(page, "2000.00");

  await page.getByRole("button", { name: "Cerrar caja" }).click();
  const closeDialog = page.getByRole("dialog", { name: "Cerrar caja" });
  await closeDialog.getByLabel("Efectivo contado (RD$)").fill("1900.00");
  await closeDialog.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText("Cerrada")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("-RD$100.00").first()).toBeVisible();
  await expect(page.getByText("Diferencia de arqueo")).toBeVisible();
});
