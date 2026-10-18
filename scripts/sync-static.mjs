import { cp, mkdir, rm } from "node:fs/promises";

await rm("grid_prix/static/assets", { recursive: true, force: true });
await mkdir("grid_prix/static", { recursive: true });
await cp("dist", "grid_prix/static", { recursive: true, force: true });
