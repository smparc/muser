import { env } from 'cloudflare:workers';
import { handleMcp } from '../../lib/mcp.mjs';
export const dynamic = 'force-dynamic';
// Agent-only MCP adapter; authenticates with the Commonroom bearer key, never with the owner's sign-in.
const route=(request:Request)=>handleMcp(request,env.DB);
export const GET=route;export const POST=route;export const DELETE=route;
