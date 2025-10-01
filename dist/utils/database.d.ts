/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */
import Database from 'better-sqlite3';
export declare class DatabaseUtils {
    private static transactionStates;
    /**
     * 트랜잭션 상태 확인
     */
    private static getTransactionState;
    /**
     * 트랜잭션 상태 설정
     */
    private static setTransactionState;
    /**
     * SQLite3 쿼리를 실행 (재시도 로직 포함)
     */
    static run(db: Database.Database, sql: string, params?: any[], maxRetries?: number): Database.RunResult;
    /**
     * SQLite3 쿼리 결과를 가져오기 (재시도 로직 포함)
     */
    static get(db: Database.Database, sql: string, params?: any[], maxRetries?: number): any;
    /**
     * SQLite3 쿼리 결과 배열을 가져오기 (재시도 로직 포함)
     */
    static all(db: Database.Database, sql: string, params?: any[], maxRetries?: number): any[];
    /**
     * SQLite3 exec 실행
     */
    static exec(db: Database.Database, sql: string): void;
    /**
     * 트랜잭션을 재시도 로직과 함께 실행 (개선된 버전)
     */
    static runTransaction<T>(db: Database.Database, transactionFn: () => T | Promise<T>, maxRetries?: number): Promise<T>;
    /**
     * WAL 체크포인트 실행 (락 해제용)
     */
    static checkpointWAL(db: Database.Database): void;
    /**
     * 트랜잭션 상태 확인
     */
    static isInTransaction(db: Database.Database): boolean;
    /**
     * 트랜잭션 강제 정리 (비상시 사용)
     */
    static forceCleanupTransaction(db: Database.Database): void;
    /**
     * 데이터베이스 상태 확인
     */
    static getDatabaseStatus(db: Database.Database): {
        journalMode: string;
        walAutoCheckpoint: number;
        busyTimeout: number;
        isLocked: boolean;
        inTransaction: boolean;
    };
}
//# sourceMappingURL=database.d.ts.map