# Notion ReadOnly MCP Server

This project implements an optimized read-only MCP server for the Notion API, focusing on performance and efficiency for AI assistants to query and retrieve Notion content.

![demo-image](mcp-demo.gif)

## Key Improvements

- **Read-Only Design**: Focused exclusively on data retrieval operations, ensuring safe access to Notion content.
- **Minimized Tool Set**: Reduced the number of exposed Notion API tools to only the essential ones for document analysis.
- **Parallel Processing**: Enhanced performance by implementing asynchronous and parallel API requests for retrieving block content, significantly reducing response times.
- **Extended Database Access**: Added support for database, page property, and comment retrieval operations.

## Installation

### 1. Setting up Integration in Notion:

Go to https://www.notion.so/profile/integrations and create a new **internal** integration or select an existing one.

![Creating a Notion Integration token](integration-creation.png)

While we limit the scope of Notion API's exposed to read-only operations, there is a non-zero risk to workspace data by exposing it to LLMs. Security-conscious users may want to further configure the Integration's _Capabilities_.

For example, you can create a read-only integration token by giving only "Read content" access from the "Configuration" tab:

![Notion Integration Token Capabilities showing Read content checked](integrations-capabilities.png)

### 2. Adding MCP config to your client:

#### Using npm:

Add the following to your `.cursor/mcp.json` or `claude_desktop_config.json` (MacOS: `~/Library/Application\ Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "notion-readonly-mcp-server"],
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
        "taewoong1378/notion-readonly-mcp-server"
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

![Adding Integration Token to Notion Connections](connections.png)

## Available Tools

This optimized server exposes only essential read-only Notion API tools:

- `API-retrieve-a-page`: Get page information
- `API-get-block-children`: Get page content blocks (with parallel processing)
- `API-retrieve-a-block`: Get details about a specific block
- `API-retrieve-a-database`: Get database information
- `API-retrieve-a-comment`: Get comments on a page or block
- `API-retrieve-a-page-property`: Get specific property information from a page

## Asynchronous Processing

The server implements advanced parallel processing techniques for handling large Notion documents:

- Multiple requests are batched and processed concurrently
- Pagination is handled automatically for block children
- Results are efficiently aggregated before being returned
- Console logging provides visibility into the process without affecting response format

## Examples

1. Using the following instruction:

```
Get the content of page 1a6b35e6e67f802fa7e1d27686f017f2
```

The AI will retrieve the page details efficiently with parallel processing of block content.

2. Using database information:

```
Get the structure of database 8a6b35e6e67f802fa7e1d27686f017f2
```

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
