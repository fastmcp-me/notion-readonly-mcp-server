import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js'
import { JSONSchema7 as IJsonSchema } from 'json-schema'
import { OpenAPIV3 } from 'openapi-types'
import { HttpClient, HttpClientError } from '../client/http-client'
import { OpenAPIToMCPConverter } from '../openapi/parser'

type PathItemObject = OpenAPIV3.PathItemObject & {
  get?: OpenAPIV3.OperationObject
  put?: OpenAPIV3.OperationObject
  post?: OpenAPIV3.OperationObject
  delete?: OpenAPIV3.OperationObject
  patch?: OpenAPIV3.OperationObject
}

type NewToolDefinition = {
  methods: Array<{
    name: string
    description: string
    inputSchema: IJsonSchema & { type: 'object' }
    returnSchema?: IJsonSchema
  }>
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>

  constructor(name: string, openApiSpec: OpenAPIV3.Document) {
    this.server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } })
    const baseUrl = openApiSpec.servers?.[0].url
    if (!baseUrl) {
      throw new Error('No base URL found in OpenAPI spec')
    }
    this.httpClient = new HttpClient(
      {
        baseUrl,
        headers: this.parseHeadersFromEnv(),
      },
      openApiSpec,
    )

    // Convert OpenAPI spec to MCP tools
    const converter = new OpenAPIToMCPConverter(openApiSpec)
    const { tools, openApiLookup } = converter.convertToMCPTools()
    this.tools = tools
    this.openApiLookup = openApiLookup

    this.setupHandlers()
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = []

      // 로그 출력 - 사용 가능한 도구 목록
      console.log('One Pager Assistant - 사용 가능한 도구 목록:')

      // Add methods as separate tools to match the MCP format
      Object.entries(this.tools).forEach(([toolName, def]) => {
        def.methods.forEach(method => {
          const toolNameWithMethod = `${toolName}-${method.name}`;
          const truncatedToolName = this.truncateToolName(toolNameWithMethod);
          tools.push({
            name: truncatedToolName,
            description: method.description,
            inputSchema: method.inputSchema as Tool['inputSchema'],
          })
          console.log(`- ${truncatedToolName}: ${method.description}`)
        })
      })

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: params } = request.params

      console.log(`One Pager Assistant - 도구 호출: ${name}`)
      console.log('파라미터:', JSON.stringify(params, null, 2))

      // Find the operation in OpenAPI spec
      const operation = this.findOperation(name)
      if (!operation) {
        const error = `메서드 ${name}를 찾을 수 없습니다.`
        console.error(error)
        throw new Error(error)
      }

      try {
        // Execute the operation
        console.log(`노션 API 호출: ${operation.method.toUpperCase()} ${operation.path}`)
        const response = await this.httpClient.executeOperation(operation, params)

        // 응답 결과 요약 로그
        console.log('노션 API 응답 코드:', response.status)
        if (response.status !== 200) {
          console.error('응답 오류:', response.data)
        } else {
          console.log('응답 성공')
          if (name === 'API-get-block-children') {
            if (response.data?.results) {
              console.log(`블록 ${response.data.results.length}개 조회됨`)
              if (response.data.has_more) {
                console.log(`다음 페이지 있음: ${response.data.next_cursor}`)
              }
            }
          }
        }

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text', // currently this is the only type that seems to be used by mcp server
              text: JSON.stringify(response.data), // TODO: pass through the http status code text?
            },
          ],
        }
      } catch (error) {
        console.error('도구 호출 오류', error)
        if (error instanceof HttpClientError) {
          console.error('HttpClientError 발생, 구조화된 오류 반환', error)
          const data = error.data?.response?.data ?? error.data ?? {}
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error', // TODO: get this from http status code?
                  ...(typeof data === 'object' ? data : { data: data }),
                }),
              },
            ],
          }
        }
        throw error
      }
    })
  }

  private findOperation(operationId: string): (OpenAPIV3.OperationObject & { method: string; path: string }) | null {
    return this.openApiLookup[operationId] ?? null
  }

  private parseHeadersFromEnv(): Record<string, string> {
    const headersJson = process.env.OPENAPI_MCP_HEADERS
    if (!headersJson) {
      return {}
    }

    try {
      const headers = JSON.parse(headersJson)
      if (typeof headers !== 'object' || headers === null) {
        console.warn('OPENAPI_MCP_HEADERS 환경 변수는 JSON 객체여야 합니다. 받은 타입:', typeof headers)
        return {}
      }
      return headers
    } catch (error) {
      console.warn('OPENAPI_MCP_HEADERS 환경 변수 파싱 실패:', error)
      return {}
    }
  }

  private getContentType(headers: Headers): 'text' | 'image' | 'binary' {
    const contentType = headers.get('content-type')
    if (!contentType) return 'binary'

    if (contentType.includes('text') || contentType.includes('json')) {
      return 'text'
    } else if (contentType.includes('image')) {
      return 'image'
    }
    return 'binary'
  }

  private truncateToolName(name: string): string {
    if (name.length <= 64) {
      return name;
    }
    return name.slice(0, 64);
  }

  async connect(transport: Transport) {
    console.log('One Pager Assistant - MCP 서버 시작됨')
    console.log('제공 API: retrieve-a-page, get-block-children, retrieve-a-block')
    
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
