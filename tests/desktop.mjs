// Real Tauri + WebView2 integration test. Only fictitious data; temporary vault outside the repo.
// Requires `npm run dev` and `cargo build --manifest-path src-tauri/Cargo.toml` first.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "vaultkey-e2e-"));
const executable = resolve("src-tauri/target/debug/vaultkey.exe");
await mkdir("verification", { recursive: true });
let child, browser, page;
const errors = [];
async function start() {
  child = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      VAULTKEY_TEST_DATA_DIR: temporary,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9227",
    },
  });
  child.on("error", () => errors.push("Native process launch failed"));
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9227");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(browser, "WebView2 debugging endpoint must be available");
  for (let i = 0; i < 60; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes("1420"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(page, "Tauri webview must load Vite");
  page.setDefaultTimeout(45000);
  page.on("pageerror", () => errors.push("Unhandled page error"));
  await page.locator("h2").first().waitFor();
}
async function ipc(command, args = {}) {
  return page.evaluate(
    async ({ command, args }) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      return invoke(command, args);
    },
    { command, args },
  );
}
async function stop() {
  const running = child;
  child = undefined;
  if (running && running.exitCode === null && running.signalCode === null) {
    await new Promise((r) => {
      running.once("exit", r);
      running.kill();
    });
  }
  browser = undefined;
  page = undefined;
  await new Promise((r) => setTimeout(r, 1000));
}
async function unlock(password = "ExamplePassword123!") {
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your vault", exact: true })
    .waitFor();
}
try {
  await start();
  await page.locator("input[name=password]").fill("ExamplePassword123!");
  await page.locator("input[name=confirm]").fill("ExamplePassword123!");
  await page.getByRole("button", { name: "Create Vault", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your vault", exact: true })
    .waitFor();
  assert.equal((await ipc("status")).unlocked, true);
  await page
    .getByRole("button", { name: "Add Credential", exact: true })
    .click();
  await page.locator("input[name=service]").fill("Google Main");
  await page.locator("input[name=email]").fill("example@example.com");
  await page.locator("input[name=password]").fill("ExamplePassword123!");
  await page.locator("input[name=category]").fill("Personal");
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Google Main", exact: true })
    .waitFor();
  let records = await ipc("list_credentials", { query: "" });
  const parent = records[0].id;
  assert.equal(records[0].password, "");
  assert.equal(records[0].hasPassword, true);
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await page.getByText("ExamplePassword123!", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  assert.equal(
    await page.getByText("ExamplePassword123!", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Copy Password", exact: true })
    .click();
  await page
    .getByText("Copied — clipboard will clear automatically", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add Credential", exact: true })
    .click();
  await page.locator("input[name=service]").fill("Canva Demo");
  await page.locator("select[name=accessMethod]").selectOption("Google");
  await page.locator("select[name=linkedAccount]").selectOption(parent);
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Canva Demo", exact: true })
    .waitFor();
  records = await ipc("list_credentials", { query: "" });
  const linked = records.find((c) => c.service === "Canva Demo");
  assert.equal(linked.hasPassword, false);
  assert.equal(linked.linkedAccount, parent);
  await page
    .getByRole("button", { name: "Linked Accounts", exact: true })
    .click();
  await page.getByText("1 linked accounts", { exact: true }).waitFor();
  await page.screenshot({ path: "verification/linked-accounts.png" });
  await page.getByRole("button", { name: /All Credentials/ }).click();
  await page
    .getByRole("textbox", { name: "Search credentials" })
    .fill("Google Main");
  await page.waitForFunction(
    () => document.querySelectorAll(".credential-item").length === 1,
  );
  await page.locator(".credential-item").first().click();
  await page
    .getByRole("button", { name: "Delete credential", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Delete credential?", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("dialog")
      .getByRole("button", { name: "Delete credential", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit credential", exact: true })
    .click();
  await page.locator("input[name=service]").fill("Google Personal");
  await page
    .getByRole("button", { name: "Save credential", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Google Personal", exact: true })
    .waitFor();
  assert.equal(
    await ipc("reveal_password", { id: parent }),
    "ExamplePassword123!",
  );
  await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.screenshot({ path: "verification/vault.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("input[name=current]").fill("ExamplePassword123!");
  await page.locator("input[name=new]").fill("NewExamplePassword123!");
  await page.locator("input[name=confirm]").fill("NewExamplePassword123!");
  await page
    .getByRole("button", { name: "Change master password", exact: true })
    .click();
  await page
    .getByText("Master password updated. Your credentials are unchanged.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: /Lock Vault/ }).click();
  await page
    .getByRole("button", { name: "Unlock Vault", exact: true })
    .waitFor();
  assert.equal((await ipc("status")).unlocked, false);
  await assert.rejects(ipc("list_credentials", { query: "" }));
  await page.locator("input[name=password]").fill("ExamplePassword123!");
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await stop();
  await start();
  await unlock("NewExamplePassword123!");
  records = await ipc("list_credentials", { query: "" });
  assert.equal(records.length, 2);
  // Isolate the inactivity measurement from mouse movement on the shared desktop.
  await page.evaluate(() => {
    window.__idleInputCount = 0;
    window.__idleInputGuard = (e) => {
      window.__idleInputCount++;
      e.stopImmediatePropagation();
    };
    for (const name of ["pointerdown", "keydown", "wheel", "pointermove"])
      window.addEventListener(name, window.__idleInputGuard, { capture: true });
  });
  await ipc("set_timeout", { seconds: 60 });
  assert.equal((await ipc("status")).timeoutSeconds, 60);
  console.log(
    "PASS creation, CRUD, reveal/hide, copy, search, relationships, delete protection, rotation, lock and restart. Testing native inactivity timeout…",
  );
  // No synthetic activity, IPC status calls do not extend the timer.
  const expiryStarted = Date.now();
  while ((await ipc("status")).unlocked) {
    assert.ok(
      Date.now() - expiryStarted < 70000,
      "Rust must enforce the 60-second timeout",
    );
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Hidden WebView2 windows throttle requestAnimationFrame, which locator visibility waits use.
  // Poll DOM with a timer; the Rust status checks above do not count as activity.
  await page.waitForFunction(
    () => document.querySelector(".auth") !== null,
    undefined,
    { polling: 500, timeout: 10000 },
  );
  const intercepted = await page.evaluate(() => {
    for (const name of ["pointerdown", "keydown", "wheel", "pointermove"])
      window.removeEventListener(name, window.__idleInputGuard, {
        capture: true,
      });
    return window.__idleInputCount;
  });
  console.log(
    `PASS 60-second inactivity timer (${intercepted} shared-desktop input events isolated).`,
  );
  await unlock("NewExamplePassword123!");
  await ipc("delete_credential", { id: linked.id });
  await ipc("delete_credential", { id: parent });
  assert.equal((await ipc("list_credentials", { query: "" })).length, 0);
  await ipc("lock_vault");
  await stop();
  const bytes = await readFile(join(temporary, "vault.db"));
  for (const text of [
    "ExamplePassword123!",
    "NewExamplePassword123!",
    "example@example.com",
    "Google Personal",
  ])
    assert.equal(bytes.includes(Buffer.from(text)), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS native auto-lock, encrypted persistence, deletion and absence of page errors.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: "verification/desktop-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  await stop();
  assert.ok(
    resolve(temporary).startsWith(resolve(tmpdir()) + "\\vaultkey-e2e-"),
    "Cleanup must stay within the generated test directory",
  );
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
