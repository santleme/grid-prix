import { cp, mkdir } from "node:fs/promises";

await mkdir("grid_prix/static", { recursive: true });
await cp("dist", "grid_prix/static", { recursive: true, force: true });
