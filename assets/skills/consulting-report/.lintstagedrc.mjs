const commit = process.env.LINT_STAGE === "commit";

export default {
  "{template,demo}/**": [
    () => "bun install --cwd template --frozen-lockfile --ignore-scripts",
    [
      () => "bun run --cwd template type-check",
      () => "bun x --cwd template --no-install tsc -p ../tsconfig.demo.json",
      () => "bun x --cwd template --no-install knip-bun --config ../knip.json",
      () => "bun x --cwd template --no-install madge --circular --extensions ts,tsx --ts-config tsconfig.json .",
    ],
    ...(commit ? [() => "bun run --cwd template build"] : []),
  ],
};
