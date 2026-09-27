import { loadSection, loadQuestions } from "@/lib/questions";
import { notFound } from "next/navigation";
import AssessmentClient from "./AssessmentClient";

export default async function ExamPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  try {
    const sectionData = loadSection(section);
    const questions = loadQuestions(section);
    return <AssessmentClient section={sectionData} questions={questions} />;
  } catch {
    notFound();
  }
}
