import { spawn } from "node:child_process";
import { setupLocal } from "./setup-local.mjs";
try {
  console.log("Chuẩn bị Supabase local và tài khoản thử…");
  const local = await setupLocal();
  const env = { ...process.env, ...local, NODE_ENV: "development" };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  let running = false;
  try {
    const response = await fetch(local.NEXT_PUBLIC_APP_URL + "/login", {
      signal: AbortSignal.timeout(1500),
    });
    const html = await response.text();
    if (!response.ok || !html.includes('aria-label="Tài khoản thử local"'))
      throw Object.assign(new Error(), { code: "PORT_3000_IN_USE" });
    running = true;
  } catch (error) {
    if (error.code === "PORT_3000_IN_USE") throw error;
  }
  if (running) {
    console.log(
      "Supabase local và app đã chạy. Mở http://localhost:3000/login để chọn tài khoản thử.",
    );
  } else {
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "localhost",
        "--port",
        "3000",
      ],
      { env, stdio: "inherit", windowsHide: true },
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => child.kill(signal));
    child.once("exit", (code) => {
      process.exitCode = code || 0;
    });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      code: error.code || error.name,
      hint:
        error.code === "PORT_3000_IN_USE"
          ? "Port 3000 đang chạy app khác hoặc cấu hình cũ; dừng server đó rồi chạy lại npm run dev:local."
          : "Mở Docker Desktop rồi chạy npm run dev:local.",
    }),
  );
  process.exitCode = 1;
}
