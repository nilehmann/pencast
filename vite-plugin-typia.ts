import path from "path";
import { fileURLToPath } from "url";
import { TypiaGenerator } from "@typia/transform";
import type { Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export function typiaGeneratorPlugin(): Plugin {
  return {
    name: "typia-generator",
    async buildStart() {
      await TypiaGenerator.build({
        input: path.join(root, "validators"),
        output: path.join(root, "shared/generated"),
        project: path.join(root, "tsconfig.server.json"),
      });
    },
  };
}
