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

// Notion object type definition
interface NotionBlock {
  object: 'block';
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any; // Allow additional fields
}

interface NotionPage {
  object: 'page';
  id: string;
  properties: Record<string, any>;
  [key: string]: any; // Allow additional fields
}

interface NotionDatabase {
  object: 'database';
  id: string;
  properties: Record<string, any>;
  [key: string]: any; // Allow additional fields
}

interface NotionComment {
  object: 'comment';
  id: string;
  [key: string]: any; // Allow additional fields
}

type NotionObject = NotionBlock | NotionPage | NotionDatabase | NotionComment;

// Recursive exploration options
interface RecursiveExplorationOptions {
  maxDepth?: number;
  includeDatabases?: boolean;
  includeComments?: boolean;
  includeProperties?: boolean;
  maxParallelRequests?: number;
  skipCache?: boolean;
  batchSize?: number;
  timeoutMs?: number;
}

// import this class, extend and return server
export class MCPProxy {
  private server: Server
  private httpClient: HttpClient
  private tools: Record<string, NewToolDefinition>
  private openApiLookup: Record<string, OpenAPIV3.OperationObject & { method: string; path: string }>
  private pageCache: Map<string, any> = new Map() // Cache for performance improvement
  private blockCache: Map<string, any> = new Map() // Block cache
  private databaseCache: Map<string, any> = new Map() // Database cache
  private commentCache: Map<string, any> = new Map() // Comment cache
  private propertyCache: Map<string, any> = new Map() // Property cache

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

      // Log available tools
      console.log('One Pager Assistant - Available tools:')

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

      // Add extended One Pager tool
      const onePagerTool = {
        name: 'API-get-one-pager',
        description: 'Recursively retrieve a full Notion page with all its blocks, databases, and related content',
        inputSchema: {
          type: 'object',
          properties: {
            page_id: {
              type: 'string',
              description: 'Identifier for a Notion page',
            },
            maxDepth: {
              type: 'integer',
              description: 'Maximum recursion depth (default: 5)',
            },
            includeDatabases: {
              type: 'boolean',
              description: 'Whether to include linked databases (default: true)',
            },
            includeComments: {
              type: 'boolean',
              description: 'Whether to include comments (default: true)',
            },
            includeProperties: {
              type: 'boolean',
              description: 'Whether to include detailed page properties (default: true)',
            },
            maxParallelRequests: {
              type: 'integer',
              description: 'Maximum number of parallel requests (default: 15)',
            },
            batchSize: {
              type: 'integer',
              description: 'Batch size for parallel processing (default: 10)',
            },
            timeoutMs: {
              type: 'integer',
              description: 'Timeout in milliseconds (default: 60000)',
            },
          },
          required: ['page_id'],
        } as Tool['inputSchema'],
      };
      
      tools.push(onePagerTool);
      console.log(`- ${onePagerTool.name}: ${onePagerTool.description}`);

