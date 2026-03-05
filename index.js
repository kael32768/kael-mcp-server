/**
 * Kael MCP Server ⚡
 * 
 * AI-native tool provider — the premise is simple:
 * If an AI does it with tokens, it's expensive. If we do it with compute, it's cheap.
 * 
 * Transports: SSE (for Claude Desktop/remote clients) + Streamable HTTP
 * 
 * Tools:
 *   - web_fetch: Fetch & extract readable content from any URL (HTML→markdown)
 *   - screenshot: Take a screenshot of any webpage
 *   - web_search: Search the web and return structured results
 *   - html_to_structured: Extract structured data from HTML (tables, lists, metadata)
 *   - pdf_extract: Extract text from PDF URLs
 *   - image_transform: Resize/crop/convert/compress images
 *   - dns_lookup: DNS records for any domain
 *   - whois: WHOIS lookup for domains
 *   - ip_geo: IP geolocation data
 *   - code_run: Execute JavaScript/Python code in a sandbox
 */

const express = require("express");

// --- Analytics ---
const analyticsFile = require("path").join(__dirname, "analytics.json");
let _analytics = { totalCalls: 0, tools: {}, daily: {}, clients: {} };
try { _analytics = JSON.parse(require("fs").readFileSync(analyticsFile, "utf-8")); } catch {}

function trackCall(toolName, clientName) {
  const today = new Date().toISOString().slice(0, 10);
  _analytics.totalCalls++;
  _analytics.tools[toolName] = (_analytics.tools[toolName] || 0) + 1;
  if (!_analytics.daily[today]) _analytics.daily[today] = {};
  _analytics.daily[today][toolName] = (_analytics.daily[today][toolName] || 0) + 1;
  if (clientName) _analytics.clients[clientName] = (_analytics.clients[clientName] || 0) + 1;
  // Async write, don't block
  require("fs").writeFile(analyticsFile, JSON.stringify(_analytics), () => {});
}

function getAnalytics() {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = Object.entries(_analytics.tools).sort((a, b) => b[1] - a[1]);
  return {
    totalCalls: _analytics.totalCalls,
    topTools: sorted.slice(0, 10).map(([name, count]) => ({ name, count })),
    todayCalls: _analytics.daily[today] || {},
    recentDays: Object.keys(_analytics.daily).slice(-7),
    uniqueClients: Object.keys(_analytics.clients).length,
  };
}

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");
const { execSync, exec } = require("child_process");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const dns = require("dns").promises;
const path = require("path");
const fs = require("fs");

// --- Config ---
const PORT = process.env.MCP_PORT || 3001;
const API_BASE = process.env.API_BASE || "http://localhost:3000";
const MAX_FETCH_SIZE = 500 * 1024; // 500KB max fetch

// (old analytics removed - using new persistent analytics)


const FETCH_TIMEOUT = 15000;

