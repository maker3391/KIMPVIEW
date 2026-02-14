# KIMPVIEW
> 🔗 **Live Service**: https://kimpview.com<br>
> 🟢 **Current Stable Version**: v1.0.1<br>
> ✍️ **Dev Blog**: https://velog.io/@cokid7979 <br>
> 📊 Kimchi Premium Real-time Dashboard  
> 🚀 Vanilla JS + Cloudflare Worker 기반 실서비스 운영 중

![KIMPVIEW Main Screenshot](/images/main.png)

## 🔑 Key Achievement

- **실제 서비스 운영 기준 누적 방문자 30,000+ 기록**
- **Google / Naver 검색 결과 상위 노출 확인**

---

## 🛠 Stability Update (v1.0.1)

- CoinPaprika market cap cache extended to 12h (Edge-level TTL)
- HTTP 402 / rate-limit fallback handling
- External API failure → stale cache rendering
- Upstream API load reduction via Worker caching

---

## 📌 프로젝트 목적

- 거래소별 가격 차이를 직관적으로 비교할 수 있는 대시보드 제공
- 실시간 데이터 기반 사용자 중심 화면 설계
- 암호화폐 시세, 글로벌 지표, 뉴스, 계산기 기능을 단일 플랫폼에서 통합 제공
- 실제 사용 환경을 고려한 UI/UX 흐름 구성

---

## ✨ 주요 기능

- Upbit / Bithumb 기준 원화 가격 테이블 제공
- Binance(USDT) 기준 가격을 환율로 환산하여 비교
- 김치프리미엄(%) 및 가격 차이(KRW) 자동 계산
- 즐겨찾기 / 검색 / 정렬(컬럼별) 지원
- 데이터 로딩 실패 시에도 화면이 깨지지 않도록 캐시 기반 fallback 렌더링 적용
- 실시간성 강화를 위해 **주기적 갱신 기반(Short TTL)** 데이터 업데이트 적용

---

## 🧩 구현/설계 포인트

- **UI 렌더링과 데이터 가공 로직 분리**
  - state 기반으로 필터/정렬/즐겨찾기 반영 후 렌더링
- **중복 API 호출 방지 및 체감 속도 개선**
  - localStorage 캐시(SWR 형태)로 초기 화면을 즉시 표시 후 백그라운드 갱신
  - 데이터 종류별 TTL 분리(가격/환율/시총/뉴스 등)
- **외부 API 제약(CORS/KEY 노출) 대응**
  - 프록시 서버(Cloudflare Worker)를 통해 외부 API 호출을 중계
- **에러/빈값 처리**
  - 값이 없을 때는 “-” 대신 빈칸 처리
  - 응답 지연/실패 시에도 테이블 구조가 유지되도록 방어 코드 적용  
    → 외부 API 상태와 무관하게 UI 안정성 확보

---
## 💡 What This Project Proves

- 외부 API 의존 환경에서의 장애 대응 설계
- Client–Edge–External API 3계층 아키텍처 설계
- SWR 기반 데이터 흐름 및 캐싱 전략 구현
- 대규모 실시간 테이블 DOM 성능 최적화
- 실서비스 운영 및 트래픽 대응 경험
---
## 🔄 Data Flow & Caching Strategy

> 페이지 진입 시 캐시 데이터를 즉시 렌더링하고,  
> 백그라운드에서 최신 데이터를 갱신하는  
> **SWR(Stale-While-Revalidate) 기반 데이터 흐름**

![KIMPVIEW Data Flow & Caching Strategy](/images/data_flow_caching_strategy.png)

---

## 🛠 기술 스택

### Frontend

- Vanilla JavaScript (ES6+, State-based UI Rendering)
- CSS3 (Flexbox / Grid)
- Performance Optimization (`IntersectionObserver`)  
  → 대규모 실시간 테이블 DOM 업데이트 최적화를 위해 사용
- WebSocket API (Real-time Liquidation & Trade Alerts)
### Infra

- Cloudflare Workers (API Proxy / CORS / API Key 보호)
- localStorage Cache (SWR Pattern implementation)

## 📡 Data Sources

### 🔹 Cryptocurrency Exchange APIs

- **Upbit Open API** – 국내 거래소 암호화폐 시세 (KRW 기준)
- **Bithumb Open API** – 국내 거래소 암호화폐 시세 (KRW 기준)
- **Binance Public API** – 글로벌 거래소 암호화폐 시세 (USDT 기준) 및 **WebSocket** 기반 실시간 선물 체결/청산 데이터
- **CoinPaprika API** – 글로벌 암호화폐 메타데이터 및 시가총액 정보
### 🔹 Market & Financial Data APIs

