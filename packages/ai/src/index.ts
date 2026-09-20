export {
  embed,
  toVectorLiteral,
  type EmbedInputType,
  type EmbedRequest,
} from './embed.js';
export {
  rerank,
  safeRerank,
  RerankUnavailableError,
  type RerankRequest,
} from './rerank.js';
export { chatFast, chatAnswer, type ChatFastRequest, type ChatAnswerRequest } from './chat.js';
export type { ChatMessage, ChatResult, EmbedResult, RerankResult } from './types.js';

/** One interface for the three providers — swap/ablate behind this package. */