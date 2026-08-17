// Idempotent seed for BUILTIN assistants.
// Uses findFirst-by-name (not upsert) because Assistant.name lacks @unique
// in the Prisma schema — Prisma's upsert requires a unique where-clause.
// See decisions.md: "T-101: seed idempotency via findFirst+create, not upsert".

import { prisma } from "../src/db.js";

interface BuiltinAssistant {
  name: string;
  category: "GENERAL" | "MEETINGS" | "SALES" | "TRANSLATION" | "INTERVIEW" | "STUDY" | "CUSTOM";
  prompt: string;
  icon: string | null;
}

const BUILTIN_ASSISTANTS: BuiltinAssistant[] = [
  {
    name: "General",
    category: "GENERAL",
    prompt:
      "You are a versatile AI assistant. Help the user with any question or task during their conversation, providing clear, concise, and accurate responses.",
    icon: null,
  },
  {
    name: "LeetCode",
    category: "INTERVIEW",
    prompt:
      "You are a coding interview coach specializing in algorithm and data structure problems. Help the user solve LeetCode-style questions by explaining approaches, analyzing complexity, and suggesting optimizations.",
    icon: null,
  },
  {
    name: "Note Taker",
    category: "MEETINGS",
    prompt:
      "You are a meeting note-taker assistant. Capture key points, decisions, and action items from the conversation. Organize notes clearly with headings and bullet points.",
    icon: null,
  },
  {
    name: "Sales",
    category: "SALES",
    prompt:
      "You are a sales conversation assistant. Help the user handle objections, highlight value propositions, and suggest persuasive responses during sales calls and meetings.",
    icon: null,
  },
  {
    name: "Study",
    category: "STUDY",
    prompt:
      "You are a study companion. Help the user understand concepts, create summaries, generate quiz questions, and explain topics from their lectures or study sessions.",
    icon: null,
  },
  {
    name: "Tech Candidate",
    category: "INTERVIEW",
    prompt:
      "You are a technical interview assistant. Help the user answer system design, behavioral, and technical interview questions with structured, compelling responses.",
    icon: null,
  },
];

export async function seed(): Promise<void> {
  for (const builtin of BUILTIN_ASSISTANTS) {
    const existing = await prisma.assistant.findFirst({
      where: { name: builtin.name, source: "BUILTIN" },
    });
    if (!existing) {
      await prisma.assistant.create({
        data: {
          name: builtin.name,
          category: builtin.category,
          source: "BUILTIN",
          prompt: builtin.prompt,
          icon: builtin.icon,
          userId: null,
        },
      });
    }
  }
}