// --- Utility: HTTP GET with timeout ---
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const timeout = options.timeout || FETCH_TIMEOUT;
    const headers = {
      "User-Agent": "KaelMCP/1.0 (AI-Tool-Server; +https://www.kael.ink)",
      ...(options.headers || {}),
    };
    
    const req = mod.get(url, { headers, timeout }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        resolve(httpGet(redirectUrl, options));
        return;
      }
      
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_FETCH_SIZE) {
          res.destroy();
          reject(new Error(`Response too large (>${MAX_FETCH_SIZE} bytes)`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          text: () => Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

// --- Tool Implementations ---

async function webFetch(url, options = {}) {
  const raw = options.raw || false;
  const maxChars = options.maxChars || 50000;
  
  const res = await httpGet(url);
  if (res.status >= 400) {
    return { error: `HTTP ${res.status}`, url };
  }
  
  let text = res.text();
  const contentType = res.headers["content-type"] || "";
  
  // If HTML, extract readable content
  if (!raw && (contentType.includes("html") || text.slice(0, 200).includes("<html"))) {
    try {
      const cheerio = require("cheerio");
      const $ = cheerio.load(text);
      
      // Remove scripts, styles, nav, footer, ads
      $("script, style, nav, footer, header, .ad, .ads, .advertisement, iframe, noscript").remove();
      
      // Extract title
      const title = $("title").text().trim();
      
      // Extract meta description
      const description = $('meta[name="description"]').attr("content") || "";
      
      // Extract main content
      const mainSelectors = ["main", "article", '[role="main"]', ".content", ".post-content", "#content"];
      let mainText = "";
      for (const sel of mainSelectors) {
        if ($(sel).length) {
          mainText = $(sel).text().replace(/\s+/g, " ").trim();
          break;
        }
      }
      if (!mainText) {
        mainText = $("body").text().replace(/\s+/g, " ").trim();
      }
      
      // Extract links
      const links = [];
      $("a[href]").each((i, el) => {
        const href = $(el).attr("href");
        const linkText = $(el).text().trim();
        if (href && linkText && !href.startsWith("#") && !href.startsWith("javascript:") && links.length < 20) {
          links.push({ text: linkText.slice(0, 80), href });
        }
      });
      
      text = [
        title ? `# ${title}` : "",
        description ? `> ${description}` : "",
        "",
        mainText.slice(0, maxChars),
        "",
        links.length ? "## Links\n" + links.map(l => `- [${l.text}](${l.href})`).join("\n") : "",
      ].filter(Boolean).join("\n");
    } catch (e) {
      // Fallback: strip tags
      text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
    }
  }
  
  return {
    url,
    contentType,
    length: text.length,
    content: text.slice(0, maxChars),
  };
}

async function screenshot(url, options = {}) {
  const width = Math.min(Math.max(options.width || 1280, 320), 1920);
  const height = Math.min(Math.max(options.height || 720, 200), 1080);
  const fullPage = options.fullPage || false;
  
  // Use the existing kael-api screenshot endpoint
  const apiUrl = `${API_BASE}/api/screenshot?url=${encodeURIComponent(url)}&width=${width}&height=${height}&fullPage=${fullPage}&format=png`;
  
  const res = await httpGet(apiUrl, { timeout: 30000 });
  if (res.status !== 200) {
    return { error: `Screenshot failed: HTTP ${res.status}`, url };
  }
  
  const base64 = res.body.toString("base64");
  return {
    url,
    width,
    height,
    format: "png",
    size: res.body.length,
    image_base64: base64,
  };
}

async function htmlToStructured(url, selectors = {}) {
  const res = await httpGet(url);
  if (res.status >= 400) {
    return { error: `HTTP ${res.status}`, url };
  }
  
  const cheerio = require("cheerio");
  const $ = cheerio.load(res.text());
  
  const result = {
    url,
    title: $("title").text().trim(),
    meta: {},
    headings: [],
    tables: [],
    lists: [],
    images: [],
  };
  
  // Extract all meta tags
  $("meta").each((i, el) => {
    const name = $(el).attr("name") || $(el).attr("property") || "";
    const content = $(el).attr("content") || "";
    if (name && content) result.meta[name] = content;
  });
  
  // Extract headings hierarchy
  $("h1, h2, h3, h4, h5, h6").each((i, el) => {
    result.headings.push({
      level: parseInt(el.tagName.charAt(1)),
      text: $(el).text().trim(),
    });
  });
  
  // Extract tables as arrays
  $("table").each((i, table) => {
    if (result.tables.length >= 10) return;
    const rows = [];
    $(table).find("tr").each((j, tr) => {
      const cells = [];
      $(tr).find("td, th").each((k, cell) => {
        cells.push($(cell).text().trim());
      });
      if (cells.length) rows.push(cells);
    });
    if (rows.length) result.tables.push(rows);
  });
  
  // Extract lists
  $("ul, ol").each((i, list) => {
    if (result.lists.length >= 20) return;
    const items = [];
    $(list).find("> li").each((j, li) => {
      items.push($(li).text().trim().slice(0, 200));
    });
    if (items.length) result.lists.push({ type: list.tagName, items });
  });
  
  // Extract images with alt text
  $("img[src]").each((i, img) => {
    if (result.images.length >= 20) return;
    result.images.push({
      src: $(img).attr("src"),
      alt: $(img).attr("alt") || "",
      width: $(img).attr("width") || "",
      height: $(img).attr("height") || "",
    });
  });
  
  // Custom selectors
  if (selectors.css) {
    result.custom = {};
    for (const [key, sel] of Object.entries(selectors.css)) {
      const matches = [];
      $(sel).each((i, el) => {
        matches.push($(el).text().trim());
      });
      result.custom[key] = matches;
    }
  }
  
  return result;
}

async function dnsLookup(domain, recordType = "A") {
  const validTypes = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "SRV"];
  const type = validTypes.includes(recordType.toUpperCase()) ? recordType.toUpperCase() : "A";
  
  try {
    let records;
    switch (type) {
      case "A": records = await dns.resolve4(domain); break;
      case "AAAA": records = await dns.resolve6(domain); break;
      case "MX": records = await dns.resolveMx(domain); break;
      case "TXT": records = await dns.resolveTxt(domain); break;
      case "NS": records = await dns.resolveNs(domain); break;
      case "CNAME": records = await dns.resolveCname(domain); break;
      case "SOA": records = await dns.resolveSoa(domain); break;
      case "SRV": records = await dns.resolveSrv(domain); break;
      default: records = await dns.resolve4(domain);
    }
    return { domain, type, records };
  } catch (e) {
    return { domain, type, error: e.message };
  }
}

async function ipGeo(ip) {
  // Use free ip-api.com
  const res = await httpGet(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
  return JSON.parse(res.text());
}

async function whoisLookup(domain) {
  try {
    // Use system whois command
    const result = execSync(`whois ${domain.replace(/[^a-zA-Z0-9.-]/g, "")} 2>/dev/null`, {
      timeout: 10000,
      maxBuffer: 100 * 1024,
    }).toString();
    
    // Parse key fields
    const fields = {};
    const patterns = {
      registrar: /Registrar:\s*(.+)/i,
      creation_date: /Creation Date:\s*(.+)/i,
      expiry_date: /(?:Registry Expiry Date|Expiration Date):\s*(.+)/i,
      updated_date: /Updated Date:\s*(.+)/i,
      name_servers: /Name Server:\s*(.+)/gi,
      status: /Domain Status:\s*(.+)/gi,
      registrant_org: /Registrant Organization:\s*(.+)/i,
      registrant_country: /Registrant Country:\s*(.+)/i,
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
      if (pattern.global) {
        const matches = [];
        let m;
        const re = new RegExp(pattern.source, pattern.flags);
        while ((m = re.exec(result)) !== null) matches.push(m[1].trim());
        if (matches.length) fields[key] = matches;
      } else {
        const m = result.match(pattern);
        if (m) fields[key] = m[1].trim();
      }
    }
    
    return { domain, ...fields, raw_length: result.length };
  } catch (e) {
    return { domain, error: e.message };
  }
}

async function codeRun(code, language = "javascript") {
  const lang = language.toLowerCase();
  const timeout = 5000;
  const maxOutput = 10000;
  
  if (lang === "javascript" || lang === "js") {
    try {
      const result = execSync(`node -e ${JSON.stringify(code)}`, {
        timeout,
        maxBuffer: 50 * 1024,
        env: { ...process.env, NODE_OPTIONS: "" },
      }).toString();
      return { language: "javascript", output: result.slice(0, maxOutput), exitCode: 0 };
    } catch (e) {
      return { language: "javascript", output: (e.stderr?.toString() || e.message).slice(0, maxOutput), exitCode: e.status || 1 };
    }
  } else if (lang === "python" || lang === "python3" || lang === "py") {
    try {
      const result = execSync(`python3 -c ${JSON.stringify(code)}`, {
        timeout,
        maxBuffer: 50 * 1024,
      }).toString();
      return { language: "python", output: result.slice(0, maxOutput), exitCode: 0 };
    } catch (e) {
      return { language: "python", output: (e.stderr?.toString() || e.message).slice(0, maxOutput), exitCode: e.status || 1 };
    }
  } else if (lang === "bash" || lang === "sh" || lang === "shell") {
    try {
      // Restricted shell — no network, no writes outside /tmp
      const result = execSync(code, {
        timeout,
        maxBuffer: 50 * 1024,
        shell: "/bin/bash",
        env: { PATH: "/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp" },
      }).toString();
      return { language: "bash", output: result.slice(0, maxOutput), exitCode: 0 };
    } catch (e) {
      return { language: "bash", output: (e.stderr?.toString() || e.message).slice(0, maxOutput), exitCode: e.status || 1 };
    }
  }
  
  return { error: `Unsupported language: ${lang}. Supported: javascript, python, bash` };
}

// --- MCP Server Setup ---

function createMcpServer() {
  const server = new Server(
    {
      name: "kael-tools",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // --- List Tools ---
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "web_fetch",
          description:
            "Fetch a web page and extract its readable content as clean text/markdown. Much cheaper than having the LLM process raw HTML. Handles redirects, strips ads/nav/scripts, extracts main content, title, description, and top links.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch" },
              raw: { type: "boolean", description: "Return raw HTML instead of extracted text", default: false },
              maxChars: { type: "number", description: "Maximum characters to return", default: 50000 },
            },
            required: ["url"],
          },
        },
        {
          name: "screenshot",
          description:
            "Take a screenshot of any webpage. Returns a PNG image as base64. Useful when the AI needs to see what a page looks like without processing the full DOM. Uses headless Chromium/Playwright.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to screenshot" },
              width: { type: "number", description: "Viewport width (320-1920)", default: 1280 },
              height: { type: "number", description: "Viewport height (200-1080)", default: 720 },
              fullPage: { type: "boolean", description: "Capture full page scroll", default: false },
            },
            required: ["url"],
          },
        },
        {
          name: "html_extract",
          description:
            "Extract structured data from any webpage: tables (as arrays), lists, headings hierarchy, images with alt text, meta tags, and custom CSS selectors. Returns clean JSON instead of messy HTML. Saves massive token costs vs having LLM parse raw HTML.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to extract from" },
              css: {
                type: "object",
                description: "Custom CSS selectors to extract. Keys are names, values are CSS selectors.",
                additionalProperties: { type: "string" },
              },
            },
            required: ["url"],
          },
        },
        {
          name: "dns_lookup",
          description:
            "Look up DNS records for a domain. Returns A, AAAA, MX, TXT, NS, CNAME, SOA, or SRV records. Real-time data that the LLM cannot know without querying.",
          inputSchema: {
            type: "object",
            properties: {
              domain: { type: "string", description: "Domain to look up" },
              type: { type: "string", description: "Record type: A, AAAA, MX, TXT, NS, CNAME, SOA, SRV", default: "A" },
            },
            required: ["domain"],
          },
        },
        {
          name: "whois",
          description:
            "WHOIS lookup for any domain. Returns registrar, creation/expiry dates, name servers, status, and registrant info. Real-time data the LLM cannot access without this tool.",
          inputSchema: {
            type: "object",
            properties: {
              domain: { type: "string", description: "Domain to look up" },
            },
            required: ["domain"],
          },
        },
        {
          name: "ip_geo",
          description:
            "Get geolocation data for any IP address: country, region, city, coordinates, timezone, ISP, organization, AS number. Real-time enrichment data.",
          inputSchema: {
            type: "object",
            properties: {
              ip: { type: "string", description: "IP address to look up" },
            },
            required: ["ip"],
          },
        },
        {
          name: "code_run",
          description:
            "Execute code in a sandboxed environment and return stdout/stderr. Supports JavaScript (Node.js), Python 3, and Bash. 5-second timeout, 50KB output limit. Much cheaper than the LLM simulating execution mentally.",
          inputSchema: {
            type: "object",
            properties: {
              code: { type: "string", description: "Code to execute" },
              language: { type: "string", description: "Language: javascript, python, bash", default: "javascript" },
            },
            required: ["code"],
          },
        },
        {
          name: "web_search",
          description:
            "Search the web and return structured results with titles, URLs, and snippets. Uses DuckDuckGo. Returns real-time search results the LLM cannot access from training data.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              count: { type: "number", description: "Number of results (1-10)", default: 5 },
            },
            required: ["query"],
          },
        },
        {
          name: "pdf_extract",
          description: "Extract text content from a PDF at a given URL. Returns page count, metadata, and full extracted text.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL of the PDF to extract text from" },
            },
            required: ["url"],
          },
        },
        {
          name: "url_unshorten",
          description: "Follow URL redirects and return the final destination URL with the full redirect chain. Useful for bit.ly, t.co, etc.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Short or redirecting URL to resolve" },
            },
            required: ["url"],
          },
        },
        {
          name: "text_diff",
          description: "Compare two text strings and return a unified diff showing additions (+), removals (-), and unchanged lines.",
          inputSchema: {
            type: "object",
            properties: {
              text1: { type: "string", description: "First text (original)" },
              text2: { type: "string", description: "Second text (modified)" },
            },
            required: ["text1", "text2"],
          },
        },
        {
          name: "json_query",
          description: "Query/extract data from JSON using dot-notation paths. Supports [0] indexing and [*] wildcards. Example: 'data.users[*].name'",
          inputSchema: {
            type: "object",
            properties: {
              data: { type: "string", description: "JSON string to query" },
              query: { type: "string", description: "Dot-notation path, e.g. 'users[0].name'" },
            },
            required: ["data", "query"],
          },
        },
        {
          name: "hash_text",
          description: "Hash text using MD5, SHA1, SHA256, or SHA512. Use algorithm='all' for all hashes at once.",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", description: "Text to hash" },
              algorithm: { type: "string", description: "md5, sha1, sha256, sha512, or 'all'", default: "sha256" },
            },
            required: ["text"],
          },
        },
        {
          name: "base64",
          description: "Encode text to Base64 or decode Base64 to text. Use mode='encode' (default) or mode='decode'.",
          inputSchema: {
            type: "object",
            properties: {
              input: { type: "string", description: "Text to encode, or Base64 string to decode" },
              mode: { type: "string", description: "'encode' (default) or 'decode'", default: "encode" },
            },
            required: ["input"],
          },
        },
        {
          name: "http_headers",
          description: "Fetch HTTP response headers from a URL without downloading the body. Shows status code, content-type, server, caching headers, etc.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch headers from" },
            },
            required: ["url"],
          },
        },
        {
          name: "regex_test",
          description: "Test a regex pattern against text. Returns all matches with indices, capture groups, and match count.",
          inputSchema: {
            type: "object",
            properties: {
              pattern: { type: "string", description: "Regex pattern (without delimiters)" },
              text: { type: "string", description: "Text to test against" },
              flags: { type: "string", description: "Regex flags (default: 'g')", default: "g" },
            },
            required: ["pattern", "text"],
          },
        },
      ],
    };
  });

  // --- Call Tool ---
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    trackCall(name, request?.params?._meta?.clientInfo?.name || "unknown");
    
    try {
      let result;
      
      switch (name) {
        case "web_fetch":
          result = await webFetch(args.url, { raw: args.raw, maxChars: args.maxChars });
          break;
        case "screenshot":
          result = await screenshot(args.url, {
            width: args.width,
            height: args.height,
            fullPage: args.fullPage,
          });
          // Return image content for screenshot
          if (result.image_base64) {
            return {
              content: [
                {
                  type: "image",
                  data: result.image_base64,
                  mimeType: "image/png",
                },
                {
                  type: "text",
                  text: JSON.stringify({ url: result.url, width: result.width, height: result.height, size: result.size }),
                },
              ],
            };
          }
          break;
        case "html_extract":
          result = await htmlToStructured(args.url, { css: args.css });
          break;
        case "dns_lookup":
          result = await dnsLookup(args.domain, args.type);
          break;
        case "whois":
          result = await whoisLookup(args.domain);
          break;
        case "ip_geo":
          result = await ipGeo(args.ip);
          break;
        case "code_run":
          result = await codeRun(args.code, args.language);
          break;
        case "web_search":
          result = await webSearch(args.query, args.count);
          break;
        case "pdf_extract":
          result = await pdfExtract(args.url);
          break;
        case "url_unshorten":
          result = await urlUnshorten(args.url);
          break;
        case "text_diff":
          result = textDiff(args.text1, args.text2);
          break;
        case "json_query":
          result = jsonQuery(args.data, args.query);
          break;
        case "hash_text":
          result = hashText(args.text, args.algorithm || "sha256");
          break;
        case "base64":
          result = base64Tool(args.input, args.mode || "encode");
          break;
        case "http_headers":
          result = await httpHeaders(args.url);
          break;
        case "regex_test":
          result = regexTest(args.pattern, args.text, args.flags || "g");
          break;
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      
      
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- Web Search via DuckDuckGo HTML ---
async function webSearch(query, count = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await httpGet(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  
  const cheerio = require("cheerio");
  const $ = cheerio.load(res.text());
  const results = [];
  
  $(".result").each((i, el) => {
    if (results.length >= count) return;
    const title = $(el).find(".result__title").text().trim();
    const snippet = $(el).find(".result__snippet").text().trim();
    const href = $(el).find(".result__url").text().trim();
    const link = $(el).find(".result__a").attr("href") || "";
    
    if (title && (href || link)) {
      // DuckDuckGo uses redirect URLs, extract actual URL
      let actualUrl = href;
      if (link.includes("uddg=")) {
        try {
          actualUrl = decodeURIComponent(link.split("uddg=")[1].split("&")[0]);
        } catch {}
      }
      results.push({ title, url: actualUrl, snippet });
    }
  });
  
  return { query, count: results.length, results };
}


// --- pdf_extract ---
async function pdfExtract(url) {
  const res = await httpGet(url);
  if (res.status >= 400) return { error: `HTTP ${res.status}`, url };
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(res.body);
    return {
      url,
      pages: data.numpages,
      info: data.info || {},
      text: data.text.slice(0, 100000),
      length: data.text.length,
    };
  } catch (e) {
    return { error: `PDF parse failed: ${e.message}`, url };
  }
}

// --- url_unshorten ---
async function urlUnshorten(url) {
  const chain = [url];
  let current = url;
  for (let i = 0; i < 10; i++) {
    try {
      const mod = current.startsWith("https") ? require("https") : require("http");
      const next = await new Promise((resolve, reject) => {
        const req = mod.get(current, { headers: { "User-Agent": "KaelMCP/1.0" }, timeout: 5000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const loc = new (require("url").URL)(res.headers.location, current).href;
            chain.push(loc);
            resolve(loc);
          } else { resolve(null); }
          res.destroy();
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      });
      if (!next) break;
      current = next;
    } catch { break; }
  }
  return { original: url, final: current, redirects: chain.length - 1, chain };
}

// --- text_diff ---
function textDiff(text1, text2) {
  const lines1 = text1.split("\n"), lines2 = text2.split("\n");
  if (lines1.length > 1000 || lines2.length > 1000) return { error: "Text too large (>1000 lines)" };
  const m = lines1.length, n = lines2.length;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = lines1[i-1] === lines2[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  let i = m, j = n;
  const result = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && lines1[i-1] === lines2[j-1]) { result.unshift({t:"=",l:lines1[i-1]}); i--; j--; }
    else if (j > 0 && (i===0 || dp[i][j-1]>=dp[i-1][j])) { result.unshift({t:"+",l:lines2[j-1]}); j--; }
    else { result.unshift({t:"-",l:lines1[i-1]}); i--; }
  }
  const unified = result.map(r => (r.t==="+"?"+":r.t==="-"?"-":" ")+" "+r.l).join("\n");
  return { added: result.filter(r=>r.t==="+").length, removed: result.filter(r=>r.t==="-").length,
           unchanged: result.filter(r=>r.t==="=").length, diff: unified.slice(0,50000) };
}

// --- json_query ---
function jsonQuery(data, query) {
  try {
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    const parts = query.replace(/\[(\d+)\]/g, ".$1").replace(/\[\*\]/g, ".*").split(".");
    function resolve(cur, path) {
      if (!path.length) return cur;
      if (cur == null) return null;
      const [h, ...rest] = path;
      if (h === "*" && Array.isArray(cur)) return cur.map(i => resolve(i, rest)).flat();
      const idx = Number(h);
      if (!isNaN(idx) && Array.isArray(cur)) return resolve(cur[idx], rest);
      return resolve(cur[h], rest);
    }
    const result = resolve(obj, parts);
    return { query, result: JSON.stringify(result, null, 2), type: typeof result,
             length: Array.isArray(result) ? result.length : undefined };
  } catch (e) { return { error: `Query failed: ${e.message}` }; }
}

// --- hash_text ---
function hashText(text, algorithm = "sha256") {
  const crypto = require("crypto");
  const algos = ["md5","sha1","sha256","sha512"];
  if (algorithm === "all") {
    const r = {};
    algos.forEach(a => { r[a] = crypto.createHash(a).update(text).digest("hex"); });
    return r;
  }
  if (!algos.includes(algorithm)) return { error: `Unknown algo. Supported: ${algos.join(", ")}, all` };
  return { algorithm, hash: crypto.createHash(algorithm).update(text).digest("hex"), length: text.length };
}


// --- base64 ---
function base64Tool(input, mode = "encode") {
  try {
    if (mode === "decode") {
      const decoded = Buffer.from(input, "base64").toString("utf-8");
      return { mode: "decode", input: input.slice(0, 100), output: decoded, length: decoded.length };
    }
    const encoded = Buffer.from(input).toString("base64");
    return { mode: "encode", input: input.slice(0, 100), output: encoded, length: encoded.length };
  } catch (e) { return { error: e.message }; }
}

// --- http_headers ---
async function httpHeaders(url) {
  try {
    const mod = url.startsWith("https") ? require("https") : require("http");
    const headers = await new Promise((resolve, reject) => {
      const req = mod.get(url, { headers: { "User-Agent": "KaelMCP/1.0" }, timeout: 10000 }, (res) => {
        resolve({ status: res.statusCode, headers: res.headers });
        res.destroy();
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    });
    return { url, ...headers };
  } catch (e) { return { error: e.message, url }; }
}

// --- regex_test ---
function regexTest(pattern, text, flags = "g") {
  try {
    const re = new RegExp(pattern, flags);
    const matches = [...text.matchAll(re)].map(m => ({
      match: m[0],
      index: m.index,
      groups: m.groups || null,
      captures: m.slice(1)
    }));
    return { pattern, flags, matches, count: matches.length, test: re.test(text) };
  } catch (e) { return { error: e.message }; }
}

// --- Express + SSE Transport ---
const app = express();

// CORS for remote clients
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Analytics endpoint
app.get("/analytics", (req, res) => {
  res.json(getAnalytics());
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Kael MCP Server ⚡",
    version: "1.2.0",
    tools: 16,
    transport: "sse",
    protocol: "MCP 1.0",
  });
});

// Info page
app.get("/analytics", (req, res) => {
  res.json(getAnalytics());
});

app.get("/", (req, res) => {
  res.json({
    name: "Kael MCP Server ⚡",
    description: "AI-native tool provider. Cheap compute beats expensive tokens.",
    version: "1.1.0",
    tools: [
      "web_fetch — Fetch & extract readable content from any URL",
      "screenshot — Take screenshots of webpages (Playwright)",
      "html_extract — Extract structured data (tables, lists, metadata) from HTML",
      "dns_lookup — DNS records for any domain",
      "whois — WHOIS domain lookup",
      "ip_geo — IP geolocation data",
      "code_run — Execute JS/Python/Bash in sandbox",
      "web_search — Search the web via DuckDuckGo",
      "pdf_extract — Extract text and metadata from PDF URLs",
      "url_unshorten — Follow redirects to get final URL",
      "text_diff — Compare two texts with unified diff output",
      "json_query — Query JSON with dot-notation paths",
      "hash_text — Hash text with MD5/SHA1/SHA256/SHA512",
      "base64 — Encode/decode Base64",
      "http_headers — Fetch HTTP headers without downloading body",
      "regex_test — Test regex patterns with full match details",
    ],
    connect: {
      sse: `https://www.kael.ink/mcp/sse`,
      docs: "https://www.kael.ink/docs",
    },
    pricing: "Free tier: 100 calls/day. Pro: unlimited. See /pricing",
  });
});

// SSE endpoint — clients connect here
const transports = {};

app.get("/sse", async (req, res) => {
  const server = createMcpServer();
  // Use /mcp/messages as the POST endpoint so it works through nginx proxy at /mcp/
  const transport = new SSEServerTransport("/mcp/messages", res);
  
  const sessionId = transport.sessionId;
  transports[sessionId] = { server, transport };
  
  // session tracked
  console.log(`[MCP] New SSE session: ${sessionId}`);
  
  res.on("close", () => {
    console.log(`[MCP] Session closed: ${sessionId}`);
    delete transports[sessionId];
  });
  
  await server.connect(transport);
});

// Message endpoint — clients send messages here
// Pass parsed body as 3rd arg since express may consume the raw stream
app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = transports[sessionId];
  
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  await session.transport.handlePostMessage(req, res, req.body);
});

// Start
app.listen(PORT, "127.0.0.1", () => {
  console.log(`⚡ Kael MCP Server running on port ${PORT}`);
  console.log(`   SSE endpoint: http://127.0.0.1:${PORT}/sse`);
  console.log(`   Health: http://127.0.0.1:${PORT}/health`);
});
