# PF2e-KR — Pathfinder 2e 한국어 컴팬디움 (Foundry VTT v14)

빌더와 모듈이 한 저장소에 있습니다. **빌드는 내 PC에서**, git에는 **작은 원본(코드·UI 번역·도구)만**,
완성된 팩은 **릴리스 파일(module.zip)에만** 올립니다. 릴리스는 지우면 용량이 바로 사라지지만, git 기록은 지울 수 없기 때문입니다.

**평소에는 `스튜디오 열기.bat`만 더블클릭하면 됩니다** — 상태 점검, DeepL 번역, 용어 통일, 빌드·배포가 한 창에 있습니다.

## 폴더
| 경로 | git | 내용 |
|---|---|---|
| `src/` `styles/` `lang/` | ✅ | 모듈 코드·스타일·UI 번역 |
| `packs/` | ❌ | 빌드된 팩 — **릴리스 zip에만** 들어감 |
| `module.base.json` | ✅ | 매니페스트의 **원본**. 제목·설명·스크립트·폴더 구성은 여기서 고칩니다 |
| `module.json` | ✅ | base + 빌드된 팩 목록으로 **자동 생성**. 직접 고치지 마세요 (다음 빌드에서 덮어씀) |
| `tools/` | ✅ | 빌드·배포·릴리스 스크립트, `tools/studio/` 스튜디오 |
| `스튜디오 열기.bat` | ✅ | 더블클릭 실행 |
| `compendium/` | ❌ | 번역 원본 사전 — git에 없으니 **따로 백업** |
| `deepl-tool/` | ❌ | 번역 작업용 도구 (로컬 전용) |
| `.build/` `reports/` `dist/` | ❌ | 빌드 중간물·보고서 |
| `node_modules/` | ❌ | 팩 빌드 도구. 게임·배포본엔 불필요. `npm install`로 언제든 다시 생김 |

## 처음 한 번
```bash
npm install
copy tools\local.config.example.json tools\local.config.json   # 경로를 내 PC에 맞게
git remote add origin https://github.com/Rutz179/PF2e-KR.git
```
`local.config.json`의 `foundryData` = 포터블 Foundry의 `Data` 폴더. PF2e 시스템은 `<foundryData>/systems/pf2e`에서
읽고, `npm run deploy`는 `<foundryData>/modules/PF2e-KR`로 복사합니다.

> 저장소는 `Data/modules` **바깥**에 두세요. Foundry가 모듈을 업데이트하면 그 폴더를 통째로 교체합니다.

## 명령
```bash
npm run build:all          # 번역 → 팩 빌드
npm run check              # 빌드 검사
npm run deploy             # 내 Foundry에 복사해서 테스트
npm run release -- 2.0.1   # 배포
```

## 배포
스튜디오 ④ 탭에서 버전을 넣고 **릴리스**, 또는 `npm run release -- 2.0.1 --keep 3`.
module.json 생성 → 검사 → `dist/module.zip`(팩 포함) → 버전 커밋·푸시(작은 텍스트만) → GitHub 릴리스 생성·업로드 →
`--keep 3`이면 최신 3개만 남기고 옛 릴리스 삭제.

필요한 것: `tools/local.config.json`의 `"githubToken"` — https://github.com/settings/personal-access-tokens 에서
**Fine-grained token → 이 저장소만 → Contents: Read and write**로 만든 값. (GitHub CLI는 필요 없음)

설치 주소(매니페스트): `https://github.com/Rutz179/PF2e-KR/releases/latest/download/module.json`

## 번역 유지보수 (스튜디오)
1. **① 상태 점검** — UI 문자열(누락/미번역/옛 키)과 팩별 미번역·새 항목 수. PF2e 업데이트 뒤 먼저 여기를 봅니다.
2. **② DeepL 번역** — 대상을 골라 **뽑기** → 복사해서 DeepL에 붙여넣기 → 결과를 붙여넣고 **미리보기** → 경고 없는 줄 **적용**.
   태그·링크·`{변수}`는 `⟦1⟧`로 보호되고, 줄 수가 다르면 적용을 막습니다. 적용 전 원본은 `.studio-backup/`에 백업.
3. **③ 용어 통일** — `glossary_conflicts.csv`를 불러와 빈도 높은 순으로 정리. 통일할 표현을 고르면 다른 표현이 쓰인 곳을
   문맥과 함께 보여주고, **체크한 곳만** 바꿉니다. 결정한 용어만 모아 작은 DeepL 용어집(`glossary.decided.csv`)으로 저장.
4. **④ 빌드·배포** — 전체 빌드 → 내 Foundry에 적용 → 확인 → 릴리스.

## 콘솔 도구 (GM)
```js
game.PF2eKR.localizeActorItems()          // 선택한 토큰: 주문·아이템·제작 공식 → 한글판
game.PF2eKR.localizeActorItems("world")   // 월드의 모든 액터
game.PF2eKR.localizeExisting()            // 붙어 있는 영문 상태/효과
game.PF2eKR.fixConditionGrants()          // 옛 빌드로 들어간 효과의 '신속' 등 상태 부여 수리
game.PF2eKR.resetPackFolders()            // 월드 폴더(예: 'PF2e 한국어')에 묶인 팩을 KR • 폴더로
```
