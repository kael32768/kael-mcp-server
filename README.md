# ⚡ Kael MCP Server

[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue?logo=data:image/svg%2bxml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiMzQjgyRjYiLz48L3N2Zz4=)](https://registry.modelcontextprotocol.io/servers/io.github.dreamingms/kael-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Tools](https://img.shields.io/badge/Tools-16-orange)](https://www.kael.ink/mcp/health)
[![Status](https://img.shields.io/badge/Status-Live-brightgreen)](https://www.kael.ink/mcp/health)

**AI-native tools for agents** — use cheap compute for web, DNS, WHOIS, screenshots, extraction, and sandboxed code execution instead of spending model tokens on guesswork.

> Kael is for tasks where an agent needs fresh external data, structured output, or real execution — not another paragraph of reasoning.

## Why this exists

LLMs are expensive at:
- fetching and cleaning live web content
- checking DNS / WHOIS / IP facts
- extracting structured data from messy pages
- executing code safely and reproducibly
- producing screenshots or binary artifacts

Kael turns those jobs into **real tools with JSON output**.

## Best fit

Use Kael MCP when your agent needs:
- **fresh data** from the web or internet infrastructure
- **structured results** instead of prose
- **deterministic execution** instead of model simulation
- **lower token burn** on repetitive utility work
- **small tool outputs** that are easier to feed back into a model

Do **not** use Kael MCP when:
- the task is pure reasoning or writing
- the data is already in context
- a local tool already solves the problem cheaper/faster
- you need a full browser workflow with human-style interaction across many steps

## Included tools

### Web and content
- `web_fetch` — URL → clean readable markdown/text
- `web_search` — real-time search results
- `html_extract` — HTML/page content → structured data
- `screenshot` — webpage → PNG screenshot
- `pdf_extract` — PDF → extracted text
- `url_unshorten` — resolve shortened links safely

### Internet and infrastructure
- `dns_lookup` — A, AAAA, MX, TXT, NS, CNAME, SOA, SRV records
- `whois` — domain registration data
- `ip_geo` — IP geolocation and network info

### Data and utility
- `code_run` — execute JavaScript, Python, or Bash in a sandbox
- `text_diff` — compare text versions
- `json_query` — query/filter JSON data
- `hash_text` — compute common hashes

## Tool selection guide

| Tool | Use when | Avoid when |
|---|---|---|
| `web_fetch` | You need readable page content for summarization or downstream extraction | You need pixel-perfect rendering or JS-heavy interaction |
| `web_search` | You need fresh discovery across the web | You already know the exact URL |
| `html_extract` | You need tables, lists, metadata, or page structure as data | Plain cleaned text is enough |
| `screenshot` | You need visual verification, layout evidence, or image output | Text content alone is enough |
| `dns_lookup` | You need factual DNS records now | Static knowledge is acceptable |
| `whois` | You need domain ownership/registration details | DNS records alone answer the question |
| `ip_geo` | You need IP location/ASN/ISP context | You only need DNS or hostname resolution |
| `code_run` | You need actual execution, parsing, transformation, or calculation | The task is simple enough to do directly in-model |
| `pdf_extract` | The source is a PDF and you need text back | The source is already HTML/text |
| `url_unshorten` | You need to inspect where a short link resolves | You already trust and know the final URL |
| `text_diff` | You need a concrete change set between two texts | You just need a summary |
| `json_query` | You need to filter/reshape JSON before reasoning | The JSON is already tiny and easy to inspect |
| `hash_text` | You need a deterministic fingerprint/checksum | Semantic comparison matters more than exact bytes |

## Quick start

### Server endpoints

Kael supports two MCP transports:

| Transport | URL | Best for |
|---|---|---|
| SSE | `https://www.kael.ink/mcp/sse` | Broad client compatibility |
| Streamable HTTP | `https://www.kael.ink/mcp/stream` | Newer clients, simpler connection model |

Use SSE if your client doesn't specify a preference. Use streamable-http if your client supports the 2025-03-26+ MCP protocol version.

Health check:

```text
https://www.kael.ink/mcp/health
```

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kael-tools": {
      "url": "https://www.kael.ink/mcp/sse"
    }
  }
}
```

Or use streamable-http if your Claude Desktop version supports it:

```json
{
  "mcpServers": {
    "kael-tools": {
      "type": "streamable-http",
      "url": "https://www.kael.ink/mcp/stream"
    }
  }
}
```

### Claude Code

Add Kael as a remote MCP server:

```bash
claude mcp add kael-tools --transport sse https://www.kael.ink/mcp/sse
```

Or add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "kael-tools": {
      "type": "sse",
      "url": "https://www.kael.ink/mcp/sse"
    }
  }
}
```

