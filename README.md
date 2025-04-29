# One Pager Assistant 서버

이 프로젝트는 Notion의 One Pager 문서를 읽고 질문에 답변할 수 있는 AI 어시스턴트를 지원하는 MCP(Model Context Protocol) 서버입니다. 노션 API를 통해 지정된 페이지와 그 하위 블록들을 읽어옵니다.

## 주요 기능

- Notion API를 활용하여 페이지 정보 조회
- 페이지의 하위 블록 내용 조회
- 개별 블록 정보 조회

## 설치 방법

```bash
# 패키지 설치
pnpm install

# 서버 실행
pnpm dev
```

## 환경 변수 설정

`.env` 파일에 다음과 같이 Notion API 인증 정보를 설정합니다:

```
OPENAPI_MCP_HEADERS={"Authorization":"Bearer your_notion_api_key","Notion-Version":"2022-06-28"}
```

## 사용 방법

서버가 실행되면 One Pager 문서의 페이지 ID를 입력하여 해당 문서의 내용을 조회할 수 있습니다. AI 어시스턴트는 다음과 같은 API를 사용합니다:

1. `API-retrieve-a-page`: 페이지 기본 정보 조회
2. `API-get-block-children`: 페이지의 하위 블록(내용) 조회

## 예제 CURL 명령어

```bash
# 페이지 정보 조회
curl -X GET 'https://api.notion.com/v1/pages/YOUR_PAGE_ID' \
  -H 'Authorization: Bearer ntn_XXXXX' \
  -H 'Notion-Version: 2022-06-28'

# 페이지 하위 블록 조회
curl -X GET 'https://api.notion.com/v1/blocks/YOUR_PAGE_ID/children?page_size=100' \
  -H 'Authorization: Bearer ntn_XXXXX' \
  -H 'Notion-Version: 2022-06-28'
```

## 문제 해결

- API 응답이 없는 경우: 액세스 토큰과 페이지 ID를 확인하세요.
- 권한 오류가 발생하는 경우: Notion Integration이 해당 페이지에 접근 권한이 있는지 확인하세요.

## 라이센스

MIT
