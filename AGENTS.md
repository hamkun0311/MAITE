# Codex 작업 지침

작업 전에 루트의 [agent.md](agent.md)와 [text-to-cad-plan.md](text-to-cad-plan.md)를 읽는다.
`agent.md`가 이 저장소의 구현 순서, 검증 게이트, 남은 중요 작업의 기준이다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
