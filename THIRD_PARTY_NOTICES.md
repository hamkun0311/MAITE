# Third-party notices

See each installed package for its complete license and notices.

| Package | License | Source |
| --- | --- | --- |
| Next.js | MIT | https://github.com/vercel/next.js |
| React | MIT | https://github.com/facebook/react |
| Tailwind CSS | MIT | https://github.com/tailwindlabs/tailwindcss |
| Three.js | MIT | https://github.com/mrdoob/three.js |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| Zod | MIT | https://github.com/colinhacks/zod |
| RepliCAD 1.2.1 | MIT | https://github.com/sgenoud/replicad |
| replicad-opencascadejs 1.2.1 | LGPL-2.1-only | https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs |
| OpenCascade.js | LGPL-2.1 | https://github.com/donalffons/opencascade.js |
| Open CASCADE Technology | LGPL-2.1 with additional exception | https://dev.opencascade.org/resources/licensing |

The CAD loader and WebAssembly module are served separately from `/wasm/` and can be replaced with compatible builds. `scripts/prepare-cad.mjs` copies the pinned distribution without modification, including the dependency's complete license alongside the engine.
