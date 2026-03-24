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
