# Data Model

스키마/엔티티 변경 없음.

런타임 변환만:

| Concept | Before | After |
|---------|--------|-------|
| System id with epoch-ms | partially `[PHONE]` | unchanged string |
| Korean mobile | `[PHONE]` | `[PHONE]` (unchanged intent) |
| Port / bare 10-digit junk | often `[PHONE]` | preserved when not phone-shaped |