Good first checks in Claude Code:
1. connect Kael and confirm the server appears in MCP tool listings
2. ask Claude to run `dns_lookup` for `example.com` MX records
3. ask Claude to use `web_fetch` on a live page and summarize it

Example evaluator prompt:

> Use the `dns_lookup` tool from the Kael MCP server to get MX records for example.com, then use `web_fetch` on https://modelcontextprotocol.io and give me a short summary.

Why this is a good Claude Code test:
- verifies Kael is reachable as a real MCP server
- exercises both a factual infrastructure tool and a fresh-web retrieval tool
- makes it obvious whether Claude is actually using tools instead of guessing

**For deeper integration** — including `CLAUDE.md` instructions, hook examples for tool routing, and project-specific patterns — see [Claude Code Integration Guide](docs/claude-code-integration.md).

### MCP Inspector

Useful for quick validation before wiring Kael into a larger agent stack:

```bash
npx @modelcontextprotocol/inspector
```

Then connect to:

```text
https://www.kael.ink/mcp/sse
```

### Other MCP-capable clients

If your runtime or editor lets you add a remote MCP server by URL, use one of:

| Transport | URL |
|---|---|
| SSE | `https://www.kael.ink/mcp/sse` |
| Streamable HTTP | `https://www.kael.ink/mcp/stream` |

Adoption-friendly rule of thumb:
- if the client asks for an MCP server URL, try the SSE endpoint first
- if the client supports streamable-http (newer protocol), use the stream endpoint
- if it wants a named server entry, use `kael-tools`
- if it supports a quick test prompt after connecting, start with `dns_lookup` or `web_fetch`

Example generic config shape (SSE):

```json
{
  "mcpServers": {
    "kael-tools": {
      "url": "https://www.kael.ink/mcp/sse"
    }
  }
}
```

Example generic config shape (streamable-http):

```json
{
  "mcpServers": {
    "kael-tools": {
      "type": "streamable-http",
      "url": "https://www.kael.ink/mcp/stream"
    }
  }
}
```

This same pattern is typically what you want in MCP-capable editors and agent runtimes such as Cursor, Cline, OpenCode, and similar tools that accept remote MCP servers.

### Generic MCP client (Node.js)

#### SSE transport

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const transport = new SSEClientTransport(
  new URL("https://www.kael.ink/mcp/sse")
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map(t => t.name));

const dns = await client.callTool({
  name: "dns_lookup",
  arguments: { domain: "example.com", type: "MX" }
});

console.log(dns.content);
```

#### Streamable HTTP transport

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://www.kael.ink/mcp/stream")
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map(t => t.name));
```

### Quick connection test flow

If you are evaluating whether Kael is worth adding to your stack, use this order:

1. Hit `https://www.kael.ink/mcp/health`
2. Connect your MCP client to `https://www.kael.ink/mcp/sse` (or `https://www.kael.ink/mcp/stream` for streamable-http)
3. List tools
4. Run one factual tool like `dns_lookup` or `web_fetch`
5. Only then wire it into a larger agent workflow

That keeps evaluation cheap and makes failures obvious early.

## Example agent tasks

### 1. Fetch a page for summarization
Ask your model to use `web_fetch` when:
- the page is live
- raw HTML would waste tokens
- you want readable markdown returned first

Example prompt:
> Fetch the pricing page with `web_fetch`, then summarize the plans and highlight any usage limits.

### 2. Check a domain's email setup
Ask your model to use `dns_lookup` when:
- you need MX/TXT/SPF/DMARC facts
- hallucinated infrastructure answers would be risky

Example prompt:
> Use `dns_lookup` to inspect MX and TXT records for example.com and tell me whether email appears configured.

### 3. Turn a messy page into structured data
Ask your model to use `html_extract` when:
- the page contains tables, lists, or repeated blocks
- you want JSON-like structure before reasoning

Example prompt:
> Load the page, extract the product table with `html_extract`, then compare the plans.

### 4. Execute code instead of simulating it
Ask your model to use `code_run` when:
- exact calculation matters
- a parser or transformation would be more reliable in code
- the result should be reproducible

Example prompt:
> Use `code_run` in Python to normalize this CSV and return the cleaned JSON.

## Example outputs evaluators can expect

These are abbreviated examples so builders can sanity-check the shape of Kael results before integrating it into an agent loop.

### `dns_lookup`

```json
{
  "domain": "example.com",
  "type": "MX",
  "answers": [
    {
      "exchange": "mx.example.com",
      "priority": 10
    }
  ]
}
```

Useful when you want:
- machine-checkable infrastructure facts
- small outputs that a model can quote directly
- an easy first connectivity test after `listTools`