- **Yahoo Finance API** – 글로벌 주식 지수 및 시장 정보

### 🔹 Crypto News & Alert APIs

- **Naver API** – 국내 경제 지표 및 금융 뉴스
- **CoinNess API** – 암호화폐 속보 및 시장 알림 데이터

---

## 🏗 시스템 아키텍처

![KIMPVIEW System Architecture](/images/system_architecture.png)


---

## 📁 Project Structure

```text
KIMPVIEW/
├─ index.html
├─ style.css
├─ /html                         # 정적 서브 페이지
│  ├─ stats.html
│  ├─ stocks.html
│  ├─ news.html
│  ├─ fx.html
│  └─ ...
│
├─ /js
│  ├─ app.js                     # 메인 코인 테이블 + LIVE 김프 계산
│  │
│  ├─ /features                  # 기능 모듈
│  │  ├─ fx.js                   # 환율 관련 로직
│  │  ├─ news.js                 # 뉴스 페이지 로직
│  │  ├─ sidepanel.js            # 거래/청산 알림
│  │  ├─ stats.js                # 글로벌 지표
│  │  ├─ stocks.js               # 주식 페이지
│  │  ├─ topmetrics.js           # 상단 실시간 지표
│  │  └─ tv-init.js              # TradingView 초기화
│  │
│  ├─ /calculators               # 종합 계산기 로직
│  │  ├─ avg-cost.js
│  │  ├─ calculator-menu.js
│  │  ├─ lossRecoveryCalc.js
│  │  └─ profitCalc.js
│  │
│  └─ /workers                   # Cloudflare Worker 프록시 코드
│     ├─ worker.js
│     └─ newsworker.js
│
├─ /images
├─ ads.txt
├─ robots.txt
├─ sitemap.xml
└─ README.md

```
> 기능 단위로 JS 모듈을 분리하여 유지보수성과 확장성을 고려한 구조로 설계했습니다.  
> `/workers` 디렉터리는 Cloudflare Worker 배포용 코드로, 외부 API 프록시 및 CORS/보안 처리를 담당합니다.

---

## 🧪 트러블 슈팅 (Troubleshooting)

> 실서비스 운영 중 직면한 기술적 한계를 극복하고 성능과 안정성을 개선한 핵심 사례입니다.

### 1. 대규모 실시간 데이터 렌더링 최적화 (DOM 작업량 90% 절감)
- **문제**: 400개 이상의 실시간 시세 행을 3초 주기로 전체 갱신 시<br> 불필요한 DOM 조작으로 인한 브라우저 메인 스레드 점유 및 스크롤 버벅임 발생.

- **해결**: `IntersectionObserver` API를 활용하여 <br>사용자 화면(Viewport)에 노출된 행만 업데이트하는 부분 렌더링 로직 구현.

- **결과**: 불필요한 리렌더링을 획기적으로 줄여 <br>저사양 기기에서도 끊김 없는 실시간 테이블 구현.

### 2. 외부 API 의존성 극복 및 가용성 확보 (SWR & Multi-level Caching)
- **문제**: 외부 거래소 API의 호출 제한(Rate Limit) 및 <br>일시적 장애 시 서비스 전체가 중단되는 리스크 존재.

- **해결**: 
  - **Edge**: Cloudflare Workers를 통해 외부 API 요청을 <br>중계하고 데이터 성격별로 캐시(TTL) 적용.
  - **Client**: SWR(Stale-While-Revalidate) 패턴을 <br>도입하여 로컬 스토리지의 기존 데이터를 우선 렌더링 후 백그라운드 갱신.

- **결과**: API 호출 횟수 60% 이상 절감 및 외부 장애 시에도 <br>이전 데이터를 표시하는 Fallback 구조로 서비스 안정성 확보.

### 3. 운영 환경 예외 처리 및 하위 호환성 유지 (Storage Versioning)
- **문제**: 배포 후 데이터 구조 변경 시, 기존 유저의 로컬 스토리지에 <br>남은 구버전 데이터와 충돌하여 화이트 스크린(Runtime Error) 발생.

- **해결**: 앱 버전 키(`appVersion`)를 도입하여 버전 불일치 시 <br>스토리지 자동 초기화 로직 구현 및 모든 스토리지 접근부 `try-catch` 방어 코드 적용.

