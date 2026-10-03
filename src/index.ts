import { runBot } from "./lifecycle.js";

runBot().catch(error => { console.error("[App] Fatal error:", error); process.exitCode = 1; });
