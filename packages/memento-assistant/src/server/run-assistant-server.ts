#!/usr/bin/env node
/**
 * Assistant runtime 실행 엔트리포인트.
 * Core HTTP API에 연결된 bridge를 주입해 createAssistantApp()를 기동한다.
 * 환경 변수: ASSISTANT_PORT | PORT (기본 8090), MEMENTO_CORE_URL (기본 http://localhost:3000).
 */
import { createCoreToolHttpClient } from 'memento-core';
import { createAssistantApp } from './assistant-http-server.js';
import { createRuntimeCoreBridge } from './runtime-core-bridge.js';

export interface AssistantRuntimeEnv {
  assistantPort: number;
  coreServerUrl: string;
}

export function resolveAssistantRuntimeEnv(
  env: NodeJS.ProcessEnv
): AssistantRuntimeEnv {
  const assistantPort = Number(env.ASSISTANT_PORT ?? env.PORT ?? 8090);
  const coreServerUrl = env.MEMENTO_CORE_URL ?? 'http://localhost:3000';
  return { assistantPort, coreServerUrl };
}

export function createAssistantRuntimeApp(
  env: NodeJS.ProcessEnv = process.env
) {
  const config = resolveAssistantRuntimeEnv(env);
  const coreClient = createCoreToolHttpClient({ serverUrl: config.coreServerUrl });
  const bridge = createRuntimeCoreBridge(coreClient);
  return {
    app: createAssistantApp(bridge),
    config,
  };
}

if (process.argv[1]?.includes('run-assistant-server')) {
  const { app, config } = createAssistantRuntimeApp();
  app.listen(config.assistantPort, () => {
    console.log(
      `Assistant runtime listening on http://localhost:${config.assistantPort}`
    );
  });
}
