import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import API from "../../../api";
import { Button } from "../../ui/button";
import { ArrowLeft, ArrowRight, ClipboardCheck, Heart } from "lucide-react";
import { ProgressHeader } from "./guided/ProgressHeader";
import { GuidanceCards } from "./guided/GuidanceCards";
import { GuideToggle } from "./guided/GuideToggle";
import { QuestionCard } from "./guided/QuestionCard";
import { useLanguage } from "../../../i18n/LanguageContext";
import { useOfficialTranslation } from "../../../i18n/officialQuestionnaire";
import { ResumeProgressDialog } from "./guided/ResumeProgressDialog";
import { useScreeningProgress } from "./guided/useScreeningProgress";

interface MCHATFormProps {
  child: any;
  flowContext?: any;
  onComplete: (results: any) => void;
}

function mchatHint(questionNumber1Based: number) {
  if (questionNumber1Based <= 5) return "Think about what your child does on most days.";
  if (questionNumber1Based <= 10) return "If it happens sometimes, answer based on what’s typical lately.";
  if (questionNumber1Based <= 15) return "It’s okay to pause and observe — your best guess helps.";
  return "You’re close — answer based on everyday routines and play.";
}

export function MCHATForm({ child, flowContext, onComplete }: MCHATFormProps) {
  const progress = useScreeningProgress({ type: "mchat", childId: child?.id, initialStep: 0 });
  const { answers, currentStep: currentPageIndex, setAnswer, setStep } = progress;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<any>(null);
  const { t, lang } = useLanguage();
  const official = useOfficialTranslation("mchat", lang);
  const [loading, setLoading] = useState(true);
  const [guideMode, setGuideMode] = useState(true);
  const [activeLocalIndex, setActiveLocalIndex] = useState(0);

  const questionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const fetchQuestionnaire = async () => {
      try {
        const params = new URLSearchParams();
        params.set('dob', child.dateOfBirth);
        params.set('childId', encodeURIComponent(String(child.id)));
        if (flowContext?.flow) params.set('flow', String(flowContext.flow));
        if (flowContext?.origin) params.set('origin', String(flowContext.origin));
        if (flowContext?.skippedMchat === true) params.set('skippedMchat', 'true');
        if (flowContext?.orderFollowed === true) params.set('orderFollowed', 'true');
        if (flowContext?.orderFollowed === false) params.set('orderFollowed', 'false');
        const response = await API.get(
          `/screening/questionnaires/MCHAT-R?${params.toString()}`
        );
        setQuestionnaire(response.data.data);
      } catch (error) {
        console.error('Error fetching MCHAT-R questionnaire:', error);
        toast.error('Failed to load questionnaire');
      } finally {
        setLoading(false);
      }
    };

    fetchQuestionnaire();
  }, [child.dateOfBirth]);

  const totalQuestions = questionnaire ? questionnaire.questions.length : 0;
  const questionsPerPage = 5;
  const totalPages = Math.ceil(totalQuestions / questionsPerPage);

  // Get questions for current page
  const startQuestionIndex = currentPageIndex * questionsPerPage;
  const endQuestionIndex = Math.min(startQuestionIndex + questionsPerPage, totalQuestions);
  const currentPageQuestions = questionnaire?.questions.slice(startQuestionIndex, endQuestionIndex) || [];

  // Check if all questions on current page are answered
  const isPageAnswered = currentPageQuestions.every((question: any) => answers[question.questionId] !== undefined);

  const firstUnansweredLocalIndex = useMemo(() => {
    for (let i = 0; i < currentPageQuestions.length; i++) {
      const q = currentPageQuestions[i];
      if (answers[q.questionId] === undefined) return i;
    }
    return -1;
  }, [answers, currentPageQuestions]);

  useEffect(() => {
    // when page changes, jump to the next unanswered (or first)
    const nextIdx = firstUnansweredLocalIndex === -1 ? 0 : firstUnansweredLocalIndex;
    setActiveLocalIndex(nextIdx);
    requestAnimationFrame(() => {
      const el = questionRefs.current[nextIdx];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as any)?.focus?.();
    });
  }, [currentPageIndex, firstUnansweredLocalIndex]);

  const handleAnswer = (questionId: string, value: string, localIndex: number) => {
    setAnswer(questionId, value);

    // move focus/scroll to next question on the page
    const nextIndex = Math.min(localIndex + 1, currentPageQuestions.length - 1);
    const nextQuestion = currentPageQuestions[nextIndex];
    const nextTarget =
      nextQuestion && answers[nextQuestion.questionId] === undefined ? nextIndex : firstUnansweredLocalIndex;

    const resolved = nextTarget === -1 ? nextIndex : nextTarget;
    setActiveLocalIndex(resolved);
    requestAnimationFrame(() => {
      const el = questionRefs.current[resolved];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as any)?.focus?.();
    });
  };

  const handleBack = () => {
    if (currentPageIndex > 0) {
      setStep(currentPageIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentPageIndex < totalPages - 1) {
      if (!isPageAnswered) return;
      setStep(currentPageIndex + 1);
    }
  };

  const handleSubmit = async () => {
    const finalAnswers = answers;
    if (Object.keys(finalAnswers).length < totalQuestions) {
      toast.error('Please answer all questions before submitting');
      return;
    }

    setIsSubmitting(true);

    try {
      const responses = Object.entries(finalAnswers).map(([questionId, answer]) => ({
        questionId,
        answer,
      }));

      const res = await API.post("/screening/calculate-screening", {
        childId: child.id,
        questionnaireType: 'MCHAT-R',
        dob: child.dateOfBirth,
        weeksPreterm: 0,
        responses,
        skippedMchat: flowContext?.skippedMchat === true,
        orderFollowed: typeof flowContext?.orderFollowed === 'boolean' ? flowContext.orderFollowed : undefined,
      });

      const submission = res.data.data;
      const results = {
        submissionId: submission.submissionId,
        riskLevel: submission.riskLevel,
        type: "M-CHAT-R",
        date: submission.createdAt,
        scores: submission.scores,
        result: submission.result,
        resultDescription: submission.resultDescription,
        decisionSupport: submission.decisionSupport || null,
        reportEmailed: submission.reportEmailed === true,
        reportEmailError: submission.reportEmailError || null,
      };
      progress.clear();
      onComplete(results);
    } catch (err) {
      console.error('Error submitting screening:', err);
      toast.error("Failed to submit screening. Check console.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <ResumeProgressDialog
        open={progress.showResumeDialog}
        onOpenChange={progress.setShowResumeDialog}
        progress={progress.resumeCandidate}
        onResume={progress.resume}
        onStartOver={progress.startOver}
      />

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-foreground">M-CHAT-R™</div>
            <div className="text-sm text-muted-foreground">
              {child?.firstName} {child?.lastName}
            </div>
          </div>
        </div>

        <ProgressHeader
          title="Guided screening questionnaire"
          subtitle="Answer based on what you’ve noticed in everyday life."
          stepLabel={`Page ${currentPageIndex + 1} of ${totalPages}`}
          current={currentPageIndex + 1}
          total={totalPages}
        />

        <GuidanceCards
          items={[
            { tone: "friendly", title: "You’re doing fine", body: "There are no trick questions." },
            { tone: "info", title: "Most days matter", body: "Answer based on typical behavior on most days." },
            { tone: "progress", title: "Pause anytime", body: "Your answers are auto-saved while you respond." },
            { tone: "friendly", title: "Almost there", body: "You’re doing a great job completing this screening." },
          ]}
          currentIndex={currentPageIndex}
        />

        <GuideToggle enabled={guideMode} onChange={setGuideMode} />

        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-semibold text-foreground">This page</div>
          <div className="mt-1 text-xs text-muted-foreground">Answer all 5 to continue.</div>
        </div>

        <div className="pb-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Heart className="h-4 w-4 text-accent" />
            Take your time — smooth scrolling will guide you.
          </span>
        </div>

        {official.missing ? (
          <p dir="auto" className="ur-text rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t("screening.noOfficialTranslation")}
          </p>
        ) : null}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPageIndex}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22 }}
            className="space-y-3"
          >
            {currentPageQuestions.map((question: any, localIndex: number) => {
              const globalNumber = startQuestionIndex + localIndex + 1;
              const value = answers[question.questionId];
              const answered = value !== undefined;
              const active = localIndex === activeLocalIndex;
              return (
                <QuestionCard
                  key={question.questionId}
                  indexLabel={String(globalNumber)}
                  text={official.item(question.questionId, question.text)}
                  value={value}
                  answered={answered}
                  active={active}
                  hint={mchatHint(globalNumber)}
                  showHint={guideMode && active}
                  options={[
                    { value: "yes", label: official.option("yes", t("answer.yes")) },
                    { value: "no", label: official.option("no", t("answer.no")) },
                  ]}
                  onSelect={(v) => handleAnswer(question.questionId, v, localIndex)}
                  containerRef={(el) => {
                    questionRefs.current[localIndex] = el;
                  }}
                />
              );
            })}
          </motion.div>
        </AnimatePresence>

        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <Button variant="outline" onClick={handleBack} disabled={currentPageIndex === 0 || isSubmitting}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>

            {currentPageIndex === totalPages - 1 ? (
              <Button
                onClick={() => handleSubmit()}
                disabled={!isPageAnswered || isSubmitting}
                className="rounded-xl"
              >
                {isSubmitting ? "Submitting…" : "Submit"}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                disabled={!isPageAnswered || isSubmitting}
                className="rounded-xl"
              >
                Save & Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
