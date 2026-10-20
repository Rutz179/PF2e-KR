# PF2e-KR — Pathfinder 2e 한국어 컴팬디움 (Foundry VTT v14)

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