- **결과**: 업데이트 후 발생하는 사용자 이탈 리스크 제거 및<br> 다양한 브라우저 환경에서의 런타임 안정성 극대화.

### 🔍 추가 트러블슈팅 및 운영 개선 기록 (총 7건)
<details>
<summary>세부 이슈 및 개선 내역 펼치기</summary>

#### 4. 브라우저 CORS 정책 및 API Key 노출 문제
- **문제**: 브라우저에서 외부 API 직접 호출 시 CORS 차단 및 보안 키 노출 위험.

- **해결**: Cloudflare Worker를 프록시 서버로 <br>사용하여 서버 단에서 API 요청 중계 및 보안 헤더 설정.

- **결과**: 브라우저 환경에서도 안정적인 API 통신이 가능해졌고<br> 보안 및 확장성을 고려한 백엔드 구조의 필요성을 명확히 인식.

#### 5. 뉴스 페이지 폴링 시 UI 상태 초기화 문제
- **문제**: 주기적 데이터 갱신 시 사용자가 펼쳐둔 기사 목록(expanded state)이 초기화됨.

- **해결**: 전체 리렌더링 대신 기존 데이터에 <br>신규 데이터만 누적 추가하는 로직으로 변경하여 UI 상태 유지.

- **결과**: 데이터 갱신이 이루어져도 사용자가 <br>펼쳐둔 UI 상태가 유지되어 뉴스 페이지 사용성 개선.

#### 6. 실시간 알림 데이터 과다로 인한 가독성 저하
- **문제**: 거래/청산 알림이 누적되며 핵심 정보 파악이 어려워짐.

- **해결**: 알림 최대 표시 개수를 3건으로 제한하고 <br> 매수/매도 유형별 색상 구분을 통해 시인성 확보.

- **결과**: 핵심 정보 위주의 알림 표시가 가능해졌고 <br>실시간 알림 영역의 가독성과 사용성이 향상.

#### 7. 페이지 이동 시 사이드 패널 상태 초기화 문제
- **문제**: 메인/서브 페이지 이동 시 실시간 알림 기록이 사라짐.

- **해결**: `sessionStorage`를 활용하여 페이지 전환 간 <br>상태를 공유하고 로직을 모듈화하여 재사용성 향상.

- **결과**: 페이지 이동 후에도 알림 상태가 유지되어 UX 일관성 확보.   

#### 8. 무료 API 호출 제한 및 크레딧 최적화
- **문제**: 다수 지표 동시 호출로 인한 API 쿼터 부족 현상.

- **해결**: 가격(실시간), 환율(긴 주기) 등 데이터 특성에 <br> 따라 TTL 캐싱 주기를 이원화하여 호출 횟수 최적화.

- **결과**: API 호출을 최적화하여 체감 실시간성과 <br>운영 안정성을 동시에 확보.

#### 9. 거래소 점검 시 테이블 미생성 문제
- **문제**: 특정 거래소 점검 시 API 응답 부재로 화면이 깨지거나 빈 테이블 표시.

- **해결**: 마지막으로 정상 수신된 데이터를 localStorage에 <br>상시 백업하여 API 실패 시 Fallback 데이터로 활용.

- **결과**: 거래소 점검 상황에서도 테이블 구조와 <br>데이터가 유지되어 사용자 경험 저하를 방지할 수 있게 됨.

#### 10. 거래소 전환 시 지표 정합성 불일치 문제
- **문제**: Upbit ↔ Bithumb 전환 시 이전 거래소의 계산 데이터(스냅샷)가 UI에 남아있는 현상.

- **해결**: 과거 스냅샷 기반 로직을 제거하고 현재 리스트 기준 <br>즉시 재계산(LIVE) 방식으로 구조 단순화.

- **결과**: 거래소 전환 시 즉시 갱신을 보장하고 <br>상태 복잡도를 제거하여 데이터 정합성과 유지보수 효율을 개선함.

</details>

---
## 🚧 향후 개선 방향

- 서버 단 집계 로직 확장 (김프 과열 지표 등)
- Worker 단 캐싱 전략 고도화 및 API 장애 대응(backoff/fallback) 강화
- 데이터 품질 개선 (이상치 탐지/정합성 검증 규칙 고도화)
- 관측/모니터링 체계 추가 (에러 로깅, 실패율/지연 시간 추적)
- 사용자 트래픽 증가 대비 구조 확장성 검토



