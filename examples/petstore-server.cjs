const express = require('express')
const bodyParser = require('body-parser')

// 메모리에 저장할 데이터
let pets = [
  {
    id: 1,
    name: 'Max',
    species: 'Dog',
    age: 3,
    status: 'available'
  },
  {
    id: 2,
    name: 'Whiskers',
    species: 'Cat',
    age: 2,
    status: 'pending'
  },
  {
    id: 3,
    name: 'Goldie',
    species: 'Fish',
    age: 1,
    status: 'sold'
  }
]

// 다음 ID 추적용
let nextId = 4

/**
 * Petstore 서버 생성 함수
 * @param {number} port 서버가 실행될 포트
 * @returns {Express} Express 서버 인스턴스
 */
function createPetstoreServer(port) {
  const app = express()

  // Middleware
  app.use(bodyParser.json())

  // OpenAPI spec 제공
  app.get('/openapi.json', (req, res) => {
    res.json({
      openapi: '3.0.0',
      info: {
        title: 'Petstore API',
        version: '1.0.0',
        description: 'A simple petstore API for testing'
      },
      servers: [
        {
          url: `http://localhost:${port}`
        }
      ],
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            summary: 'List all pets',
            parameters: [
              {
                name: 'status',
                in: 'query',
                required: false,
                schema: {
                  type: 'string',
                  enum: ['available', 'pending', 'sold']
                }
              }
            ],
            responses: {
              '200': {
                description: 'A list of pets',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/Pet'
                      }
                    }
                  }
                }
              }
            }
          },
          post: {
            operationId: 'createPet',
            summary: 'Create a pet',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/NewPet'
                  }
                }
              },
              required: true
            },
            responses: {
              '201': {
                description: 'Pet created',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Pet'
                    }
                  }
                }
              }
            }
          }
        },
        '/pets/{id}': {
          get: {
            operationId: 'getPet',
            summary: 'Get a pet by ID',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: {
                  type: 'integer'
                }
              }
            ],
            responses: {
              '200': {
                description: 'A pet',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Pet'
                    }
                  }
                }
              },
              '404': {
                description: 'Pet not found',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Error'
                    }
                  }
                }
              }
            }
          },
          put: {
            operationId: 'updatePet',
            summary: 'Update a pet',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: {
                  type: 'integer'
                }
              }
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/PetUpdate'
                  }
                }
              },
              required: true
            },
            responses: {
              '200': {
                description: 'Pet updated',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Pet'
                    }
                  }
                }
              },
              '404': {
                description: 'Pet not found',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Error'
                    }
                  }
                }
              }
            }
          },
          delete: {
            operationId: 'deletePet',
            summary: 'Delete a pet',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: {
                  type: 'integer'
                }
              }
            ],
            responses: {
              '204': {
                description: 'Pet deleted'
              },
              '404': {
                description: 'Pet not found',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Error'
                    }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id', 'name', 'species', 'status'],
            properties: {
              id: {
                type: 'integer'
              },
              name: {
                type: 'string'
              },
              species: {
                type: 'string'
              },
              age: {
                type: 'integer'
              },
              status: {
                type: 'string',
                enum: ['available', 'pending', 'sold']
              }
            }
          },
          NewPet: {
            type: 'object',
            required: ['name', 'species'],
            properties: {
              name: {
                type: 'string'
              },
              species: {
                type: 'string'
              },
              age: {
                type: 'integer'
              }
            }
          },
          PetUpdate: {
            type: 'object',
            properties: {
              name: {
                type: 'string'
              },
              species: {
                type: 'string'
              },
              age: {
                type: 'integer'
              },
              status: {
                type: 'string',
                enum: ['available', 'pending', 'sold']
              }
            }
          },
          Error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string'
              },
              message: {
                type: 'string'
              }
            }
          }
        }
      }
    })
  })

  // 모든 펫 목록 조회
  app.get('/pets', (req, res) => {
    let result = [...pets]
    
    // 상태별 필터링
    if (req.query.status) {
      result = result.filter(pet => pet.status === req.query.status)
    }
    
    res.json(result)
  })

  // 특정 펫 조회
  app.get('/pets/:id', (req, res) => {
    const id = parseInt(req.params.id)
    const pet = pets.find(p => p.id === id)
    
    if (!pet) {
      return res.status(404).json({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Pet not found',
        petId: id
      })
    }
    
    res.json(pet)
  })

  // 펫 생성
  app.post('/pets', (req, res) => {
    const { name, species, age } = req.body
    
    if (!name || !species) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Name and species are required'
      })
    }
    
    const newPet = {
      id: nextId++,
      name,
      species,
      age: age || 0,
      status: 'available'
    }
    
    pets.push(newPet)
    res.status(201).json(newPet)
  })

  // 펫 정보 업데이트
  app.put('/pets/:id', (req, res) => {
    const id = parseInt(req.params.id)
    const petIndex = pets.findIndex(p => p.id === id)
    
    if (petIndex === -1) {
      return res.status(404).json({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Pet not found',
        petId: id
      })
    }
    
    const { name, species, age, status } = req.body
    const updatedPet = {
      ...pets[petIndex],
      name: name !== undefined ? name : pets[petIndex].name,
      species: species !== undefined ? species : pets[petIndex].species,
      age: age !== undefined ? age : pets[petIndex].age,
      status: status !== undefined ? status : pets[petIndex].status
    }
    
    pets[petIndex] = updatedPet
    res.json(updatedPet)
  })

  // 펫 삭제
  app.delete('/pets/:id', (req, res) => {
    const id = parseInt(req.params.id)
    const petIndex = pets.findIndex(p => p.id === id)
    
    if (petIndex === -1) {
      return res.status(404).json({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Pet not found',
        petId: id
      })
    }
    
    pets.splice(petIndex, 1)
    res.status(204).end()
  })

  // 서버 시작
  const server = app.listen(port, () => {
    console.log(`Petstore server running on http://localhost:${port}`)
  })

  return server
}

module.exports = { createPetstoreServer } 