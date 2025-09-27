/**
 * @memento/client AI Agent 통합 예제
 * 
 * 이 예제는 AI Agent와 Memento 클라이언트를 통합하는 방법을 보여줍니다.
 */

import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';

/**
 * AI Agent 클래스 - Memento와 통합된 AI Agent
 */
class AIAgent {
  private client: MementoClient;
  private memoryManager: MemoryManager;
  private injector: ContextInjector;
  private sessionId: string;

  constructor(serverUrl: string, apiKey?: string) {
    this.client = new MementoClient({
      serverUrl,
      apiKey,
      logLevel: 'info'
    });
    
    this.memoryManager = new MemoryManager(this.client);
    this.injector = new ContextInjector(this.client);
    this.sessionId = `session_${Date.now()}`;
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    console.log('🤖 AI Agent가 초기화되었습니다');
  }

  async processMessage(userMessage: string): Promise<string> {
    console.log(`\n👤 사용자: ${userMessage}`);
    
    try {
      // 1. 관련 기억을 컨텍스트로 주입
      const context = await this.injector.injectConversationContext(
        userMessage,
        1000
      );
      
      console.log('🧠 컨텍스트 주입 완료');
      
      // 2. AI 모델에 컨텍스트와 함께 전달 (시뮬레이션)
      const response = await this.generateResponse(userMessage, context.content);
      
      // 3. 새로운 기억 저장
      await this.memoryManager.create({
        content: `사용자: ${userMessage}\nAI: ${response}`,
        type: 'episodic',
        importance: 0.7,
        tags: ['conversation', 'ai-response', this.sessionId],
        source: 'ai-agent'
      });
      
      console.log('💾 대화가 기억에 저장되었습니다');
      
      return response;
      
    } catch (error) {
      console.error('❌ 메시지 처리 중 오류:', error);
      return '죄송합니다. 처리 중 오류가 발생했습니다.';
    }
  }

  private async generateResponse(message: string, context: string): Promise<string> {
    // 실제 AI 모델 호출을 시뮬레이션
    // 여기서는 간단한 규칙 기반 응답을 생성
    
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('안녕') || lowerMessage.includes('hello')) {
      return '안녕하세요! 무엇을 도와드릴까요?';
    }
    
    if (lowerMessage.includes('기억') || lowerMessage.includes('memory')) {
      return `기억에 대해 말씀하시는군요. 관련된 정보를 찾아보겠습니다.\n\n${context}`;
    }
    
    if (lowerMessage.includes('프로젝트') || lowerMessage.includes('project')) {
      const projectMemories = await this.memoryManager.search('프로젝트', {
        limit: 3
      });
      
      if (projectMemories.total_count > 0) {
        return `프로젝트 관련 정보를 찾았습니다:\n${projectMemories.items.map((item, index) => 
          `${index + 1}. ${item.content}`
        ).join('\n')}`;
      } else {
        return '프로젝트 관련 정보를 찾을 수 없습니다.';
      }
    }
    
    if (lowerMessage.includes('학습') || lowerMessage.includes('learn')) {
      return `학습에 대해 말씀하시는군요. 관련된 학습 자료를 찾아보겠습니다.\n\n${context}`;
    }
    
    // 기본 응답
    return `"${message}"에 대해 답변드리겠습니다. 관련 정보를 참고하여 답변하겠습니다.\n\n${context}`;
  }

  async getMemoryStats(): Promise<void> {
    const stats = await this.memoryManager.getStats();
    console.log('\n📊 현재 기억 통계:');
    console.log(`  총 기억 수: ${stats.total}`);
    console.log(`  타입별 분포:`);
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`    ${type}: ${count}개`);
    });
    console.log(`  최근 기억: ${stats.recent}개`);
  }

  async searchMemories(query: string): Promise<void> {
    const results = await this.memoryManager.search(query, { limit: 5 });
    console.log(`\n🔍 "${query}" 검색 결과 (${results.total_count}개):`);
    results.items.forEach((item, index) => {
      console.log(`  ${index + 1}. [${item.type}] ${item.content.substring(0, 100)}...`);
      console.log(`     점수: ${item.score?.toFixed(3)}, 중요도: ${item.importance}`);
    });
  }

  async cleanup(): Promise<void> {
    await this.client.disconnect();
    console.log('🤖 AI Agent가 종료되었습니다');
  }
}

/**
 * 프로젝트 관리자 클래스 - 프로젝트별 기억 관리
 */
class ProjectManager {
  private memoryManager: MemoryManager;
  private projectId: string;

  constructor(memoryManager: MemoryManager, projectId: string) {
    this.memoryManager = memoryManager;
    this.projectId = projectId;
  }

  async createProject(name: string, description: string): Promise<void> {
    await this.memoryManager.create({
      content: `프로젝트 생성: ${name}\n설명: ${description}`,
      type: 'episodic',
      project_id: this.projectId,
      importance: 0.8,
      tags: ['project', 'creation', 'milestone']
    });
    console.log(`📁 프로젝트 "${name}"이 생성되었습니다`);
  }

  async addTask(task: string, priority: 'high' | 'medium' | 'low' = 'medium'): Promise<void> {
    const importance = priority === 'high' ? 0.9 : priority === 'medium' ? 0.7 : 0.5;
    
    await this.memoryManager.create({
      content: `작업 추가: ${task}\n우선순위: ${priority}`,
      type: 'procedural',
      project_id: this.projectId,
      importance,
      tags: ['task', 'project', priority]
    });
    console.log(`✅ 작업 "${task}"이 추가되었습니다 (우선순위: ${priority})`);
  }

