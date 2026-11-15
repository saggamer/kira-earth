import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
const python =
  process.platform === "win32"
    ? "backend/.venv/Scripts/python.exe"
    : "backend/.venv/bin/python";
if (!existsSync(python)) {
  console.error("Set up backend/.venv first. See README.md for installation.");
  process.exit(1);
}
const children = [
  spawn(
    python,
    [
      "-m",
      "uvicorn",
      "backend.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
    ],
    { stdio: "inherit" },
  ),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
