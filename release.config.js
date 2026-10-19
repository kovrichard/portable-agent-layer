const stableOnly = (plugin) =>
  process.env.GITHUB_REF_NAME === "canary" ? [] : [plugin];

export default {
  branches: ["main", { name: "canary", prerelease: true }],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ...stableOnly("@semantic-release/changelog"),
    ["@semantic-release/npm", { npmPublish: true }],
    ...stableOnly([
      "@semantic-release/git",
      { assets: ["package.json", "CHANGELOG.md"] },
    ]),
    "@semantic-release/github",
  ],
};