  async completeTask(taskId: string): Promise<void> {
    await this.memoryManager.create({
      content: `작업 완료: ${taskId}`,
      type: 'episodic',
      project_id: this.projectId,
      importance: 0.6,
      tags: ['task', 'completion', 'milestone']
    });
    console.log(`🎉 작업 "${taskId}"이 완료되었습니다`);
  }

  async getProjectHistory(): Promise<void> {
    const history = await this.memoryManager.searchByProject(this.projectId);
    console.log(`\n📋 프로젝트 "${this.projectId}" 히스토리 (${history.total_count}개):`);
    history.items.forEach((item, index) => {
      console.log(`  ${index + 1}. [${item.type}] ${item.content}`);
      console.log(`     생성일: ${item.created_at}, 중요도: ${item.importance}`);
    });
  }
}

/**
 * 학습 관리자 클래스 - 학습 관련 기억 관리
 */
class LearningManager {
  private memoryManager: MemoryManager;
  private injector: ContextInjector;

  constructor(memoryManager: MemoryManager, injector: ContextInjector) {
    this.memoryManager = memoryManager;
    this.injector = injector;
  }

  async studyTopic(topic: string, content: string, difficulty: 'easy' | 'medium' | 'hard' = 'medium'): Promise<void> {
    const importance = difficulty === 'hard' ? 0.9 : difficulty === 'medium' ? 0.7 : 0.5;
    
    await this.memoryManager.create({
      content: `학습 주제: ${topic}\n내용: ${content}`,
      type: 'semantic',
      importance,
      tags: ['learning', topic, difficulty]
    });
    console.log(`📚 "${topic}" 학습 내용이 저장되었습니다 (난이도: ${difficulty})`);
  }

  async reviewTopic(topic: string): Promise<void> {
    const context = await this.injector.injectLearningContext(topic, 1500);
    console.log(`\n📖 "${topic}" 복습 자료:`);
    console.log(context.content);
  }

  async getLearningProgress(): Promise<void> {
    const learningMemories = await this.memoryManager.searchByType('semantic');
    const topics = new Set<string>();
    
    learningMemories.items.forEach(item => {
      if (item.tags) {
        item.tags.forEach(tag => {
          if (tag !== 'learning') topics.add(tag);
        });
      }
    });
    
    console.log(`\n📈 학습 진행 상황:`);
    console.log(`  학습한 주제 수: ${topics.size}`);
    console.log(`  학습한 주제들: ${Array.from(topics).join(', ')}`);
  }
}

/**
 * 메인 예제 함수
 */
async function aiAgentIntegrationExample() {
  console.log('🚀 AI Agent 통합 예제\n');

  // AI Agent 초기화
  const agent = new AIAgent('http://localhost:8080', 'your-api-key');
  await agent.initialize();

  // 프로젝트 관리자 초기화
  const projectManager = new ProjectManager(agent.memoryManager, 'ai-agent-demo');
  
  // 학습 관리자 초기화
  const learningManager = new LearningManager(agent.memoryManager, agent.injector);

  try {
    // 1. 프로젝트 생성 및 관리
    console.log('📁 프로젝트 관리');
    await projectManager.createProject(
      'AI Agent 개발',
      'Memento를 활용한 AI Agent 개발 프로젝트'
    );
    
    await projectManager.addTask('기억 시스템 설계', 'high');
    await projectManager.addTask('컨텍스트 주입 구현', 'medium');
    await projectManager.addTask('테스트 작성', 'low');
    
    await projectManager.completeTask('기억 시스템 설계');
    await projectManager.getProjectHistory();

    // 2. 학습 관리
    console.log('\n📚 학습 관리');
    await learningManager.studyTopic(
      'TypeScript',
      'TypeScript는 JavaScript의 상위 집합으로, 정적 타입 검사를 제공합니다.',
      'medium'
    );
    
    await learningManager.studyTopic(
      'Machine Learning',
      '머신러닝은 데이터로부터 패턴을 학습하는 AI의 한 분야입니다.',
      'hard'
    );
    
    await learningManager.getLearningProgress();

    // 3. AI Agent와 대화
    console.log('\n💬 AI Agent와 대화');
    
    const messages = [
      '안녕하세요!',
      '기억에 대해 설명해주세요',
      '프로젝트 진행 상황은 어떤가요?',
      'TypeScript에 대해 복습하고 싶어요',
      '학습한 내용을 정리해주세요'
    ];
    
    for (const message of messages) {
      const response = await agent.processMessage(message);
      console.log(`🤖 AI: ${response}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
    }

    // 4. 기억 검색 및 통계
    console.log('\n🔍 기억 검색');
    await agent.searchMemories('프로젝트');
    await agent.searchMemories('학습');
    
    await agent.getMemoryStats();

    // 5. 복습 및 정리
    console.log('\n📖 복습 및 정리');
    await learningManager.reviewTopic('TypeScript');
    await learningManager.reviewTopic('Machine Learning');

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    await agent.cleanup();
  }
}

// 예제 실행
if (require.main === module) {
  aiAgentIntegrationExample().catch(console.error);
}

export { AIAgent, ProjectManager, LearningManager, aiAgentIntegrationExample };
