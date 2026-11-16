# Make Markdown rendering faster

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/quillinhk/makefun-markdown-speed/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/quillinhk/makefun-markdown-speed/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A dependency-free, fast CommonMark 0.31.2 + GFM renderer that produces
byte-identical HTML to [marked](https://github.com/markedjs/marked) 18.1.3
with its default options (GFM on, breaks off, pedantic off, async off).

`parse.js` is a clean-room, single-file ES module exporting `parse(markdown)`.
It renders each case separately with no caching between cases, is fully
deterministic, and reads no files or clock. It was developed and verified
against the 720 practice cases (680 CommonMark spec examples + 40 generated
READMEs) in the competition kit.

## Run it

```sh
node main.ts
```

`main.ts` reads `cases.json` from `/input` (or `$MAKEFUN_INPUT_DIR`) and
writes `html.json` — a JSON array of HTML strings, one per case, in input
order — to `/output` (or `$MAKEFUN_OUTPUT_DIR`).

To check the parser directly against the practice set:

```sh
node --input-type=module -e "
import { parse } from './parse.js';
console.log(parse('# Hello\n\nSome *emphasised* text.\n'));
"
```
