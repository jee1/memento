/**
 * 사용 집계기 (#1768, ADR 2026-11-18-issue-1768-local-usage-aggregate 결정 4, 5)
 *
 * 호출 경로는 메모리 Map 만 만진다. DB 쓰기는 주기(기본 30초)와 종료 때 한 트랜잭션으로 한다.
 * 운영 DB 의 busy_timeout 이 60초이고 better-sqlite3 쓰기가 동기라서, 호출마다 쓰면 다른 프로세스가
 * 쓰기 잠금을 쥔 동안 호출 쪽 이벤트 루프가 멈출 수 있다. 프로세스가 여럿이어도
 * `count = count + excluded.count` 로 합쳐진다. 비정상 종료에서는 최대 한 주기치를 잃는다.
 *
 * 이 모듈은 인자나 결과, 오류 메시지를 받지 않는다. 입력은 UsageCountKey 하나뿐이다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';
import {
  OTHER_CLIENT,
  type ClientName,
  type ConnectionMethod,
  type Outcome,
  type ProtocolEra,
  type RequestKind,
  type UsageErrorCode,
} from './usage-vocabulary.js';

export interface UsageCountKey {
  clientName: ClientName;
  /** major.minor.patch 또는 빈 문자열 */
  clientVersion: string;
  connectionMethod: ConnectionMethod;
  era: ProtocolEra;
  requestKind: RequestKind;
  /** 등록된 도구 이름, other, 또는 빈 문자열(tools/call 이 아닐 때) */
  tool: string;
  outcome: Outcome;
  errorCode: UsageErrorCode;
}

export interface UsageAggregatorOptions {
  /** flush 간격(ms). 기본 30초. 0 이하면 타이머를 만들지 않는다(테스트가 직접 flush 한다). */
  flushIntervalMs?: number;
  /** 하루 서로 다른 열쇠 수 상한. 기본 2,000. */
  maxKeysPerDay?: number;
  /** 현재 시각. 테스트에서 고정한다. */
  now?: () => Date;
}

const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const DEFAULT_MAX_KEYS_PER_DAY = 2_000;
/** flush 가 계속 실패해 Map 이 이 배수를 넘으면 오래된 쪽부터 버린다. */
const MAX_PENDING_FACTOR = 2;

const SEP = '\u0001';

/** better-sqlite3 의 SQLITE_BUSY, SQLITE_LOCKED 계열. 이것만 다음 주기에 다시 시도한다. */
function isTransientLockError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class UsageAggregator {
  /** day + SEP + 열쇠 → 횟수. 삽입 순서가 곧 오래된 순서다. */
  private pending = new Map<string, number>();
  private readonly keysByDay = new Map<string, Set<string>>();
  private readonly flushIntervalMs: number;
  private readonly maxKeysPerDay: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private limitWarnedDay: string | null = null;

  constructor(
    private readonly db: Database.Database,
    options: UsageAggregatorOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxKeysPerDay = options.maxKeysPerDay ?? DEFAULT_MAX_KEYS_PER_DAY;
    this.now = options.now ?? (() => new Date());
  }

  /** 주기 flush 를 시작한다. 타이머는 프로세스 종료를 막지 않는다. */
  start(): void {
    if (this.timer || this.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  /** 타이머를 멈추고 남은 것을 마지막으로 쓴다. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /** 열쇠 하나를 센다. 실패하지 않는다. */
  count(key: UsageCountKey): void {
    const day = utcDay(this.now());
    const stored = this.admit(day, key);
    const id = day + SEP + stored;
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    this.dropOldestIfOverflowing();
  }

  /** 아직 DB 에 쓰지 않은 서로 다른 열쇠 수(테스트와 진단용). */
  pendingKeyCount(): number {
    return this.pending.size;
  }

  /**
   * 모은 것을 한 트랜잭션으로 쓴다. 실패하면 Map 을 지우지 않고 다음 주기에 다시 시도한다.
   * 도구 호출을 막지 않도록 예외를 던지지 않는다.
   */
  flush(): void {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      const upsert = this.db.prepare(
        `INSERT INTO usage_daily_count
           (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET count = count + excluded.count`,
      );
      this.db.transaction(() => {
        for (const [id, n] of batch) {
          const [day, client, version, method, era, kind, tool, outcome, code] = id.split(SEP);
          upsert.run(day, client, version, method, era, kind, tool, outcome, Number(code), n);
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTransientLockError(error)) {
        // 다른 프로세스가 쓰기 잠금을 쥐고 있다. 쓰지 못한 것을 새로 쌓인 것 앞에 되돌려 놓는다(삽입 순서 = 오래된 순서).
        const merged = new Map(batch);
        for (const [id, n] of this.pending) merged.set(id, (merged.get(id) ?? 0) + n);
        this.pending = merged;
        this.dropOldestIfOverflowing();
        logger.warn('usage aggregate flush deferred (database busy)', { error: message });
        return;
      }
      // 표가 없거나(마이그레이션 전, 되돌린 뒤) 제약에 걸리는 등 다시 해도 같은 결과인 실패다. 쌓아 두지 않고 버린다.
      logger.warn('usage aggregate flush failed, batch dropped', { error: message, keys: batch.size });
    }
  }

  /**
   * 하루 열쇠 수 상한을 지킨다(결정 5). 상한에 닿으면 새 열쇠는 버전을 비우고, 그래도 새 열쇠면 other 로 합친다.
   * 반환값은 SEP 로 이은 열쇠 문자열(day 제외)이다.
   */
  private admit(day: string, key: UsageCountKey): string {
    const seen = this.keysByDay.get(day) ?? this.newDay(day);
    const encode = (k: UsageCountKey) =>
      [k.clientName, k.clientVersion, k.connectionMethod, k.era, k.requestKind, k.tool, k.outcome, k.errorCode].join(SEP);

    const exact = encode(key);
    if (seen.has(exact) || seen.size < this.maxKeysPerDay) {
      seen.add(exact);
      return exact;
    }
    this.warnLimit(day);
    const versionless = encode({ ...key, clientVersion: '' });
    if (seen.has(versionless)) return versionless;
    const merged = encode({ ...key, clientName: OTHER_CLIENT, clientVersion: '' });
    seen.add(merged);
    return merged;
  }

  private newDay(day: string): Set<string> {
    // 어제까지의 집합은 더 필요 없다. 날짜가 바뀌면 비운다.
    this.keysByDay.clear();
    const set = new Set<string>();
    this.keysByDay.set(day, set);
    return set;
  }

  private warnLimit(day: string): void {
    if (this.limitWarnedDay === day) return;
    this.limitWarnedDay = day;
    logger.warn('usage aggregate daily key limit reached', { day, limit: this.maxKeysPerDay });
  }

  private dropOldestIfOverflowing(): void {
    const cap = this.maxKeysPerDay * MAX_PENDING_FACTOR;
    if (this.pending.size <= cap) return;
    const overflow = this.pending.size - cap;
    let dropped = 0;
    for (const id of this.pending.keys()) {
      if (dropped >= overflow) break;
      this.pending.delete(id);
      dropped += 1;
    }
    logger.warn('usage aggregate pending overflow, oldest entries dropped', { dropped });
  }
}
