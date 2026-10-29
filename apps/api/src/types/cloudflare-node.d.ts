// The `cloudflare:node` module is provided by the Workers runtime, not by a package, so it has no
// shipped TypeScript types in this repository. Declaring only what this Worker uses keeps `tsc`
// honest without pulling in `@cloudflare/workers-types` for a codebase that is otherwise Node.

declare module 'cloudflare:node' {
  import type { Server } from 'node:http';

  type NodeHandler = (request: Request, env: unknown, ctx: unknown) => Promise<Response>;

  /** Routes incoming Worker requests to a Node HTTP server, calling `listen()` if needed. */
  export function httpServerHandler(server: Server): NodeHandler;

  /** Routes one request to a Node server listening on a routing port. */
  export function handleAsNodeRequest(port: number, request: Request): Promise<Response>;
}
