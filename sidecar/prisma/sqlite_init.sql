-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT,
    "uiLanguage" TEXT NOT NULL DEFAULT 'pt',
    "targetLanguage" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "micDeviceId" TEXT,
    "incomingDeviceId" TEXT,
    "features" TEXT NOT NULL DEFAULT '{}',
    "shortcuts" TEXT NOT NULL DEFAULT '{}',
    "sttLanguage" TEXT NOT NULL DEFAULT 'pt-BR',
    "overlayTemplateEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overlayTemplate" TEXT NOT NULL DEFAULT '',
    "retentionDays" INTEGER,
    "activeAssistantId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Settings_activeAssistantId_fkey" FOREIGN KEY ("activeAssistantId") REFERENCES "Assistant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKeyRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "connectionMode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "baseUrl" TEXT,
    "lastValidatedAt" DATETIME,
    "slot" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKeyRef_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "function" TEXT NOT NULL,
    "model" TEXT,
    "apiKeyRefId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderAssignment_apiKeyRefId_fkey" FOREIGN KEY ("apiKeyRefId") REFERENCES "ApiKeyRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assistant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "prompt" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assistant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "platform" TEXT NOT NULL DEFAULT 'OTHER',
    "sourceLanguage" TEXT,
    "targetLanguage" TEXT,
    "sttEngine" TEXT,
    "assistantId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "rollingSummary" TEXT,
    "summarizedSegmentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "translatedText" TEXT,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranscriptSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "contextLabel" TEXT,
    "theySaid" TEXT,
    "sayThis" TEXT NOT NULL,
    "providerKind" TEXT,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Summary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actionItems" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Summary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "speakingTimeSec" INTEGER NOT NULL DEFAULT 0,
    "questionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "objectionsHandled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PerformanceMetric_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");

-- CreateIndex
CREATE INDEX "ApiKeyRef_userId_idx" ON "ApiKeyRef"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyRef_userId_slot_key" ON "ApiKeyRef"("userId", "slot");

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

