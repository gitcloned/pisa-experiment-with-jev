import fs from "fs";
import path from "path";
import type { Section, Question } from "@/types";

const examsDir = path.join(process.cwd(), "exams");

export function loadSection(sectionId: string): Section {
  const file = path.join(examsDir, sectionId, "section.json");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function loadQuestions(sectionId: string): Question[] {
  const dir = path.join(examsDir, sectionId, "questions");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

export function loadQuestion(sectionId: string, questionId: number): Question {
  const file = path.join(examsDir, sectionId, "questions", `${questionId}.json`);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

export function loadAllSections(): Section[] {
  return fs
    .readdirSync(examsDir)
    .filter((f) => fs.statSync(path.join(examsDir, f)).isDirectory())
    .map((d) => loadSection(d));
}
