# [0.56.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.55.2...v0.56.0) (2026-06-30)


### Features

* **skills:** enhance create-pdf with customizable margins and header/footer templates ([bd483f7](https://github.com/kovrichard/portable-agent-layer/commit/bd483f7705bb7a0dd45f7c3ce0fb21fa3a1e1345))

## [0.55.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.55.1...v0.55.2) (2026-06-23)


### Bug Fixes

* **skills:** allow writing personal skills in .pal ([dfbdbed](https://github.com/kovrichard/portable-agent-layer/commit/dfbdbed78797d890efa6c33e176cc60a8b20852d))

## [0.55.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.55.0...v0.55.1) (2026-06-17)


### Bug Fixes

* **isc:** introduce ticket emoji ([9aeadfc](https://github.com/kovrichard/portable-agent-layer/commit/9aeadfc974b1c910f6af94db6d927f32b20c8f27))

# [0.55.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.54.3...v0.55.0) (2026-06-13)


### Bug Fixes

* **skill-doctor:** improve link depth checking and handle Windows-style paths ([1e9bf76](https://github.com/kovrichard/portable-agent-layer/commit/1e9bf7604898242a7210a64acde0ac9c093d7d50))
* **skill-doctor:** warn when skill description is not wrapped with double quotes ([bd81b90](https://github.com/kovrichard/portable-agent-layer/commit/bd81b90bb97c2149214f6267014eef5b5fc36813))
* **skills:** use quotes around descriptions ([c31fe21](https://github.com/kovrichard/portable-agent-layer/commit/c31fe219f428b0d404a97108f3b86e0ffce29f72))


### Features

* **attribution:** add optional git co-author attribution prompt ([bdb21dd](https://github.com/kovrichard/portable-agent-layer/commit/bdb21ddbb27d7e99c2c7bd8a86b5c9f5ff82567a))

## [0.54.3](https://github.com/kovrichard/portable-agent-layer/compare/v0.54.2...v0.54.3) (2026-06-13)


### Bug Fixes

* **status-line:** respect claude's compact window env var ([20b5a88](https://github.com/kovrichard/portable-agent-layer/commit/20b5a882f38af2d29024c7d169d7b47a78e66d3c))

## [0.54.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.54.1...v0.54.2) (2026-06-09)


### Bug Fixes

* **steering-rules:** add code not comments rule ([2bb94b4](https://github.com/kovrichard/portable-agent-layer/commit/2bb94b4b548a63b5c550ebcf9505040d9f5ca96a))

## [0.54.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.54.0...v0.54.1) (2026-06-09)


### Bug Fixes

* **projects:** rename check-isc to complete-isc, introduce reopen-isc ([1dc69b7](https://github.com/kovrichard/portable-agent-layer/commit/1dc69b733a3f1df6d43b6713d08dbc5383f433b6))

# [0.54.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.53.0...v0.54.0) (2026-06-04)


### Bug Fixes

* adjust tests ([6260281](https://github.com/kovrichard/portable-agent-layer/commit/6260281765d888d78792c3ad1411378d3f53b0f9))
* **cursor:** clean up old hook formats on install ([3f5e0f9](https://github.com/kovrichard/portable-agent-layer/commit/3f5e0f9024979e91695053a37acb6a2acc8bfab7))
* **install:** detect repo mode simpler ([a2f0d58](https://github.com/kovrichard/portable-agent-layer/commit/a2f0d5890bf657ce50e99a778e31ef1298b8aecd))


### Features

* **algorithm:** update verify gate ([e03c104](https://github.com/kovrichard/portable-agent-layer/commit/e03c104d61a46bcadfa3f7b1516b801050ea8229))

# [0.53.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.52.0...v0.53.0) (2026-06-04)


### Features

* **analyze-reflect:** add new skills for learning analysis and relationship reflection ([dd647d8](https://github.com/kovrichard/portable-agent-layer/commit/dd647d8d41e42503cafbea28909541d280a982bb))
* **analyze:** integrate analyze tool into CLI and update documentation ([1392d95](https://github.com/kovrichard/portable-agent-layer/commit/1392d95a71142adc117395ea439bdb9fe11a2852))
* **eval:** add failure-principle extraction evaluation with assertions and test cases ([4f7fa15](https://github.com/kovrichard/portable-agent-layer/commit/4f7fa1556ab289c3a95562d155c4bce52ca0bfd6))
* **eval:** add sentiment evaluation tool with prompt configurations and logging support ([10d6eb7](https://github.com/kovrichard/portable-agent-layer/commit/10d6eb76a83a1c1428f11279858c28d7da297c0a))
* **eval:** enhance failure-principle extraction with new prompts and update evaluation logic ([6407c13](https://github.com/kovrichard/portable-agent-layer/commit/6407c1371f77d673964be1358a671d10987c7a39))
* **eval:** introduce eval-prompt skill for evaluating PAL inference prompts ([fc0f41e](https://github.com/kovrichard/portable-agent-layer/commit/fc0f41eba59a8c724a0ba30e2b0f1d4697d59099))
* **pdf:** add PDF reading tool and fallback mechanism for text extraction ([cb3ff8a](https://github.com/kovrichard/portable-agent-layer/commit/cb3ff8ac973163a3777b0dfa4bccf4bc0725d313))

# [0.52.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.51.2...v0.52.0) (2026-06-04)


### Bug Fixes

* **projects:** do not load all ISCs automatically, only on resume ([9df63f0](https://github.com/kovrichard/portable-agent-layer/commit/9df63f014cc2df1bbcfe218489d6e64fe91a8a93))
* **statusline:** change emdash to dash ([8ee23b4](https://github.com/kovrichard/portable-agent-layer/commit/8ee23b4984e7741dfb6fac9786bc273c8eeb7721))
* **synthesis:** remove dead code ([78c8b78](https://github.com/kovrichard/portable-agent-layer/commit/78c8b7899a0df79c8190c48f182bbb4891b3e448))


### Features

* **hooks:** enhance command normalization and add tests for hook path migration ([d86b28f](https://github.com/kovrichard/portable-agent-layer/commit/d86b28f5c94db75e30280765cf75df1e233d9eae))
* **logging:** add prompt snapshot logging and update retrieval injection function ([fa6bb93](https://github.com/kovrichard/portable-agent-layer/commit/fa6bb93f3eeec372ae62fd78502ac1fea3ccbe82))

## [0.51.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.51.1...v0.51.2) (2026-06-03)


### Bug Fixes

* **cli:** enhance export and import functionality to support directory arguments ([536a2bc](https://github.com/kovrichard/portable-agent-layer/commit/536a2bc03782711466579d695de87b10a5941c22))
* **debug:** add verbose logging functionality to CLI ([89d63db](https://github.com/kovrichard/portable-agent-layer/commit/89d63db0c5b5b05e5f12e3bedf720b9e1e78d4b8))
* **logging:** enhance CLI with detailed debug logging for export and import operations ([bd7500d](https://github.com/kovrichard/portable-agent-layer/commit/bd7500da3437af7edb79665139e5c3de9ef799ad))

## [0.51.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.51.0...v0.51.1) (2026-06-02)


### Bug Fixes

* **doctor:** check hooks correctly ([064b5a4](https://github.com/kovrichard/portable-agent-layer/commit/064b5a489454faaaa1bc94d583096598755d2c7f))
* **status:** show for 30 minutes ([1035c74](https://github.com/kovrichard/portable-agent-layer/commit/1035c743639a7fcf4becfda64211397bc55aefcb))

# [0.51.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.50.0...v0.51.0) (2026-06-01)


### Features

* add famous quotes ([bcf52d7](https://github.com/kovrichard/portable-agent-layer/commit/bcf52d7b0c66d1850c8df1485d652fefd0dddcd5))
* **status:** add more quotes ([997ada2](https://github.com/kovrichard/portable-agent-layer/commit/997ada2fedc06ce52d34081a3911d6cd8a5c3557))
* **status:** show quotes more randomly ([c2b5f01](https://github.com/kovrichard/portable-agent-layer/commit/c2b5f01c5729459a87adf57d08e90fab0b733dea))

# [0.50.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.49.0...v0.50.0) (2026-06-01)


### Features

* **codex:** add and manage Codex TUI status line configuration ([fa2a143](https://github.com/kovrichard/portable-agent-layer/commit/fa2a143b8a02e40e06a601beb474ca3d971f2024))
* **cursor:** enhance statusline integration with CLI configuration and script management ([28e3e2d](https://github.com/kovrichard/portable-agent-layer/commit/28e3e2d99df51b3cb06a60a3916a0622c3500be4))

# [0.49.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.48.0...v0.49.0) (2026-06-01)


### Features

* **status:** add status line ([3f1cd70](https://github.com/kovrichard/portable-agent-layer/commit/3f1cd70fe3ca0053d41415cd688e86a49b48e8da))
* **status:** update mac/linux status line ([ba0ad9c](https://github.com/kovrichard/portable-agent-layer/commit/ba0ad9c7c7254b610c17d5960ba6a359a13ef6b1))

# [0.48.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.47.0...v0.48.0) (2026-05-31)


### Features

* **algorithm-reflection:** enhance algorithm reflection with task-specific scope ([fb2d7ec](https://github.com/kovrichard/portable-agent-layer/commit/fb2d7ec3005bcd8fb3e69545d35b4f519b2e86e2))
* **algorithm-synthesis:** add grounding verification and synthesis tool for algorithm reflections ([7bc245b](https://github.com/kovrichard/portable-agent-layer/commit/7bc245b71f9ba0dca637371253d3438eb2709726))
* **algorithm-update:** introduce algorithm-update skill and review nudge system ([da306e9](https://github.com/kovrichard/portable-agent-layer/commit/da306e945d00b5ea3eca4444e5ecc277c1a2f24e))
* **failure-ranking:** implement ranking system for failure lessons based on project relevance ([d08cc64](https://github.com/kovrichard/portable-agent-layer/commit/d08cc64960be8e2299869588c542b3a731a8e584))
* **reflections:** feed reflections into context ([426f17e](https://github.com/kovrichard/portable-agent-layer/commit/426f17ea13dd03f9dc6e27920e004228266a95cc))
* **skills:** add skill doctor command to evaluate skills against authoring best practices ([aa4276e](https://github.com/kovrichard/portable-agent-layer/commit/aa4276ed79513e1278f3857174dd08a8f80a7074))

# [0.47.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.46.0...v0.47.0) (2026-05-30)


### Features

* **skills:** separate author and distributed create skill ([6decef1](https://github.com/kovrichard/portable-agent-layer/commit/6decef14aae256d214ef9894ef75682b2ab8b8f9))

# [0.46.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.45.2...v0.46.0) (2026-05-30)


### Features

* **skills:** add playwright skill ([c44117c](https://github.com/kovrichard/portable-agent-layer/commit/c44117ce38599bdc7133735621da337fca4dece9))

## [0.45.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.45.1...v0.45.2) (2026-05-30)


### Bug Fixes

* **claude:** enable running lsof ([7f6445b](https://github.com/kovrichard/portable-agent-layer/commit/7f6445bff516ee4f08adbd09c7960f653e256dcd))

## [0.45.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.45.0...v0.45.1) (2026-05-29)


### Bug Fixes

* **self-model:** write self model detached ([c2b1cd3](https://github.com/kovrichard/portable-agent-layer/commit/c2b1cd34e07b9be938363c7fc776a13449d16998))
* **wisdom:** do not auto-graduate failure patterns ([52b8dc8](https://github.com/kovrichard/portable-agent-layer/commit/52b8dc8457d58e0344e78ae1757d8ee27ff04590))

# [0.45.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.44.0...v0.45.0) (2026-05-29)


### Features

* add frontend design skill ([09b39cc](https://github.com/kovrichard/portable-agent-layer/commit/09b39ccb092ec138ab475ba297da10a1836dd3b2))

# [0.44.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.43.1...v0.44.0) (2026-05-26)


### Features

* update klint version ([90f9105](https://github.com/kovrichard/portable-agent-layer/commit/90f91055fad03669039186262f13e7993b4b384e))

## [0.43.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.43.0...v0.43.1) (2026-05-25)


### Bug Fixes

* **hooks:** enhance blockResponse for Codex PreToolUse to include permissionDecisionReason ([4bf17dd](https://github.com/kovrichard/portable-agent-layer/commit/4bf17dd8841aacc00209fe1ec84b9606fbc5ffe8))

# [0.43.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.42.0...v0.43.0) (2026-05-25)


### Bug Fixes

* **claude-md:** improve symlink handling to repair stale targets and add corresponding test ([7abf1b5](https://github.com/kovrichard/portable-agent-layer/commit/7abf1b5403b19faaa27d881d6bc16cb224339de2))
* **dependencies:** add missing pdf-lib ([97d0a76](https://github.com/kovrichard/portable-agent-layer/commit/97d0a76b9396c14dfec20b199cdc841225538d74))
* **hooks:** update run-hook to write error output to stderr for codex integration ([cda6835](https://github.com/kovrichard/portable-agent-layer/commit/cda68351f08865aff03437c503c01b1a31e0cb4a))


### Features

* **claude:** allowlist own consulting-report tool ([27f9854](https://github.com/kovrichard/portable-agent-layer/commit/27f98546ce436c38cb5ca018c477838db23900d7))
* **codex:** add managed rules for PAL workflow and integrate into installation process ([6a8b98d](https://github.com/kovrichard/portable-agent-layer/commit/6a8b98d34e0608c05b87926fa02170094ea22e87))
* **consulting-report:** add new and update existing components ([518f3cc](https://github.com/kovrichard/portable-agent-layer/commit/518f3cc7d1792127ec92f26bddc6996205753a56))
* **consulting-report:** add process-guide shapes and enhance PDF generation with logo support ([d0598b7](https://github.com/kovrichard/portable-agent-layer/commit/d0598b7a87c8578cc6eb54f6fba28bf96646af84))
* **hooks:** enhance jscpd and run-hook for codex integration ([de13795](https://github.com/kovrichard/portable-agent-layer/commit/de137958ae4891bb990f2547e6a8f60c6c95937d))

# [0.42.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.41.1...v0.42.0) (2026-05-22)


### Bug Fixes

* **knowledge:** add reverse adjacency for directed edge traversal in knowledge graph ([8139e64](https://github.com/kovrichard/portable-agent-layer/commit/8139e64a58e1d100357cadbe34d04810f8c61f20))
* **knowledge:** implement body filtering for search scoring to exclude PAL markup ([aa5aeea](https://github.com/kovrichard/portable-agent-layer/commit/aa5aeeaf36dd9a2811fc46568a72422f3862660b))
* **knowledge:** split industry to different tags if possible ([42c9ce5](https://github.com/kovrichard/portable-agent-layer/commit/42c9ce5a18d4668721e974c607e3d0f27d06d1cc))
* **package:** add .husky/install.mjs to package files to fix package mode install warnings ([3d063e3](https://github.com/kovrichard/portable-agent-layer/commit/3d063e3f26796bfb4f6fb81c79b10cd1be6130a8))


### Features

* **entities:** introduce new skill for entity detection and management ([06bb897](https://github.com/kovrichard/portable-agent-layer/commit/06bb8972748fec9dabdba20a0b77a997985efb97))
* **extract-entities:** introduce cli in skill ([96b7e59](https://github.com/kovrichard/portable-agent-layer/commit/96b7e59f4e833decf71f743fa2a9f2d8da32352a))
* **knowledge:** add CLI command for knowledge management ([67383be](https://github.com/kovrichard/portable-agent-layer/commit/67383be56bba8d9d3c4beec2eb94d55cb7879030))
* **knowledge:** add function to find existing company by title and update linking logic ([f10c828](https://github.com/kovrichard/portable-agent-layer/commit/f10c828ae81b896605449b045e00ed9babfdb022))
* **knowledge:** add ingest command for bulk entity input from JSON ([a6a7999](https://github.com/kovrichard/portable-agent-layer/commit/a6a7999e257198b863a10cd60af93dfe65a2279e))
* **knowledge:** add knowledge management functionality with entity serialization and validation ([7bc4577](https://github.com/kovrichard/portable-agent-layer/commit/7bc4577f18cd1d0fd1e72ab8acefacec16b836f6))
* **knowledge:** enhance entity ingestion process with detailed logging and rich field preservation ([ef5b742](https://github.com/kovrichard/portable-agent-layer/commit/ef5b742e2abee4d2f311e7ed6e8448cb3bd87b27))
* **knowledge:** implement knowledge graph functionality with node and edge management ([93acc31](https://github.com/kovrichard/portable-agent-layer/commit/93acc312c384470e41ea94b8557d894d8d868b67))
* **migrate:** implement migration from legacy entity-index.json to knowledge markdown files ([86c3c13](https://github.com/kovrichard/portable-agent-layer/commit/86c3c136de1da4455108a642aa3e935d35b7b7f0))

## [0.41.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.41.0...v0.41.1) (2026-05-19)


### Bug Fixes

* add windowsHide option to subprocesses for improved background process handling ([8e49b9b](https://github.com/kovrichard/portable-agent-layer/commit/8e49b9b168ecb1d27473bf25d6092db147636bd8))

# [0.41.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.40.0...v0.41.0) (2026-05-19)


### Bug Fixes

* **claude:** unset CLAUDECODE in spawned envs ([33b3e87](https://github.com/kovrichard/portable-agent-layer/commit/33b3e87c6db75c5d8b785fb44079166e6cda2952))
* **fake-bin:** resolve bun.exe path for cross-platform compatibility in command scripts ([a62a119](https://github.com/kovrichard/portable-agent-layer/commit/a62a119e1b29586da4675315a1eacb8ba81f883a))
* **hooks:** improve atomic file handling in detachFailurePrinciple to prevent race conditions ([8bb4923](https://github.com/kovrichard/portable-agent-layer/commit/8bb49236f4fbc55d3e9d7d946d00ff63cfb10da0))
* **inference:** refactor binary detection to return full paths for CLI agents ([ffecd92](https://github.com/kovrichard/portable-agent-layer/commit/ffecd920380b523d9f6b8e7c4044e1d4a5828968))
* **inference:** use a common binary checker ([b575275](https://github.com/kovrichard/portable-agent-layer/commit/b57527589cd8e6d3a13837522c99085c27dc7b69))
* **inference:** use Bun.which to be cross platform ([b6bb3f9](https://github.com/kovrichard/portable-agent-layer/commit/b6bb3f9570d0502e8f22b9f8f7cbab745db71c71))
* **notifications:** add PAL_NOTIFICATIONS_DISABLED env var to suppress desktop notifications ([da541ab](https://github.com/kovrichard/portable-agent-layer/commit/da541ab6179cdb0e592014986200cbed4744a80e))
* remove redundant test ([655d050](https://github.com/kovrichard/portable-agent-layer/commit/655d050842966336dc3cb4ef2699b486a863f07e))
* type error fixes ([9385102](https://github.com/kovrichard/portable-agent-layer/commit/93851021dfaab6aa41813253f74fe8fdff8ab150))


### Features

* add detached autoGraduate handling to improve inference performance ([abe7d1c](https://github.com/kovrichard/portable-agent-layer/commit/abe7d1ce2f87260c3a0bb8052326efb479318f78))
* **doctor:** add inference probing functionality to check agent routes ([182f80e](https://github.com/kovrichard/portable-agent-layer/commit/182f80ebfc48c087924307388b778659d3a1a4e6))
* **doctor:** add informational logging for optional API key checks ([4c2ca75](https://github.com/kovrichard/portable-agent-layer/commit/4c2ca7541017d6ee1de4c55054206d925b66d073))
* **doctor:** check inference related env vars ([a48b6cc](https://github.com/kovrichard/portable-agent-layer/commit/a48b6ccc4cadb8cacbb6480ee92aa1773c6c7517))
* **doctor:** detect unnecessary env vars ([245bb0d](https://github.com/kovrichard/portable-agent-layer/commit/245bb0da8f49aa2ce1958b14e7a913b83a6df0d6))
* **doctor:** implement install integrity checks for hook commands and opencode plugin freshness ([99d9424](https://github.com/kovrichard/portable-agent-layer/commit/99d94242b0180a312f76c5387c76827743ef0116))
* implement detached inference handling for session intelligence and failure principle ([7d79291](https://github.com/kovrichard/portable-agent-layer/commit/7d792916ae7873c51f23efe2681779b0b4b9c1f7))
* implement spawn-guard to prevent recursion in PAL inference subprocesses ([a2d0beb](https://github.com/kovrichard/portable-agent-layer/commit/a2d0beb89e7dcf163d36c2dd2e74a1c331be1ff2))
* **inference:** add Opencode support with CLI integration and enhance argument handling ([faedef1](https://github.com/kovrichard/portable-agent-layer/commit/faedef1045387d84adf55cb152a1ba04c76f9a21))
* **inference:** add sessionId to inference options and logging for better traceability ([34b24b0](https://github.com/kovrichard/portable-agent-layer/commit/34b24b085b1ed2102bae1d683aa8fe95fa027d55))
* **inference:** add support for Codex integration and enhance inference logic ([7ee7f42](https://github.com/kovrichard/portable-agent-layer/commit/7ee7f424564e22bff336b3e83eba62e2e25cd8b4))
* **inference:** add support for Cursor integration with argument handling and logging ([3274cc4](https://github.com/kovrichard/portable-agent-layer/commit/3274cc4e4287fe5fb7e9d2a5e1bd24351f332f72))
* **inference:** integrate Copilot support with enhanced argument handling ([34a832b](https://github.com/kovrichard/portable-agent-layer/commit/34a832bf9f8611c0ed4ce09359ddab4a72ebd8b3))
* **inference:** log the caller ([32e291f](https://github.com/kovrichard/portable-agent-layer/commit/32e291f01a72f7f53d59aa7ce7934c9fd4ec9fe3))
* integrate jscpd for duplicate code detection and add configuration ([58be797](https://github.com/kovrichard/portable-agent-layer/commit/58be797681a5c92204b81e8459e29fb8f08080fe))
* **logging:** enhance log rotation and health check to support multiple rotated log files ([cb0d6a1](https://github.com/kovrichard/portable-agent-layer/commit/cb0d6a1c0ca473162e5b8e940299049e4e717e50))

# [0.40.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.39.0...v0.40.0) (2026-05-17)


### Features

* install klint skill ([4a10f62](https://github.com/kovrichard/portable-agent-layer/commit/4a10f6250251b7b8b9fbde48c1f60d2edcb874ac))

# [0.39.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.38.0...v0.39.0) (2026-05-17)


### Bug Fixes

* **consulting-report:** minor visual fixes ([9c159d9](https://github.com/kovrichard/portable-agent-layer/commit/9c159d9c2d667233f71d051d4ec5c830f97fcc8b))
* **consulting-report:** start top level sections on new pages ([e07d696](https://github.com/kovrichard/portable-agent-layer/commit/e07d6961cd372219af61927b2a610791a4134296))
* **klint:** update path alias loading to support extended tsconfig and add corresponding test ([fe1d34e](https://github.com/kovrichard/portable-agent-layer/commit/fe1d34ec1bf597eb96f11196cad39b1295ea8749))


### Features

* **consulting-report:** introduce more components ([9c3e039](https://github.com/kovrichard/portable-agent-layer/commit/9c3e03908e08f3517cd1f3ed9da8b2f468cc81f7))
* **klint:** add no-skill-src-import rule to prevent imports from repo src/ directory ([40cf6ea](https://github.com/kovrichard/portable-agent-layer/commit/40cf6ea484abd39044359d7d5199de6cf7a634bb))
* **klint:** add path alias resolution for imports and corresponding tests ([fea545e](https://github.com/kovrichard/portable-agent-layer/commit/fea545e08ccc7f2eb41b9ae9dcd9bbde340f6f18))
* **klint:** add support for YAML configuration and enhance schema with architecture constraints ([b302dcb](https://github.com/kovrichard/portable-agent-layer/commit/b302dcba107e46583fea7110141b34585cf2edb6))
* **klint:** enhance architecture rules by adding target and CLI layer restrictions ([fe66639](https://github.com/kovrichard/portable-agent-layer/commit/fe666397b758b3feaa03560b51be534dcbe5d5c8))
* **klint:** implement architecture rules for imports and singleton patterns with tests ([00a9efc](https://github.com/kovrichard/portable-agent-layer/commit/00a9efc40b96109dd59954df8845270e76f52dbd))
* **klint:** introduce agent skill ([efdca4d](https://github.com/kovrichard/portable-agent-layer/commit/efdca4dd5dc994667b611283ebbb57b9b3f9589d))
* **klint:** introduce klint hook for JSON output and update command references in settings ([094f686](https://github.com/kovrichard/portable-agent-layer/commit/094f6861c1fc37a35dfdf8a0d690e6a74745387d))

# [0.38.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.37.0...v0.38.0) (2026-05-15)


### Features

* **klint:** add built-in rule name enum to config schema ([4256f60](https://github.com/kovrichard/portable-agent-layer/commit/4256f60ee95bafccaf26f449863e5cb7f3bfb7da))
* **klint:** add prefer-at rule for cleaner negative indexing with tests and schema updates ([4bd565a](https://github.com/kovrichard/portable-agent-layer/commit/4bd565a5da585b26e41d97ab736db55ccc292673))
* **klint:** add prefer-string-raw rule for sonar ([e5b8122](https://github.com/kovrichard/portable-agent-layer/commit/e5b812238166521c9393111d2dced271285678a7))
* **klint:** add Zod config schema with JSON Schema generation ([090c879](https://github.com/kovrichard/portable-agent-layer/commit/090c879a5b07832ba7413d361d39dc9ceec7268f))
* **klint:** enhance plugin system with rule implementations and update schema ([071538f](https://github.com/kovrichard/portable-agent-layer/commit/071538f0f658de294a989b76ccab05b09db10952))
* **klint:** implement no-single-char-class rule with tests and schema updates ([c0a1ebc](https://github.com/kovrichard/portable-agent-layer/commit/c0a1ebcab32d775bd483013d34512df6e99b5bf3))

# [0.37.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.36.0...v0.37.0) (2026-05-15)


### Bug Fixes

* apply flint fixes ([1391267](https://github.com/kovrichard/portable-agent-layer/commit/1391267ce1898f6989d55ed79976331ebb270c64))
* **doctor:** check codex hooks correctly ([a4b0a0d](https://github.com/kovrichard/portable-agent-layer/commit/a4b0a0d648cbeeabf7fcdb9f6ca35f3634e551bc))
* **flint:** make runner platform independent ([7e32a49](https://github.com/kovrichard/portable-agent-layer/commit/7e32a49ba9db2f5123fb6c96f52c58fbf84ebb9e))
* **presentation:** wrap description with double quotes ([a88b63a](https://github.com/kovrichard/portable-agent-layer/commit/a88b63adc4ad2e809c4cdcc36c5b71a8b8ad83ee))


### Features

* **algorithm:** enhance ISA context and ISC management with new commands for task scaffolding ([734e450](https://github.com/kovrichard/portable-agent-layer/commit/734e450df6cde03345683f58792e139d696d00d9))
* **algorithm:** handle cross-project isa management ([ad3eb0f](https://github.com/kovrichard/portable-agent-layer/commit/ad3eb0fca702b9ae857c0793d5f67802407068d5))
* **arch-check:** add architectural linting rules and integrate into CI/CD pipeline ([103084e](https://github.com/kovrichard/portable-agent-layer/commit/103084e58a30c4523abebc558f14c99473fb0f04))
* **arch-check:** add rule to detect synchronous fs calls in async functions ([0625a1c](https://github.com/kovrichard/portable-agent-layer/commit/0625a1c160805420adc9f9099229f0dc3452da43))
* **capture-failure:** add cwd parameter to captureFailure and related functions ([d4fe323](https://github.com/kovrichard/portable-agent-layer/commit/d4fe323b56c58b76d68539aa0b02af1b0c73c454))
* **codex:** enhance Codex hook commands and context handling ([82d09ee](https://github.com/kovrichard/portable-agent-layer/commit/82d09ee968c032c102f75b6a86e0c562097fc55d))
* **codex:** implement Codex hooks integration ([14d4983](https://github.com/kovrichard/portable-agent-layer/commit/14d4983bfd1d1479da212a170f0bf7a9043e2275))
* **cursor:** update hook commands to include PAL_AGENT for cursor and enhance hook context handling ([2637b96](https://github.com/kovrichard/portable-agent-layer/commit/2637b9655c724ea73190beef5f46d478c69d6e9b))
* **flint:** add custom linting rules and enhance CLI configuration options ([2dc53d4](https://github.com/kovrichard/portable-agent-layer/commit/2dc53d4059e56e86bd12bacbe4c671663163eb1c))
* **flint:** add new linting rules for skipped and focused tests, and performance improvements ([a248154](https://github.com/kovrichard/portable-agent-layer/commit/a248154153d7056417244a7b54782fd02a956171))
* **flint:** add no-agent-import-in-core rule to stop core module imports leak agent-specific code ([7eba9f0](https://github.com/kovrichard/portable-agent-layer/commit/7eba9f0143bc50a0cf58fbc4676d602e54809b36))
* **flint:** add no-async-predicate rule to prevent async callbacks in array methods ([d10bba5](https://github.com/kovrichard/portable-agent-layer/commit/d10bba5be4bbb57eae4c10533d1701b5b8ec7402))
* **flint:** add no-consecutive-array-push and no-nested-ternary rules for improved code clarity ([6ef9269](https://github.com/kovrichard/portable-agent-layer/commit/6ef9269ba9c940cd35fc5da69ab268460c6706eb))
* **flint:** add no-floating-promise rule to prevent unhandled promise rejections ([665accd](https://github.com/kovrichard/portable-agent-layer/commit/665accd180fc9a44e26cc151b06069b59e160ce5))
* **flint:** add no-hardcoded-pal-home rule to enforce usage of paths module for PAL_HOME ([b51085d](https://github.com/kovrichard/portable-agent-layer/commit/b51085dd98b99d12248fabbee43b9a8a4268b92f))
* **flint:** add no-misused-promises rule to prevent misuse of async functions in non-async contexts ([91cdbca](https://github.com/kovrichard/portable-agent-layer/commit/91cdbca776da5f15c1171cc4a7d9207d72cac67d))
* **flint:** add no-nested-template-literals rule to prevent nested template literals ([f99d62f](https://github.com/kovrichard/portable-agent-layer/commit/f99d62f1f1cd8534c559d4ed405b47d852dfa420))
* **flint:** add no-raw-exit-in-lib rule to prevent process termination in library modules ([9f2e941](https://github.com/kovrichard/portable-agent-layer/commit/9f2e941775bf72b77d8a810adb2d507e2ef43f26))
* **flint:** add no-throw-string rule to prevent throwing plain strings ([92d0419](https://github.com/kovrichard/portable-agent-layer/commit/92d0419d8a04dc45253894675d78bef6028e032d))
* **flint:** add prefer-string-raw-regexp rule to enforce String.raw usage in RegExp templates ([5f8c06d](https://github.com/kovrichard/portable-agent-layer/commit/5f8c06dfac5821b161574acdcaa72c6da8ad2b1e))
* **flint:** add prefer-string-replaceall rule to encourage use of String.prototype.replaceAll ([6de2856](https://github.com/kovrichard/portable-agent-layer/commit/6de2856014ec043056f76a70142a266f428d7dd8))
* **flint:** enhance no-string-match rule to include auto-fix ([e60db36](https://github.com/kovrichard/portable-agent-layer/commit/e60db36866b2d4c8fd4b67e22d7df87ba4101b23))
* **flint:** enhance rule checks to utilize pre-read file contents for improved performance ([9eb1bd1](https://github.com/kovrichard/portable-agent-layer/commit/9eb1bd101039cbbd2eee3b6a16ad14b15e45cc16))
* **flint:** enhance violation reporting with detailed messages for linting rules ([801ff8e](https://github.com/kovrichard/portable-agent-layer/commit/801ff8e67bd5043f952d3db3f1a816f5a8b8ce19))
* **flint:** implement AST caching for improved performance and add cache clearing functionality ([78bbd71](https://github.com/kovrichard/portable-agent-layer/commit/78bbd7188a72f869308555974d7ed3bd42e864cd))
* **flint:** implement Flint linting framework with custom rules for TypeScript ([3243c56](https://github.com/kovrichard/portable-agent-layer/commit/3243c5610951324ac40feb590bd2c4f4a8642950))
* **flint:** implement prefer-nullish-coalescing-assign rule and auto-fix option ([85d800a](https://github.com/kovrichard/portable-agent-layer/commit/85d800a19667a134b4fa6144bf9400b80c07d211))
* **flint:** introduce flint.config.json and flint.rules.ts for custom linting rules ([5ce9674](https://github.com/kovrichard/portable-agent-layer/commit/5ce96745e9aa41840cbd51d51b1a94491b261ce8))
* **flint:** introduce new linting rules for optional chaining and date equality checks ([4ebde2c](https://github.com/kovrichard/portable-agent-layer/commit/4ebde2cca4e6c05981aa46e71c08f36eff735d6e))
* **flint:** introduce no-string-match rule to enforce usage of RegExp.exec() for non-global regexes ([9857f6d](https://github.com/kovrichard/portable-agent-layer/commit/9857f6d0ec858d3a6b45f927b662221d42c79037))
* **flint:** run on assets ([09de6e6](https://github.com/kovrichard/portable-agent-layer/commit/09de6e6011f1331e7f481565b1ae30a785a77c78))
* **flint:** use biome where possible ([3513c3f](https://github.com/kovrichard/portable-agent-layer/commit/3513c3fd685b0be21536d9382f7ec73061a5b0c4))
* **inject-retrieval:** enhance retrieval reminder functionality for opencode and cursor ([b8b8feb](https://github.com/kovrichard/portable-agent-layer/commit/b8b8feb1a4e9bb83fd07688638d3eeaccd45dd33))
* **isc:** add ISC management commands for adding, checking, and listing ISCs in project criteria ([ac4cbe5](https://github.com/kovrichard/portable-agent-layer/commit/ac4cbe57e055bab4b67ecdb5d9cee0009f965d20))
* **migrate:** implement non-destructive data migration command and update CLI help ([d1b274a](https://github.com/kovrichard/portable-agent-layer/commit/d1b274abac1e14a86b3279aa2a074efd14366e87))
* **persist:** add check to skip persisting if latest session already exists ([0703fea](https://github.com/kovrichard/portable-agent-layer/commit/0703fead4f520173b03bf1863fdb4c05c86a5ff2))
* **persist:** always persist last exchange in stop ([c968764](https://github.com/kovrichard/portable-agent-layer/commit/c968764843bc424cf2e3d22d3a885e52e14c88d5))
* **pre-compact-persist:** enhance handoff note generation and session management ([fefd400](https://github.com/kovrichard/portable-agent-layer/commit/fefd400703ef83d337fc16840520fd72c9554075))
* **project:** add set-path command to update project paths ([33f51ab](https://github.com/kovrichard/portable-agent-layer/commit/33f51ab9792fde16fe46d69bfe8091d437b3f6c4))
* **projects:** add support for displaying open ISCs in project criteria ([3f8517a](https://github.com/kovrichard/portable-agent-layer/commit/3f8517a74834def2f6fec9cd5dd91a73b94e1942))
* **projects:** add support for project constraints in active projects context ([a12a91d](https://github.com/kovrichard/portable-agent-layer/commit/a12a91d387ea4bc33a307f69d993dbe64087904a))
* **relationship:** enhance filtering of relationship notes and include cwd in session metadata ([a66c814](https://github.com/kovrichard/portable-agent-layer/commit/a66c81435c40b12f4d23b5fa5d81b6e3d0e9b4c5))
* **security:** add beforeShellExecution command for SecurityValidator and enhance input handling ([780d60e](https://github.com/kovrichard/portable-agent-layer/commit/780d60e5e124b5b3ea1e8c848d7de363595fc4da))
* **security:** add protection for PAL-deployed directories and enhance related tests ([bd73454](https://github.com/kovrichard/portable-agent-layer/commit/bd73454ba69d0a92be2c5c1d667d5f7e0eafa847))
* **security:** introduce PAL_INSTALLED_DIRS_RE regex and enhance actionable messages ([1eddb19](https://github.com/kovrichard/portable-agent-layer/commit/1eddb19f4d166e397d6b99a8bc0fe2b9fb081d14))
* **tests:** add comprehensive test suite for signals, time, token usage, and work tracking ([19cca44](https://github.com/kovrichard/portable-agent-layer/commit/19cca44c41aeae09e0a0d1c71e7af59d8c7f800c))

# [0.36.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.35.0...v0.36.0) (2026-05-12)


### Bug Fixes

* **vscode:** tests do not write outside the sandbox ([524ef78](https://github.com/kovrichard/portable-agent-layer/commit/524ef789becde3cd190f3757063a79ff6dda7b4a))


### Features

* **context-digests:** implement context digest handler and enhance system reminder ([0dde590](https://github.com/kovrichard/portable-agent-layer/commit/0dde590666e886041a3cd7421bb58664c488fc39))
* **context:** add synthesis digest handling and update settings management ([98ca655](https://github.com/kovrichard/portable-agent-layer/commit/98ca655d836fec904c7cfd04f9e6323ed745cc08))
* **context:** filter recent interaction notes and implement text truncation ([2937b11](https://github.com/kovrichard/portable-agent-layer/commit/2937b1179963d28b27d43dda233c31ad1447b826))
* **copilot:** enhance instruction file management and VS Code integration ([2aa556b](https://github.com/kovrichard/portable-agent-layer/commit/2aa556b39e3e3cdbd6d0f41bbb0aad8cd3c11fc8))
* **cursor:** implement context digest writing for Cursor installation and removal ([30b36fd](https://github.com/kovrichard/portable-agent-layer/commit/30b36fd894c21957afd391f5a17212df600a2f16))
* **handoff:** implement handoff note tool and update session intelligence capture ([18f7592](https://github.com/kovrichard/portable-agent-layer/commit/18f7592c149373f32335358785ae4ca84c9f682e))
* **opencode:** enhance installation and uninstallation processes with config.json updates ([cdbe1be](https://github.com/kovrichard/portable-agent-layer/commit/cdbe1bee774d927629c5d4c4c2d85c7dcfa777b6))
* **relationship:** introduce relationship-note tool for capturing session entries ([f489ed8](https://github.com/kovrichard/portable-agent-layer/commit/f489ed8f513a4ad0a64cd2e5d4a15c6df5341e8d))
* **semi-static:** reintroduce failure patterns loading and update context handling ([a5ad21e](https://github.com/kovrichard/portable-agent-layer/commit/a5ad21e355988e84b96446bf9771cf073f251853))
* **settings:** disable claude memory ([6814394](https://github.com/kovrichard/portable-agent-layer/commit/6814394c88d6952916703ef83ecb66c890a6514c))
* **steering-rules:** add guidelines for testing and verification practices ([f3de904](https://github.com/kovrichard/portable-agent-layer/commit/f3de90416d8f533648d4be59d97e8992e1e161e1))

# [0.35.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.34.0...v0.35.0) (2026-05-10)


### Features

* **presentation:** add print-specific elements for slide number and logo ([0c5abc4](https://github.com/kovrichard/portable-agent-layer/commit/0c5abc4aa5aee0e8d1c82d5bb2d057bb62c176f2))
* **presentation:** add print-specific styles to enhance layout for big-stat and quote sections ([d6b688c](https://github.com/kovrichard/portable-agent-layer/commit/d6b688c759abba63ff2161c51dbf51a898cbb8b6))
* **presentation:** implement print view for trainer notes ([4f8183a](https://github.com/kovrichard/portable-agent-layer/commit/4f8183aad2c6684cc08fd40f5fc81fc5cbe2b3cf))
* **templates:** update AGENTS.md.template to include project resume command ([de99b6c](https://github.com/kovrichard/portable-agent-layer/commit/de99b6cc8d76cda059ad38eb4787aedae97d981f))

# [0.34.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.33.0...v0.34.0) (2026-05-07)


### Features

* **cli:** add 'usage' command to summarize token usage and cost; update documentation ([cd049fe](https://github.com/kovrichard/portable-agent-layer/commit/cd049fe1ca323b3b13d1da69ee341d780b2991d6))

# [0.33.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.32.0...v0.33.0) (2026-05-06)


### Bug Fixes

* **presentation:** update build output behavior ([563c0db](https://github.com/kovrichard/portable-agent-layer/commit/563c0db813a9b28c599691dddbcbce0e934f19ff))
* remove pii from code ([f7a883c](https://github.com/kovrichard/portable-agent-layer/commit/f7a883c7792a771dedf509b09b2d6c7ff16cac61))


### Features

* **algorithm:** add guidance on demonstrating new checks with minimal examples ([e2390d8](https://github.com/kovrichard/portable-agent-layer/commit/e2390d88a360c0cadb5eff343f4accf40f3053bd))
* **auto-graduate:** implement auto-graduation handler for promoting patterns to wisdom-frame ([c312ca5](https://github.com/kovrichard/portable-agent-layer/commit/c312ca5cb5f225b3e3f1cb824a36e70e255cbde3))
* **presentation:** add linting rules for exercise slides to enforce title format and required notes ([9bc8757](https://github.com/kovrichard/portable-agent-layer/commit/9bc875776e9c49e53508dc40055ad675bb368987))
* **presentation:** add visual-line budget check for bullet-bearing slides ([31eca32](https://github.com/kovrichard/portable-agent-layer/commit/31eca323998d000faf0ebc8a349d37b02d81850f))
* **presentation:** enhance image handling and print styles in slides ([2b7f0f5](https://github.com/kovrichard/portable-agent-layer/commit/2b7f0f5e3cbfc1e622d502e018f319d1d7ce9eac))
* **presentation:** enhance linting rules for bullet length and note citations ([58a3053](https://github.com/kovrichard/portable-agent-layer/commit/58a3053eb967d78b597bee365dc76e778b1c70b3))
* **presentation:** implement dynamic code font scaling based on line count in slides ([f5b6b97](https://github.com/kovrichard/portable-agent-layer/commit/f5b6b97792b9e540b755831ceabceb4a689dc9ce))
* **presentation:** introduce new deck-scope linting rules for visual rhythm and block structure ([c686aa8](https://github.com/kovrichard/portable-agent-layer/commit/c686aa8e34b03507644d444b358c250d546b47ef))
* **presentation:** refine monotone rhythm check to detect periodic patterns in slide layouts ([52d2845](https://github.com/kovrichard/portable-agent-layer/commit/52d2845bcea82e09b7e1b72d551909b3ec0ad2bb))
* **presentation:** update syntax highlighting theme to GitHub Dark ([9f21a3d](https://github.com/kovrichard/portable-agent-layer/commit/9f21a3dddf9d1d2b1cb7c4bd29b881aff0c41707))
* **project:** add projectTouch handler on stop ([b6c9a1e](https://github.com/kovrichard/portable-agent-layer/commit/b6c9a1e1d267e8e206852f8e5b36af3541a78d20))
* **project:** introduce project lifecycle management with CLI integration and state persistence ([9a2a5c6](https://github.com/kovrichard/portable-agent-layer/commit/9a2a5c6ae6bf2d9788b4015cdd33afbe6734712f))
* **projects:** add support for stable facts in project lifecycle management ([6f2ba2a](https://github.com/kovrichard/portable-agent-layer/commit/6f2ba2a437221f550e5f2ae688661bc10d0c0269))
* **projects:** implement active projects context loading and update project settings ([fe14fd6](https://github.com/kovrichard/portable-agent-layer/commit/fe14fd6bb3a1de72f3c51c418e74f13cdf049e4e))
* **projects:** introduce new project management skill ([4f38795](https://github.com/kovrichard/portable-agent-layer/commit/4f387950ffd723c4cee2fdcb901ae00e75c7ebe5))
* **projects:** show limited context when not in the directory of the project ([4161713](https://github.com/kovrichard/portable-agent-layer/commit/41617132f737783ef818a0b0ce48d3a128a73c38))
* **retrieval:** implement retrieval index and scoring mechanism for prompt context injection ([377006b](https://github.com/kovrichard/portable-agent-layer/commit/377006b2ab678493a752da8c672c15d893c74d36))

# [0.32.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.31.0...v0.32.0) (2026-05-01)


### Features

* **consulting-report:** add three new components ([2299f98](https://github.com/kovrichard/portable-agent-layer/commit/2299f98f8cccf061359114bc94bbc00128bc6e59))

# [0.31.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.30.1...v0.31.0) (2026-05-01)


### Bug Fixes

* **consulting-report:** update branding field and remove outdated template files ([88563a3](https://github.com/kovrichard/portable-agent-layer/commit/88563a38b2eab3b870e58008cbce3a4f294d6f7f))


### Features

* **consulting-report:** add dev server tool for live preview and enhance scaffold options ([3bbf651](https://github.com/kovrichard/portable-agent-layer/commit/3bbf65179578aa1113713ae44640727dbefdad0b))
* **consulting-report:** create consulting report demo with structured components and styles ([c167e0b](https://github.com/kovrichard/portable-agent-layer/commit/c167e0b492222d1c067606b71eb7fcdb48d5dfae))
* **consulting-report:** implement comprehensive report template with dynamic components ([19bdd76](https://github.com/kovrichard/portable-agent-layer/commit/19bdd76c5c09c14152b09636e4671f2a7ebd63a5))

## [0.30.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.30.0...v0.30.1) (2026-04-30)


### Bug Fixes

* **ci:** use client id instead of app id ([16ae715](https://github.com/kovrichard/portable-agent-layer/commit/16ae71536124b1ba6676b0d4b80a43fa1e9f57df))

# [0.30.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.29.1...v0.30.0) (2026-04-30)


### Features

* enhance presentation skill, introduce knip, organize ci actions ([735dfdb](https://github.com/kovrichard/portable-agent-layer/commit/735dfdbf5aedfd99f69a68855741c8afbef65f3c))

## [0.29.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.29.0...v0.29.1) (2026-04-29)


### Bug Fixes

* make update work on npm ([b2a06cb](https://github.com/kovrichard/portable-agent-layer/commit/b2a06cb204407a04e4b63d580b735b5187c7f210))

# [0.29.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.28.1...v0.29.0) (2026-04-28)


### Features

* **hooks:** add PreCompact and CompactRecover hooks for session state management ([3c5142b](https://github.com/kovrichard/portable-agent-layer/commit/3c5142b9faba9b13a072b8dad654c361aac3171e))
* **presentation:** add new skill for creating branded HTML presentations from markdown ([0d236fb](https://github.com/kovrichard/portable-agent-layer/commit/0d236fb6f471f62446abbed5cc741ad4bd589afa))

## [0.28.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.28.0...v0.28.1) (2026-04-27)


### Bug Fixes

* do not break package mode when .git is missing ([b33baea](https://github.com/kovrichard/portable-agent-layer/commit/b33baea3dc66040c2a9b777d1075733637fab7de))

# [0.28.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.27.1...v0.28.0) (2026-04-26)


### Bug Fixes

* update cache write metrics to cover opus 4.7, fix caching costs ([e0061b1](https://github.com/kovrichard/portable-agent-layer/commit/e0061b158f7dc68b12f42058b2d2beca92276184))


### Features

* add cross-platform desktop notification support ([2b47209](https://github.com/kovrichard/portable-agent-layer/commit/2b47209f708c1d822e66ebf140713118e2ca7bf1))

## [0.27.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.27.0...v0.27.1) (2026-04-21)


### Bug Fixes

* update playwright install command ([922113d](https://github.com/kovrichard/portable-agent-layer/commit/922113d3ea75723c2481a15806361c9f8d2f98b7))

# [0.27.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.26.1...v0.27.0) (2026-04-21)


### Bug Fixes

* ignore playwright install in tests ([51f4d1a](https://github.com/kovrichard/portable-agent-layer/commit/51f4d1a85621b95c41a24f63544f04d751086917))


### Features

* **consulting-report:** add scaffolding and PDF generation tools for consulting reports ([d1bb28b](https://github.com/kovrichard/portable-agent-layer/commit/d1bb28bc952984bebc4612c8c29a0609a2602715))
* **create-pdf:** add markdown to PDF conversion tool using Playwright ([db4eba4](https://github.com/kovrichard/portable-agent-layer/commit/db4eba46aaa255eb5a3544079ac7b7d7e99adfe6))
* **doctor:** check playwright ([dbf7793](https://github.com/kovrichard/portable-agent-layer/commit/dbf779384056ee25d7be393dc87fcf7c3925f775))

## [0.26.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.26.0...v0.26.1) (2026-04-04)


### Bug Fixes

* remove setup.json from doctor ([79fc3a8](https://github.com/kovrichard/portable-agent-layer/commit/79fc3a8484dc9636bbbb51257222413e0bf90826))

# [0.26.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.25.0...v0.26.0) (2026-04-04)


### Features

* **setup:** implement interactive TELOS setup with project prompts and context management ([267cc63](https://github.com/kovrichard/portable-agent-layer/commit/267cc63191723f821d697b52d209d2d8c8e21ad0))
* **token-usage:** add self-model to TokenCaller and log usage in self-model composition ([2bd345f](https://github.com/kovrichard/portable-agent-layer/commit/2bd345f75ede802012bad926f8897ab3c34d4256))

# [0.25.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.24.2...v0.25.0) (2026-04-03)


### Features

* **copilot:** add Copilot support ([ded1bfb](https://github.com/kovrichard/portable-agent-layer/commit/ded1bfb545ab05e565515d2779623123c89f88c2))

## [0.24.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.24.1...v0.24.2) (2026-04-03)


### Bug Fixes

* **doctor:** add checks for hook registrations and plugin installations ([45d22e7](https://github.com/kovrichard/portable-agent-layer/commit/45d22e79b6734e10d587593530d5272a2e3a46ad))
* **doctor:** add package, skill, settings, agents.md, and claude.md check to doctor ([3dfdd92](https://github.com/kovrichard/portable-agent-layer/commit/3dfdd9206ecf1428d00a2376d2bcb5a384df2c02))

## [0.24.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.24.0...v0.24.1) (2026-04-03)


### Bug Fixes

* **doctor:** add missing api keys to it ([9ecf45d](https://github.com/kovrichard/portable-agent-layer/commit/9ecf45d8210f37e6c90daf2eec289f06eac6a272))

# [0.24.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.23.1...v0.24.0) (2026-03-27)


### Bug Fixes

* remove dead code ([36d087b](https://github.com/kovrichard/portable-agent-layer/commit/36d087b905d6924b0478b1906cffd82362875a5a))


### Features

* add SONNET_MODEL and implement self-model synthesis tool ([324fb5e](https://github.com/kovrichard/portable-agent-layer/commit/324fb5e37509183639451aab82651a19ce5ee704))
* **self-model:** add self-model auto-trigger and enhance synthesis with previous model comparison ([ea90d48](https://github.com/kovrichard/portable-agent-layer/commit/ea90d48043d4e2f185e72395200b1c8751ce878d))
* **self-model:** add self-model loading functionality and integrate into system reminder ([dedb211](https://github.com/kovrichard/portable-agent-layer/commit/dedb2111e75c69ab0952e4950eb97ba592a8371b))
* **self-model:** implement archiving for self-model updates and refactor paths ([0c10906](https://github.com/kovrichard/portable-agent-layer/commit/0c1090660cb7ccf53f6457ceaed9f9aef4ec9967))

## [0.23.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.23.0...v0.23.1) (2026-03-27)


### Bug Fixes

* add principle field to failure and rating handlers for enhanced context ([c0c4bbc](https://github.com/kovrichard/portable-agent-layer/commit/c0c4bbc2bdd6b7e309092fac5604f5746272c2f9))
* add principle to explicit ratings to ([096a667](https://github.com/kovrichard/portable-agent-layer/commit/096a667c3186b0cf61e95bd8d6f3d32d2162842b))
* **relationship:** collect opinions faster ([7648909](https://github.com/kovrichard/portable-agent-layer/commit/7648909b82499211db56a3a0691bc200fc31ba8e))

# [0.23.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.22.0...v0.23.0) (2026-03-27)


### Features

* **algorithm:** introduce effort levels ([d4eb705](https://github.com/kovrichard/portable-agent-layer/commit/d4eb70557ab48c0801233d8113c01a43d5fe7171))
* introduce .pal home, generalize subagents, merge session end logic ([7c25065](https://github.com/kovrichard/portable-agent-layer/commit/7c25065d8dd70b1fe3745374b72e9331f16fc7bb))

# [0.22.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.21.0...v0.22.0) (2026-03-26)


### Bug Fixes

* remove dead code ([53e4d40](https://github.com/kovrichard/portable-agent-layer/commit/53e4d4029db75701865ec5176b84b47eee149acd))


### Features

* add algorithm reflection logging and update documentation ([5416c9d](https://github.com/kovrichard/portable-agent-layer/commit/5416c9db8e877899f62fafe2ae5dfc0c35b9ed65))
* implement skill index generation for the algorithm, enrich observe step ([1ca0a16](https://github.com/kovrichard/portable-agent-layer/commit/1ca0a1686ed18a54b0d32a98b038d7a07d638a23))

# [0.21.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.20.0...v0.21.0) (2026-03-26)


### Features

* introduce new agents, store project memory ([2c21b9c](https://github.com/kovrichard/portable-agent-layer/commit/2c21b9cae17a4df7639e4333a3a8275d1bd1207e))

# [0.20.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.19.0...v0.20.0) (2026-03-26)


### Features

* add pdf creator script ([a0608c9](https://github.com/kovrichard/portable-agent-layer/commit/a0608c9956a333508d1919530c8f1d0bfaba6bc2))

# [0.19.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.18.1...v0.19.0) (2026-03-25)


### Features

* **research:** introduce grok researcher subagent ([216392b](https://github.com/kovrichard/portable-agent-layer/commit/216392b28e08d7ad2565d9fcf7a599ee9209bf95))

## [0.18.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.18.0...v0.18.1) (2026-03-25)


### Bug Fixes

* **tools:** allowlist agent tools ([3e458d6](https://github.com/kovrichard/portable-agent-layer/commit/3e458d63cd27ab31cb3332d858ba742ca2210382))

# [0.18.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.17.0...v0.18.0) (2026-03-25)


### Bug Fixes

* **tools:** make the wisdom frame and analyze tools symlinks to be callable from anywhere ([248a03c](https://github.com/kovrichard/portable-agent-layer/commit/248a03c64cbbda2d7cd730b961ecbf0b7575b769))


### Features

* add 5th step to algorithm, add wisdom frame updater ([b29a5f4](https://github.com/kovrichard/portable-agent-layer/commit/b29a5f4efdc495a4746ab66fda413c3b5e19c97f))
* add tests to wisdom frame updater ([2455f63](https://github.com/kovrichard/portable-agent-layer/commit/2455f63b2c87e62c4191897e600dd6077d6f92ab))

# [0.17.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.16.0...v0.17.0) (2026-03-25)


### Features

* add partial codex support ([863e06d](https://github.com/kovrichard/portable-agent-layer/commit/863e06d9ce4ade14ce7c64715d3140f86f14fd62))

# [0.16.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.15.1...v0.16.0) (2026-03-25)


### Bug Fixes

* **cursor:** make agents.md work ([d93e4fa](https://github.com/kovrichard/portable-agent-layer/commit/d93e4fa606248165c0fec98d3877cec3cdc89adf))
* **cursor:** make context injection work ([39efb5c](https://github.com/kovrichard/portable-agent-layer/commit/39efb5c3774d6597697464336977f8e7f0f3efdd))


### Features

* **agent:** implement agent detection and response formatting for Cursor and Claude Code ([193894b](https://github.com/kovrichard/portable-agent-layer/commit/193894b578c43166d0c99ce294f3e67f5a7d3060))
* introduce cursor skill and agent support ([09e4a92](https://github.com/kovrichard/portable-agent-layer/commit/09e4a92752c304c2f4f10ee42897eae01378a137))

## [0.15.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.15.0...v0.15.1) (2026-03-25)


### Bug Fixes

* **usage:** adjust model usage print style ([004b407](https://github.com/kovrichard/portable-agent-layer/commit/004b407702b5e64739cdf499aac7fb59e5394208))

# [0.15.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.14.1...v0.15.0) (2026-03-25)


### Features

* **telos:** enhance update tool with ID support for deduplication and replacement ([2c602db](https://github.com/kovrichard/portable-agent-layer/commit/2c602dbacd067ed242384172cb4b0a97b1cb8945))

## [0.14.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.14.0...v0.14.1) (2026-03-25)


### Bug Fixes

* **relationship:** set last reflection date again when creating report ([c64a56f](https://github.com/kovrichard/portable-agent-layer/commit/c64a56f444b41d9b3ef3e458310ab9cf11930670))

# [0.14.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.13.0...v0.14.0) (2026-03-25)


### Bug Fixes

* **opinion:** update confidence values in opinion creation and evidence addition ([eb827be](https://github.com/kovrichard/portable-agent-layer/commit/eb827be5af66b8000c008b270188307fd36dab86))


### Features

* **opinion:** add deduplication in opinion management ([dd8aebd](https://github.com/kovrichard/portable-agent-layer/commit/dd8aebd3776ac71a9f7a87fa7f7b570876f3e4fe))
* **text-similarity:** add stemming functions to normalize keywords in text extraction ([fedc22c](https://github.com/kovrichard/portable-agent-layer/commit/fedc22c1871bcdd4995c43d7f664b7868e95bdc9))

# [0.13.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.12.0...v0.13.0) (2026-03-24)


### Bug Fixes

* **session-name:** enable detached background process for Haiku inference upgrade ([5db86fb](https://github.com/kovrichard/portable-agent-layer/commit/5db86fb040ca339145fb327befea955125d41241))
* update opinion tracking docs ([f4748c4](https://github.com/kovrichard/portable-agent-layer/commit/f4748c43bbd91fcb89c5fbfdd652cd0c73ce3edc))


### Features

* **opinion:** introduce Opinion Tracker skill and tool ([03899c7](https://github.com/kovrichard/portable-agent-layer/commit/03899c7f868e528de0f26ea34edbf373e820a194))
* **routing:** add system architecture content ([c0d59d0](https://github.com/kovrichard/portable-agent-layer/commit/c0d59d05f014723de32fdc4e87c7051827df8d2d))
* **routing:** add system readme and architecture template ([c8bba51](https://github.com/kovrichard/portable-agent-layer/commit/c8bba5181ec79916d16608dd767f9ac09d086023))
* **routing:** add system readme content ([b6c3413](https://github.com/kovrichard/portable-agent-layer/commit/b6c3413dde923ece13b043e088c1de9273b55979))

# [0.12.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.11.0...v0.12.0) (2026-03-24)


### Features

* **PAL:** enhance identity setup with interactive prompts and update configuration handling ([c04e9aa](https://github.com/kovrichard/portable-agent-layer/commit/c04e9aad251873965efe6f8c13cb6e9d0eac1b12))
* **PAL:** introduce algorithm mode for complex work ([3d8f8ac](https://github.com/kovrichard/portable-agent-layer/commit/3d8f8acad6376590aac7bdaffcd87a522c61b777))
* **PAL:** introduce pal-settings.json for dynamic context and startup file loading ([dcdf7b7](https://github.com/kovrichard/portable-agent-layer/commit/dcdf7b749e8d14e47298e9f609350453c8d3f381))

# [0.11.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.10.0...v0.11.0) (2026-03-24)


### Features

* **PAL:** add settings template for Claude integration and implement merge/unmerge functionality ([d59f1f4](https://github.com/kovrichard/portable-agent-layer/commit/d59f1f4c046f68f909ceb993e0da9d620c0e194d))
* **PAL:** introduce modular context routing ([ada64aa](https://github.com/kovrichard/portable-agent-layer/commit/ada64aa8b4392308ec9761349f7746067a4f85b6))
* **skills:** use self-contained skill scripts ([dd5bdb7](https://github.com/kovrichard/portable-agent-layer/commit/dd5bdb7ca24a06e1dbf46140a27892e524406cac))
* **telos:** implement update tool for TELOS files ([8ca8373](https://github.com/kovrichard/portable-agent-layer/commit/8ca83737c419747cefb2a23abc5e49f6957d6d67))

# [0.10.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.9.0...v0.10.0) (2026-03-23)


### Bug Fixes

* do not include analysis reports in the context ([2cecef7](https://github.com/kovrichard/portable-agent-layer/commit/2cecef744fb579bef4c378ac4a137e713ada03b5))


### Features

* **graduation:** add path property to analysis entries and enhance logging in analyze tool ([403e0b9](https://github.com/kovrichard/portable-agent-layer/commit/403e0b94b6aefaa91a143ce2dd0bbe9a7d6d46df))
* **opinion:** add opinion tracking tool and update documentation ([951c802](https://github.com/kovrichard/portable-agent-layer/commit/951c80261176652b086b9ab83b4f295dab6c512f))
* **opinions:** implement opinion management system with CRUD operations and context loading ([a084230](https://github.com/kovrichard/portable-agent-layer/commit/a0842305a4da2b255ec3321ed3082d15cc41e256))
* **reflect:** implement auto-trigger for relationship reflect ([fc53354](https://github.com/kovrichard/portable-agent-layer/commit/fc53354b4ba70bef20ecb5412e4dac637b7f3f29))
* **relationship:** add belief type to observations ([3f69de3](https://github.com/kovrichard/portable-agent-layer/commit/3f69de3d06a0e794ae74bf6c40b09f4633babb41))
* **session:** enhance session naming logic to avoid duplicates and improve keyword extraction ([3096da5](https://github.com/kovrichard/portable-agent-layer/commit/3096da5a31a5a223b00954a15b9ce27fef3c026d))
* **steering:** add steering rules template and integrate into AGENTS.md ([f961f1d](https://github.com/kovrichard/portable-agent-layer/commit/f961f1df82f356bddb384c5a5a39c55e71aa2890))
* **work-learning:** add current working directory to work learning capture ([f28975b](https://github.com/kovrichard/portable-agent-layer/commit/f28975b25c96256f324ebfdc30e81fabc3d39cbc))

# [0.9.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.8.1...v0.9.0) (2026-03-23)


### Bug Fixes

* **log:** adjust import format ([25e1df7](https://github.com/kovrichard/portable-agent-layer/commit/25e1df74b859dac3c7b2b61c28c779754e4e9599))
* **opencode:** clean up legacy files ([fdb59b7](https://github.com/kovrichard/portable-agent-layer/commit/fdb59b773d93c532f6f19925510085cf104a2cb9))
* **opencode:** make it align with claude code's way of rating ([403f9b4](https://github.com/kovrichard/portable-agent-layer/commit/403f9b4f62efd7cba87153480354f495c3baf1c0))


### Features

* **rating:** better categorize explicit ratings ([4904cf2](https://github.com/kovrichard/portable-agent-layer/commit/4904cf250b3a14e9b254b4877534831d7c2dd44a))
* **security:** add new hook-managed files and directories ([14429fc](https://github.com/kovrichard/portable-agent-layer/commit/14429fc26964191a6b211e10a845f8a86ec9536f))

## [0.8.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.8.0...v0.8.1) (2026-03-23)


### Bug Fixes

* **update-check:** update notice message to reflect new `pal cli update` command ([c9702d0](https://github.com/kovrichard/portable-agent-layer/commit/c9702d00a5af6ca2cdb43a77b02ac5a07040fa35))

# [0.8.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.7.0...v0.8.0) (2026-03-23)


### Features

* **cli:** add `pal cli update` command to update PAL and reinstall hooks ([dffa191](https://github.com/kovrichard/portable-agent-layer/commit/dffa19138643a00633bcc770f22df2d3dbf22c7d))

# [0.7.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.6.2...v0.7.0) (2026-03-23)


### Features

* **update-check:** implement update checker to notify users of available updates ([67e30be](https://github.com/kovrichard/portable-agent-layer/commit/67e30bed75145951625aca4d14c5e1c7bf2ae598))

## [0.6.2](https://github.com/kovrichard/portable-agent-layer/compare/v0.6.1...v0.6.2) (2026-03-23)


### Bug Fixes

* **failure:** streamline failure capture process and update conversation summary format ([f921ecb](https://github.com/kovrichard/portable-agent-layer/commit/f921ecbc29eceeee844a648865d6309a85afdef1))

## [0.6.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.6.0...v0.6.1) (2026-03-23)


### Bug Fixes

* **summary:** make it work on windows ([163f3a8](https://github.com/kovrichard/portable-agent-layer/commit/163f3a81e83bf33271f01431644f9ad55bb8fced))

# [0.6.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.5.0...v0.6.0) (2026-03-23)


### Features

* **graduation:** add emerging patterns to graduation results and update filtering logic ([05495e9](https://github.com/kovrichard/portable-agent-layer/commit/05495e9cd17d03d93b0132b7244b8330e68884e6))

# [0.5.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.4.0...v0.5.0) (2026-03-23)


### Features

* **principles:** add evaluation tool for generating and comparing principles ([53c0a2e](https://github.com/kovrichard/portable-agent-layer/commit/53c0a2ec16be154e5d6cc19a78319e7a8b3fa624))

# [0.4.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.3.0...v0.4.0) (2026-03-22)


### Bug Fixes

* **failure:** correctly order assistant and user messages in the prompt ([4019c14](https://github.com/kovrichard/portable-agent-layer/commit/4019c1425115353f306c37db9a9d49f49467b73a))
* **failures:** add quotes to front matter strings ([9f3bd06](https://github.com/kovrichard/portable-agent-layer/commit/9f3bd069b5424d00f19edde7044731bac06a5a3a))
* **inference:** increase maxTokens and timeout for failure and work-learning handlers ([9199ef1](https://github.com/kovrichard/portable-agent-layer/commit/9199ef178a9e036e326a42d28564ab6b268f8fa2))


### Features

* add wisdom graduation logic ([ed4d083](https://github.com/kovrichard/portable-agent-layer/commit/ed4d0835d9658dd015850c7d81026b326cef9cdd))
* **cli:** add hook health check and env var check to doctor command ([67ed313](https://github.com/kovrichard/portable-agent-layer/commit/67ed313932190b2da28f0815676032520752d1de))
* **frontmatter:** implement lightweight YAML frontmatter parser and serializer ([7ad9151](https://github.com/kovrichard/portable-agent-layer/commit/7ad91512575e1378e8ea62ecdfe07bf54cedc533))
* **pricing:** add model pricing configuration and enhance cost calculation logic ([9d93b71](https://github.com/kovrichard/portable-agent-layer/commit/9d93b7111f523eb432e7d49c86c55510277b5878))
* **security:** add new hook-managed files for tags and graduated data ([0a743c9](https://github.com/kovrichard/portable-agent-layer/commit/0a743c9376140fcbd30a1210244858bf288820d6))
* **tags:** add pending tag suggestions to doctor command output ([7938729](https://github.com/kovrichard/portable-agent-layer/commit/79387293d016c7abbc00500137d6491ecde47c28))
* **tags:** implement tag management for semantic grouping and enhance inference prompts ([b7a5810](https://github.com/kovrichard/portable-agent-layer/commit/b7a58107f41a748eb3e224afa786e5983b8676fc))

# [0.3.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.2.1...v0.3.0) (2026-03-22)


### Bug Fixes

* **cli:** allow CI/tests to skip agent detection in doctor command ([a2eac5f](https://github.com/kovrichard/portable-agent-layer/commit/a2eac5f55f55ea753c95022f1aae8f440d43b97b))


### Features

* **cli:** add 'doctor' command to check system health and prerequisites ([894f1a1](https://github.com/kovrichard/portable-agent-layer/commit/894f1a153665d29d77790604fd56c96ca3accf1a))
* implement README sync validation to ensure documentation reflects code changes ([4a5721b](https://github.com/kovrichard/portable-agent-layer/commit/4a5721b8de5958a9175a5dd499c46447e991d448))

## [0.2.1](https://github.com/kovrichard/portable-agent-layer/compare/v0.2.0...v0.2.1) (2026-03-22)


### Bug Fixes

* **ci:** add back id-token permission ([f8a3535](https://github.com/kovrichard/portable-agent-layer/commit/f8a353525003295d4a6447956828365836d89cf2))
* **ci:** add missing token to checkout ([a35b296](https://github.com/kovrichard/portable-agent-layer/commit/a35b2968d225b86b4f8340a36238ba942dd04608))
* use app token for release ([38ab974](https://github.com/kovrichard/portable-agent-layer/commit/38ab97451e5580880014bed927368d061e88c636))


### Performance Improvements

* merge pal runner and cli into a single script ([08fe475](https://github.com/kovrichard/portable-agent-layer/commit/08fe475359008765112e2e0ec4d2daa77ff27b36))

# [0.2.0](https://github.com/kovrichard/portable-agent-layer/compare/v0.1.0...v0.2.0) (2026-03-22)


### Bug Fixes

* add back debug logs ([358c299](https://github.com/kovrichard/portable-agent-layer/commit/358c2993cce086b9d7647851ddd0035b51a521c7))
* adjust log path in skill ([afa2758](https://github.com/kovrichard/portable-agent-layer/commit/afa2758fee1b7870b7721cf535dd9815222612ab))
* **claude:** use relative path for claude.md ([22a6a9e](https://github.com/kovrichard/portable-agent-layer/commit/22a6a9e57c2dcbf4e3a26e2634fe62e6618551d0))
* clean up relationship noise ([e7a3706](https://github.com/kovrichard/portable-agent-layer/commit/e7a3706b5f050ca823117db867bb8029785fd0e9))
* deduplicate session notes ([8c0bf55](https://github.com/kovrichard/portable-agent-layer/commit/8c0bf553ff13080cf4547264488a67c570b01899))
* handle duplicate wisdom frames, only store user messages ([7f0baf1](https://github.com/kovrichard/portable-agent-layer/commit/7f0baf1885914001915ab6b70d1572bbac853339))
* improve error handling in session stop process ([9329917](https://github.com/kovrichard/portable-agent-layer/commit/9329917332baa24040640fd47dc5de9536265390))
* improve symlink handling for skills on Windows and Unix ([b2629b1](https://github.com/kovrichard/portable-agent-layer/commit/b2629b1ebe6e48f46f3b42fba9c76e7fd3ca8fac))
* improve symlink removal logic in copySkills function ([bf6a731](https://github.com/kovrichard/portable-agent-layer/commit/bf6a7314c95c14c95ddf77d2c334a786c1f6f859))
* make opencode history work ([509d393](https://github.com/kovrichard/portable-agent-layer/commit/509d393a96619c5a4bcc9590f3309077969f8576))
* make rating work ([cf9b550](https://github.com/kovrichard/portable-agent-layer/commit/cf9b550b95c4215dd96b855c7115cfdbecd9f49a))
* make rating work in opencode too ([0abd023](https://github.com/kovrichard/portable-agent-layer/commit/0abd023b977995303064be8f69eacaca04ac5b25))
* make skills work ([018181f](https://github.com/kovrichard/portable-agent-layer/commit/018181fd4f8182389f24a63917c057af38aac5fa))
* parse failures correctly ([66e06e0](https://github.com/kovrichard/portable-agent-layer/commit/66e06e00a94cc9b40cd01a42e64a1e2a5ffd5fe4))
* populate pai debug to opencode plugin ([286c4b5](https://github.com/kovrichard/portable-agent-layer/commit/286c4b54380e82cc7feae37d8bd1c3f223dad966))
* remove dead code, add time to context ([5913a61](https://github.com/kovrichard/portable-agent-layer/commit/5913a61cfb52ace6d8062c70c179459c29d5e149))
* update export file filtering to exclude hidden files ([ceb45ba](https://github.com/kovrichard/portable-agent-layer/commit/ceb45ba92da55093992f09a1bb879e5461af113b))
* update paths on windows ([72e02ae](https://github.com/kovrichard/portable-agent-layer/commit/72e02aedb4f7d9c07e934d4d05d844f86200a988))
* update writeLearningMarkdown to include responsePreview for better context in ratings ([bcbb91d](https://github.com/kovrichard/portable-agent-layer/commit/bcbb91dd106547133378a1c09b922111a6be5045))
* use correct logic to read learnings ([109e412](https://github.com/kovrichard/portable-agent-layer/commit/109e4121b7f726647add999d2c3167dcfea03eca))
* use correct schema ([124c7f7](https://github.com/kovrichard/portable-agent-layer/commit/124c7f70c11b06d811702fd4a7541f8749973b12))
* use forward slashes for pai dir ([0f2f242](https://github.com/kovrichard/portable-agent-layer/commit/0f2f242b37d45a44220a12b29ce7dd063b8fcc6c))


### Features

* add ai identity startup step ([0b48fe3](https://github.com/kovrichard/portable-agent-layer/commit/0b48fe329379a21f2f9f3802b884d9a8b2d6eb70))
* add CLI entry point and implement core commands for PAL ([3f15558](https://github.com/kovrichard/portable-agent-layer/commit/3f15558fde103adae8a7269d86efd3a870e1558a))
* add CLI tool and wrapper script for session summary after Claude Code execution ([1ae3ff5](https://github.com/kovrichard/portable-agent-layer/commit/1ae3ff5960f6c996b9b7ee39f5399ddf2363031e))
* add commitlint ([df63cee](https://github.com/kovrichard/portable-agent-layer/commit/df63cee9ee8eb0449b1f34bac9e533a637df7613))
* add cross-frame synthesis functionality ([457c328](https://github.com/kovrichard/portable-agent-layer/commit/457c3282cb5c4d079aa087f3c29319e3e58731a8))
* add dynamic CLAUDE.md generation functionality ([082e50d](https://github.com/kovrichard/portable-agent-layer/commit/082e50d48789a991ae40fe3681c5fb18abc308fa))
* add fyzz-chat-api tool for accessing Fyzz Chat conversations and projects via CLI ([616c9d9](https://github.com/kovrichard/portable-agent-layer/commit/616c9d9635c9f2b7450a93d0c270ca6ea4c60314))
* add Haiku model constants and implement token cost CLI tool for usage analysis ([4366b45](https://github.com/kovrichard/portable-agent-layer/commit/4366b457fbfed3af28a51d0fedc41936414984e1))
* add logging to inference ([ec7a5a1](https://github.com/kovrichard/portable-agent-layer/commit/ec7a5a191cc718c3033c16adcd813f4bc06ebce3))
* add new research agent definitions for claude-researcher, investigative-researcher, and multi-perspective-researcher with detailed methodologies and output formats ([d883ccf](https://github.com/kovrichard/portable-agent-layer/commit/d883ccf5e550c2413ef4ac41dc7e87146a45495b))
* add PDF download tool and update export/import commands for consistency ([121434a](https://github.com/kovrichard/portable-agent-layer/commit/121434a5b9d0896845336d9d82b8075b48d4941a))
* add PowerShell wrapper scripts for Claude Code with session summary functionality ([3210b18](https://github.com/kovrichard/portable-agent-layer/commit/3210b18c76c10de2682c3c8ca9e62bd326535e30))
* add reflection handler for session insights ([0fbe133](https://github.com/kovrichard/portable-agent-layer/commit/0fbe133b71396bf90b5b026cd34120756fb03298))
* add relationship capture functionality ([7659b80](https://github.com/kovrichard/portable-agent-layer/commit/7659b8012bd5cde137045f175f44d9383fd48f82))
* add skill guard ([f3eb25f](https://github.com/kovrichard/portable-agent-layer/commit/f3eb25f3d2017f6979298d97e0e85a1bb865415a))
* add tools for pattern synthesis and relationship reflection analysis ([8afcf3d](https://github.com/kovrichard/portable-agent-layer/commit/8afcf3dce22c6dca23a980fa6451e055b4d47421))
* add windows support ([31e8806](https://github.com/kovrichard/portable-agent-layer/commit/31e88067f2e369c2959fcaa0c93b5a1098047065))
* add youtube-analyze tool and skill for analyzing YouTube videos ([df175f1](https://github.com/kovrichard/portable-agent-layer/commit/df175f191cd493fde075cbd15e7abf16c83e3a50))
* configure husky ([51d657b](https://github.com/kovrichard/portable-agent-layer/commit/51d657bf1e41e7642667a61031c2a4417f006e55))
* enhance context loading and session management ([085d2c5](https://github.com/kovrichard/portable-agent-layer/commit/085d2c592159de37749706820fb00a905e1ea6cc))
* enhance environment setup in install.ts ([998d416](https://github.com/kovrichard/portable-agent-layer/commit/998d41690606752276167808f249ba7f9242d791))
* enhance failure capture with AI-driven root cause analysis and improved context handling ([e1c1cd4](https://github.com/kovrichard/portable-agent-layer/commit/e1c1cd4abbf87e4387e6a78963349fa70fccb27e))
* enhance failure capture with optional detailed context and remove learning handler ([21c9fb8](https://github.com/kovrichard/portable-agent-layer/commit/21c9fb85d620e7b73ca5ec6d94da5460dd4e96df))
* enhance learning capture with session deduplication and structured tracking ([46eef3e](https://github.com/kovrichard/portable-agent-layer/commit/46eef3e9c16f87d8b3be2f8d8c98e49bb6511ce7))
* enhance relationship observation capture with inference and session validation ([9a13356](https://github.com/kovrichard/portable-agent-layer/commit/9a13356823d6c2ded6a17703360fa63300e1ccab))
* enhance session name generation with background inference upgrade ([8e6ab21](https://github.com/kovrichard/portable-agent-layer/commit/8e6ab2110925f3af30ed6886c1fafdbd48e7f28c))
* enhance StopOrchestrator and rating handler functionality ([164a4c1](https://github.com/kovrichard/portable-agent-layer/commit/164a4c1fccf836074515dcfb6c60f7f9415604ea))
* enhance title generation for work learning sessions using AI inference for improved context ([a63017c](https://github.com/kovrichard/portable-agent-layer/commit/a63017c531f39a7f587a2461ec9ff8edfc2414f5))
* enhance work learning session capture with improved message tracking and inference ([07a7a0e](https://github.com/kovrichard/portable-agent-layer/commit/07a7a0e0bb6c085b0e41d97205b285279a481eaa))
* expand entity management to include links and sources with deduplication logic ([3687870](https://github.com/kovrichard/portable-agent-layer/commit/3687870b795d51dfc9206fe7f427d2e281e4e2a1))
* implement failure capture functionality ([265507c](https://github.com/kovrichard/portable-agent-layer/commit/265507cf2b84a51947808aad63796ba32f7cdba1))
* implement graduation system for principle validation ([ce486f2](https://github.com/kovrichard/portable-agent-layer/commit/ce486f2589036180fe09b4c2b4b04f5bb52895dc))
* implement learning categorization for improved session tracking ([2eb2a76](https://github.com/kovrichard/portable-agent-layer/commit/2eb2a76568d1399cbb8592f22acb1b63c047393d))
* implement logging functionality across hooks ([fe9f726](https://github.com/kovrichard/portable-agent-layer/commit/fe9f726b285cfc37fde396342d4f00bb381b92c9))
* implement structured work tracking and session management ([4f33400](https://github.com/kovrichard/portable-agent-layer/commit/4f3340016e74ba233c4287cde963f7b8860bc03a))
* implement synthesis trigger and recommendations loading for enhanced pattern analysis ([ad6eb42](https://github.com/kovrichard/portable-agent-layer/commit/ad6eb4223c02f8e997074a22f62fefff563a1727))
* implement token usage logging across various handlers for improved usage tracking ([d84a5cd](https://github.com/kovrichard/portable-agent-layer/commit/d84a5cd78e8129c63a38d66e171787f48f980c30))
* implement wisdom capture functionality ([511ae5d](https://github.com/kovrichard/portable-agent-layer/commit/511ae5deec14e430827197e47295776135d9f081)), closes [hi#confidence](https://github.com/hi/issues/confidence)
* implement work learning capture functionality ([0222ee5](https://github.com/kovrichard/portable-agent-layer/commit/0222ee54065b6c59b2c365ad7bc6d204f95c3422))
* improve handoff note extraction with text cleaning utility ([ab5697e](https://github.com/kovrichard/portable-agent-layer/commit/ab5697efbccadaffbeca5620e7138a7e87eb5990))
* introduce AGENTS.md generation and symlink to CLAUDE.md ([6fabe39](https://github.com/kovrichard/portable-agent-layer/commit/6fabe39aa35226ecc91013dd468e336cc0e9dc94))
* introduce biome ([ae19b04](https://github.com/kovrichard/portable-agent-layer/commit/ae19b04a241f47842a538b3c0822470ef6fcc99e))
* introduce entity management system with deduplication and backup functionality ([49ee556](https://github.com/kovrichard/portable-agent-layer/commit/49ee556de3539050af635d4db1910bc2afb9e54a))
* introduce typescript checking ([4ebc191](https://github.com/kovrichard/portable-agent-layer/commit/4ebc191cc194f477460336e6267584b0f7c60e64))
* move install and uninstall scripts under src/cli ([70cc844](https://github.com/kovrichard/portable-agent-layer/commit/70cc844741320f193aaee299aead97abe6035d5b))
* prevent ai editing or deleting protected folders ([79c03ee](https://github.com/kovrichard/portable-agent-layer/commit/79c03ee510ca1a132364ed29b959ae0eb4a9fca3))
* update token cost calculations to include claude code usage ([feaa165](https://github.com/kovrichard/portable-agent-layer/commit/feaa165d2ca7a8ece8c8a2bf0310a3173ec8f461))
