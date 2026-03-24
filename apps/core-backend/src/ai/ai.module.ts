import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { SearchModule } from '../search/search.module';
import { AiController } from './ai.controller';
import { AiConfigService } from './ai-config.service';
import { ModelProviderService } from './model-provider.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { ConversationService } from './conversation.service';
import { AgentService } from './agent.service';

@Module({
  imports: [AuthModule, forwardRef(() => JobsModule), SearchModule],
  controllers: [AiController],
  providers: [
    AiConfigService,
    ModelProviderService,
    ChunkingService,
    EmbeddingService,
    ConversationService,
    AgentService,
  ],
  exports: [AiConfigService, EmbeddingService],
})
export class AiModule {}
