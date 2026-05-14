import { main } from "../../flint/cli";

if (import.meta.main) await main({ configDir: import.meta.dir });
