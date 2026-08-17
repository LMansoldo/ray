-- CreateEnum
CREATE TYPE "ProviderConnectionMode" AS ENUM ('API_KEY', 'SUBSCRIPTION', 'AGGREGATOR', 'COMPATIBLE_ENDPOINT');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'DEEPSEEK', 'OPENROUTER', 'GENERIC');

-- CreateEnum
CREATE TYPE "AiFunction" AS ENUM ('TRANSCRIPTION', 'ANALYSIS', 'TRANSLATION');

-- CreateEnum
CREATE TYPE "SttEngine" AS ENUM ('APPLE_SPEECH', 'WHISPER_LOCAL', 'CLOUD');

-- CreateEnum
CREATE TYPE "Speaker" AS ENUM ('SELF', 'OTHERS');

-- CreateEnum
CREATE TYPE "AssistantCategory" AS ENUM ('GENERAL', 'MEETINGS', 'SALES', 'TRANSLATION', 'INTERVIEW', 'STUDY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AssistantSource" AS ENUM ('BUILTIN', 'USER');

-- CreateEnum
CREATE TYPE "SuggestionTrigger" AS ENUM ('AUTO', 'ANALYZE_CONVERSATION', 'SCREEN_CAPTURE', 'ASK_ANYTHING', 'ANALYZE_SELECTION');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "MeetingPlatform" AS ENUM ('ZOOM', 'GOOGLE_MEET', 'MICROSOFT_TEAMS', 'HANGOUTS', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "uiLanguage" TEXT NOT NULL DEFAULT 'pt',
    "targetLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "micDeviceId" TEXT,
    "incomingDeviceId" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "shortcuts" JSONB NOT NULL DEFAULT '{}',
    "retentionDays" INTEGER,
    "activeAssistantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyRef" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "connectionMode" "ProviderConnectionMode" NOT NULL,
    "label" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "baseUrl" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKeyRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAssignment" (
    "id" TEXT NOT NULL,
    "function" "AiFunction" NOT NULL,
    "model" TEXT,
    "apiKeyRefId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assistant" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "category" "AssistantCategory" NOT NULL,
    "source" "AssistantSource" NOT NULL DEFAULT 'USER',
    "prompt" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "platform" "MeetingPlatform" NOT NULL DEFAULT 'OTHER',
    "sourceLanguage" TEXT,
    "targetLanguage" TEXT,
    "sttEngine" "SttEngine",
    "assistantId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "speaker" "Speaker" NOT NULL,
    "text" TEXT NOT NULL,
    "translatedText" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trigger" "SuggestionTrigger" NOT NULL,
    "contextLabel" TEXT,
    "theySaid" TEXT,
    "sayThis" TEXT NOT NULL,
    "providerKind" "ProviderKind",
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "speakingTimeSec" INTEGER NOT NULL DEFAULT 0,
    "questionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "objectionsHandled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");

-- CreateIndex
CREATE INDEX "ApiKeyRef_userId_idx" ON "ApiKeyRef"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyRef_userId_kind_label_key" ON "ApiKeyRef"("userId", "kind", "label");

-- CreateIndex
CREATE INDEX "ProviderAssignment_apiKeyRefId_idx" ON "ProviderAssignment"("apiKeyRefId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAssignment_userId_function_key" ON "ProviderAssignment"("userId", "function");

-- CreateIndex
CREATE INDEX "Assistant_userId_idx" ON "Assistant"("userId");

-- CreateIndex
CREATE INDEX "Assistant_category_idx" ON "Assistant"("category");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE INDEX "TranscriptSegment_sessionId_startMs_idx" ON "TranscriptSegment"("sessionId", "startMs");

-- CreateIndex
CREATE INDEX "Suggestion_sessionId_createdAt_idx" ON "Suggestion"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Summary_sessionId_key" ON "Summary"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceMetric_sessionId_key" ON "PerformanceMetric"("sessionId");

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_activeAssistantId_fkey" FOREIGN KEY ("activeAssistantId") REFERENCES "Assistant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyRef" ADD CONSTRAINT "ApiKeyRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAssignment" ADD CONSTRAINT "ProviderAssignment_apiKeyRefId_fkey" FOREIGN KEY ("apiKeyRefId") REFERENCES "ApiKeyRef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
