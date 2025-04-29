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
  private pageCache: Map<string, any> = new Map() // 성능 향상을 위한 캐시

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
        // API-get-block-children 호출 시 병렬 처리 최적화
        if (name === 'API-get-block-children') {
          return await this.handleBlockChildrenParallel(operation, params)
        }

        // 다른 일반 API 호출
        console.log(`노션 API 호출: ${operation.method.toUpperCase()} ${operation.path}`)
        const response = await this.httpClient.executeOperation(operation, params)

        // 응답 결과 요약 로그
        console.log('노션 API 응답 코드:', response.status)
        if (response.status !== 200) {
          console.error('응답 오류:', response.data)
        } else {
          console.log('응답 성공')
        }

        // 페이지 정보 캐싱 (retrieve-a-page 호출인 경우)
        if (name === 'API-retrieve-a-page' && response.data && response.data.id) {
          this.pageCache.set(response.data.id, response.data)
        }

        // Convert response to MCP format
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data),
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
                  status: 'error',
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

  // 블록 하위 항목 병렬 처리 최적화 메서드
  private async handleBlockChildrenParallel(operation: OpenAPIV3.OperationObject & { method: string; path: string }, params: any) {
    console.log(`노션 API 병렬 처리 시작: ${operation.method.toUpperCase()} ${operation.path}`)
    
    // 첫 번째 페이지 조회
    const initialResponse = await this.httpClient.executeOperation(operation, params)
    
    if (initialResponse.status !== 200) {
      console.error('응답 오류:', initialResponse.data)
      return {
        content: [{ type: 'text', text: JSON.stringify(initialResponse.data) }],
      }
    }
    
    const results = initialResponse.data.results || []
    let nextCursor = initialResponse.data.next_cursor
    
    // 병렬 처리를 위한 배열
    const pageRequests = []
    const maxParallelRequests = 5 // 동시 요청 제한
    
    console.log(`첫 페이지에서 블록 ${results.length}개 조회됨`)
    
    // 다음 페이지가 있는 경우 병렬로 요청
    while (nextCursor) {
      // 다음 페이지를 위한 파라미터 복제
      const nextPageParams = { ...params, start_cursor: nextCursor }
      
      // 페이지 요청 추가
      pageRequests.push(
        this.httpClient.executeOperation(operation, nextPageParams)
          .then(response => {
            if (response.status === 200) {
              console.log(`추가 페이지에서 블록 ${response.data.results?.length || 0}개 조회됨`)
              return {
                results: response.data.results || [],
                next_cursor: response.data.next_cursor
              }
            }
            return { results: [], next_cursor: null }
          })
          .catch(error => {
            console.error('페이지 조회 오류:', error)
            return { results: [], next_cursor: null }
          })
      )
      
      // 최대 동시 요청 수에 도달했거나 더 이상 다음 페이지가 없으면 병렬 처리 실행
      if (pageRequests.length >= maxParallelRequests || !nextCursor) {
        console.log(`${pageRequests.length}개 페이지 병렬 처리 중...`)
        const pageResponses = await Promise.all(pageRequests)
        
        // 결과 병합
        for (const response of pageResponses) {
          results.push(...response.results)
          // 다음 배치의 시작점으로 마지막 next_cursor 설정
          if (response.next_cursor) {
            nextCursor = response.next_cursor
          } else {
            nextCursor = null
          }
        }
        
        // 요청 배열 초기화
        pageRequests.length = 0
      }
      
      // 다음 cursor가 없으면 반복 종료
      if (!nextCursor) break
    }
    
    console.log(`총 ${results.length}개 블록 조회 완료`)
    
    // 최종 결과 반환
    const mergedResponse = {
      ...initialResponse.data,
      results,
      has_more: false,
      next_cursor: null
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify(mergedResponse) }],
    }
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
    console.log('병렬 처리 최적화 활성화됨')
    
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
