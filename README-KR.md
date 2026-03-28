# kordoc

**모두 파싱해버리겠다.**

[![npm version](https://img.shields.io/npm/v/kordoc.svg)](https://www.npmjs.com/package/kordoc)
[![license](https://img.shields.io/npm/l/kordoc.svg)](https://github.com/chrisryugj/kordoc/blob/main/LICENSE)

> *대한민국에서 둘째가라면 서러울 문서지옥. 거기서 7년 버틴 공무원이 만들었습니다.*

HWP, HWPX, PDF — 관공서에서 쏟아지는 모든 문서 포맷을 마크다운으로 변환합니다.
학교 교육과정, 사전기획 보고서, 검토의견서, 소식지 원고... 뭐든 넣으면 파싱합니다.

[English](./README.md)

![kordoc 데모](./demo.gif)

---

## 특징

- **한컴오피스 불필요** — COM 자동화 없이 바이너리 직접 파싱. Linux, Mac에서도 동작
- **손상 파일 복구** — ZIP Central Directory가 깨진 HWPX도 Local File Header 스캔으로 복구
- **병합 셀 완벽 처리** — 2-pass 그리드 알고리즘으로 colSpan/rowSpan 정확히 렌더링
- **HWP5 바이너리 직접 파싱** — OLE2 컨테이너 → 레코드 스트림 → UTF-16LE 텍스트 추출
- **이미지 PDF 감지** — 스캔된 PDF는 텍스트 추출 불가를 사전에 알려줌
- **3가지 인터페이스** — npm 라이브러리, CLI 도구, MCP 서버 (Claude/Cursor)
- **실전 검증 완료** — 5개 공공 프로젝트, 수천 건의 실제 관공서 문서에서 테스트됨

## 지원 포맷

| 포맷 | 엔진 | 특징 |
|------|------|------|
| **HWPX** (한컴 2020+) | ZIP + XML DOM | 매니페스트, 중첩 테이블, 병합 셀, 손상 ZIP 복구 |
| **HWP 5.x** (한컴 레거시) | OLE2 + CFB | 21종 제어문자, zlib 압축 해제, DRM 감지 |
| **PDF** | pdfjs-dist | 라인 그룹핑, 테이블 감지, 이미지 PDF 경고 |

## 설치

```bash
npm install kordoc

# PDF 파싱이 필요하면 pdfjs-dist도 설치 (선택)
npm install pdfjs-dist
```

> `pdfjs-dist`는 선택적 peerDependency입니다. HWP/HWPX만 쓴다면 설치 불필요.

## 사용법

### 라이브러리

```typescript
import { parse } from "kordoc"
import { readFileSync } from "fs"

const buffer = readFileSync("사업계획서.hwpx")
const result = await parse(buffer.buffer)

if (result.success) {
  console.log(result.markdown)
}
```

### CLI

```bash
npx kordoc 사업계획서.hwpx                     # 터미널 출력
npx kordoc 보고서.hwp -o 보고서.md              # 파일 저장
npx kordoc *.pdf -d ./변환결과/                 # 일괄 변환
npx kordoc 검토서.hwpx --format json           # JSON 메타데이터 포함
```

### MCP 서버 (Claude / Cursor / Windsurf)

Claude Desktop이나 Cursor에서 문서 파싱 도구로 바로 사용 가능합니다:

```json
{
  "mcpServers": {
    "kordoc": {
      "command": "npx",
      "args": ["-y", "kordoc-mcp"]
    }
  }
}
```

**제공 도구:**

| 도구 | 설명 |
|------|------|
| `parse_document` | HWP/HWPX/PDF 파일을 마크다운으로 변환 |
| `detect_format` | 매직 바이트로 파일 포맷 감지 |

## 작동 원리

```
파일 입력 → 매직 바이트 감지 → 포맷별 라우팅
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
             HWPX              HWP 5.x               PDF
           (ZIP+XML)         (OLE2+레코드)         (pdfjs-dist)
                │                   │                   │
                └───────┬───────────┘                   │
                        │                               │
                  2-Pass 테이블                          │
                  빌더 (그리드)                          │
                        │                               │
                ┌───────▼───────────────────────────────▼───┐
                │           IRBlock[] (중간 표현)            │
                └─────────────────┬─────────────────────────┘
                                  │
                            마크다운 출력
```

## 보안

v1.0.0 프로덕션급 보안 강화:

- **ZIP bomb 방지** — 비압축 크기 사전 검증, 압축 해제 100MB 제한, 엔트리 500개 제한
- **XXE/Billion Laughs 방지** — 내부 DTD 서브셋 포함 완전 제거
- **압축 폭탄 방지** — HWP5 스트림별 `maxOutputLength` + 전체 섹션 누적 100MB 제한
- **PDF 리소스 제한** — MAX_PAGES=5,000, 누적 텍스트 100MB 상한, `doc.destroy()` 정리
- **HWP5 레코드 제한** — 섹션당 최대 500,000개 레코드, 조작 파일에 의한 메모리 폭주 방지
- **테이블 차원 클램핑** — HWP5 바이너리에서 읽은 rows/cols를 할당 전 MAX_ROWS/MAX_COLS로 제한
- **colSpan/rowSpan 클램핑** — 악성 병합 값을 그리드 한계로 클램핑 (MAX_COLS=200, MAX_ROWS=10,000)
- **경로 순회 차단** — 백슬래시 정규화, `..`, 절대경로, Windows 드라이브 문자 모두 차단
- **MCP 에러 정제** — 파일시스템 경로가 클라이언트 에러 메시지에 노출되지 않도록 제거
- **MCP 서버 경로 제한** — `.hwp`, `.hwpx`, `.pdf` 확장자만 허용, 심볼릭 링크 해석
- **파일 크기 제한** — MCP 서버 및 CLI에서 500MB 상한
- **HWP5 섹션 제한** — 기본 경로와 폴백 경로 모두 최대 100 섹션
- **HWP5 제어문자 수정** — 문자 코드 10(각주/미주) 정상 처리

## 만든 사람

대한민국 지방공무원. 광진구청에서 7년간 HWP 파일과 싸우다가 이걸 만들었습니다.
5개 공공 프로젝트(학교 교육과정, 시설 검토 보고서, 법률 별표, 소식지, 공공데이터)에서
수천 건의 실제 관공서 문서를 파싱하며 검증했습니다.

## 라이선스

[MIT](./LICENSE)
