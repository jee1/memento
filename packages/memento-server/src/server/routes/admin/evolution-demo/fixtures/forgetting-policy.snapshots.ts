export const forgettingPolicyFixture = {
  "scenario_id": "forgetting-policy",
  "question": "같은 날 저장된 저중요·고중요 기억은 시간이 지나면 어떻게 달라질까요?",
  "snapshots": {
    "day-30": {
      "point_label": "30일 경과",
      "answer": "저중요 episodic(회의 잡음)은 망각 후보로 분류되어 소프트 삭제되었고, 고중요 결정(JWT Bearer 채택)은 semantic으로 승격되어 보존됩니다. 핀 고정된 운영 절차는 TTL과 무관하게 그대로 남습니다.",
      "memory_summary": {
        "episodic_count": 2,
        "semantic_count": 1,
        "forgotten_count": 1,
        "preserved_count": 2,
        "summary_text": "저중요 1건 망각, 고중요 1건 semantic 승격, 핀 1건 무기한 보존."
      },
      "memory_groups": [
        {
          "label": "회의 잡음 (저중요)",
          "importance": 0.2,
          "status": "망각 후보",
          "outcome": "forget",
          "pinned": false
        },
        {
          "label": "JWT Bearer 채택 결정 (고중요)",
          "importance": 0.9,
          "status": "semantic 승격",
          "outcome": "preserve",
          "pinned": false
        },
        {
          "label": "배포 체크리스트 (핀 고정)",
          "importance": 0.65,
          "status": "핀으로 보존",
          "outcome": "pin",
          "pinned": true
        }
      ],
      "explanation": "중요도가 낮은 episodic은 망각 정책 임계값(0.6) 아래로 떨어져 소프트 삭제됩니다. 고중요 사실은 수면 통합으로 semantic이 되어 TTL 망각에서 제외됩니다. 핀은 운영자가 명시적으로 보존을 지정한 경우입니다.",
      "timestamp": "2026-02-20T10:00:00.000Z"
    },
    "day-90": {
      "point_label": "90일 경과",
      "answer": "저중요 기억은 하드 삭제까지 진행되었고, 고중요 semantic은 답변에 계속 반영됩니다. 핀 고정 기억은 episodic 형태로도 만료 없이 유지됩니다.",
      "memory_summary": {
        "episodic_count": 1,
        "semantic_count": 1,
        "forgotten_count": 1,
        "preserved_count": 2,
        "summary_text": "저중요 완전 망각, 고중요 semantic 유지, 핀 episodic 영구 보존."
      },
      "memory_groups": [
        {
          "label": "회의 잡음 (저중요)",
          "importance": 0.2,
          "status": "완전 망각",
          "outcome": "forget",
          "pinned": false
        },
        {
          "label": "JWT Bearer 채택 결정 (고중요)",
          "importance": 0.9,
          "status": "semantic 유지",
          "outcome": "preserve",
          "pinned": false
        },
        {
          "label": "배포 체크리스트 (핀 고정)",
          "importance": 0.65,
          "status": "핀으로 보존",
          "outcome": "pin",
          "pinned": true
        }
      ],
      "explanation": "90일 TTL 이후 저중요 episodic은 hard delete까지 진행됩니다. semantic으로 승격된 고중요 사실은 망각 대상이 아니며 recall에 계속 기여합니다. 핀 고정은 episodic이라도 만료 정책을 우회해 보존합니다 — 핀 또는 semantic 전환이 ‘보존’으로 이어지는 이유입니다.",
      "timestamp": "2026-04-21T10:00:00.000Z"
    }
  }
};
