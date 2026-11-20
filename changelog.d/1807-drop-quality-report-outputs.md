Removed
- 품질 리포트의 HTML 형식. `GET /api/v1/quality/report?format=html` 은 이제 400 `{ "error": "Unsupported report format", "supported": ["markdown", "json"] }` 로 답하고, 모르는 `format` 값도 같다(이전에는 500). `npm run quality:report -- --format html` 은 종료 코드 1 로 거부하고, 모르는 형식도 같다(이전에는 조용히 markdown). markdown 과 json 응답, `getReportData`, `/api/v1/quality/history`, 대시보드는 그대로다 (#1807)
- 품질 리포트를 만들 때마다 `logs/quality-report-<시각>.json` 을 남기던 자동 사본. 읽는 곳이 없었다. 일일 품질 측정 배치는 이제 리포트를 만들지 않고 측정과 기록만 하며, 배치 결과의 `details.reportFilePath` 도 없어졌다. 이미 쌓인 `logs/quality-report-*.json` 은 지우지 않으니 필요하면 직접 정리한다 (#1807)