### `web_fetch`

```json
{
  "url": "https://example.com/pricing",
  "title": "Pricing",
  "content": "# Pricing\n\nStarter ...\nPro ...",
  "contentType": "text/markdown"
}
```

Useful when you want:
- readable page content instead of raw HTML
- a compact artifact for summarization
- a lower-token input for downstream reasoning

### `html_extract`

```json
{
  "url": "https://example.com",
  "headings": ["Overview", "Pricing"],
  "links": [
    {
      "text": "Docs",
      "href": "https://example.com/docs"
    }
  ],
  "tables": [
    {
      "rows": [
        ["Plan", "Price"],
        ["Starter", "$9"]
      ]
    }
  ]
}
```

Useful when you want:
- page structure as data before reasoning
- table/list extraction without custom scraping glue
- cleaner agent pipelines: fetch/extract first, summarize second

### `code_run`

```json
{
  "language": "python",
  "stdout": "[{\"name\":\"alice\",\"score\":42}]",
  "stderr": "",
  "exitCode": 0
}
```

Useful when you want:
- deterministic transforms or calculations
- reproducible parser behavior
- concrete execution evidence instead of simulated code reasoning

## Copy-paste prompts for AI runtimes

These are short prompts you can drop into Claude, Cursor, or another MCP-capable agent to verify that Kael is wired correctly and useful for real work.

### Fresh-web retrieval check
> Use `web_search` to find the official homepage for Model Context Protocol, then use `web_fetch` on the best result and give me a 5-bullet summary.

Why this is a good test:
- proves search + fetch both work
- shows that Kael returns fresh external data instead of stale model memory
- keeps the output small enough for a quick integration check

### Minimal connection-verification prompt
> List the tools available from the Kael MCP server, then run `dns_lookup` for example.com MX records and `web_fetch` on https://modelcontextprotocol.io. Return the raw tool findings first, then a short summary.

Why this is a good test:
- confirms the client can see Kael's tool catalog
- exercises both infrastructure lookup and live-page retrieval
- makes it easier to tell whether the runtime is actually calling tools instead of improvising

### DNS / infrastructure fact check
> Use `dns_lookup` to get the MX and TXT records for example.com. Summarize what they imply about email setup and quote the exact records you found.

Why this is a good test:
- verifies structured factual output
- makes hallucinations obvious
- matches a common real agent task

### Structured extraction check
> Fetch a page, then use `html_extract` to pull the main links, headings, and any tables into structured output before summarizing them.

Why this is a good test:
- demonstrates that Kael is not only for plain-text retrieval
- shows how to turn messy pages into data first, reasoning second

### Execution-backed transformation check
> Use `code_run` in Python to convert this CSV into normalized JSON, then return the JSON and a one-sentence description of what changed.

Why this is a good test:
- confirms the agent can hand exact work to execution instead of pretending to run code
- useful for evaluation by builders who care about reproducibility

## What good tool use looks like

A strong Kael-enabled agent flow usually looks like this:

1. **discover or fetch** real external data
2. **extract or transform** it into a smaller structured form
3. **reason over the result** instead of over raw pages, HTML, or guessed facts
4. **return compact evidence-backed output** to the user or downstream agent

That pattern is usually cheaper and more reliable than asking a model to reason directly over messy live inputs.

## Direct REST API

The same capabilities are also exposed as REST endpoints under `https://www.kael.ink/api/`.

```bash
# IP geolocation
curl "https://www.kael.ink/api/ip?ip=8.8.8.8"

# Screenshot a page
curl "https://www.kael.ink/api/screenshot?url=https://example.com"
```

## Why Kael

1. **Built for agents** — structured outputs, not UI-first flows
2. **Fresh external facts** — DNS, WHOIS, search, IP data, page content
3. **Cheaper than token-heavy reasoning** — especially for fetch/extract/execute tasks
4. **Standard MCP** — works with Claude and other MCP-compatible runtimes
5. **Practical tool mix** — internet facts, content extraction, and sandboxed execution in one server

## Endpoints and links

- **MCP SSE:** `https://www.kael.ink/mcp/sse`
- **MCP Streamable HTTP:** `https://www.kael.ink/mcp/stream`
- **MCP health:** `https://www.kael.ink/mcp/health`
- **Website:** https://www.kael.ink
- **API docs:** https://www.kael.ink/docs
- **Swagger:** https://www.kael.ink/swagger
- **Status:** https://www.kael.ink/status

## Positioning in one sentence

Kael gives AI agents cheap, structured, real-world capabilities so they can fetch, inspect, extract, and execute instead of wasting tokens pretending to.

## License

MIT
