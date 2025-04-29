# Minimized Notion MCP Server

This project implements an optimized MCP server for the Notion API, focusing on performance and efficiency for AI assistants.

![demo-image](mcp-demo.gif)

## Key Improvements

- **Minimized Tool Set**: Reduced the number of exposed Notion API tools to only the most essential ones for document analysis.
- **Parallel Processing**: Enhanced performance by implementing parallel API requests for retrieving block content, significantly reducing response times.

## Installation

### 1. Setting up Integration in Notion:

Go to https://www.notion.so/profile/integrations and create a new **internal** integration or select an existing one.

![Creating a Notion Integration token](notion-integration.png)

While we limit the scope of Notion API's exposed, there is a non-zero risk to workspace data by exposing it to LLMs. Security-conscious users may want to further configure the Integration's _Capabilities_.

For example, you can create a read-only integration token by giving only "Read content" access from the "Configuration" tab:

![Notion Integration Token Capabilities showing Read content checked](notion-capabilities.png)

### 2. Adding MCP config to your client:

#### Using npm:

Add the following to your `.cursor/mcp.json` or `claude_desktop_config.json` (MacOS: `~/Library/Application\ Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "minimized-notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\": \"Bearer ntn_****\", \"Notion-Version\": \"2022-06-28\" }"
      }
    }
  }
}
```

#### Using Docker:

Add the following to your `.cursor/mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e", "OPENAPI_MCP_HEADERS",
        "taewoong1378/minimized-notion-mcp-server"
      ],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\":\"Bearer ntn_****\",\"Notion-Version\":\"2022-06-28\"}"
      }
    }
  }
}
```

Don't forget to replace `ntn_****` with your integration secret. Find it from your integration configuration tab.

### 3. Connecting content to integration:

Ensure relevant pages and databases are connected to your integration.

To do this, visit the page, click on the 3 dots, and select "Connect to integration".

![Adding Integration Token to Notion Connections](notion-connections.png)

## Available Tools

This optimized server exposes only the most essential Notion API tools:

- `API-retrieve-a-page`: Get page information
- `API-get-block-children`: Get page content blocks (with parallel processing)
- `API-retrieve-a-block`: Get details about a specific block

## Examples

1. Using the following instruction:

```
Get the content of page 1a6b35e6e67f802fa7e1d27686f017f2
```

The AI will retrieve the page details efficiently with parallel processing of block content.

## Development

Build:

```
pnpm build
```

Execute:

```
pnpm dev
```

## License

MIT
