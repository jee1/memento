# Plan: dependency updates (#637)

## Packages (minor/patch only)

| Package | From | To |
|---------|------|-----|
| better-sqlite3 | ^12.4.1 | ^12.11.1 |
| @playwright/test | ^1.60.0 | ^1.61.1 |
| cors | ^2.8.5 | ^2.8.6 |
| @typescript-eslint/* | 8.62.0 | 8.62.1 |
| tsx | ^4.20.5 | ^4.23.0 |
| typescript | 5.9.2 | 5.9.3 |
| helmet | ^8.1.0 | ^8.2.0 |
| @types/express | ^5.0.3 | ^5.0.6 |
| axios (client) | ^1.18.1 | latest 1.x |

## Verification

1. `npm install` + `npm run rebuild-native`
2. `npm audit`
3. `npm run lint && npm run type-check && npm test`
