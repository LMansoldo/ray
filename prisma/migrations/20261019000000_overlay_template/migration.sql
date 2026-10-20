-- Overlay customizado (contracts/settings.ts): template HTML+CSS do usuário
-- e flag de ativação — defaults = InsightCard embutido.
ALTER TABLE "Settings" ADD COLUMN "overlayTemplateEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "overlayTemplate" TEXT NOT NULL DEFAULT '';