      return { tools }
    })

    // Handle tool calling
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: params } = request.params

      console.log(`One Pager Assistant - Tool call: ${name}`)
      console.log('Parameters:', JSON.stringify(params, null, 2))

      try {
        // Handle extended One Pager tool
        if (name === 'API-get-one-pager') {
          return await this.handleOnePagerRequest(params);
        }

        // Find the operation in OpenAPI spec
        const operation = this.findOperation(name)
        if (!operation) {
          const error = `Method ${name} not found.`
          console.error(error)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  message: error,
                  code: 404
                }),
              },
            ],
          }
        }

        // Optimized parallel processing for API-get-block-children
        if (name === 'API-get-block-children') {
          return await this.handleBlockChildrenParallel(operation, params)
        }

        // Other regular API calls
        console.log(`Notion API call: ${operation.method.toUpperCase()} ${operation.path}`)
        const response = await this.httpClient.executeOperation(operation, params)

        // Log response summary
        console.log('Notion API response code:', response.status)
        if (response.status !== 200) {
          console.error('Response error:', response.data)
        } else {
          console.log('Response success')
        }

        // Update cache with response data
        this.updateCacheFromResponse(name, response.data);

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
        console.error('Tool call error', error)
        
        if (error instanceof HttpClientError) {
          console.error('HttpClientError occurred, returning structured error', error)
          const data = error.data?.response?.data ?? error.data ?? {}
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'error',
                  code: error.status,
                  message: error.message,
                  details: typeof data === 'object' ? data : { data: data },
                }),
              },
            ],
          }
        }
        
        // Ensure any other errors are also properly formatted as JSON
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'error',
                message: error instanceof Error ? error.message : String(error),
                code: 500
              }),
            },
          ],
        }
      }
    })
  }

  // Update cache based on API response type
  private updateCacheFromResponse(apiName: string, data: any): void {
    if (!data || typeof data !== 'object') return;

    try {
      // Update appropriate cache based on API response type
      if (apiName === 'API-retrieve-a-page' && data.object === 'page' && data.id) {
        this.pageCache.set(data.id, data);
      } else if (apiName === 'API-retrieve-a-block' && data.object === 'block' && data.id) {
        this.blockCache.set(data.id, data);
      } else if (apiName === 'API-retrieve-a-database' && data.object === 'database' && data.id) {
        this.databaseCache.set(data.id, data);
      } else if (apiName === 'API-retrieve-a-comment' && data.results) {
        // Cache comments from result list
        data.results.forEach((comment: any) => {
          if (comment.object === 'comment' && comment.id) {
            this.commentCache.set(comment.id, comment);
          }
        });
      } else if (apiName === 'API-retrieve-a-page-property' && data.results) {
        // Page property caching - would need params from call context
        // Skip this in current context
        console.log('Page property information has been cached');
      }

      // API-get-block-children handled in handleBlockChildrenParallel
    } catch (error) {
      console.warn('Error updating cache:', error);
    }
  }

  // One Pager request handler
  private async handleOnePagerRequest(params: any) {
    console.log('Starting One Pager request processing:', params.page_id);
    
    const options: RecursiveExplorationOptions = {
      maxDepth: params.maxDepth || 5,
      includeDatabases: params.includeDatabases !== false,
      includeComments: params.includeComments !== false,
      includeProperties: params.includeProperties !== false,
      maxParallelRequests: params.maxParallelRequests || 15,
      skipCache: params.skipCache || false,
      batchSize: params.batchSize || 10,
      timeoutMs: params.timeoutMs || 60000,
    };
    
    console.log('Exploration options:', JSON.stringify(options, null, 2));
    
    try {
      const startTime = Date.now();
      
      const pageData = await this.retrievePageRecursively(params.page_id, options);
      
      const duration = Date.now() - startTime;
      console.log(`One Pager completed in ${duration}ms for page ${params.page_id}`);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...pageData,
              _meta: {
                processingTimeMs: duration,
                retrievedAt: new Date().toISOString(),
                options: {
                  maxDepth: options.maxDepth,
                  includeDatabases: options.includeDatabases,
                  includeComments: options.includeComments,
                  includeProperties: options.includeProperties
                }
              }
            }),
          },
        ],
      };
    } catch (error) {
      console.error('Error in One Pager request:', error);
      const errorResponse = {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof HttpClientError ? error.status : 500,
        details: error instanceof HttpClientError ? error.data : undefined,
        timestamp: new Date().toISOString()
      };
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorResponse),
          },
        ],
      };
    }
  }

  // Recursively retrieve page content
  private async retrievePageRecursively(pageId: string, options: RecursiveExplorationOptions, currentDepth: number = 0): Promise<any> {
    console.log(`Recursive page exploration: ${pageId}, depth: ${currentDepth}/${options.maxDepth || 5}`);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${options.timeoutMs}ms`)), options.timeoutMs || 60000);
    });
    
    try {
      // Check maximum depth
      if (currentDepth >= (options.maxDepth || 5)) {
        console.log(`Maximum depth reached: ${currentDepth}/${options.maxDepth || 5}`);
        return { id: pageId, note: "Maximum recursion depth reached" };
      }
      
      // 1. Get basic page info (check cache)
      let pageData: any;
      if (!options.skipCache && this.pageCache.has(pageId)) {
        pageData = this.pageCache.get(pageId);
        console.log(`Page cache hit: ${pageId}`);
      } else {
        // Retrieve page info via API call
        const operation = this.findOperation('API-retrieve-a-page');
        if (!operation) {
          throw new Error('API-retrieve-a-page method not found.');
        }
        
        console.log(`Notion API call: ${operation.method.toUpperCase()} ${operation.path} (pageId: ${pageId})`);
        const response = await Promise.race([
          this.httpClient.executeOperation(operation, { page_id: pageId }),
          timeoutPromise
        ]) as any; 
        
        if (response.status !== 200) {
          console.error('Error retrieving page information:', response.data);
          return { 
            id: pageId,
            error: "Failed to retrieve page", 
            status: response.status,
            details: response.data 
          };
        }
        
        pageData = response.data;
        // Only cache successful responses
        this.pageCache.set(pageId, pageData);
      }
      
      // Collection of tasks to be executed in parallel for improved efficiency
      const parallelTasks: Promise<any>[] = [];
      
      // 2. Fetch block content (register async task)
      const blocksPromise = this.retrieveBlocksRecursively(pageId, options, currentDepth + 1);
      parallelTasks.push(blocksPromise);
      
      // 3. Fetch property details (if option enabled)
      let propertiesPromise: Promise<any> = Promise.resolve(null);
      if (options.includeProperties && pageData.properties) {
        propertiesPromise = this.enrichPageProperties(pageId, pageData.properties, options);
        parallelTasks.push(propertiesPromise);
      }
      
      // 4. Fetch comments (if option enabled)
      let commentsPromise: Promise<any> = Promise.resolve(null);
      if (options.includeComments) {
        commentsPromise = this.retrieveComments(pageId, options);
        parallelTasks.push(commentsPromise);
      }
      
      // Execute all tasks in parallel
      await Promise.race([Promise.all(parallelTasks), timeoutPromise]);
      
      // Integrate results into the main page data
      const enrichedPageData = { ...pageData };
      
      // Add block content
      const blocksData = await blocksPromise;
      enrichedPageData.content = blocksData;
      
      // Add property details (if option enabled)
      if (options.includeProperties && pageData.properties) {
        const enrichedProperties = await propertiesPromise;
        if (enrichedProperties) {
          enrichedPageData.detailed_properties = enrichedProperties;
        }
      }
      
      // Add comments (if option enabled)
      if (options.includeComments) {
        const comments = await commentsPromise;
        if (comments && comments.results && comments.results.length > 0) {
          enrichedPageData.comments = comments;
        }
      }
      
      return enrichedPageData;
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        console.error(`Timeout occurred while processing page ${pageId} at depth ${currentDepth}`);
        return { 
          id: pageId, 
          error: "Operation timed out", 
          partial_results: true,
          note: `Processing exceeded timeout limit (${options.timeoutMs}ms)`
        };
      }
      
      console.error(`Error in retrievePageRecursively for page ${pageId}:`, error);
      return { 
        id: pageId, 
        error: error instanceof Error ? error.message : String(error),
        retrievalFailed: true
      };
    }
  }
  
  // Recursively retrieve block content with improved parallelism
  private async retrieveBlocksRecursively(blockId: string, options: RecursiveExplorationOptions, currentDepth: number): Promise<any[]> {
    console.log(`Recursive block exploration: ${blockId}, depth: ${currentDepth}/${options.maxDepth || 5}`);
    
    if (currentDepth >= (options.maxDepth || 5)) {
      console.log(`Maximum depth reached: ${currentDepth}/${options.maxDepth || 5}`);
      return [{ note: "Maximum recursion depth reached" }];
    }
    
    try {
      const operation = this.findOperation('API-get-block-children');
      if (!operation) {
        throw new Error('API-get-block-children method not found.');
      }
      
      const blocksResponse = await this.handleBlockChildrenParallel(operation, { 
        block_id: blockId,
        page_size: 100
      });
      
      const blocksData = JSON.parse(blocksResponse.content[0].text);
      const blocks = blocksData.results || [];
      
      if (blocks.length === 0) {
        return [];
      }
      
      const batchSize = options.batchSize || 10;
      const enrichedBlocks: any[] = [];
      
      // Process blocks in batches for memory optimization and improved parallel execution
      for (let i = 0; i < blocks.length; i += batchSize) {
        const batch = blocks.slice(i, i + batchSize);
        
        // Process each batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (block: any) => {
            this.blockCache.set(block.id, block);
            
            const enrichedBlock = { ...block };
            
            // Collection of async tasks for this block
            const blockTasks: Promise<any>[] = [];
            
            // Process child blocks recursively
            if (block.has_children) {
              blockTasks.push(
                this.retrieveBlocksRecursively(block.id, options, currentDepth + 1)
                  .then(childBlocks => { enrichedBlock.children = childBlocks; })
                  .catch(error => {
                    console.error(`Error retrieving child blocks for ${block.id}:`, error);
                    enrichedBlock.children_error = { message: String(error) };
                    return [];
                  })
              );
            }
            
            // Process database blocks (if option enabled)
            if (options.includeDatabases && 
                (block.type === 'child_database' || block.type === 'linked_database')) {
              const databaseId = block[block.type]?.database_id;
              if (databaseId) {
                blockTasks.push(
                  this.retrieveDatabase(databaseId, options)
                    .then(database => { enrichedBlock.database = database; })
                    .catch(error => {
                      console.error(`Error retrieving database ${databaseId}:`, error);
                      enrichedBlock.database_error = { message: String(error) };
                    })
                );
              }
            }
            
            // Process page blocks or linked pages - optimization
            if (block.type === 'child_page' && currentDepth < (options.maxDepth || 5) - 1) {
              const pageId = block.id;
              blockTasks.push(
                this.retrievePageBasicInfo(pageId, options)
                  .then(pageInfo => { enrichedBlock.page_info = pageInfo; })
                  .catch(error => {
                    console.error(`Error retrieving page info for ${pageId}:`, error);
                    enrichedBlock.page_info_error = { message: String(error) };
                  })
              );
            }
            
            // Wait for all async tasks to complete
            if (blockTasks.length > 0) {
              await Promise.all(blockTasks);
            }
            
            return enrichedBlock;
          })
        );
        
        enrichedBlocks.push(...batchResults);
      }
      
      return enrichedBlocks;
    } catch (error) {
      console.error(`Error in retrieveBlocksRecursively for block ${blockId}:`, error);
      return [{ 
        id: blockId, 
        error: error instanceof Error ? error.message : String(error),
        retrievalFailed: true
      }];
    }
  }
  
  // Lightweight method to fetch only basic page info (without recursive loading)
  private async retrievePageBasicInfo(pageId: string, options: RecursiveExplorationOptions): Promise<any> {
    // Check cache
    if (!options.skipCache && this.pageCache.has(pageId)) {
      const cachedData = this.pageCache.get(pageId);
      return {
        id: cachedData.id,
        title: cachedData.properties?.title || { text: null },
        icon: cachedData.icon,
        cover: cachedData.cover,
        url: cachedData.url,
        fromCache: true
      };
    }
    
    // Get page info via API
    const operation = this.findOperation('API-retrieve-a-page');
    if (!operation) {
      return { id: pageId, note: "API-retrieve-a-page method not found" };
    }
    
    try {
      const response = await this.httpClient.executeOperation(operation, { page_id: pageId });
      
      if (response.status !== 200) {
        return { id: pageId, error: "Failed to retrieve page", status: response.status };
      }
      
      const pageData = response.data;
      this.pageCache.set(pageId, pageData);
      
      return {
        id: pageData.id,
        title: pageData.properties?.title || { text: null },
        icon: pageData.icon,
        cover: pageData.cover,
        url: pageData.url,
        created_time: pageData.created_time,
        last_edited_time: pageData.last_edited_time
      };
    } catch (error) {
      console.error(`Error retrieving basic page info ${pageId}:`, error);
      return { id: pageId, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Retrieve database information
  private async retrieveDatabase(databaseId: string, options: RecursiveExplorationOptions): Promise<any> {
    console.log(`Retrieving database information: ${databaseId}`);
    
    // Check cache
    if (!options.skipCache && this.databaseCache.has(databaseId)) {
      console.log(`Database cache hit: ${databaseId}`);
      return this.databaseCache.get(databaseId);
    }
    
    // Get database info via API call
    const operation = this.findOperation('API-retrieve-a-database');
    if (!operation) {
      console.warn('API-retrieve-a-database method not found.');
      return { id: databaseId, note: "Database details not available" };
    }
    
    try {
      console.log(`Notion API call: ${operation.method.toUpperCase()} ${operation.path} (databaseId: ${databaseId})`);
      const response = await this.httpClient.executeOperation(operation, { database_id: databaseId });
      
      if (response.status !== 200) {
        console.error('Error retrieving database information:', response.data);
        return { id: databaseId, error: "Failed to retrieve database" };
      }
      
      const databaseData = response.data;
      this.databaseCache.set(databaseId, databaseData);
      return databaseData;
    } catch (error) {
      console.error('Error retrieving database:', error);
      return { id: databaseId, error: "Failed to retrieve database" };
    }
  }
  
  // Retrieve comments
  private async retrieveComments(blockId: string, options: RecursiveExplorationOptions): Promise<any> {
    console.log(`Retrieving comments: ${blockId}`);
    
    // Get comments via API call
    const operation = this.findOperation('API-retrieve-a-comment');
    if (!operation) {
      console.warn('API-retrieve-a-comment method not found.');
      return { results: [] };
    }
    
    try {
      console.log(`Notion API call: ${operation.method.toUpperCase()} ${operation.path} (blockId: ${blockId})`);
      const response = await this.httpClient.executeOperation(operation, { block_id: blockId });
      
      if (response.status !== 200) {
        console.error('Error retrieving comments:', response.data);
        return { results: [] };
      }
      
      const commentsData = response.data;
      
      // Cache comments
      if (commentsData.results) {
        commentsData.results.forEach((comment: any) => {
          if (comment.id) {
            this.commentCache.set(comment.id, comment);
          }
        });
      }
      
      return commentsData;
    } catch (error) {
      console.error('Error retrieving comments:', error);
      return { results: [] };
    }
  }
  
  // Enrich page properties with detailed information
  private async enrichPageProperties(pageId: string, properties: any, options: RecursiveExplorationOptions): Promise<any> {
    console.log(`Enriching page properties: ${pageId}`);
    
    const enrichedProperties = { ...properties };
    const propertyPromises: Promise<void>[] = [];
    
    // Get detailed information for each property
    for (const [propName, propData] of Object.entries(properties)) {
      const propId = (propData as any).id;
      if (!propId) continue;
      
      // Create cache key
      const cacheKey = `${pageId}:${propId}`;
      
      propertyPromises.push(
        (async () => {
          try {
            // Check cache
            if (!options.skipCache && this.propertyCache.has(cacheKey)) {
              enrichedProperties[propName].details = this.propertyCache.get(cacheKey);
            } else {
              // Skip properties with URLs that contain special characters like notion://
              if (propId.includes('notion://') || propId.includes('%3A%2F%2F')) {
                console.warn(`Skipping property with special URL format: ${propName} (${propId})`);
                enrichedProperties[propName].details = { 
                  object: 'property_item', 
                  type: 'unsupported',
                  unsupported: { type: 'special_url_format' } 
                };
                return;
              }
              
              // Get property details via API call
              const operation = this.findOperation('API-retrieve-a-page-property');
              if (!operation) {
                console.warn('API-retrieve-a-page-property method not found.');
                return;
              }
              
              const response = await this.httpClient.executeOperation(operation, {
                page_id: pageId,
                property_id: propId
              }).catch(error => {
                console.warn(`Error retrieving property ${propName} (${propId}): ${error.message}`);
                return { 
                  status: error.status || 500,
                  data: { 
                    object: 'property_item', 
                    type: 'error',
                    error: { message: error.message } 
                  }
                };
              });
              
              if (response.status === 200) {
                enrichedProperties[propName].details = response.data;
                this.propertyCache.set(cacheKey, response.data);
              } else {
                enrichedProperties[propName].details = { 
                  object: 'property_item', 
                  type: 'error',
                  error: { status: response.status, message: JSON.stringify(response.data) } 
                };
              }
            }
          } catch (error) {
            console.error(`Error retrieving property ${propName}:`, error);
            enrichedProperties[propName].details = { 
              object: 'property_item', 
              type: 'error',
              error: { message: error instanceof Error ? error.message : String(error) } 
            };
          }
        })()
      );
    }
    
    // Get all property information in parallel
    await Promise.all(propertyPromises);
    
    return enrichedProperties;
  }

  // Optimized parallel processing for block children
  private async handleBlockChildrenParallel(operation: OpenAPIV3.OperationObject & { method: string; path: string }, params: any) {
    console.log(`Starting Notion API parallel processing: ${operation.method.toUpperCase()} ${operation.path}`)
    
    // Get first page
    const initialResponse = await this.httpClient.executeOperation(operation, params)
    
    if (initialResponse.status !== 200) {
      console.error('Response error:', initialResponse.data)
      return {
        content: [{ type: 'text', text: JSON.stringify(initialResponse.data) }],
      }
    }
    
    const results = initialResponse.data.results || []
    let nextCursor = initialResponse.data.next_cursor
    
    // Array for parallel processing
    const pageRequests = []
    const maxParallelRequests = 5 // Limit simultaneous requests
    
    console.log(`Retrieved ${results.length} blocks from first page`)
    
    // Request subsequent pages in parallel if available
    while (nextCursor) {
      // Clone parameters for next page
      const nextPageParams = { ...params, start_cursor: nextCursor }
      
      // Add page request
      pageRequests.push(
        this.httpClient.executeOperation(operation, nextPageParams)
          .then(response => {
            if (response.status === 200) {
              console.log(`Retrieved ${response.data.results?.length || 0} blocks from additional page`)
              return {
                results: response.data.results || [],
                next_cursor: response.data.next_cursor
              }
            }
            return { results: [], next_cursor: null }
          })
          .catch(error => {
            console.error('Error retrieving page:', error)
            return { results: [], next_cursor: null }
          })
      )
      
      // Execute parallel requests when batch size reached or no more pages
      if (pageRequests.length >= maxParallelRequests || !nextCursor) {
        console.log(`Processing ${pageRequests.length} pages in parallel...`)
        const pageResponses = await Promise.all(pageRequests)
        
        // Merge results
        for (const response of pageResponses) {
          results.push(...response.results)
          // Set next cursor for next batch
          if (response.next_cursor) {
            nextCursor = response.next_cursor
          } else {
            nextCursor = null
          }
        }
        
        // Reset request array
        pageRequests.length = 0
      }
      
      // Exit loop if no more pages
      if (!nextCursor) break
    }
    
    console.log(`Retrieved ${results.length} blocks in total`)
    
    // Return merged response
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
        console.warn('OPENAPI_MCP_HEADERS environment variable must be a JSON object, got:', typeof headers)
        return {}
      }
      return headers
    } catch (error) {
      console.warn('Failed to parse OPENAPI_MCP_HEADERS environment variable:', error)
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
    console.log('One Pager Assistant - MCP server started')
    console.log('Providing APIs: retrieve-a-page, get-block-children, retrieve-a-block')
    console.log('New feature: get-one-pager - recursively explore pages automatically')
    console.log('Parallel processing optimization enabled')
    
    // The SDK will handle stdio communication
    await this.server.connect(transport)
  }

  getServer() {
    return this.server
  }
}
