import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

const raw = fs.readFileSync(path.join(ROOT, "config.json"), "utf8");
export const config = JSON.parse(raw);
