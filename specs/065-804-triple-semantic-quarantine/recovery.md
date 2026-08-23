# 재추출 복구 경로 (FR-006l)

**Spec**: [spec.md](./spec.md) | **Quickstart**: [quickstart.md](./quickstart.md)

격리는 출처 episodic 의 `triple_extracted` 플래그를 건드리지 않는다(FR-006k). 따라서 격리 후
같은 episodic 에서 재추출을 시도해도 "이미 처리됨"으로 스킵된다. **이는 의도된 동작이다.**

## 왜 지금 리셋하면 안 되는가

#805(재오염 차단)와 재조립 실패 원인이 해소되기 전에 플래그를 리셋하면 같은 파편이 다시 쌓인다.
2026-08 폴백률이 11.6%(119/1,022)이므로, 지금 재추출하면 **더 나쁜 것**이 생성된다.

## 복구 절차 (선행 조건 충족 후)

`relations.jsonl` 의 `extracted_from` 반대편이 출처 episodic ID 다.

```bash
# 1. 출처 episodic ID 목록 추출
jq -r 'select(.relation_type == "extracted_from") | .other_id' \
  .local/quarantine-065/relations.jsonl | sort -u > /tmp/source-episodics.txt
wc -l /tmp/source-episodics.txt   # 2026-08-23 기준 25,096행에서 중복 제거한 수

# 2. 플래그 리셋 (서버 정지 상태에서)
#    ⚠️ #805 와 재조립 실패 원인이 해소된 뒤에만 실행한다
sqlite3 "$DB_PATH" "UPDATE memory_item SET triple_extracted = 0
  WHERE id IN ($(paste -sd, /tmp/source-episodics.txt | sed "s/[^,]*/'&'/g"));"
```

## 선행 조건 체크리스트

- [ ] #805 — 파이프라인 산출물 재유입 차단
- [ ] `buildTripleSentence` 재조립 실패 원인 해소 (predicate 비한글 종결 / 구 형태)
- [ ] 2026-08 기준 11.6% 폴백률이 1% 미만으로 회복

## 2026-08-23 실측

| 항목 | 값 |
|---|---|
| 내보낸 관계 | 54,876행 |
| `extracted_from` | 25,096 |
| `supported_by` | 25,096 |
| 나머지 관계 타입 | 4,684 |

## `relations.jsonl` 은 커밋되지 않는다

이 파일은 `.local/quarantine-065/` 아래에만 둔다(FR-006b). 관계 자체는 기억 본문이 아니지만
54,876행의 ID 쌍이라 저장소에 넣을 물건이 아니다.

**이 파일이 사라지면 재추출 복구 경로도 사라진다.** `kg_triple` 은 subject/predicate/object 는
보존하지만 어느 episodic 에서 나왔는지는 담지 않는다. 격리를 실행하기 전에 `export-relations`
산출물을 별도 보관처에 복사해 두어야 한다 — 게이트 11 이 파일의 *존재* 만 확인하지, 그 파일이
격리 후에도 살아 있을지는 보장하지 않는다.
