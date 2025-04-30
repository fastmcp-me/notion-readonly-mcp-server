import fs from 'fs'
import { OpenAPIV3 } from 'openapi-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpClient } from '../http-client'

// 모킹 방식 변경
vi.mock('fs', () => {
  return {
    default: {
      createReadStream: vi.fn()
    },
    createReadStream: vi.fn()
  }
})

vi.mock('form-data', () => {
  const FormDataMock = vi.fn().mockImplementation(() => ({
    append: vi.fn(),
    getHeaders: vi.fn().mockReturnValue({ 'content-type': 'multipart/form-data; boundary=---123' })
  }))
  return {
    default: FormDataMock
  }
})

describe('HttpClient File Upload', () => {
  let client: HttpClient
  const mockApiInstance = {
    uploadFile: vi.fn(),
  }

  const baseConfig = {
    baseUrl: 'http://test.com',
    headers: {},
  }

  const mockOpenApiSpec: OpenAPIV3.Document = {
    openapi: '3.0.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    paths: {
      '/upload': {
        post: {
          operationId: 'uploadFile',
          responses: {
            '200': {
              description: 'File uploaded successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                      },
                    },
                  },
                },
              },
            },
          },
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                    },
                    description: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    client = new HttpClient(baseConfig, mockOpenApiSpec)
    // @ts-expect-error - Mock the private api property
    client['api'] = Promise.resolve(mockApiInstance)
  })

  it('should handle file uploads with FormData', async () => {
    const mockFileStream = { pipe: vi.fn() }
    
    // 모킹 방식 변경
    vi.mocked(fs.createReadStream).mockReturnValue(mockFileStream as any)

    const uploadPath = mockOpenApiSpec.paths['/upload']
    if (!uploadPath?.post) {
      throw new Error('Upload path not found in spec')
    }
    const operation = uploadPath.post as OpenAPIV3.OperationObject & { method: string; path: string }
    const params = {
      file: '/path/to/test.txt',
      description: 'Test file',
    }

    mockApiInstance.uploadFile.mockResolvedValue({
      data: { success: true },
      status: 200,
      headers: {},
    })

    await client.executeOperation(operation, params)

    expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/test.txt')
    expect(mockApiInstance.uploadFile).toHaveBeenCalled()
  })

  it('should throw error for invalid file path', async () => {
    vi.mocked(fs.createReadStream).mockImplementation(() => {
      throw new Error('File not found')
    })

    const uploadPath = mockOpenApiSpec.paths['/upload']
    if (!uploadPath?.post) {
      throw new Error('Upload path not found in spec')
    }
    const operation = uploadPath.post as OpenAPIV3.OperationObject & { method: string; path: string }
    const params = {
      file: '/nonexistent/file.txt',
      description: 'Test file',
    }

    await expect(client.executeOperation(operation, params)).rejects.toThrow('Failed to read file at /nonexistent/file.txt')
  })

  it('should handle multiple file uploads', async () => {
    const mockFileStream1 = { pipe: vi.fn() }
    const mockFileStream2 = { pipe: vi.fn() }
    
    // createReadStream 모킹을 시퀀스로 설정
    vi.mocked(fs.createReadStream)
      .mockReturnValueOnce(mockFileStream1 as any)
      .mockReturnValueOnce(mockFileStream2 as any)

    const operation: OpenAPIV3.OperationObject = {
      operationId: 'uploadFile',
      responses: {
        '200': {
          description: 'Files uploaded successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {
                    type: 'boolean',
                  },
                },
              },
            },
          },
        },
      },
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file1: {
                  type: 'string',
                  format: 'binary',
                },
                file2: {
                  type: 'string',
                  format: 'binary',
                },
                description: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    }

    const params = {
      file1: '/path/to/test1.txt',
      file2: '/path/to/test2.txt',
      description: 'Test files',
    }

    mockApiInstance.uploadFile.mockResolvedValue({
      data: { success: true },
      status: 200,
      headers: {},
    })

    await client.executeOperation(operation as OpenAPIV3.OperationObject & { method: string; path: string }, params)

    expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/test1.txt')
    expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/test2.txt')
    expect(mockApiInstance.uploadFile).toHaveBeenCalled()
  })
})
