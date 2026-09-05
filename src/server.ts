import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {ApiClient, safeError, type Transport} from './api.js';
import {inputs, output, type ToolName} from './schema.js';
import {execute, descriptions} from './tools.js';
export function createServer(api: Transport = new ApiClient()) {
  const server = new McpServer({name: 'aisa-web-market', version: '0.1.1'}, {instructions: 'Website competitive analysis using five AIsa tools. Use the installed aisa-web-market skill for scenario guidance. Compare identical scope and preserve missing-data evidence. API calls are billed. Credentials come from AISA_API_KEY; never request the key in conversation.'});
  for (const name of Object.keys(inputs) as ToolName[]) {
    server.registerTool(name, {description: descriptions[name], inputSchema: inputs[name], outputSchema: output.shape, annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true}}, async (args: unknown, extra: {signal: AbortSignal}) => {
      try {
        const result = output.parse(await execute(name, args, api, extra.signal));
        return {content: [{type: 'text' as const, text: JSON.stringify(result)}], structuredContent: result};
      } catch (e) {
        const err = safeError(e);
        return {isError: true, content: [{type: 'text' as const, text: JSON.stringify({error: {code: err.code, message: err.message, retryable: err.retryable, ...(err.status === undefined ? {} : {http_status: err.status})}})}]};
      }
    });
  }
  return server;
}
