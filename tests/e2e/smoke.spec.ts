import { test, expect } from "@playwright/test";

test("landing redirects to default locale and renders hero", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/pt-BR$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("language can be switched to English", async ({ page }) => {
  await page.goto("/pt-BR");
  await page.getByLabel(/idioma|language/i).selectOption("en");
  await expect(page).toHaveURL(/\/en$/);
});

test("sign-in page renders the form", async ({ page }) => {
  await page.goto("/pt-BR/sign-in");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
});

test("dashboard is protected", async ({ page }) => {
  await page.goto("/pt-BR/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("admin console is protected", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});
