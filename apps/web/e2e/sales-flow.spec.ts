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

test("cash sale completes and syncs exactly once", async ({ page }) => {
  await login(page);

  // Home -> Vender
  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page).toHaveURL(/\/sell/);

  // El catálogo sembrado carga (Arroz La Garza 5lb, RD$275.00).
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();

  // Agregar 2 unidades de arroz -> total RD$550.00
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();
  await page.getByRole("button", { name: "Agregar uno de Arroz La Garza 5lb" }).click();

  // Cobrar en efectivo.
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar venta" }).click();

  // Recibo interno.
  await expect(page.getByText("Venta registrada")).toBeVisible();
  await expect(page.getByText(/RD\$550\.00/).first()).toBeVisible();
  await expect(page.getByText("Efectivo")).toBeVisible();

  // Nueva venta limpia el estado.
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await expect(page.getByPlaceholder("Buscar producto…")).toBeVisible();
});

test("mixed payment sale works offline and syncs on reconnect", async ({ page, context }) => {
  const consoleErrors: string[] = [];
  const networkProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("ERR_INTERNET_DISCONNECTED")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (navigator.onLine) {
      networkProblems.push(`FAILED ${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
    }
  });
  page.on("response", (response) => {
    if (/\/api\/sync\/(push|pull)/.test(response.url()) && response.status() >= 400) {
      networkProblems.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  await login(page);

  await page.getByRole("link", { name: /Vender/ }).click();
  await expect(page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Arroz La Garza 5lb/ }).first().click();

  // Venta offline: el shell del POS sigue funcionando desde el catálogo local.
  await context.setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });

  await page.getByRole("button", { name: "Cobrar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Efectivo" }).click();
  await dialog.getByLabel("Pago mixto (efectivo + otro método)").check();
  // Efectivo RD$100 + transferencia por el resto (RD$175).
  await dialog.getByRole("spinbutton", { name: "Efectivo", exact: true }).fill("100");
  await dialog.getByRole("button", { name: /Confirmar venta|Guardar offline/ }).click();

  // El recibo se genera offline y la operación queda en la cola local.
  await expect(page.getByText("Venta registrada")).toBeVisible();
  await page.getByRole("button", { name: "Nueva venta" }).click();

  // Reconexión: la cola se vacía al sincronizar.
  await context.setOffline(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });
  // El SW necesita un instante para reclamar el control tras reconectar.
  await page.waitForTimeout(800);
  await page.goto("/sell", { waitUntil: "domcontentloaded" });
  await expect(page.locator("header")).toBeVisible();
  await page.locator("header").getByRole("button", { name: /Sync/ }).click();
  try {
    await expect(page.locator("header").getByText(/Sincronizado/)).toBeVisible({ timeout: 10_000 });
  } catch {
    const dump = await page.evaluate(async () => {
      const open = (name: string) =>
        new Promise<IDBDatabase | null>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onupgradeneeded = () => req.result.close();
        });
      const readAll = (db: IDBDatabase, store: string) =>
        new Promise<string>((resolve) => {
          const tx = db.transaction(store, "readonly");
          const all: unknown[] = [];
          const req = tx.objectStore(store).openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              all.push(cursor.value);
              cursor.continue();
            } else resolve(JSON.stringify(all));
          };
          req.onerror = () => resolve("ERR_READ");
        });
      const db = await open("fiao-offline");
      if (!db) return "NO_DB";
      const names = Array.from(db.objectStoreNames);
      const out: Record<string, string> = {};
      for (const store of names) out[store] = await readAll(db, store);
      db.close();
      return JSON.stringify(out);
    });
    throw new Error(`Sync no llegó a Sincronizado. Dexie dump:\n${dump}\nConsola:\n${consoleErrors.join("\n")}\nRed:\n${networkProblems.join("\n")}`);
  }
  expect(consoleErrors).toEqual([]);
  expect(networkProblems).toEqual([]);
});