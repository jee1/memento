/**
 * Agent HTTP 서버
 * 하는 일: POST /chat, actionableLoop 호출, AgentResponse 반환
 * 주의: Core import 금지. 연관: actionableLoop, contracts, config
 */

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { runActionableLoop } from './loop/actionableLoop.js';
import { ToolRegistry } from './tools/registry.js';
import { createSearchTool } from './tools/searchTool.js';
import { StubSearchProvider } from './clients/searchClient.js';
import type { ChatRequest } from './schemas/contracts.js';

const app = express();
app.use(cors());
app.use(express.json());

const toolRegistry = new ToolRegistry();
toolRegistry.register(createSearchTool(new StubSearchProvider()));

app.post('/chat', async (req, res) => {
  const body = req.body as Partial<ChatRequest>;
  const message = body?.message;
  const ownerId = body?.ownerId;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (!ownerId || typeof ownerId !== 'string') {
    res.status(400).json({ error: 'ownerId is required' });
    return;
  }

  const reqPayload: ChatRequest = {
    message: message.trim(),
    ownerId: ownerId.trim(),
    sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined
  };

  try {
    const response = await runActionableLoop(reqPayload, toolRegistry);
    res.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Agent loop failed', message: msg });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'memento-agent' });
});

const port = config.agentPort;
app.listen(port, () => {
  console.log(`Memento Agent listening on http://0.0.0.0:${port}`);
});
