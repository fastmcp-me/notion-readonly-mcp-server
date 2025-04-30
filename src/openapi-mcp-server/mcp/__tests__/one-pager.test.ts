import { OpenAPIV3 } from 'openapi-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpClient } from '../../client/http-client'
import { MCPProxy } from '../proxy'

// Mock the dependencies
vi.mock('../../client/http-client')
vi.mock('@modelcontextprotocol/sdk/server/index.js')

describe('MCPProxy - One Pager Functionality', () => {
  let proxy: MCPProxy
  let mockOpenApiSpec: OpenAPIV3.Document

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Setup OpenAPI spec for testing
    mockOpenApiSpec = {
      openapi: '3.0.0',
      servers: [{ url: 'http://localhost:3000' }],
      info: {
        title: 'Notion API',
        version: '1.0.0',
      },
      paths: {
        '/v1/pages/{page_id}': {
          get: {
            operationId: 'retrieve-a-page',
            parameters: [
              {
                name: 'page_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
        '/v1/blocks/{block_id}/children': {
          get: {
            operationId: 'get-block-children',
            parameters: [
              {
                name: 'block_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              },
              {
                name: 'page_size',
                in: 'query',
                schema: { type: 'integer' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
        '/v1/blocks/{block_id}': {
          get: {
            operationId: 'retrieve-a-block',
            parameters: [
              {
                name: 'block_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
        '/v1/databases/{database_id}': {
          get: {
            operationId: 'retrieve-a-database',
            parameters: [
              {
                name: 'database_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
        '/v1/comments': {
          get: {
            operationId: 'retrieve-a-comment',
            parameters: [
              {
                name: 'block_id',
                in: 'query',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
        '/v1/pages/{page_id}/properties/{property_id}': {
          get: {
            operationId: 'retrieve-a-page-property',
            parameters: [
              {
                name: 'page_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              },
              {
                name: 'property_id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    }

    proxy = new MCPProxy('test-proxy', mockOpenApiSpec)
  })

  describe('handleOnePagerRequest', () => {
    it('should recursively retrieve page content', async () => {
      // Set up mocks for each API response

      // 1. Mock page response
      const mockPageResponse = {
        data: {
          object: 'page',
          id: 'test-page-id',
          properties: {
            title: {
              id: 'title',
              type: 'title',
              title: [{ type: 'text', text: { content: 'Test Page' } }]
            }
          },
          has_children: true
        },
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }

      // 2. Mock block children response
      const mockBlocksResponse = {
        data: {
          object: 'list',
          results: [
            {
              object: 'block',
              id: 'block-1',
              type: 'paragraph',
              has_children: false,
              paragraph: {
                rich_text: [{ type: 'text', text: { content: 'Test paragraph' } }]
              }
            },
            {
              object: 'block',
              id: 'block-2',
              type: 'child_database',
              has_children: false,
              child_database: {
                database_id: 'db-1'
              }
            }
          ],
          next_cursor: null,
          has_more: false
        },
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }

      // 3. Mock database response
      const mockDatabaseResponse = {
        data: {
          object: 'database',
          id: 'db-1',
          title: [{ type: 'text', text: { content: 'Test Database' } }],
          properties: {
            Name: {
              id: 'title',
              type: 'title',
              title: {}
            }
          }
        },
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }

      // 4. Mock comments response
      const mockCommentsResponse = {
        data: {
          object: 'list',
          results: [
            {
              object: 'comment',
              id: 'comment-1',
              rich_text: [{ type: 'text', text: { content: 'Test comment' } }]
            }
          ],
          has_more: false
        },
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }

      // Set up the mock API responses
      const executeOperationMock = HttpClient.prototype.executeOperation as ReturnType<typeof vi.fn>
      
      executeOperationMock.mockImplementation((operation, params) => {
        if (operation.operationId === 'retrieve-a-page') {
          return Promise.resolve(mockPageResponse)
        } else if (operation.operationId === 'get-block-children') {
          return Promise.resolve(mockBlocksResponse)
        } else if (operation.operationId === 'retrieve-a-database') {
          return Promise.resolve(mockDatabaseResponse)
        } else if (operation.operationId === 'retrieve-a-comment') {
          return Promise.resolve(mockCommentsResponse)
        }
        return Promise.resolve({ data: {}, status: 200, headers: new Headers() })
      })

      // Set up openApiLookup with our test operations
      const openApiLookup = {
        'API-retrieve-a-page': {
          operationId: 'retrieve-a-page',
          method: 'get',
          path: '/v1/pages/{page_id}',
        },
        'API-get-block-children': {
          operationId: 'get-block-children',
          method: 'get',
          path: '/v1/blocks/{block_id}/children',
        },
        'API-retrieve-a-database': {
          operationId: 'retrieve-a-database',
          method: 'get',
          path: '/v1/databases/{database_id}',
        },
        'API-retrieve-a-comment': {
          operationId: 'retrieve-a-comment',
          method: 'get',
          path: '/v1/comments',
        },
      }
      ;(proxy as any).openApiLookup = openApiLookup

      // Get the server request handlers
      const server = (proxy as any).server
      const handlers = server.setRequestHandler.mock.calls.flatMap((x: unknown[]) => x).filter((x: unknown) => typeof x === 'function')
      const callToolHandler = handlers[1]

      // Call the get-one-pager tool
      const result = await callToolHandler({
        params: {
          name: 'API-get-one-pager',
          arguments: {
            page_id: 'test-page-id',
            maxDepth: 2,
            includeDatabases: true,
            includeComments: true
          },
        },
      })

      // Parse the result
      const onePagerData = JSON.parse(result.content[0].text)

      // Verify the structure of the One Pager result
      expect(onePagerData).toHaveProperty('id', 'test-page-id')
      expect(onePagerData).toHaveProperty('content')
      
      // Verify that recursive content was retrieved
      expect(onePagerData.content).toBeInstanceOf(Array)
      expect(onePagerData.content.length).toBeGreaterThan(0)
      
      // Verify that at least one comment was retrieved
      expect(onePagerData).toHaveProperty('comments')
      expect(onePagerData.comments.results.length).toBeGreaterThan(0)
      
      // Verify database information was retrieved
      const databaseBlock = onePagerData.content.find((block: any) => block.type === 'child_database')
      expect(databaseBlock).toBeDefined()
      expect(databaseBlock).toHaveProperty('database')
      expect(databaseBlock.database).toHaveProperty('id', 'db-1')
    })
  })
}) 